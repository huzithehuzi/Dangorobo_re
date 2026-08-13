const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAssistantLogsIpcHandlers } = require("../src/main/assistant/assistant-logs-ipc.js");

function createHarness() {
  const validSender = {};
  const first = {
    id: "first", timestamp: "2026-08-10T00:00:00.000Z", question: "첫 질문", answer: "첫 답",
    model: "gemini", personality: "friend"
  };
  const second = {
    id: "second", timestamp: "2026-08-10T01:00:00.000Z", question: "둘째 질문", answer: "둘째 답",
    model: "gemini", personality: "friend"
  };
  let logs = [first, second];
  let saveCalls = 0;
  /** @type {Map<string, (...args: any[]) => any>} */
  const handlers = new Map();
  const ipcMain = {
    handle(/** @type {string} */ channel, /** @type {(...args: any[]) => any} */ handler) {
      handlers.set(channel, handler);
    }
  };
  registerAssistantLogsIpcHandlers(/** @type {any} */ (ipcMain), {
    getLogs: () => logs,
    setLogs: (nextLogs) => { logs = nextLogs; },
    isLogWindowSender: (sender) => sender === validSender,
    save: () => { saveCalls += 1; }
  });
  return {
    first,
    second,
    validSender,
    handlers,
    getLogs: () => logs,
    saveCalls: () => saveCalls,
    /**
     * @param {string} channel
     * @param {unknown} sender
     * @param {...any} args
     */
    invoke(channel, sender, ...args) {
      const handler = handlers.get(channel);
      assert.ok(handler);
      return handler({ sender }, ...args);
    }
  };
}

test("질문·답변 기록 IPC 세 채널을 기존 순서로 등록한다", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()], [
    "assistant-logs:get",
    "assistant-logs:delete",
    "assistant-logs:clear"
  ]);
});

test("조회는 sender를 제한하지 않고 최신 항목부터 복사해 반환한다", () => {
  const harness = createHarness();
  const result = harness.invoke("assistant-logs:get", {});
  assert.deepEqual(result, [harness.second, harness.first]);
  assert.notEqual(result, harness.getLogs());
  assert.deepEqual(harness.getLogs(), [harness.first, harness.second]);
});

test("삭제는 로그 창 sender와 존재하는 id를 모두 확인한다", () => {
  const harness = createHarness();
  assert.equal(harness.invoke("assistant-logs:delete", {}, "first"), false);
  assert.equal(harness.invoke("assistant-logs:delete", harness.validSender, "missing"), false);
  assert.equal(harness.saveCalls(), 0);
  assert.equal(harness.invoke("assistant-logs:delete", harness.validSender, "first"), true);
  assert.deepEqual(harness.getLogs(), [harness.second]);
  assert.equal(harness.saveCalls(), 1);
});

test("전체 삭제는 로그 창 sender에서 빈 배열을 저장한다", () => {
  const harness = createHarness();
  assert.equal(harness.invoke("assistant-logs:clear", {}), false);
  assert.equal(harness.invoke("assistant-logs:clear", harness.validSender), true);
  assert.deepEqual(harness.getLogs(), []);
  assert.equal(harness.saveCalls(), 1);
  assert.equal(harness.invoke("assistant-logs:clear", harness.validSender), true);
  assert.equal(harness.saveCalls(), 2);
});
