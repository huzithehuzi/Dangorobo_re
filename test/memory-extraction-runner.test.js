const test = require("node:test");
const assert = require("node:assert/strict");

const { createMemoryExtractionRunner } = require("../src/main/memory/memory-extraction-runner.js");
const {
  buildExtractionPrompt,
  buildOpenLoopsDetectionPrompt,
  buildLoopResolutionPrompt,
  buildForgetPrompt
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
 *   forgettableMemories?: Array<{ id: number, memory_label: string, memory_value: string }>,
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
    /** @type {unknown[][]} */
    getForgettableMemories: [],
    /** @type {number[]} */
    forgetMemory: [],
    /** @type {unknown[][]} */
    forgetOpenLoop: [],
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
    },
    getForgettableMemories: (/** @type {number} */ limit) => {
      calls.getForgettableMemories.push([limit]);
      return options.forgettableMemories || [];
    },
    forgetMemory: (/** @type {number} */ id) => {
      calls.forgetMemory.push(id);
      return true;
    },
    forgetOpenLoop: (/** @type {number} */ id, /** @type {string} */ note) => {
      calls.forgetOpenLoop.push([id, note]);
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

// ── 잊어달라는 요청 (2026-08-21) ──────────────────────────────────────────────────
//
// 로컬 키워드 검사를 통과한 대화에서만 LLM에게 무엇을 잊을지 묻는다. 그 배치에서는
// 다른 추출을 하지 않는다 — 같은 대화에서 기억·주제를 새로 뽑으면 방금 잊은 것이
// 다른 표현으로 되돌아오는 경로가 생긴다.

const FORGET_HISTORY = [
  { question: "내 커피 취향은 이제 잊어줘", answer: "알겠어, 지웠어" }
];
const FORGET_MEMORIES = [
  { id: 11, memory_label: "커피 취향", memory_value: "라떼를 좋아함" },
  { id: 12, memory_label: "아침 운동", memory_value: "매일 달리기" }
];
const FORGET_LOOPS = [{ id: 21, topic: "자격증 시험 결과" }];

test("잊어달라고 하면 지목된 기억과 주제만 잊는다", async () => {
  const { deps, calls } = createFakeDeps({
    askResponses: ['["M1", "L1"]'],
    forgettableMemories: FORGET_MEMORIES,
    openLoops: FORGET_LOOPS
  });
  await createMemoryExtractionRunner(deps)(FORGET_HISTORY, "ko");

  const forgetPrompt = buildForgetPrompt(FORGET_HISTORY, FORGET_MEMORIES, FORGET_LOOPS, "ko");
  assert.equal(calls.ask.length, 1, "잊기 판정 한 번만 부른다");
  assert.equal(calls.ask[0].userPrompt, forgetPrompt.userPrompt);
  assert.deepEqual(calls.ask[0].options, expectedAskOptions(forgetPrompt.maxTokens));

  assert.deepEqual(calls.forgetMemory, [11], "M1이 가리키는 행만 잊는다");
  assert.deepEqual(calls.forgetOpenLoop.map((call) => call[0]), [21]);
  assert.ok(String(calls.forgetOpenLoop[0][1]).length > 0, "사유를 남긴다");
});

test("잊기 배치에서는 기억 추출도 주제 추출도 하지 않는다", async () => {
  const { deps, calls } = createFakeDeps({
    askResponses: ['["M1"]'],
    forgettableMemories: FORGET_MEMORIES,
    openLoops: FORGET_LOOPS
  });
  await createMemoryExtractionRunner(deps)(FORGET_HISTORY, "ko");

  assert.deepEqual(calls.insertMemory, []);
  assert.deepEqual(calls.insertOpenLoop, []);
  assert.deepEqual(calls.insertEpisode, []);
  assert.deepEqual(calls.getAllMemories, [], "추출 프롬프트용 목록도 안 읽는다");
});

test("완료 신호와 잊기 신호가 같이 걸리면 잊기가 이긴다", async () => {
  // "그거 다 끝났으니 잊어줘"는 주제를 닫으라는 게 아니라 지우라는 요청이다.
  const history = [
    { question: "그거 다 끝났으니 이제 잊어줘", answer: "결과가 나왔구나, 지웠어" }
  ];
  const { deps, calls } = createFakeDeps({
    askResponses: ['["L1"]'],
    forgettableMemories: FORGET_MEMORIES,
    openLoops: FORGET_LOOPS
  });
  await createMemoryExtractionRunner(deps)(history, "ko");

  assert.deepEqual(calls.forgetOpenLoop.map((call) => call[0]), [21]);
  assert.deepEqual(calls.closeOpenLoop, [], "해결 판정 경로를 타지 않는다");
});

test("잊을 후보가 없으면 LLM을 부르지 않는다", async () => {
  const { deps, calls } = createFakeDeps({
    askResponses: ['["M1"]'],
    forgettableMemories: [],
    openLoops: []
  });
  await createMemoryExtractionRunner(deps)(FORGET_HISTORY, "ko");

  assert.equal(calls.ask.length, 0);
  assert.deepEqual(calls.forgetMemory, []);
});

test("빈 배열이 오면 아무것도 잊지 않는다", async () => {
  const { deps, calls } = createFakeDeps({
    askResponses: ["[]"],
    forgettableMemories: FORGET_MEMORIES,
    openLoops: FORGET_LOOPS
  });
  await createMemoryExtractionRunner(deps)(FORGET_HISTORY, "ko");

  assert.equal(calls.ask.length, 1);
  assert.deepEqual(calls.forgetMemory, []);
  assert.deepEqual(calls.forgetOpenLoop, []);
});

test("잊기 신호가 없는 대화는 기존 경로 그대로다", async () => {
  const { deps, calls } = createFakeDeps({
    askResponses: ["[]", "[]"],
    forgettableMemories: FORGET_MEMORIES
  });
  await createMemoryExtractionRunner(deps)(ONGOING_HISTORY, "ko");

  assert.deepEqual(calls.forgetMemory, []);
  assert.deepEqual(calls.getForgettableMemories, [], "잊기 후보를 읽지도 않는다");
  assert.equal(calls.ask.length, 2, "추출 + 주제 감지");
});

test("잊기 신호는 사용자 발화에서만 본다", async () => {
  // 펫이 "잊어버렸어" 같은 말을 해도 사용자 요청이 아니다. 완료 판정은 답변을 보지만
  // (기존 동작) 잊기는 요청이라 반대다.
  const history = [
    { question: "오늘 뭐 했어?", answer: "미안, 잊어버렸어" }
  ];
  const { deps, calls } = createFakeDeps({
    askResponses: ["[]", "[]"],
    forgettableMemories: FORGET_MEMORIES
  });
  await createMemoryExtractionRunner(deps)(history, "ko");

  assert.deepEqual(calls.forgetMemory, []);
  assert.equal(calls.ask.length, 2, "일반 추출 경로를 탄다");
});

// ── 잊기 요청은 추출 주기를 기다리지 않는다 (2026-08-21) ──────────────────────────
//
// 러너는 **마지막 질문**에서만 잊기 신호를 찾는다. main이 3턴 주기에만 러너를 부르면,
// 주기가 도는 턴에는 마지막 질문이 이미 다른 말이라 신호가 감지되지 않고 요청이 통째로
// 사라진다(3번 중 2번). 펫 대화 답장은 카운터를 아예 올리지 않아 영영 사라졌다.

test("main은 잊기 신호를 추출 카운터보다 먼저, early return보다 앞에서 본다", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const mainSource = fs
    .readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8")
    .replace(/\s+/g, " ");

  assert.ok(
    mainSource.includes("const forgetRequested = detectForgetSignals(turn.question);"),
    "기록하는 턴에서 바로 판정해야 한다"
  );
  assert.ok(
    mainSource.includes("if (!dueForExtraction && !forgetRequested) return;"),
    "잊기 요청이면 주기와 무관하게 추출을 당겨 실행해야 한다"
  );
  // countTowardExtraction으로 먼저 빠져나가면 펫 대화 답장의 잊기 요청이 사라진다.
  assert.ok(
    !mainSource.includes("if (!countTowardExtraction) return;"),
    "잊기 판정보다 앞선 early return이 남아 있으면 답장 경로의 요청이 버려진다"
  );
  assert.ok(
    mainSource.includes("const dueForExtraction = countTowardExtraction && assistantHistory.countTurnForExtraction();"),
    "카운터는 원래 조건에서만 올라가야 한다(잊기로 당겨 실행할 때 주기가 밀리지 않게)"
  );
});

test("러너는 마지막 질문에서만 잊기 신호를 본다", () => {
  // main이 즉시 부르는 것과 짝이다. 이 전제가 깨지면(예: 이력 전체를 훑게 바꾸면)
  // 며칠 전 대화의 "잊어줘"가 매 배치마다 다시 발동한다.
  const fs = require("node:fs");
  const path = require("node:path");
  const runnerSource = fs
    .readFileSync(path.join(__dirname, "..", "src", "main", "memory", "memory-extraction-runner.ts"), "utf8")
    .replace(/\s+/g, " ");
  assert.ok(
    runnerSource.includes("const latestQuestion = conversationHistory[conversationHistory.length - 1]?.question;"),
    "마지막 질문만 본다"
  );
});
