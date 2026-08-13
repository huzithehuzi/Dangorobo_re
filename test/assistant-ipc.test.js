// @ts-check
// AI 도구 IPC 회귀 테스트 (질문·펫 대화 답장·번역·문서 요약·이미지 리사이즈).
// 특히 document-summary:open의 경로 검사는 main.ts 안에 있을 때 단위 테스트가 없었다 —
// 렌더러가 보낸 경로를 그대로 열면 요약 폴더 밖 파일이 열린다.
// Electron 없이 순수 Node로 실행된다: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getLocale: () => "ko-KR" } }
});

const { registerAssistantIpcHandlers } = require("../src/main/assistant/assistant-ipc.js");
const { DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");

const SUMMARY_DIR = path.resolve("C:/user-data/summaries");

/** @typedef {import("../src/main/image-resize.js").ImageResizeResult} ImageResizeResult */

/**
 * resizeClipboardImage 대역. 판별 유니온이라 ok를 리터럴로 좁혀야 한다.
 * @param {ImageResizeResult} result
 */
function stubImageResize(result) {
  return async () => result;
}

/** 대화 세션이 없는 상태의 petChatService 대역. */
function idlePetChat() {
  return {
    isSessionActive: () => false,
    callNow: async () => {},
    getOpeningMessage: () => null,
    recordReply: () => {}
  };
}

function createHarness(overrides = {}) {
  /** @type {Map<string, (...args: any[]) => any>} */
  const listeners = new Map();
  const ipcMain = {
    handle(/** @type {string} */ c, /** @type {any} */ h) { listeners.set(c, h); },
    on(/** @type {string} */ c, /** @type {any} */ h) { listeners.set(c, h); }
  };
  const petSender = { window: "pet" };
  const otherSender = { window: "settings" };
  /** @type {string[]} */
  const calls = [];
  /** @type {Array<{ question: string, answer: string, options: any }>} */
  const recordedTurns = [];
  /** @type {string[]} */
  const openedPaths = [];
  /** @type {string[]} */
  const clipboard = [];

  const settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), {
    language: "ko",
    assistantEnabled: true,
    translateTargetLanguage: "en"
  });

  const deps = {
    getSettings: () => settings,
    translate: (/** @type {string} */ _l, /** @type {string} */ key) => `t:${key}`,
    describeAssistantError: (/** @type {any} */ e) => `ai:${e.message}`,
    describeError: (/** @type {any} */ e) => `err:${e.message}`,
    hasApiKey: () => true,
    isPetSender: (/** @type {unknown} */ s) => s === petSender,
    isAssistantPanelActive: () => true,
    isTranslatePanelActive: () => true,
    isDocumentSummaryPanelActive: () => true,
    isRestActive: () => false,
    isDndActive: () => false,
    askGemini: async () => "안녕!\n[expression: happy]",
    petChat: {
      isSessionActive: () => true,
      callNow: async () => { calls.push("callNow"); },
      getOpeningMessage: () => "뭐해?",
      recordReply: (/** @type {string} */ r, /** @type {string} */ a) => { calls.push(`recordReply:${r}|${a}`); }
    },
    recordAssistantTurn: (/** @type {string} */ q, /** @type {string} */ a, /** @type {any} */ o) => {
      recordedTurns.push({ question: q, answer: a, options: o });
    },
    rebuildTrayMenu: () => { calls.push("tray"); },
    closeAssistantPanel: () => { calls.push("closeAssistant"); },
    closeImageResizePanel: () => { calls.push("closeImageResize"); },
    closeTranslatePanel: () => { calls.push("closeTranslate"); },
    closeDocumentSummaryPanel: () => { calls.push("closeSummary"); },
    resizeClipboardImage: stubImageResize({ ok: true, percent: 50 }),
    translateWithGemini: async () => "Hello",
    setTranslateTargetLanguage: (/** @type {string} */ target) => { calls.push(`saveLang:${target}`); },
    summarizeDocument: async () => "# 요약",
    writeSummaryDocument: () => path.join(SUMMARY_DIR, "summary-1.html"),
    summaryDirectory: () => SUMMARY_DIR,
    ensureDirectory: (/** @type {string} */ d) => { calls.push(`mkdir:${d}`); },
    fileExists: () => true,
    openPath: async (/** @type {string} */ target) => { openedPaths.push(target); return ""; },
    writeClipboardText: (/** @type {string} */ text) => { clipboard.push(text); },
    ...overrides
  };
  registerAssistantIpcHandlers(/** @type {any} */ (ipcMain), deps);
  return {
    settings, calls, recordedTurns, openedPaths, clipboard, petSender, otherSender,
    send: (/** @type {string} */ channel, /** @type {unknown} */ sender, /** @type {any[]} */ ...args) => {
      const listener = listeners.get(channel);
      assert.ok(listener, `등록되지 않은 채널: ${channel}`);
      return listener({ sender }, ...args);
    },
    channels: () => [...listeners.keys()]
  };
}

test("등록하는 채널 목록이 분리 전 main.ts와 같다", () => {
  assert.deepEqual(createHarness().channels().sort(), [
    "image:resize", "assistant:ask", "assistant:close",
    "pet-chat:call-now", "pet-chat:reply", "pet-chat:close",
    "image-resize:close", "translate:close", "document-summary:close",
    "document-summary:run", "document-summary:open", "summary:open-folder",
    "translate:run", "translate:copy"
  ].sort());
});

test("질문은 로그를 남기고 장기 기억 추출 카운터를 올린다", async () => {
  const harness = createHarness();
  const result = await harness.send("assistant:ask", harness.petSender, "안녕?");
  assert.equal(result.ok, true);
  assert.equal(result.expression, "happy");
  assert.deepEqual(harness.recordedTurns[0].options, { appendLog: true, countTowardExtraction: true });
});

test("펫 대화 답장은 로그도 추출 카운터도 건드리지 않는다", async () => {
  const harness = createHarness();
  const result = await harness.send("pet-chat:reply", harness.petSender, "응 잘 지내");
  assert.equal(result.ok, true);
  assert.deepEqual(harness.recordedTurns[0].options, { appendLog: false, countTowardExtraction: false });
  assert.ok(harness.calls.some((c) => c.startsWith("recordReply:")), "petChatService 기록을 건너뛰었다");
});

test("AI가 꺼져 있거나 키가 없으면 질문을 거부한다", async () => {
  const disabled = createHarness();
  disabled.settings.assistantEnabled = false;
  assert.equal((await disabled.send("assistant:ask", disabled.petSender, "안녕")).error, "t:assistant.disabledError");

  const noKey = createHarness({ hasApiKey: () => false });
  assert.equal((await noKey.send("assistant:ask", noKey.petSender, "안녕")).error, "t:assistant.disabledError");
});

test("빈 질문과 빈 답장은 Gemini를 부르지 않는다", async () => {
  const harness = createHarness({
    askGemini: async () => { throw new Error("불리면 안 된다"); }
  });
  assert.equal((await harness.send("assistant:ask", harness.petSender, "   ")).error, "t:assistant.emptyQuestionError");
  assert.equal((await harness.send("pet-chat:reply", harness.petSender, "")).error, "t:assistant.emptyReplyError");
});

test("빈 답변이 오면 실패로 바꾼다", async () => {
  const harness = createHarness({ askGemini: async () => "" });
  const result = await harness.send("assistant:ask", harness.petSender, "안녕");
  assert.equal(result.ok, false);
  assert.equal(result.error, "ai:t:assistant.emptyAnswerError");
  assert.deepEqual(harness.recordedTurns, [], "실패한 턴을 이력에 남기면 안 된다");
});

test("부르기는 펫 창에서만, 세션 중이 아닐 때만 받는다", async () => {
  const wrongSender = createHarness();
  assert.equal((await wrongSender.send("pet-chat:call-now", wrongSender.otherSender)).ok, false);
  assert.deepEqual(wrongSender.calls, []);

  const active = createHarness();
  assert.equal(
    (await active.send("pet-chat:call-now", active.petSender)).error,
    "t:petChat.alreadyActiveError"
  );

  const ready = createHarness({ petChat: idlePetChat() });
  assert.equal((await ready.send("pet-chat:call-now", ready.petSender)).ok, true);
});

test("휴식·방해 금지 중에는 펫이 먼저 말 걸지 않는다", async () => {
  for (const flag of ["isRestActive", "isDndActive"]) {
    const harness = createHarness({ [flag]: () => true, petChat: idlePetChat() });
    const result = await harness.send("pet-chat:call-now", harness.petSender);
    assert.equal(result.ok, false, flag);
  }
});

test("요약 파일 열기는 요약 폴더 밖 경로를 거부한다", async () => {
  const harness = createHarness();
  const outside = [
    "C:/Windows/System32/calc.exe",
    path.join(SUMMARY_DIR, "..", "secret.html"),
    path.join(SUMMARY_DIR, "..", "summaries-evil", "x.html"),
    `${SUMMARY_DIR}.html`
  ];
  for (const target of outside) {
    assert.deepEqual(await harness.send("document-summary:open", harness.petSender, target), { ok: false }, target);
  }
  assert.deepEqual(harness.openedPaths, [], "폴더 밖 경로가 열렸다");
});

test("요약 파일 열기는 .html이 아니거나 없는 파일을 거부한다", async () => {
  const notHtml = createHarness();
  assert.deepEqual(
    await notHtml.send("document-summary:open", notHtml.petSender, path.join(SUMMARY_DIR, "a.md")),
    { ok: false }
  );
  const missing = createHarness({ fileExists: () => false });
  assert.deepEqual(
    await missing.send("document-summary:open", missing.petSender, path.join(SUMMARY_DIR, "a.html")),
    { ok: false }
  );
  assert.deepEqual(notHtml.openedPaths, []);
  assert.deepEqual(missing.openedPaths, []);
});

test("요약 폴더 안의 html은 대소문자와 상관없이 연다", async () => {
  const harness = createHarness();
  const target = path.join(SUMMARY_DIR, "summary-1.HTML");
  assert.deepEqual(await harness.send("document-summary:open", harness.petSender, target), { ok: true });
  assert.deepEqual(harness.openedPaths, [target]);
});

test("요약 실행은 길이 상한을 넘기면 Gemini를 부르지 않는다", async () => {
  const harness = createHarness({
    summarizeDocument: async () => { throw new Error("불리면 안 된다"); }
  });
  const result = await harness.send("document-summary:run", harness.petSender, { text: "가".repeat(1501) });
  assert.equal(result.error, "t:documentSummary.textTooLongError");
});

test("요약 실행은 문자열 payload와 객체 payload를 모두 받는다", async () => {
  const harness = createHarness();
  assert.equal((await harness.send("document-summary:run", harness.petSender, "문서 내용")).ok, true);
  assert.equal((await harness.send("document-summary:run", harness.petSender, { text: "문서", extraRequest: "표로" })).ok, true);
});

test("번역은 대상 언어가 바뀔 때만 저장한다", async () => {
  const harness = createHarness();
  await harness.send("translate:run", harness.petSender, "en", "안녕");
  assert.deepEqual(harness.calls, [], "같은 언어인데 저장했다");
  await harness.send("translate:run", harness.petSender, "ja", "안녕");
  assert.deepEqual(harness.calls, ["saveLang:ja"]);
});

test("번역은 길이 상한을 넘기면 Gemini를 부르지 않는다", async () => {
  const harness = createHarness({
    translateWithGemini: async () => { throw new Error("불리면 안 된다"); }
  });
  const result = await harness.send("translate:run", harness.petSender, "en", "a".repeat(5001));
  assert.equal(result.error, "t:translate.textTooLongError");
});

test("번역 결과 복사는 번역 패널이 열린 펫 창에서만 받는다", () => {
  const closed = createHarness({ isTranslatePanelActive: () => false });
  closed.send("translate:copy", closed.petSender, "Hello");
  assert.deepEqual(closed.clipboard, []);

  const wrongSender = createHarness();
  wrongSender.send("translate:copy", wrongSender.otherSender, "Hello");
  assert.deepEqual(wrongSender.clipboard, []);

  const ok = createHarness();
  ok.send("translate:copy", ok.petSender, "Hello");
  assert.deepEqual(ok.clipboard, ["Hello"]);
});

test("이미지 리사이즈는 원인별 오류 문구를 고른다", async () => {
  const notDetected = createHarness({ resizeClipboardImage: stubImageResize({ ok: false, errorCode: "notDetected" }) });
  assert.equal(
    (await notDetected.send("image:resize", notDetected.petSender, 50, "lanczos")).error,
    "t:imageResize.notDetectedError"
  );
  const withDetail = createHarness({
    resizeClipboardImage: stubImageResize({ ok: false, errorCode: "failed", detail: "디코딩 실패" })
  });
  assert.equal(
    (await withDetail.send("image:resize", withDetail.petSender, 50, "lanczos")).error,
    "디코딩 실패"
  );
});

test("패널 닫기 채널은 각자의 패널만 닫는다", () => {
  const harness = createHarness();
  harness.send("assistant:close", harness.petSender);
  harness.send("pet-chat:close", harness.petSender);
  harness.send("image-resize:close", harness.petSender);
  harness.send("translate:close", harness.petSender);
  harness.send("document-summary:close", harness.petSender);
  assert.deepEqual(harness.calls, [
    "closeAssistant", "closeAssistant", "closeImageResize", "closeTranslate", "closeSummary"
  ]);
});
