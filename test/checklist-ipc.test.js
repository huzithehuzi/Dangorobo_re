const test = require("node:test");
const assert = require("node:assert/strict");
const { registerChecklistIpcHandlers } = require("../src/main/windows/checklist-ipc.js");

const CHECKLIST_HANDLE_CHANNELS = [
  "checklist:get",
  "checklist:add",
  "checklist:toggle",
  "checklist:delete",
  "checklist:clear",
  "checklist:reorder"
];

/** @param {Record<string, any>} [overrides] */
function createDependencies(overrides = {}) {
  /** @type {Array<{ id: string, text: string, done: boolean }>} */
  let items = [
    { id: "a", text: "첫째", done: false },
    { id: "b", text: "둘째", done: true }
  ];
  let saveCalls = 0;
  let celebrateCalls = 0;
  let closeCalls = 0;
  const validSender = {};
  return {
    validSender,
    getItems: () => items,
    setItems: (/** @type {typeof items} */ nextItems) => { items = nextItems; },
    isChecklistSender: (/** @type {unknown} */ sender) => sender === validSender,
    normalizeItem: (/** @type {{ id?: unknown, text?: unknown, done?: unknown } | null | undefined} */ entry) => {
      const text = String(entry?.text || "").trim();
      return text ? { id: `new-${text}`, text, done: false } : null;
    },
    maxItems: 3,
    save: () => { saveCalls += 1; },
    celebrate: () => { celebrateCalls += 1; },
    close: () => { closeCalls += 1; },
    saveCalls: () => saveCalls,
    celebrateCalls: () => celebrateCalls,
    closeCalls: () => closeCalls,
    ...overrides
  };
}

/** @param {Record<string, any>} [overrides] */
function createHarness(overrides = {}) {
  /** @type {Map<string, (...args: any[]) => any>} */
  const handles = new Map();
  /** @type {Map<string, (...args: any[]) => any>} */
  const listeners = new Map();
  const ipcMain = {
    handle(/** @type {string} */ channel, /** @type {(...args: any[]) => any} */ handler) {
      handles.set(channel, handler);
    },
    on(/** @type {string} */ channel, /** @type {(...args: any[]) => any} */ listener) {
      listeners.set(channel, listener);
    }
  };
  const deps = createDependencies(overrides);
  registerChecklistIpcHandlers(/** @type {any} */ (ipcMain), deps);
  return {
    deps,
    handles,
    listeners,
    /**
     * @param {string} channel
     * @param {unknown} sender
     * @param {...any} args
     */
    invoke(channel, sender, ...args) {
      const handler = handles.get(channel);
      assert.ok(handler);
      return handler({ sender }, ...args);
    },
    /**
     * @param {string} channel
     * @param {unknown} sender
     * @param {...any} args
     */
    emit(channel, sender, ...args) {
      const listener = listeners.get(channel);
      assert.ok(listener);
      return listener({ sender }, ...args);
    }
  };
}

test("체크리스트 IPC 채널을 기존 handle/on 구분으로 등록한다", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handles.keys()], CHECKLIST_HANDLE_CHANNELS);
  assert.deepEqual([...harness.listeners.keys()], ["checklist:close"]);
});

test("조회는 창 sender와 무관하게 최신 항목 배열을 반환한다", () => {
  const harness = createHarness();
  assert.deepEqual(harness.invoke("checklist:get", {}), [
    { id: "a", text: "첫째", done: false },
    { id: "b", text: "둘째", done: true }
  ]);
});

test("추가는 sender와 정규화를 검사하고 최대 개수에서 오래된 항목을 버린다", () => {
  const harness = createHarness();
  const invalidResult = harness.invoke("checklist:add", {}, "셋째");
  assert.equal(harness.deps.saveCalls(), 0);
  assert.equal(invalidResult.length, 2);

  assert.equal(harness.invoke("checklist:add", harness.deps.validSender, "   ").length, 2);
  assert.equal(harness.deps.saveCalls(), 0);
  assert.deepEqual(harness.invoke("checklist:add", harness.deps.validSender, "셋째"), [
    { id: "a", text: "첫째", done: false },
    { id: "b", text: "둘째", done: true },
    { id: "new-셋째", text: "셋째", done: false }
  ]);
  assert.deepEqual(harness.invoke("checklist:add", harness.deps.validSender, "넷째"), [
    { id: "b", text: "둘째", done: true },
    { id: "new-셋째", text: "셋째", done: false },
    { id: "new-넷째", text: "넷째", done: false }
  ]);
  assert.equal(harness.deps.saveCalls(), 2);
});

test("완료 전환만 축하하고 완료 해제와 없는 id는 저장만 한다", () => {
  const harness = createHarness();
  assert.equal(harness.invoke("checklist:toggle", harness.deps.validSender, "a")[0].done, true);
  assert.equal(harness.deps.celebrateCalls(), 1);
  assert.equal(harness.invoke("checklist:toggle", harness.deps.validSender, "a")[0].done, false);
  assert.equal(harness.invoke("checklist:toggle", harness.deps.validSender, "missing")[0].done, false);
  assert.equal(harness.deps.celebrateCalls(), 1);
  assert.equal(harness.deps.saveCalls(), 3);
});

test("삭제·전체 삭제는 유효한 sender에서만 상태와 저장을 갱신한다", () => {
  const harness = createHarness();
  assert.equal(harness.invoke("checklist:delete", {}, "a").length, 2);
  assert.equal(harness.invoke("checklist:delete", harness.deps.validSender, "a").length, 1);
  assert.deepEqual(harness.invoke("checklist:clear", harness.deps.validSender), []);
  assert.equal(harness.deps.saveCalls(), 2);
});

test("재정렬은 누락 항목을 뒤에 보존하고 기존 길이 검사를 유지한다", () => {
  const harness = createHarness();
  assert.deepEqual(harness.invoke("checklist:reorder", harness.deps.validSender, ["b"]), [
    { id: "b", text: "둘째", done: true },
    { id: "a", text: "첫째", done: false }
  ]);
  assert.equal(harness.deps.saveCalls(), 1);
  const current = harness.invoke("checklist:get", null);
  assert.equal(harness.invoke("checklist:reorder", harness.deps.validSender, "b,a"), current);
  const unknownOnly = harness.invoke("checklist:reorder", harness.deps.validSender, ["missing"]);
  assert.deepEqual(unknownOnly, current);
  assert.notEqual(unknownOnly, current);
  assert.equal(harness.deps.saveCalls(), 2);
  assert.equal(harness.invoke("checklist:reorder", harness.deps.validSender, ["b", "b"]), unknownOnly);
  assert.equal(harness.deps.saveCalls(), 2);
});

test("닫기는 체크리스트 창 sender에서만 위임한다", () => {
  const harness = createHarness();
  harness.emit("checklist:close", {});
  harness.emit("checklist:close", harness.deps.validSender);
  assert.equal(harness.deps.closeCalls(), 1);
});
