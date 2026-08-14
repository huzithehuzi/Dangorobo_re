// @ts-check
// 즐겨찾기 독립 창과 플로팅 독(dock·cursor 두 방식)의 창 소유권·기하·생명주기.
//
// 창 객체와 screen만 흉내 내면 Electron 없이 그대로 돌아간다. 실제 `window-factory.ts`를
// 거치므로 팩토리가 거는 이벤트 배선(move·resize·closed·blur·ready-to-show)까지 함께 확인된다.
//
// 배치 계산 자체는 `favorites-layout.ts`의 순수 함수이고 그쪽 테스트가 따로 있다.
// 여기서 보는 것은 "언제 어떤 창을 만들고 닫고 저장하는가"다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

class FakeWebContents {
  constructor() {
    /** @type {Array<{ channel: string, payload: any }>} */
    this.messages = [];
  }

  /** @param {string} channel @param {any} payload */
  send(channel, payload) {
    this.messages.push({ channel, payload });
  }
}

class FakeBrowserWindow extends EventEmitter {
  /** @type {FakeBrowserWindow[]} */
  static instances = [];

  /** @param {Record<string, any>} options */
  constructor(options) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    this.visible = options.show !== false;
    /** 창에 건 조작을 순서대로 남긴다 — show/destroy 같은 것은 순서가 곧 계약이다. */
    this.operations = /** @type {string[]} */ ([]);
    /** @type {Array<{ x: number, y: number, width: number, height: number }>} */
    this.boundsCalls = [];
    /** @type {boolean[]} */
    this.resizableCalls = [];
    this.bounds = {
      x: Number(options.x) || 0,
      y: Number(options.y) || 0,
      width: Number(options.width) || 0,
      height: Number(options.height) || 0
    };
    FakeBrowserWindow.instances.push(this);
  }

  isDestroyed() { return this.destroyed; }
  // 표시 상태를 실제로 추적한다 — cursor 방식 파이가 "떠 있는가"를 플래그가 아니라 창에
  // 묻도록 바뀌었으므로, 가짜 창도 show/hide를 반영해야 그 계약을 검증할 수 있다.
  isVisible() { return this.visible; }
  setAlwaysOnTop() {}
  show() { this.operations.push("show"); this.visible = true; }
  showInactive() { this.operations.push("showInactive"); this.visible = true; }
  focus() { this.operations.push("focus"); }
  hide() { this.operations.push("hide"); this.visible = false; }
  getPosition() { return [this.bounds.x, this.bounds.y]; }
  getSize() { return [this.bounds.width, this.bounds.height]; }
  getBounds() { return { ...this.bounds }; }

  /** @param {{ x: number, y: number, width: number, height: number }} next */
  setBounds(next) {
    this.boundsCalls.push({ ...next });
    Object.assign(this.bounds, next);
  }

  /** @param {number} x @param {number} y */
  setPosition(x, y) {
    this.operations.push("setPosition");
    this.bounds.x = x;
    this.bounds.y = y;
  }

  /** @param {boolean} value */
  setResizable(value) { this.resizableCalls.push(value); }

  close() {
    this.operations.push("close");
    this.finish();
  }

  destroy() {
    this.operations.push("destroy");
    this.finish();
  }

  finish() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
  }
}

let workArea = { x: 0, y: 0, width: 1920, height: 1080 };
let cursorPoint = { x: 800, y: 600 };

const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: { getLocale: () => "ko-KR" },
    BrowserWindow: FakeBrowserWindow,
    screen: {
      getPrimaryDisplay: () => ({ workArea: { ...workArea } }),
      getDisplayNearestPoint: () => ({ workArea: { ...workArea } }),
      getCursorScreenPoint: () => ({ ...cursorPoint })
    }
  }
});

const { DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");
const { createFavoritesWindowController } = require("../src/main/windows/favorites-windows.js");

// 1920×1080 기준 기대값. favorites-layout.ts의 공식에서 그대로 나온다.
const DEFAULT_WINDOW_POSITION = { x: 1346, y: 10 };
const DEFAULT_WINDOW_SIZE = { width: 264, height: 340 };
const DEFAULT_DOCK_POSITION = { x: 1530, y: 930 };
const DOCK_COLLAPSED = 80;
const DOCK_EXPANDED = 300;

/** @param {Partial<import("../src/main/windows/favorites-panels.js").FavoritesPanelsState>} [overrides] */
function panelsState(overrides = {}) {
  return {
    window: { open: false, position: null, size: null },
    dock: { open: false, position: null },
    ...overrides
  };
}

/**
 * @param {{
 *   settings?: Record<string, unknown>,
 *   panels?: any,
 *   launchItems?: any[]
 * }} [options]
 */
function createHarness(options = {}) {
  FakeBrowserWindow.instances = [];
  workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  cursorPoint = { x: 800, y: 600 };

  const settings = /** @type {any} */ ({
    ...DEFAULT_SETTINGS,
    favoritesEnabled: true,
    ...options.settings
  });
  const panels = /** @type {any} */ (options.panels ?? panelsState());
  const calls = { save: 0, schedule: 0, tray: 0, buildItems: 0 };
  /** @type {string[]} */
  const loaded = [];
  let quitting = false;

  const controller = createFavoritesWindowController(/** @type {any} */ ({
    chrome: { preloadPath: "/preload.js", iconPath: "/icon.png" },
    loadUiWindow: (/** @type {any} */ _win, /** @type {string} */ name) => { loaded.push(name); },
    translate: (/** @type {string} */ key) => key,
    getSettings: () => settings,
    getPanelsState: () => panels,
    savePanelsState: () => { calls.save += 1; },
    schedulePanelsSave: () => { calls.schedule += 1; },
    isAppQuitting: () => quitting,
    rebuildTrayMenu: () => { calls.tray += 1; },
    buildFavoriteLaunchItems: async () => {
      calls.buildItems += 1;
      return options.launchItems ?? [{ id: "a", name: "A" }];
    }
  }));

  return {
    controller, settings, panels, calls, loaded,
    setQuitting: (/** @type {boolean} */ value) => { quitting = value; },
    /** 팩토리가 건 ready-to-show를 흘려보낸다(실제로는 창이 그릴 준비를 마쳤을 때 온다). */
    ready: (/** @type {any} */ win) => win.emit("ready-to-show"),
    flush: () => new Promise((resolve) => setImmediate(resolve))
  };
}

/** @param {any} win @returns {Array<{ channel: string, payload: any }>} */
function sent(win) {
  return win.webContents.messages;
}

// ── 독립 창 ────────────────────────────────────────────────────────────────────

test("독립 창은 저장된 위치·크기가 없으면 기본 자리에 만든다", () => {
  const h = createHarness();
  h.controller.createWindow();

  const win = /** @type {any} */ (h.controller.window());
  assert.ok(win, "창을 만든다");
  assert.equal(win.options.x, DEFAULT_WINDOW_POSITION.x);
  assert.equal(win.options.y, DEFAULT_WINDOW_POSITION.y);
  assert.equal(win.options.width, DEFAULT_WINDOW_SIZE.width);
  assert.equal(win.options.height, DEFAULT_WINDOW_SIZE.height);
  assert.deepEqual(h.loaded, ["favorites-window"]);
});

test("저장된 위치가 화면 밖이면 작업 영역 안으로 당겨서 만든다", () => {
  const h = createHarness({
    panels: panelsState({ window: { open: true, position: { x: 5000, y: 5000 }, size: null } })
  });
  h.controller.createWindow();

  const win = /** @type {any} */ (h.controller.window());
  assert.equal(win.options.x, 1920 - DEFAULT_WINDOW_SIZE.width, "오른쪽 끝에 붙인다");
  assert.equal(win.options.y, 1080 - DEFAULT_WINDOW_SIZE.height, "아래쪽 끝에 붙인다");
});

test("이미 떠 있으면 새로 만들지 않고 앞으로 가져오기만 한다", () => {
  const h = createHarness();
  h.controller.createWindow();
  const first = h.controller.window();

  h.controller.createWindow();
  assert.equal(h.controller.window(), first, "같은 창을 유지한다");
  assert.equal(FakeBrowserWindow.instances.length, 1);
  assert.deepEqual(/** @type {any} */ (first).operations, ["show", "focus"]);
});

test("창을 옮기거나 크기를 바꾸면 상태에 반영하고 저장은 미룬다", () => {
  const h = createHarness();
  h.controller.createWindow();
  const win = /** @type {any} */ (h.controller.window());

  win.bounds.x = 400;
  win.bounds.y = 300;
  win.emit("move");
  assert.deepEqual(h.panels.window.position, { x: 400, y: 300 });

  win.bounds.width = 500;
  win.bounds.height = 600;
  win.emit("resize");
  assert.deepEqual(h.panels.window.size, { width: 500, height: 600 });

  // 드래그 중에는 이벤트가 쏟아지므로 즉시 저장하지 않는다.
  assert.equal(h.calls.schedule, 2);
  assert.equal(h.calls.save, 0);
});

test("Alt+F4로 닫아도 닫힘으로 기억해 다음 실행 때 되살리지 않는다", () => {
  const h = createHarness({
    panels: panelsState({ window: { open: true, position: null, size: null } })
  });
  h.controller.createWindow();
  const win = /** @type {any} */ (h.controller.window());

  win.finish();
  assert.equal(h.panels.window.open, false);
  assert.equal(h.calls.save, 1, "즉시 저장한다");
  assert.equal(h.calls.tray, 1);
  assert.equal(h.controller.window(), undefined, "핸들을 비운다");
});

test("앱을 끄는 중에 닫히는 것은 사용자가 닫은 것으로 보지 않는다", () => {
  const h = createHarness({
    panels: panelsState({ window: { open: true, position: null, size: null } })
  });
  h.controller.createWindow();
  h.setQuitting(true);

  /** @type {any} */ (h.controller.window()).finish();
  assert.equal(h.panels.window.open, true, "열려 있던 것으로 남겨 다음 실행에 되살린다");
  assert.equal(h.calls.save, 0);
});

test("즐겨찾기가 꺼져 있으면 창을 열지 않는다", () => {
  const h = createHarness({ settings: { favoritesEnabled: false } });
  h.controller.openWindow();

  assert.equal(h.controller.window(), undefined);
  assert.equal(h.panels.window.open, false);
  assert.equal(h.calls.save, 0);
});

test("이미 열린 것으로 기록돼 있으면 다시 저장하지 않는다", () => {
  const h = createHarness({
    panels: panelsState({ window: { open: true, position: null, size: null } })
  });
  h.controller.openWindow();

  assert.equal(h.calls.save, 0, "상태가 그대로면 디스크를 건드리지 않는다");
  assert.equal(h.calls.tray, 0);
});

test("창을 닫으면 상태를 한 번만 저장한다", () => {
  const h = createHarness();
  h.controller.openWindow();
  assert.equal(h.calls.save, 1);

  h.controller.closeWindow();
  assert.equal(h.panels.window.open, false);
  assert.equal(h.calls.save, 2, "닫힘 이벤트와 closeWindow가 겹쳐 두 번 저장하지 않는다");
});

// ── 플로팅 독 ──────────────────────────────────────────────────────────────────

test("독은 접힌 크기로 만들고 저장된 위치가 없으면 기본 자리를 쓴다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.createDockWindow();

  const dock = /** @type {any} */ (h.controller.dockWindow());
  assert.equal(dock.options.width, DOCK_COLLAPSED);
  assert.equal(dock.options.height, DOCK_COLLAPSED);
  assert.deepEqual({ x: dock.options.x, y: dock.options.y }, DEFAULT_DOCK_POSITION);
  assert.deepEqual(h.panels.dock.position, DEFAULT_DOCK_POSITION, "dock 방식은 위치를 기록한다");
  assert.deepEqual(h.loaded, ["favorites-dock"]);
});

test("독 크기를 바꿀 때는 리사이즈 금지를 잠깐 풀었다 되돌린다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.createDockWindow();
  const dock = /** @type {any} */ (h.controller.dockWindow());

  h.controller.setDockExpanded(true);
  // resizable:false 창은 Windows에서 프로그램적 리사이즈도 막힐 수 있다.
  assert.deepEqual(dock.resizableCalls, [true, false]);
});

test("독을 펼치면 접을 위치도 함께 옮겨 화면 밖으로 되돌아가지 않는다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.createDockWindow();
  const dock = /** @type {any} */ (h.controller.dockWindow());

  h.controller.setDockExpanded(true);
  assert.equal(h.controller.isDockExpanded(), true);
  assert.deepEqual(dock.boundsCalls.at(-1), { x: 1420, y: 780, width: DOCK_EXPANDED, height: DOCK_EXPANDED });
  // 펼침 보정으로 아래쪽에서 밀려났으니 접을 자리도 그만큼 위로 온다.
  assert.deepEqual(h.panels.dock.position, { x: 1530, y: 890 });

  h.controller.setDockExpanded(false);
  assert.deepEqual(dock.boundsCalls.at(-1), { x: 1530, y: 890, width: DOCK_COLLAPSED, height: DOCK_COLLAPSED });
  assert.deepEqual(sent(dock).map((m) => m.payload), [
    { expanded: true, cursorMode: false },
    { expanded: false, cursorMode: false }
  ]);
});

test("독 드래그는 누른 순간의 자리를 기준으로 삼는다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.createDockWindow();
  const dock = /** @type {any} */ (h.controller.dockWindow());

  h.controller.beginDockDrag();
  h.controller.moveDockBy(50, -30);
  assert.deepEqual({ x: dock.bounds.x, y: dock.bounds.y }, { x: 1580, y: 900 });

  // 델타는 시작점 기준이다 — 누적하면 마우스보다 두 배 빨리 움직인다.
  h.controller.moveDockBy(100, -60);
  assert.deepEqual({ x: dock.bounds.x, y: dock.bounds.y }, { x: 1630, y: 870 });
  assert.deepEqual(h.panels.dock.position, { x: 1630, y: 870 });
});

test("드래그 중에도 작업 영역을 벗어나지 않는다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.createDockWindow();
  const dock = /** @type {any} */ (h.controller.dockWindow());

  h.controller.beginDockDrag();
  h.controller.moveDockBy(9000, 9000);
  assert.deepEqual(
    { x: dock.bounds.x, y: dock.bounds.y },
    { x: 1920 - DOCK_COLLAPSED, y: 1080 - DOCK_COLLAPSED }
  );
});

test("드래그를 시작하지 않았거나 끝낸 뒤에는 움직이지 않는다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.createDockWindow();
  const dock = /** @type {any} */ (h.controller.dockWindow());
  const boundsBefore = dock.boundsCalls.length;

  h.controller.moveDockBy(50, 50);
  assert.equal(dock.boundsCalls.length, boundsBefore, "시작 전에는 무시한다");

  h.controller.beginDockDrag();
  h.controller.moveDockBy(50, 50);
  h.controller.endDockDrag();
  assert.equal(h.calls.save, 1, "손을 뗄 때 즉시 저장한다");

  const before = { ...dock.bounds };
  h.controller.moveDockBy(200, 200);
  assert.deepEqual({ x: dock.bounds.x, y: dock.bounds.y }, { x: before.x, y: before.y });
});

// 배율이 섞인 다중 모니터에서 setPosition()은 부를 때마다 창을 1~2px씩 키운다(실측).
// 드래그는 포인터가 움직일 때마다 이걸 부르므로, 크기를 다시 못 박지 않으면 창이 계속
// 부풀고 CSS로 중앙에 놓인 가운데 버튼이 오른쪽 아래로 밀려난다.
test("드래그 중에는 매번 접힌 크기를 다시 못 박는다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.createDockWindow();
  const dock = /** @type {any} */ (h.controller.dockWindow());

  h.controller.beginDockDrag();
  for (const step of [10, 20, 30]) h.controller.moveDockBy(step, step);

  const moves = dock.boundsCalls.slice(-3);
  assert.equal(moves.length, 3, "이동마다 bounds를 건다");
  for (const move of moves) {
    assert.equal(move.width, DOCK_COLLAPSED, "폭을 다시 못 박지 않으면 누적해서 커진다");
    assert.equal(move.height, DOCK_COLLAPSED, "높이를 다시 못 박지 않으면 누적해서 커진다");
  }
  // 위치는 눌린 지점 기준으로 따라와야 한다.
  assert.equal(moves.at(-1)?.x, dock.bounds.x);
});

test("펼쳐진 독을 잡으면 먼저 접고 나서 끈다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.createDockWindow();
  h.controller.setDockExpanded(true);

  h.controller.beginDockDrag();
  assert.equal(h.controller.isDockExpanded(), false, "펼친 채로 끌면 파이 메뉴가 커서를 따라다닌다");
});

// ── cursor 방식 파이 ───────────────────────────────────────────────────────────

test("cursor 방식은 커서 자리에 펼친 크기로 띄우고 포커스를 가져온다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "cursor" } });
  h.controller.openCursorPie();

  const dock = /** @type {any} */ (h.controller.dockWindow());
  assert.equal(h.controller.isDockExpanded(), true);
  // 커서(800, 600)를 중심으로 300×300.
  assert.deepEqual(dock.boundsCalls.at(-1), { x: 650, y: 450, width: DOCK_EXPANDED, height: DOCK_EXPANDED });
  // 바깥을 클릭하면 blur로 닫으므로 포커스가 있어야 한다.
  assert.deepEqual(dock.operations, ["show", "focus"]);
  assert.deepEqual(sent(dock).at(-1)?.payload, { expanded: true, cursorMode: true });
});

test("cursor 방식은 표시 전후로 크기를 두 번 건다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "cursor" } });
  h.controller.openCursorPie();
  const dock = /** @type {any} */ (h.controller.dockWindow());

  // 숨어 있는 창에 건 bounds는 배율이 다른 모니터로 옮겨가는 순간 Windows가 다시
  // 환산해버려서 크기가 어긋난다(다중 모니터 실측).
  const showAt = dock.operations.indexOf("show");
  assert.equal(dock.boundsCalls.length, 2, "show 앞뒤로 한 번씩");
  assert.deepEqual(dock.boundsCalls[0], dock.boundsCalls[1]);
  assert.ok(showAt >= 0);
});

test("cursor 방식에서 접기는 크기를 줄이는 게 아니라 숨기는 것이다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "cursor" } });
  h.controller.openCursorPie();
  const dock = /** @type {any} */ (h.controller.dockWindow());
  const boundsBefore = dock.boundsCalls.length;

  h.controller.setDockExpanded(false);
  assert.equal(h.controller.isDockExpanded(), false);
  assert.equal(dock.operations.includes("hide"), true);
  assert.equal(dock.boundsCalls.length, boundsBefore, "접힌 크기로 줄이지 않는다");
  assert.deepEqual(sent(dock).at(-1)?.payload, { expanded: false, cursorMode: true });
});

test("이미 닫힌 파이를 또 닫아도 아무 일도 하지 않는다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "cursor" } });
  h.controller.openCursorPie();
  h.controller.closeCursorPie();
  const dock = /** @type {any} */ (h.controller.dockWindow());
  const messages = sent(dock).length;

  h.controller.closeCursorPie();
  assert.equal(sent(dock).length, messages);
});

// "가운데 닫기 버튼이 아무 일도 안 한다"의 구조적 원인. 예전 closeCursorPie()는 dockExpanded
// 플래그가 false면 곧바로 돌아갔는데, 그 플래그가 화면과 어긋나면 닫기 경로가 전부 죽었다.
test("플래그가 화면과 어긋나도 떠 있는 파이는 닫힌다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "cursor" } });
  h.controller.openCursorPie();
  const dock = /** @type {any} */ (h.controller.dockWindow());
  // 창은 그대로 떠 있는데 플래그만 내려간 상태를 만든다(blur 경합 등으로 실제 일어난다).
  dock.emit("blur");
  dock.visible = true;
  assert.equal(h.controller.isDockExpanded(), false, "플래그는 내려가 있다");
  assert.equal(h.controller.isCursorPieOpen(), true, "그래도 화면에는 떠 있다");

  const hidesBefore = dock.operations.filter((/** @type {string} */ op) => op === "hide").length;
  h.controller.setDockExpanded(false);
  const hidesAfter = dock.operations.filter((/** @type {string} */ op) => op === "hide").length;
  assert.equal(hidesAfter, hidesBefore + 1, "떠 있는 창은 반드시 숨겨야 한다");
  assert.deepEqual(sent(dock).at(-1)?.payload, { expanded: false, cursorMode: true });
});

// 단축키 토글도 같은 기준을 쓴다 — 플래그를 보면 "열려 있는데 또 여는" 상태가 된다.
test("떠 있는 파이 여부는 플래그가 아니라 창에게 묻는다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "cursor" } });
  assert.equal(h.controller.isCursorPieOpen(), false, "만들기 전");
  h.controller.createDockWindow({ show: false });
  assert.equal(h.controller.isCursorPieOpen(), false, "숨겨 만들어 둔 상태");
  h.controller.openCursorPie();
  assert.equal(h.controller.isCursorPieOpen(), true);
  h.controller.closeCursorPie();
  assert.equal(h.controller.isCursorPieOpen(), false);
});

test("바깥을 클릭해 포커스를 잃으면 cursor 방식만 닫힌다", () => {
  const cursor = createHarness({ settings: { favoritesDisplayMode: "cursor" } });
  cursor.controller.openCursorPie();
  /** @type {any} */ (cursor.controller.dockWindow()).emit("blur");
  assert.equal(cursor.controller.isDockExpanded(), false);

  const dock = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  dock.controller.createDockWindow();
  dock.controller.setDockExpanded(true);
  /** @type {any} */ (dock.controller.dockWindow()).emit("blur");
  assert.equal(dock.controller.isDockExpanded(), true, "독은 상시 런처라 포커스를 잃어도 그대로 둔다");
});

// ── 표시 방식 동기화 ───────────────────────────────────────────────────────────

test("시작 시점을 기준선으로 잡아두면 설정만 다시 저장해도 독이 되살아나지 않는다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.primeSyncBaseline();

  h.controller.syncToSettings();
  assert.equal(h.controller.dockWindow(), undefined, "사용자가 숨겨둔 독을 저장할 때마다 띄우지 않는다");
});

test("기준선을 안 잡으면 첫 동기화에서 독을 띄운다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.syncToSettings();
  assert.ok(h.controller.dockWindow(), "방금 켠 것으로 보고 띄운다");
});

test("표시 방식을 바꾸면 독 창을 파괴하고 새로 만든다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.primeSyncBaseline();
  h.controller.createDockWindow();
  const first = /** @type {any} */ (h.controller.dockWindow());

  h.settings.favoritesDisplayMode = "cursor";
  h.controller.syncToSettings();

  // close()는 실제 파괴가 나중이라 그 사이에 "이미 있다"고 보고 닫히는 중인 창을 재사용한다.
  assert.deepEqual(first.operations, ["destroy"]);
  assert.notEqual(h.controller.dockWindow(), first, "새 창으로 갈아 끼운다");
});

test("cursor 방식은 숨긴 채 미리 만들어 둔다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "cursor" } });
  h.controller.primeSyncBaseline();
  h.controller.syncToSettings();

  const dock = /** @type {any} */ (h.controller.dockWindow());
  assert.ok(dock, "단축키를 눌렀을 때 바로 뜨도록 미리 만든다");
  assert.equal(dock.options.show, false);
  h.ready(dock);
  assert.deepEqual(dock.operations, [], "ready-to-show가 와도 보여주지 않는다");
});

test("즐겨찾기를 방금 켜면 dock 방식에서 독을 띄운다", () => {
  const h = createHarness({ settings: { favoritesEnabled: false, favoritesDisplayMode: "dock" } });
  h.controller.primeSyncBaseline();

  h.settings.favoritesEnabled = true;
  h.controller.syncToSettings();
  assert.ok(h.controller.dockWindow());
});

test("즐겨찾기를 끄면 열려 있던 창을 모두 닫는다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.primeSyncBaseline();
  h.controller.openWindow();
  h.controller.openDockWindow();

  h.settings.favoritesEnabled = false;
  h.controller.syncToSettings();
  assert.equal(h.controller.window(), undefined);
  assert.equal(h.controller.dockWindow(), undefined);
  assert.equal(h.panels.window.open, false);
  assert.equal(h.panels.dock.open, false);
});

test("window 방식이 아니면 독립 창을 닫는다", () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "window" } });
  h.controller.primeSyncBaseline();
  h.controller.openWindow();
  assert.ok(h.controller.window());

  h.settings.favoritesDisplayMode = "bubble";
  h.controller.syncToSettings();
  assert.equal(h.controller.window(), undefined);
});

// ── 두 창에 함께 보내기 ─────────────────────────────────────────────────────────

test("창이 닫히면 핸들을 비워 남은 창에만 메시지가 간다", () => {
  // 이 검사가 무는 것은 "핸들을 비우는 것"까지다. alive()의 isDestroyed() 쪽 절반은
  // 닫힘 이벤트가 항상 핸들을 먼저 비우므로 밖에서 만들어낼 수 있는 상황이 없다 —
  // 재진입에 대비한 방어라 변이 검사로 고정되지 않는다.
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.createWindow();
  h.controller.createDockWindow();
  const win = /** @type {any} */ (h.controller.window());
  const dock = /** @type {any} */ (h.controller.dockWindow());
  const dockBefore = sent(dock).length;

  win.finish();
  assert.equal(h.controller.window(), undefined);
  h.controller.sendToPanels("pet:settings-updated", { theme: "rose" });

  assert.equal(sent(win).length, 0, "닫힌 창에는 보내지 않는다");
  assert.deepEqual(sent(dock).slice(dockBefore), [
    { channel: "pet:settings-updated", payload: { theme: "rose" } }
  ]);
});

test("열린 창이 하나도 없으면 항목을 만들지 않는다", async () => {
  const h = createHarness();
  h.controller.broadcastToPanels();
  await h.flush();

  // 아이콘 추출은 PowerShell까지 부르는 비싼 일이라 받을 창이 없으면 시작조차 하지 않는다.
  assert.equal(h.calls.buildItems, 0);
});

test("즐겨찾기 목록은 표시 설정과 함께 두 창에 간다", async () => {
  const h = createHarness({
    settings: { favoritesDisplayMode: "dock", favoritesLayout: "grid", favoriteGridLabelsHidden: true },
    launchItems: [{ id: "one" }, { id: "two" }]
  });
  h.controller.createWindow();
  h.controller.createDockWindow();

  h.controller.broadcastToPanels();
  await h.flush();

  const expected = {
    channel: "favorites:items",
    payload: { items: [{ id: "one" }, { id: "two" }], layout: "grid", hideLabels: true }
  };
  assert.equal(h.calls.buildItems, 1, "두 창에 보내려고 두 번 만들지 않는다");
  assert.deepEqual(sent(/** @type {any} */ (h.controller.window())).at(-1), expected);
  assert.deepEqual(sent(/** @type {any} */ (h.controller.dockWindow())).at(-1), expected);
});

test("항목을 만드는 사이에 닫힌 창에는 보내지 않는다", async () => {
  const h = createHarness({ settings: { favoritesDisplayMode: "dock" } });
  h.controller.createWindow();
  h.controller.createDockWindow();
  const win = /** @type {any} */ (h.controller.window());

  h.controller.broadcastToPanels();
  win.finish();
  await h.flush();

  assert.equal(sent(win).length, 0);
  assert.equal(sent(/** @type {any} */ (h.controller.dockWindow())).at(-1)?.channel, "favorites:items");
});
