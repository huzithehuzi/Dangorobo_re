const test = require("node:test");
const assert = require("node:assert/strict");

const { createMemoryExtractionRunner } = require("../src/main/memory/memory-extraction-runner.js");
const {
  buildExtractionPrompt,
  buildOpenLoopsDetectionPrompt,
  buildLoopResolutionPrompt
} = require("../src/main/memory/memory-extraction.js");

// 분리 전 main.js가 askGemini에 넘기던 옵션 그대로여야 한다. maxHistoryTurns는
// includeMemory: false면 무시되는 값이지만 요청 모양을 바꾸지 않는다.
/** @param {number} maxOutputTokens */
function expectedAskOptions(maxOutputTokens) {
  return {
    shortQuestionMode: true,
    maxHistoryTurns: 0,
    includeMemory: false,
    maxOutputTokens,
    timeoutMs: 5000,
    retryOnTimeout: false
  };
}

/**
 * @param {{
 *   askResponses?: Array<string | Error>,
 *   openLoops?: Array<{ id: number, topic: string }>,
 *   episodeId?: number | null
 * }} [options]
 */
function createFakeDeps(options = {}) {
  const askResponses = [...(options.askResponses || [])];
  const calls = {
    /** @type {Array<{ userPrompt: string, options: Record<string, unknown> }>} */
    ask: [],
    /** @type {unknown[][]} */
    getAllMemories: [],
    /** @type {unknown[]} */
    insertMemory: [],
    getOpenLoops: 0,
    /** @type {unknown[][]} */
    closeOpenLoop: [],
    /** @type {unknown[]} */
    insertEpisode: [],
    /** @type {unknown[]} */
    insertOpenLoop: []
  };
  const deps = {
    ask: async (/** @type {string} */ userPrompt, /** @type {Record<string, unknown>} */ askOptions) => {
      calls.ask.push({ userPrompt, options: askOptions });
      const next = askResponses.shift();
      if (next instanceof Error) throw next;
      return next ?? "";
    },
    getAllMemories: (/** @type {number} */ limit) => {
      calls.getAllMemories.push([limit]);
      return [];
    },
    insertMemory: (/** @type {unknown} */ memory) => {
      calls.insertMemory.push(memory);
      return true;
    },
    getOpenLoops: () => {
      calls.getOpenLoops += 1;
      return options.openLoops || [];
    },
    closeOpenLoop: (/** @type {number} */ id, /** @type {string} */ note) => {
      calls.closeOpenLoop.push([id, note]);
      return true;
    },
    insertEpisode: (/** @type {unknown} */ episodeData) => {
      calls.insertEpisode.push(episodeData);
      return options.episodeId !== undefined ? options.episodeId : 1;
    },
    insertOpenLoop: (/** @type {unknown} */ loopData) => {
      calls.insertOpenLoop.push(loopData);
      return true;
    }
  };
  return { deps, calls };
}

// detectCompletionSignals가 걸리지 않는 답변으로 끝나는 대화.
const ONGOING_HISTORY = [
  { question: "자격증 시험 준비 중이야", answer: "응원할게, 진행 상황 알려줘" }
];
// "결과", "나왔어"가 완료 신호로 걸리는 대화.
const COMPLETED_HISTORY = [
  { question: "자격증 시험 봤어", answer: "결과가 나왔어? 궁금하다" }
];

test("성공 경로: 추출 저장 뒤 미완료 주제를 에피소드에 연결한다", async () => {
  const extractionJson = JSON.stringify([{
    category: "fact",
    memory_key: "cert_exam",
    memory_label: "자격증 시험",
    memory_value: "자격증 시험을 준비 중",
    importance: 0.8
  }]);
  const { deps, calls } = createFakeDeps({
    askResponses: [extractionJson, '[{"topic":"자격증 시험 결과 대기"}]'],
    episodeId: 7
  });
  await createMemoryExtractionRunner(deps)(ONGOING_HISTORY, "ko");

  assert.deepEqual(calls.getAllMemories, [[20]]);
  assert.equal(calls.ask.length, 2);
  const extractionPrompt = buildExtractionPrompt(ONGOING_HISTORY, "ko", []);
  assert.equal(calls.ask[0].userPrompt, extractionPrompt.userPrompt);
  assert.deepEqual(calls.ask[0].options, expectedAskOptions(extractionPrompt.maxTokens));
  const loopsPrompt = buildOpenLoopsDetectionPrompt(ONGOING_HISTORY, "ko", []);
  assert.equal(calls.ask[1].userPrompt, loopsPrompt.userPrompt);
  assert.deepEqual(calls.ask[1].options, expectedAskOptions(loopsPrompt.maxTokens));

  assert.deepEqual(calls.insertMemory, [{
    category: "fact",
    memory_key: "cert_exam",
    memory_label: "자격증 시험",
    memory_value: "자격증 시험을 준비 중",
    importance: 0.8
  }]);
  assert.equal(calls.insertEpisode.length, 1);
  const episodeData = /** @type {{ summary: string, keyTopics: string[] }} */ (calls.insertEpisode[0]);
  assert.ok(episodeData.summary.includes("(1턴)"));
  assert.deepEqual(episodeData.keyTopics, ["자격증 시험 결과 대기"]);
  assert.deepEqual(calls.insertOpenLoop, [{ episode_id: 7, topic: "자격증 시험 결과 대기" }]);
  assert.deepEqual(calls.closeOpenLoop, []);
});

test("기억 추출 응답이 비어도 미완료 주제 단계는 진행한다", async () => {
  const { deps, calls } = createFakeDeps({ askResponses: ["", '[{"topic":"시험 결과 대기"}]'] });
  await createMemoryExtractionRunner(deps)(ONGOING_HISTORY, "ko");

  assert.equal(calls.ask.length, 2);
  assert.deepEqual(calls.insertMemory, []);
  assert.equal(calls.insertEpisode.length, 1);
});

test("완료 신호: 열린 주제가 있을 때만 두 번째 호출로 해결 주제를 닫는다", async () => {
  const openLoops = [{ id: 11, topic: "자격증 시험" }, { id: 22, topic: "면접" }];
  const { deps, calls } = createFakeDeps({ askResponses: ["", "[1]"], openLoops });
  await createMemoryExtractionRunner(deps)(COMPLETED_HISTORY, "ko");

  assert.equal(calls.ask.length, 2);
  const resolutionPrompt = buildLoopResolutionPrompt(COMPLETED_HISTORY, openLoops, "ko");
  assert.equal(calls.ask[1].userPrompt, resolutionPrompt.userPrompt);
  assert.deepEqual(calls.ask[1].options, expectedAskOptions(resolutionPrompt.maxTokens));
  assert.deepEqual(calls.closeOpenLoop, [[11, "AI가 대화에서 완료 신호를 감지해 자동 종료"]]);
  assert.deepEqual(calls.insertEpisode, []);
  assert.deepEqual(calls.insertOpenLoop, []);
});

test("완료 신호에 열린 주제가 없으면 두 번째 호출을 하지 않는다", async () => {
  const { deps, calls } = createFakeDeps({ askResponses: [""] });
  await createMemoryExtractionRunner(deps)(COMPLETED_HISTORY, "ko");

  assert.equal(calls.ask.length, 1);
  assert.deepEqual(calls.closeOpenLoop, []);
  assert.deepEqual(calls.insertEpisode, []);
  assert.deepEqual(calls.insertOpenLoop, []);
});

test("미완료 주제 응답이 truthy면 파싱 결과가 비어도 에피소드는 만든다", async () => {
  const { deps, calls } = createFakeDeps({ askResponses: ["", "없음"] });
  await createMemoryExtractionRunner(deps)(ONGOING_HISTORY, "ko");

  assert.equal(calls.insertEpisode.length, 1);
  assert.deepEqual(/** @type {{ keyTopics: string[] }} */ (calls.insertEpisode[0]).keyTopics, []);
  assert.deepEqual(calls.insertOpenLoop, []);
});

test("미완료 주제 응답이 비면 에피소드도 만들지 않는다", async () => {
  const { deps, calls } = createFakeDeps({ askResponses: ["", ""] });
  await createMemoryExtractionRunner(deps)(ONGOING_HISTORY, "ko");

  assert.deepEqual(calls.insertEpisode, []);
  assert.deepEqual(calls.insertOpenLoop, []);
});

test("에피소드 삽입이 실패하면 미완료 주제를 저장하지 않는다", async () => {
  const { deps, calls } = createFakeDeps({
    askResponses: ["", '[{"topic":"시험 결과 대기"}]'],
    episodeId: null
  });
  await createMemoryExtractionRunner(deps)(ONGOING_HISTORY, "ko");

  assert.equal(calls.insertEpisode.length, 1);
  assert.deepEqual(calls.insertOpenLoop, []);
});

test("ask가 던져도 호출자에게 전파하지 않는다", async () => {
  const { deps, calls } = createFakeDeps({ askResponses: [new Error("네트워크 실패")] });
  await assert.doesNotReject(createMemoryExtractionRunner(deps)(ONGOING_HISTORY, "ko"));
  assert.equal(calls.ask.length, 1);
});

test("빈 대화 이력이면 아무것도 하지 않는다", async () => {
  const { deps, calls } = createFakeDeps();
  await createMemoryExtractionRunner(deps)([], "ko");
  assert.equal(calls.ask.length, 0);
  assert.equal(calls.getOpenLoops, 0);
});
