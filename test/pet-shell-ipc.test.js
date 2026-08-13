// @ts-check
// 펫 창 상태 보고와 우클릭 메뉴 IPC 회귀 테스트.
// 하위 메뉴까지 훑는 항목 탐색과 미디어 플레이어 사각형 검증은 main.ts 안에 있을 때
// 단위 테스트가 없었다. 둘 다 틀리면 증상이 조용하다 — 메뉴가 안 눌리거나, 펫 드래그가
// 미디어 버튼 위에서 잘못 걸린다.
// Electron 없이 순수 Node로 실행된다: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  registerPetShellIpcHandlers,
  findMenuItem,
  normalizeMediaPlayerRect
} = require("../src/main/windows/pet-shell-ipc.js");

const CHANNELS = [
  "pet:get-cursor",
  "pet:get-window-bounds",
  "pet:get-mode",
  "pet:report-visual-top",
  "pet:report-media-rect",
  "pet:rest-confirm",
  "media:command",
  "pet:quit",
  "context-menu:action",
  "context-menu:close"
];

function createHarness(overrides = {}) {
  /** @type {Map<string, (...args: any[]) => any>} */
  const listeners = new Map();
  const ipcMain = {
    handle(/** @type {string} */ c, /** @type {any} */ h) { listeners.set(c, h); },
    on(/** @type {string} */ c, /** @type {any} */ h) { listeners.set(c, h); }
  };
  const petSender = { window: "pet" };
  const menuSender = { window: "menu" };
  /** @type {string[]} */
  const calls = [];
  const state = {
    modelTopLocalY: /** @type {number | null} */ (null),
    mediaPlayerRect: /** @type {any} */ (undefined)
  };
  const deps = {
    isPetSender: (/** @type {unknown} */ s) => s === petSender,
    isContextMenuSender: (/** @type {unknown} */ s) => s === menuSender,
    getCursorPoint: () => ({ x: 100, y: 200 }),
    getPetWindowBounds: () => ({ x: 10, y: 20, width: 300, height: 420 }),
    isClickThrough: () => true,
    setModelTopLocalY: (/** @type {number} */ v) => { state.modelTopLocalY = v; },
    setMediaPlayerRect: (/** @type {any} */ r) => { state.mediaPlayerRect = r; },
    confirmRestAlert: () => { calls.push("restConfirm"); },
    sendMediaCommand: (/** @type {string} */ a) => { calls.push(`media:${a}`); },
    quit: () => { calls.push("quit"); },
    currentPetMenuItems: () => [],
    closePetContextMenu: () => { calls.push("closeMenu"); },
    ...overrides
  };
  registerPetShellIpcHandlers(/** @type {any} */ (ipcMain), deps);
  return {
    calls, state, petSender, menuSender,
    send: (/** @type {string} */ channel, /** @type {unknown} */ sender, /** @type {unknown} */ payload = undefined) => {
      const listener = listeners.get(channel);
      assert.ok(listener, `등록되지 않은 채널: ${channel}`);
      return listener({ sender }, payload);
    },
    channels: () => [...listeners.keys()]
  };
}

test("등록하는 채널 목록이 분리 전 main.ts와 같다", () => {
  assert.deepEqual(createHarness().channels().sort(), [...CHANNELS].sort());
});

test("조회 채널은 현재 값을 그대로 돌려준다", () => {
  const harness = createHarness();
  assert.deepEqual(harness.send("pet:get-cursor", harness.petSender), { x: 100, y: 200 });
  assert.deepEqual(harness.send("pet:get-window-bounds", harness.petSender), { x: 10, y: 20, width: 300, height: 420 });
  assert.deepEqual(harness.send("pet:get-mode", harness.petSender), { clickThrough: true });
});

test("펫 창이 없으면 창 경계는 null이다", () => {
  const harness = createHarness({ getPetWindowBounds: () => null });
  assert.equal(harness.send("pet:get-window-bounds", harness.petSender), null);
});

test("모델 꼭대기는 양수만 받는다", () => {
  const harness = createHarness();
  for (const bad of [undefined, null, "abc", 0, -3, NaN, Infinity]) {
    harness.send("pet:report-visual-top", harness.petSender, bad);
    assert.equal(harness.state.modelTopLocalY, null, `${String(bad)}이 통과했다`);
  }
  harness.send("pet:report-visual-top", harness.petSender, 2.05);
  assert.equal(harness.state.modelTopLocalY, 2.05);
});

test("미디어 사각형은 네 값이 모두 유한한 수일 때만 받는다", () => {
  assert.equal(normalizeMediaPlayerRect(undefined), null);
  assert.equal(normalizeMediaPlayerRect(null), null);
  assert.equal(normalizeMediaPlayerRect("x"), null);
  assert.equal(normalizeMediaPlayerRect({ left: 1, top: 2, width: 3 }), null);
  assert.equal(normalizeMediaPlayerRect({ left: 1, top: 2, width: 3, height: "4" }), null);
  assert.equal(normalizeMediaPlayerRect({ left: 1, top: 2, width: 3, height: NaN }), null);
  assert.deepEqual(
    normalizeMediaPlayerRect({ left: 1, top: 2, width: 3, height: 4, extra: "무시" }),
    { left: 1, top: 2, width: 3, height: 4 }
  );
});

test("미디어 플레이어가 사라지면 사각형을 비운다", () => {
  const harness = createHarness();
  harness.send("pet:report-media-rect", harness.petSender, { left: 1, top: 2, width: 3, height: 4 });
  assert.deepEqual(harness.state.mediaPlayerRect, { left: 1, top: 2, width: 3, height: 4 });
  harness.send("pet:report-media-rect", harness.petSender, null);
  assert.equal(harness.state.mediaPlayerRect, null, "안 비우면 사라진 플레이어 자리에서 드래그가 막힌다");
});

test("미디어 명령은 문자열로 정규화해 넘긴다", () => {
  const harness = createHarness();
  harness.send("media:command", harness.petSender, "play");
  harness.send("media:command", harness.petSender, undefined);
  assert.deepEqual(harness.calls, ["media:play", "media:"]);
});

test("휴식 확인과 종료는 그대로 위임한다", () => {
  const harness = createHarness();
  harness.send("pet:rest-confirm", harness.petSender);
  harness.send("pet:quit", harness.petSender);
  assert.deepEqual(harness.calls, ["restConfirm", "quit"]);
});

test("하위 메뉴 안의 항목도 찾는다", () => {
  const items = [
    { id: "top", label: "위" },
    {
      id: "favorites",
      label: "즐겨찾기",
      items: [
        { id: "favorite:1", label: "메모장" },
        { id: "nested", label: "더", items: [{ id: "deep", label: "깊은 항목" }] }
      ]
    }
  ];
  assert.equal(findMenuItem(/** @type {any} */ (items), "top")?.label, "위");
  assert.equal(findMenuItem(/** @type {any} */ (items), "favorite:1")?.label, "메모장");
  assert.equal(findMenuItem(/** @type {any} */ (items), "deep")?.label, "깊은 항목");
  assert.equal(findMenuItem(/** @type {any} */ (items), "없음"), null);
});

test("메뉴 항목은 실행 전에 메뉴를 먼저 닫는다", () => {
  /** @type {string[]} */
  const order = [];
  const harness = createHarness({
    currentPetMenuItems: () => [{ id: "settings", label: "설정", run: () => order.push("run") }],
    closePetContextMenu: () => order.push("close")
  });
  harness.send("context-menu:action", harness.menuSender, "settings");
  assert.deepEqual(order, ["close", "run"], "먼저 실행하면 새 창 위에 메뉴가 남는다");
});

test("run이 없는 항목이나 없는 id도 메뉴는 닫는다", () => {
  const noRun = createHarness({ currentPetMenuItems: () => [{ id: "label-only", label: "구분선" }] });
  noRun.send("context-menu:action", noRun.menuSender, "label-only");
  assert.deepEqual(noRun.calls, ["closeMenu"]);

  const missing = createHarness();
  missing.send("context-menu:action", missing.menuSender, "없는id");
  assert.deepEqual(missing.calls, ["closeMenu"]);
});

test("메뉴 채널은 메뉴 창이 아닌 sender를 무시한다", () => {
  for (const channel of ["context-menu:action", "context-menu:close"]) {
    const harness = createHarness({
      currentPetMenuItems: () => [{ id: "settings", label: "설정", run: () => harness.calls.push("run") }]
    });
    harness.send(channel, harness.petSender, "settings");
    assert.deepEqual(harness.calls, [], `${channel}이 펫 창 요청에 반응했다`);
  }
});
