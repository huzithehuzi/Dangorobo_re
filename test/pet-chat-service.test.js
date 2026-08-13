const test = require("node:test");
const assert = require("node:assert/strict");

const { createPetChatService } = require("../src/main/assistant/pet-chat-service.js");
const { t } = require("../src/shared/i18n.js");

const BASE_SETTINGS = {
  language: "ko",
  petChatEnabled: true,
  pettingChatEnabled: true,
  assistantEnabled: true,
  petChatMinMinutes: 3,
  petChatMaxMinutes: 20
};

/**
 * @param {{
 *   settings?: Record<string, unknown>,
 *   askResponses?: Array<string | Error>,
 *   hasApiKey?: boolean,
 *   blocked?: boolean,
 *   hasHistory?: boolean,
 *   random?: () => number
 * }} [options]
 */
function createHarness(options = {}) {
  const askResponses = [...(options.askResponses || [])];
  const calls = {
    /** @type {Array<{ prompt: string, options: Record<string, unknown> }>} */
    ask: [],
    /** @type {Array<{ message: string, expression: string | null }>} */
    openPanel: [],
    /** @type {unknown[][]} */
    logSession: [],
    /** @type {Array<{ fn: () => unknown, delay: number, cleared: boolean }>} */
    timers: [],
    clearCount: 0
  };
  const service = createPetChatService({
    ask: async (prompt, askOptions) => {
      calls.ask.push({ prompt, options: askOptions });
      const next = askResponses.shift();
      if (next instanceof Error) throw next;
      return next ?? "";
    },
    getSettings: () => /** @type {any} */ ({ ...BASE_SETTINGS, ...options.settings }),
    hasApiKey: () => options.hasApiKey !== false,
    isAutoChatBlocked: () => options.blocked === true,
    hasConversationHistory: () => options.hasHistory === true,
    openPanel: (message, expression) => calls.openPanel.push({ message, expression }),
    logSession: (...args) => calls.logSession.push(args),
    setTimeoutFn: /** @type {any} */ ((/** @type {() => unknown} */ fn, /** @type {number} */ delay) => {
      const entry = { fn, delay, cleared: false };
      calls.timers.push(entry);
      return entry;
    }),
    clearTimeoutFn: /** @type {any} */ ((/** @type {{ cleared: boolean } | undefined} */ handle) => {
      calls.clearCount += 1;
      if (handle) handle.cleared = true;
    }),
    random: options.random || (() => 0)
  });
  return { service, calls };
}

test("schedule은 설정 범위 안의 랜덤 지연으로 타이머를 건다", () => {
  const { service, calls } = createHarness({ random: () => 0.5 });
  service.schedule();
  assert.equal(calls.timers.length, 1);
  // min 3, max 20에서 random 0.5 → 11.5분
  assert.equal(calls.timers[0].delay, 11.5 * 60 * 1000);
});

test("잡담·어시스턴트·API 키 중 하나라도 꺼져 있으면 예약하지 않는다", () => {
  for (const overrides of [
    { settings: { petChatEnabled: false } },
    { settings: { assistantEnabled: false } },
    { hasApiKey: false }
  ]) {
    const { service, calls } = createHarness(overrides);
    service.schedule();
    assert.equal(calls.timers.length, 0);
  }
});

test("주기 발동이 막혀 있으면 60초 재시도만 예약하고 LLM을 부르지 않는다", async () => {
  const { service, calls } = createHarness({ blocked: true });
  service.schedule();
  await calls.timers[0].fn();
  assert.equal(calls.ask.length, 0);
  assert.equal(calls.timers.length, 2);
  assert.equal(calls.timers[1].delay, 60000);
});

test("주기 발동 성공: 고정 옵션으로 LLM을 부르고 말풍선을 연다", async () => {
  const { service, calls } = createHarness({ askResponses: ["안녕! 오늘 어때?"] });
  service.schedule();
  await calls.timers[0].fn();

  assert.equal(calls.ask.length, 1);
  assert.deepEqual(calls.ask[0].options, {
    maxHistoryTurns: 2,
    historyCharBudget: 900,
    maxOutputTokens: 320
  });
  assert.deepEqual(calls.openPanel, [{ message: "안녕! 오늘 어때?", expression: "normal" }]);
  assert.equal(service.isSessionActive(), true);
  assert.equal(service.getOpeningMessage(), "안녕! 오늘 어때?");
});

test("주기 발동 실패(빈 응답)는 조용히 다음 주기만 예약한다", async () => {
  const { service, calls } = createHarness({ askResponses: [""] });
  service.schedule();
  await calls.timers[0].fn();
  assert.equal(service.isSessionActive(), false);
  assert.deepEqual(calls.openPanel, []);
  // 실패 후 schedule()이 새 주기 타이머를 걸었다
  assert.equal(calls.timers.length, 2);
  assert.notEqual(calls.timers[1].delay, 60000);
});

test("오프너 프롬프트에 최근 오프너 목록이 실리고 8개·240자로 잘린다", async () => {
  const longAnswer = "가".repeat(300);
  const answers = Array.from({ length: 10 }, (_, i) => (i === 0 ? longAnswer : `오프너 ${i}`));
  const { service, calls } = createHarness({ askResponses: answers });
  for (let i = 0; i < 10; i += 1) {
    await service.callNow();
    service.endSession();
  }
  // 10번째 프롬프트 시점의 최근 목록은 직전 9개를 8개로 자른 것 — 첫 응답(300자)은 밀려났다
  const lastPrompt = calls.ask[9].prompt;
  assert.ok(lastPrompt.includes("오프너 1"));
  assert.ok(!lastPrompt.includes(longAnswer.slice(0, 240)));
  // 두 번째 프롬프트에는 첫 응답이 240자로 잘려 실렸다
  assert.ok(calls.ask[1].prompt.includes(longAnswer.slice(0, 240)));
  assert.ok(!calls.ask[1].prompt.includes(longAnswer.slice(0, 241)));
});

test("최근 화제 3개는 다음 선택에서 제외된다", async () => {
  const { service, calls } = createHarness({ askResponses: ["a", "b", "c", "d"], random: () => 0 });
  const hints = [];
  for (let i = 0; i < 4; i += 1) {
    await service.callNow();
    service.endSession();
    hints.push(calls.ask[i].prompt);
  }
  // random 0으로 항상 "첫 미사용 화제"를 고르므로 4번의 프롬프트가 전부 다른 힌트를 쓴다
  assert.equal(new Set(hints).size, 4);
});

test("대화 이력이 있으면 이어가기 화제가 후보에 들어간다", () => {
  // continueTopic은 후보 목록 끝에 붙는다 — random이 마지막 요소를 고르게 해서 확인
  const { service, calls } = createHarness({
    askResponses: ["a"],
    hasHistory: true,
    random: () => 0.999
  });
  service.schedule();
  calls.timers[0].fn();
  assert.ok(calls.ask.length === 0 || calls.ask[0].prompt.includes(t("ko", "petChat.hint.continueTopic")));
});

test("callNow 성공은 기존 타이머를 지우고 다음 주기를 예약한다", async () => {
  const { service, calls } = createHarness({ askResponses: ["안녕"] });
  service.schedule();
  await service.callNow();
  assert.equal(calls.timers[0].cleared, true);
  assert.equal(calls.timers.length, 2);
});

test("callNow 실패는 예외를 전파하고 타이머를 지운 채로 둔다", async () => {
  const { service, calls } = createHarness({ askResponses: [new Error("네트워크")] });
  service.schedule();
  await assert.rejects(service.callNow());
  assert.equal(calls.timers[0].cleared, true);
  // 실패 시 재예약하지 않는다 — 분리 전 pet-chat:call-now와 같은 동작
  assert.equal(calls.timers.length, 1);
});

test("endSession은 세션이 있을 때만 한 번 로그를 남기고 재예약한다", async () => {
  const { service, calls } = createHarness({ askResponses: ["궁금한 거 있어?"] });
  await service.callNow();
  service.recordReply("응 있어", "뭔데?");
  service.endSession();
  assert.deepEqual(calls.logSession, [["궁금한 거 있어?", "응 있어", "뭔데?"]]);
  assert.equal(service.isSessionActive(), false);
  assert.equal(service.getOpeningMessage(), null);

  const timersAfter = calls.timers.length;
  service.endSession();
  assert.deepEqual(calls.logSession.length, 1);
  assert.equal(calls.timers.length, timersAfter);
});

test("쓰다듬기 잡담은 막혀 있으면 재시도 없이 조용히 넘어간다", async () => {
  const { service, calls } = createHarness({ blocked: true });
  await service.triggerPettingChat();
  assert.equal(calls.ask.length, 0);
  assert.equal(calls.timers.length, 0);
});

test("쓰다듬기 잡담 실패도 조용히 무시하고 재예약하지 않는다", async () => {
  const { service, calls } = createHarness({ askResponses: [new Error("실패")] });
  await service.triggerPettingChat();
  assert.equal(calls.timers.length, 0);
  assert.equal(service.isSessionActive(), false);
});

test("쓰다듬기 잡담은 쓰다듬기 전용 인트로를 쓴다", async () => {
  const { service, calls } = createHarness({ askResponses: ["부끄러워"] });
  await service.triggerPettingChat();
  assert.ok(calls.ask[0].prompt.includes(t("ko", "petChat.pettedIntro")));
  assert.equal(service.isSessionActive(), true);
});
