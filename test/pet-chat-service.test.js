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
 *   hasMemory?: boolean,
 *   hasOpenLoops?: boolean,
 *   random?: (() => number) | number[]
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
    hasLongTermMemory: () => options.hasMemory === true,
    hasOpenLoops: () => options.hasOpenLoops === true,
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
    random: Array.isArray(options.random)
      // 배열이면 순서대로 소비한다 — 화제 선택이 "그룹 추첨 → 목록 안 추첨" 두 번 뽑으므로
      // 어느 경로를 타는지 정하려면 호출 순서별로 값을 줘야 한다. 다 쓰면 마지막 값을 반복한다.
      ? (() => {
        const values = [...options.random];
        let index = 0;
        return () => values[Math.min(index++, values.length - 1)];
      })()
      : (options.random || (() => 0))
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
    maxHistoryTurns: 6,
    historyCharBudget: 1800,
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

test("재료가 있으면 이어가기 화제를 정해진 확률로 먼저 고른다", async () => {
  // 화제 선택은 random을 두 번 쓴다: 첫 번째가 그룹 추첨(0.6 미만이면 이어가기),
  // 두 번째가 그 그룹 안 추첨이다.
  const continuity = createHarness({
    askResponses: ["a"],
    hasHistory: true,
    random: [0.59, 0]
  });
  await continuity.service.callNow();
  assert.ok(
    continuity.calls.ask[0].prompt.includes(t("ko", "petChat.hint.continueTopic")),
    "확률 안에 들면 지난 대화를 소재로 삼는다"
  );
  assert.ok(
    continuity.calls.ask[0].prompt.includes(t("ko", "petChat.continuityInstruction")),
    "이어가기에는 전용 지시문이 실린다"
  );
  assert.ok(
    !continuity.calls.ask[0].prompt.includes(t("ko", "petChat.varietyInstruction")),
    "'최근 소재를 되풀이하지 말라'는 랜덤용 지시문과 섞이지 않는다"
  );

  const randomTopic = createHarness({
    askResponses: ["a"],
    hasHistory: true,
    random: [0.61, 0]
  });
  await randomTopic.service.callNow();
  assert.ok(
    randomTopic.calls.ask[0].prompt.includes(t("ko", "petChat.hint.joke")),
    "확률을 벗어나면 랜덤 소재 목록에서 고른다"
  );
  assert.ok(randomTopic.calls.ask[0].prompt.includes(t("ko", "petChat.varietyInstruction")));
});

test("재료가 없는 이어가기 화제는 후보에 넣지 않는다", async () => {
  // 이력만 있고 기억은 없는 상태 — 기억·미완료 주제를 소재로 주면 모델이 지어낸다.
  const { service, calls } = createHarness({
    askResponses: ["a", "b", "c", "d", "e"],
    hasHistory: true,
    random: [0]
  });
  for (let i = 0; i < 5; i += 1) {
    await service.callNow();
    service.endSession();
  }
  const prompts = calls.ask.map((call) => call.prompt).join("\n");
  assert.ok(!prompts.includes(t("ko", "petChat.hint.rememberedDetail")), "기억이 없으면 안 쓴다");
  assert.ok(!prompts.includes(t("ko", "petChat.hint.openLoopFollowUp")), "미완료 주제가 없으면 안 쓴다");
});

test("기억·미완료 주제만 있어도 이어가기 화제를 고른다", async () => {
  const { service, calls } = createHarness({
    askResponses: ["a"],
    hasMemory: true,
    hasOpenLoops: true,
    random: [0, 0]
  });
  await service.callNow();
  assert.ok(
    calls.ask[0].prompt.includes(t("ko", "petChat.hint.rememberedDetail")),
    "이력이 없어도 기억을 소재로 삼는다"
  );
});

test("이력·기억이 모두 없으면 확률과 무관하게 랜덤 소재를 쓴다", async () => {
  // 첫 실행 상태. 그룹 추첨을 아예 하지 않으므로 random 첫 값이 목록 추첨에 쓰인다.
  const { service, calls } = createHarness({ askResponses: ["a"], random: [0] });
  await service.callNow();
  assert.ok(calls.ask[0].prompt.includes(t("ko", "petChat.hint.joke")));
  assert.ok(!calls.ask[0].prompt.includes(t("ko", "petChat.continuityInstruction")));
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
