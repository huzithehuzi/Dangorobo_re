const test = require("node:test");
const assert = require("node:assert/strict");

const { createAskGemini } = require("../src/main/assistant/ask-gemini.js");
const { t } = require("../src/shared/i18n.js");

/** @param {string} text */
function responseWith(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

/**
 * @param {{ responses?: Array<Record<string, unknown> | Error> }} [options]
 */
function createHarness(options = {}) {
  const responses = [...(options.responses || [responseWith("답변")])];
  /** @type {Array<{ body: any, options: Record<string, unknown> | undefined }>} */
  const requests = [];
  const blockCalls = { instructions: /** @type {any[]} */ ([]), history: /** @type {any[]} */ ([]), episode: 0, memory: /** @type {string[]} */ ([]), oneOff: 0 };
  const ask = createAskGemini({
    generateContent: async (body, requestOptions) => {
      requests.push({ body, options: requestOptions });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next ?? responseWith("답변");
    },
    getLanguage: () => "ko",
    instructionsBlock: (blockOptions) => {
      blockCalls.instructions.push(blockOptions);
      return "[지시문]";
    },
    historyBlock: (blockOptions) => {
      blockCalls.history.push(blockOptions);
      return "[이력]";
    },
    episodeBlock: () => {
      blockCalls.episode += 1;
      return "[에피소드]";
    },
    memoryBlock: (question) => {
      blockCalls.memory.push(question);
      return "[기억]";
    },
    oneOffBlock: () => {
      blockCalls.oneOff += 1;
      return "[원오프]";
    }
  });
  return { ask, requests, blockCalls };
}

/** @param {{ body: any }} request */
function promptOf(request) {
  return request.body.contents[0].parts[0].text;
}

// 사고 토큰도 maxOutputTokens에서 나가므로, 호출부가 준 "답변 예산" 위에 사고 몫을 얹어
// 보낸다(ask-gemini.ts의 ASSISTANT_THINKING_HEADROOM_TOKENS). 이 값이 사라지면 예산이 작은
// 경로에서 답변이 문장 중간에 끊기거나 빈 문자열로 온다.
const THINKING_HEADROOM = 512;

test("프롬프트는 지시문·에피소드·기억·이력·원오프·리마인더·질문 순으로 조립한다", async () => {
  const { ask, requests, blockCalls } = createHarness();
  const longQuestion = "이것은 스물네 글자를 확실히 넘기는 긴 질문 문장입니다";
  const answer = await ask(longQuestion);

  assert.equal(answer, "답변");
  assert.equal(
    promptOf(requests[0]),
    `[지시문][에피소드][기억][이력][원오프]\n\n${t("ko", "assistant.languageReminder")}\n${t("ko", "assistant.questionLabel")}: ${longQuestion}`
  );
  // 긴 질문 → shortQuestionMode 아님 → 날짜 포함, 기본 토큰 1024 + 사고 몫 512, 타임아웃 22초
  assert.deepEqual(blockCalls.instructions, [{ includeDateTime: true }]);
  assert.deepEqual(blockCalls.memory, [longQuestion]);
  assert.equal(requests[0].body.generationConfig.maxOutputTokens, 1024 + THINKING_HEADROOM);
  assert.deepEqual(requests[0].body.generationConfig.thinkingConfig, { thinkingLevel: "low" });
  assert.deepEqual(requests[0].options, { timeoutMs: 22000 });
});

test("질문·펫대화 요청은 안전 필터 4종을 BLOCK_NONE으로 보낸다", async () => {
  // 2026-08-14 이전에는 safetySettings를 안 보내 API 기본 차단 수준이 걸렸다.
  // 번역 경로와 같은 값이지만 상수는 공유하지 않는다(경로별 정책 분리, AGENTS.md).
  const timeoutError = /** @type {Error & { code?: string }} */ (new Error("타임아웃"));
  timeoutError.code = "REQUEST_TIMEOUT";
  const { ask, requests } = createHarness({
    responses: [timeoutError, responseWith("짧은 답변")]
  });
  await ask("이것은 스물네 글자를 확실히 넘기는 긴 질문 문장입니다");

  const expected = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
  ];
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body.safetySettings, expected, "첫 요청");
  // 강등 재시도도 같은 설정으로 나가야 한다 — 여기서 빠지면 타임아웃 뒤 답만 조용히 차단된다.
  assert.deepEqual(requests[1].body.safetySettings, expected, "강등 재시도");
});

test("짧은 질문은 자동으로 short 모드 — 날짜 제외, 토큰 480", async () => {
  const { ask, requests, blockCalls } = createHarness();
  await ask("안녕");
  assert.deepEqual(blockCalls.instructions, [{ includeDateTime: false }]);
  assert.equal(requests[0].body.generationConfig.maxOutputTokens, 480 + THINKING_HEADROOM);
});

test("shortQuestionMode 명시가 자동 판정보다 우선한다", async () => {
  const forcedLong = createHarness();
  await forcedLong.ask("안녕", [], { shortQuestionMode: false });
  assert.equal(forcedLong.requests[0].body.generationConfig.maxOutputTokens, 1024 + THINKING_HEADROOM);

  const forcedShort = createHarness();
  await forcedShort.ask("이것은 스물네 글자를 확실히 넘기는 긴 질문 문장입니다", [], { shortQuestionMode: true });
  assert.equal(forcedShort.requests[0].body.generationConfig.maxOutputTokens, 480 + THINKING_HEADROOM);
});

test("extraTurns가 있으면 짧은 질문도 short 모드가 아니다", async () => {
  const { ask, requests } = createHarness();
  await ask("안녕", [{ question: "이전 질문", answer: "이전 답" }]);
  assert.equal(requests[0].body.generationConfig.maxOutputTokens, 1024 + THINKING_HEADROOM);
});

test("includeMemory: false면 기억 블록 콜백을 아예 부르지 않는다", async () => {
  const { ask, requests, blockCalls } = createHarness();
  await ask("안녕", [], { includeMemory: false, maxHistoryTurns: 3 });

  assert.equal(blockCalls.history.length, 0);
  assert.equal(blockCalls.episode, 0);
  assert.equal(blockCalls.memory.length, 0);
  assert.equal(blockCalls.oneOff, 1);
  assert.ok(promptOf(requests[0]).startsWith("[지시문][원오프]"));
});

test("토큰 하한 128, 지정값 우선", async () => {
  const low = createHarness();
  await low.ask("안녕", [], { maxOutputTokens: 50 });
  assert.equal(low.requests[0].body.generationConfig.maxOutputTokens, 128 + THINKING_HEADROOM);

  const high = createHarness();
  await high.ask("안녕", [], { maxOutputTokens: 2000 });
  assert.equal(high.requests[0].body.generationConfig.maxOutputTokens, 2000 + THINKING_HEADROOM);
});

test("타임아웃이면 강등 옵션으로 정확히 1회 재시도한다", async () => {
  const timeoutError = /** @type {Error & { code?: string }} */ (new Error("타임아웃"));
  timeoutError.code = "REQUEST_TIMEOUT";
  const { ask, requests, blockCalls } = createHarness({
    responses: [timeoutError, responseWith("짧은 답변")]
  });
  const answer = await ask("이것은 스물네 글자를 확실히 넘기는 긴 질문 문장입니다", [], { maxOutputTokens: 900 });

  assert.equal(answer, "짧은 답변");
  assert.equal(requests.length, 2);
  // 재시도: 기억 제외·short 강제·토큰 min(max(128, 900), 256)=256(+사고 몫)·타임아웃 12초
  assert.ok(promptOf(requests[1]).startsWith("[지시문][원오프]"));
  assert.equal(requests[1].body.generationConfig.maxOutputTokens, 256 + THINKING_HEADROOM);
  assert.deepEqual(requests[1].options, { timeoutMs: 12000 });
  // 재시도의 이력 블록도 부르지 않는다(includeMemory: false)
  assert.equal(blockCalls.history.length, 1);
  // 재시도는 short 모드 → 날짜 제외
  assert.deepEqual(blockCalls.instructions, [{ includeDateTime: true }, { includeDateTime: false }]);
});

test("재시도의 재시도는 없다 — 두 번째 타임아웃은 그대로 던진다", async () => {
  const timeoutError = /** @type {Error & { code?: string }} */ (new Error("타임아웃"));
  timeoutError.code = "REQUEST_TIMEOUT";
  const second = /** @type {Error & { code?: string }} */ (new Error("두 번째 타임아웃"));
  second.code = "REQUEST_TIMEOUT";
  const { ask, requests } = createHarness({ responses: [timeoutError, second] });
  await assert.rejects(ask("안녕"), /두 번째 타임아웃/);
  assert.equal(requests.length, 2);
});

test("retryOnTimeout: false면 재시도하지 않는다", async () => {
  const timeoutError = /** @type {Error & { code?: string }} */ (new Error("타임아웃"));
  timeoutError.code = "REQUEST_TIMEOUT";
  const { ask, requests } = createHarness({ responses: [timeoutError] });
  await assert.rejects(ask("안녕", [], { retryOnTimeout: false }), /타임아웃/);
  assert.equal(requests.length, 1);
});

test("타임아웃이 아닌 오류는 재시도 없이 전파한다", async () => {
  const { ask, requests } = createHarness({ responses: [new Error("쿼터 초과")] });
  await assert.rejects(ask("안녕"), /쿼터 초과/);
  assert.equal(requests.length, 1);
});

test("죽은 옵션(personalityOverride 등)은 여전히 아무 효과가 없다", async () => {
  const plain = createHarness();
  await plain.ask("안녕");
  const withDead = createHarness();
  await withDead.ask("안녕", [], {
    personalityOverride: "다른 성격",
    systemPromptOverride: "다른 시스템 프롬프트"
  });
  assert.deepEqual(withDead.requests[0].body, plain.requests[0].body);
  assert.deepEqual(withDead.requests[0].options, plain.requests[0].options);
});

// 이 계약이 깨지면(사고 몫을 안 얹으면) 예산이 작은 경로에서 사고가 예산을 다 먹고 답변이
// 문장 중간에 끊긴다 — 펫 오프너(320)·기억 추출(50~300)이 그 경로다.
test("호출부 예산은 답변용이고, 사고 몫은 그 위에 얹어 보낸다", async () => {
  for (const requested of [50, 320, 900]) {
    const { ask, requests } = createHarness();
    await ask("안녕", [], { maxOutputTokens: requested });
    const sent = requests[0].body.generationConfig.maxOutputTokens;
    assert.ok(
      sent >= Math.max(128, requested) + THINKING_HEADROOM,
      `예산 ${requested} → 실제 ${sent}: 사고 몫이 빠졌다`
    );
    assert.ok(requests[0].body.generationConfig.thinkingConfig, "사고 설정이 없으면 이 계약도 필요 없다");
  }
});
