// @ts-check
// 시스템 트레이와 자체 우클릭 팝업의 소유권·타이머·비동기 창 수명을 Electron 없이 검증한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    /** @type {Array<{ channel: string, payload: unknown }>} */
    this.messages = [];
    this.captureCount = 0;
  }

  /** @param {string} channel @param {unknown} payload */
  send(channel, payload) {
    this.messages.push({ channel, payload });
  }

  async capturePage() {
    this.captureCount += 1;
    return { toPNG: () => Buffer.from("captured-menu") };
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
    /** @type {string[]} */
    this.operations = [];
    /** @type {any[][]} */
    this.alwaysOnTopCalls = [];
    FakeBrowserWindow.instances.push(this);
  }

  isDestroyed() { return this.destroyed; }
  /** @param {any[]} args */
  setAlwaysOnTop(...args) { this.alwaysOnTopCalls.push(args); }
  show() { this.operations.push("show"); }
  focus() { this.operations.push("focus"); }
  close() {
    if (this.destroyed) return;
    this.operations.push("close");
    if (deferWindowClose) return;
    this.finishClose();
  }

  finishClose() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
  }
}

class FakeTray extends EventEmitter {
  /** @type {FakeTray[]} */
  static instances = [];

  /** @param {unknown} image */
  constructor(image) {
    super();
    this.image = image;
    this.destroyed = false;
    /** @type {string[]} */
    this.tooltips = [];
    FakeTray.instances.push(this);
  }

  isDestroyed() { return this.destroyed; }
  /** @param {string} tooltip */
  setToolTip(tooltip) { this.tooltips.push(tooltip); }
}

let iconEmpty = false;
let deferWindowClose = false;
/** @type {Array<{ path: string, options: Record<string, unknown> }>} */
let imageRequests = [];
let cursorPoint = { x: 320, y: 240 };
let workArea = { x: 0, y: 0, width: 1920, height: 1080 };
/** @type {{ x: number, y: number }[]} */
let displayProbes = [];

const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: { getLocale: () => "ko-KR" },
    BrowserWindow: FakeBrowserWindow,
    Tray: FakeTray,
    nativeImage: {
      createFromPath: (/** @type {string} */ path) => ({
        resize: (/** @type {Record<string, unknown>} */ options) => {
          imageRequests.push({ path, options });
          return { isEmpty: () => iconEmpty };
        }
      })
    },
    screen: {
      getCursorScreenPoint: () => ({ ...cursorPoint }),
      getDisplayNearestPoint: (/** @type {{ x: number, y: number }} */ point) => {
        displayProbes.push({ ...point });
        return { workArea: { ...workArea } };
      }
    }
  }
});

const { DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");
const { createPetMenuController } = require("../src/main/windows/pet-menu-controller.js");

function resetFakes() {
  FakeBrowserWindow.instances = [];
  FakeTray.instances = [];
  iconEmpty = false;
  deferWindowClose = false;
  imageRequests = [];
  cursorPoint = { x: 320, y: 240 };
  workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  displayProbes = [];
}

/** @returns {Promise<void>} */
function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @param {{
 *   argv?: string[],
 *   hydrate?: (items: any[]) => Promise<any[]>,
 *   settings?: import("../src/main/settings-schema.js").Settings
 * }} [overrides]
 */
function createHarness(overrides = {}) {
  resetFakes();
  const settings = overrides.settings ?? structuredClone(DEFAULT_SETTINGS);
  settings.language = "ko";
  const state = {
    settings,
    countdown: "10분",
    clickThrough: true,
    restActive: false,
    alwaysDragEnabled: false,
    assistantKeyConfigured: false,
    assistantLogCount: 0,
    checklistOpen: false
  };
  const calls = {
    /** @type {Array<{ win: FakeBrowserWindow, name: string }>} */
    loaded: [],
    /** @type {string[]} */
    logs: [],
    /** @type {Array<{ path: string, contents: Buffer }>} */
    writes: [],
    quit: 0
  };
  const noOp = () => {};
  const actions = {
    togglePet: noOp,
    toggleMoveMode: noOp,
    openSettings: noOp,
    openLogs: noOp,
    toggleChecklist: noOp,
    openAssistant: noOp,
    openFavorites: noOp,
    activateFavorite: noOp,
    toggleAutoStart: noOp,
    quit: noOp
  };
  const controller = createPetMenuController({
    chrome: { preloadPath: "/sentinel/preload.js", iconPath: "/sentinel/app-icon.png" },
    argv: overrides.argv ?? ["electron", "."],
    loadUiWindow: (win, name) => {
      calls.loaded.push({ win: /** @type {any} */ (win), name });
    },
    getMenuState: () => state,
    actions,
    hydrateFavoriteMenuItems: overrides.hydrate ?? (async (items) => items),
    translate: (/** @type {string} */ language, /** @type {string} */ key, vars) => (
      `${language}:${key}:${vars?.countdown ?? ""}`
    ),
    logWindowOp: (/** @type {string} */ op) => calls.logs.push(op),
    writeCaptureFile: (/** @type {string} */ path, /** @type {Buffer} */ contents) => {
      calls.writes.push({ path, contents });
    },
    quit: () => { calls.quit += 1; }
  });
  return { controller, state, calls };
}

test("트레이는 아이콘을 20px로 만들고 우클릭의 현재 DIP 좌표에 자체 메뉴를 연다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller } = createHarness();
  t.after(controller.dispose);

  controller.createTray();
  assert.deepEqual(imageRequests, [{
    path: "/sentinel/app-icon.png",
    options: { width: 20, height: 20, quality: "best" }
  }]);
  const tray = FakeTray.instances[0];
  assert.equal(controller.tray(), tray);
  assert.deepEqual(tray.tooltips, ["Dangorobo"]);

  cursorPoint = { x: 777, y: 333 };
  tray.emit("right-click");
  assert.deepEqual(displayProbes, [cursorPoint]);
  assert.equal(FakeBrowserWindow.instances.length, 1);
});

test("비어 있는 트레이 아이콘은 조용히 계속하지 않고 생성을 거부한다", () => {
  const { controller } = createHarness();
  iconEmpty = true;
  assert.throws(() => controller.createTray(), /App icon could not be loaded/);
  assert.equal(FakeTray.instances.length, 0);
});

test("툴팁 갱신은 400ms로 합치고 countdown과 language가 달라질 때만 실행한다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, state, calls } = createHarness();
  t.after(controller.dispose);
  controller.createTray();
  const tray = FakeTray.instances[0];

  t.mock.timers.tick(399);
  assert.deepEqual(tray.tooltips, ["Dangorobo"]);
  t.mock.timers.tick(1);
  assert.deepEqual(tray.tooltips, ["Dangorobo", "ko:tray.tooltip:10분"]);

  controller.rebuild();
  t.mock.timers.tick(400);
  assert.equal(tray.tooltips.length, 2, "같은 지문으로 Shell을 다시 호출하면 안 된다");

  state.countdown = "9분";
  controller.rebuild();
  t.mock.timers.tick(200);
  state.countdown = "8분";
  controller.rebuild();
  t.mock.timers.tick(399);
  assert.equal(tray.tooltips.length, 2, "앞선 예약은 취소돼야 한다");
  t.mock.timers.tick(1);
  assert.equal(tray.tooltips.at(-1), "ko:tray.tooltip:8분");

  state.settings.language = "ja";
  controller.rebuild();
  t.mock.timers.tick(400);
  assert.equal(tray.tooltips.at(-1), "ja:tray.tooltip:8분");
  assert.equal(calls.logs.length, 3);
});

test("팝업이 떠 있는 동안 툴팁을 보류하고 닫힌 뒤 최신 값으로 갱신한다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, state } = createHarness();
  t.after(controller.dispose);
  controller.createTray();
  t.mock.timers.tick(400);
  const tray = FakeTray.instances[0];

  controller.open({ x: 100, y: 100 });
  state.countdown = "곧";
  controller.rebuild();
  t.mock.timers.tick(400);
  assert.equal(tray.tooltips.at(-1), "ko:tray.tooltip:10분");

  controller.close();
  assert.equal(controller.contextMenuWindow(), undefined);
  t.mock.timers.tick(400);
  assert.equal(tray.tooltips.at(-1), "ko:tray.tooltip:곧");
});

test("팝업 창은 음수 모니터 작업 영역 안에 배치되고 안전한 공용 preload를 쓴다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, calls } = createHarness();
  t.after(controller.dispose);
  workArea = { x: -1920, y: 20, width: 1920, height: 1040 };
  const cursor = { x: -100, y: 1050 };
  controller.open(cursor);
  const win = FakeBrowserWindow.instances[0];

  const maxX = workArea.x + workArea.width - win.options.width;
  const maxY = workArea.y + workArea.height - win.options.height;
  assert.ok(cursor.x > maxX, "검사 좌표가 실제 오른쪽 경계를 넘어야 한다");
  assert.ok(cursor.y > maxY, "검사 좌표가 실제 아래쪽 경계를 넘어야 한다");
  assert.equal(win.options.x, maxX);
  assert.equal(win.options.y, maxY);
  assert.equal(win.options.width, 250);
  assert.equal(win.options.show, false);
  assert.equal(win.options.frame, false);
  assert.equal(win.options.transparent, true);
  assert.equal(win.options.resizable, false);
  assert.equal(win.options.skipTaskbar, true);
  assert.equal(win.options.alwaysOnTop, true);
  assert.deepEqual(win.options.webPreferences, {
    preload: "/sentinel/preload.js",
    contextIsolation: true,
    nodeIntegration: false
  });
  assert.deepEqual(win.alwaysOnTopCalls, [[true, "floating"]]);
  assert.deepEqual(calls.loaded, [{ win, name: "pet-context-menu" }]);

  win.emit("ready-to-show");
  assert.deepEqual(win.operations, ["show", "focus"]);
  win.emit("blur");
  assert.equal(win.isDestroyed(), true);

  const upperLeft = { x: -2000, y: -30 };
  assert.ok(upperLeft.x < workArea.x && upperLeft.y < workArea.y);
  controller.open(upperLeft);
  const next = FakeBrowserWindow.instances[1];
  assert.equal(next.options.x, workArea.x);
  assert.equal(next.options.y, workArea.y);
});

test("아이콘 hydration이 끝난 뒤에만 허용 필드로 직렬화해 보낸다", async (t) => {
  /** @type {(items: any[]) => void} */
  let finishHydration = () => {};
  /** @type {any[]} */
  let hydratingItems = [];
  const hydration = new Promise((resolve) => { finishHydration = resolve; });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.favoritesEnabled = true;
  settings.favoritesTrayItemsEnabled = true;
  settings.favoriteItems = [{
    id: "memo",
    name: "메모",
    target: "C:\\memo.exe",
    iconTemplate: "",
    iconColor: "",
    customIcon: "C:\\private-icon.png"
  }];
  const { controller } = createHarness({
    settings,
    hydrate: async (items) => {
      hydratingItems = items;
      return hydration;
    }
  });
  t.after(controller.dispose);

  controller.open({ x: 100, y: 100 });
  const win = FakeBrowserWindow.instances[0];
  win.webContents.emit("did-finish-load");
  assert.deepEqual(win.webContents.messages, []);
  const favorite = hydratingItems.find((item) => item.id === "favorite:memo");
  favorite.iconDataUrl = "data:image/png;base64,AA";
  finishHydration(hydratingItems);
  await flushPromises();

  assert.equal(win.webContents.messages.length, 1);
  const message = /** @type {any} */ (win.webContents.messages[0]);
  const payload = /** @type {any[]} */ (message.payload);
  const serializedFavorite = payload.find((item) => item.id === "favorite:memo");
  assert.equal(serializedFavorite.iconDataUrl, "data:image/png;base64,AA");
  assert.equal(Object.hasOwn(serializedFavorite, "run"), false);
  assert.equal(Object.hasOwn(serializedFavorite, "target"), false);
  assert.equal(Object.hasOwn(serializedFavorite, "customIcon"), false);
});

test("교체된 창의 늦은 hydration과 closed 이벤트는 새 창을 건드리지 않는다", async (t) => {
  /** @type {(items: any[]) => void} */
  let finishFirst = () => {};
  let hydrationCall = 0;
  const firstHydration = new Promise((resolve) => { finishFirst = resolve; });
  const { controller } = createHarness({
    hydrate: async (items) => {
      hydrationCall += 1;
      return hydrationCall === 1 ? firstHydration : items;
    }
  });
  t.after(controller.dispose);

  controller.open({ x: 100, y: 100 });
  const first = FakeBrowserWindow.instances[0];
  first.webContents.emit("did-finish-load");
  deferWindowClose = true;
  controller.open({ x: 200, y: 200 });
  const second = FakeBrowserWindow.instances[1];
  assert.equal(controller.contextMenuWindow(), second);
  first.emit("ready-to-show");
  assert.deepEqual(first.operations, ["close"]);

  finishFirst([]);
  await flushPromises();
  assert.deepEqual(first.webContents.messages, []);
  first.finishClose();
  assert.equal(controller.contextMenuWindow(), second);
});

test("일반 blur는 닫지만 캡처 모드에서는 400ms 뒤 PNG를 저장하고 종료한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, calls } = createHarness({
    argv: ["electron", ".", "--capture-context-menu=/tmp/menu.png"]
  });
  t.after(controller.dispose);

  controller.open({ x: 100, y: 100 });
  const win = FakeBrowserWindow.instances[0];
  win.emit("blur");
  assert.equal(win.isDestroyed(), false);
  win.webContents.emit("did-finish-load");
  await flushPromises();
  t.mock.timers.tick(399);
  assert.deepEqual(calls.writes, []);
  t.mock.timers.tick(1);
  await flushPromises();

  assert.equal(win.webContents.captureCount, 1);
  assert.equal(calls.writes.length, 1);
  const write = /** @type {any} */ (calls.writes[0]);
  assert.equal(write.path, "/tmp/menu.png");
  assert.equal(write.contents.toString(), "captured-menu");
  assert.equal(calls.quit, 1);
});

test("dispose는 아직 실행되지 않은 트레이와 캡처 타이머를 모두 정리한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const trayHarness = createHarness();
  trayHarness.controller.createTray();
  const tray = FakeTray.instances[0];
  trayHarness.controller.dispose();

  const captureHarness = createHarness({
    argv: ["electron", ".", "--capture-context-menu=/tmp/menu.png"]
  });
  captureHarness.controller.open({ x: 100, y: 100 });
  FakeBrowserWindow.instances[0].webContents.emit("did-finish-load");
  await flushPromises();

  captureHarness.controller.dispose();
  t.mock.timers.tick(1000);
  await flushPromises();
  assert.deepEqual(tray.tooltips, ["Dangorobo"]);
  assert.deepEqual(captureHarness.calls.writes, []);
  assert.equal(captureHarness.calls.quit, 0);
});

test("dispose 뒤 끝난 hydration은 메시지나 캡처 타이머를 되살리지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  /** @type {(items: any[]) => void} */
  let finishHydration = () => {};
  const hydration = new Promise((resolve) => { finishHydration = resolve; });
  const { controller, calls } = createHarness({
    argv: ["electron", ".", "--capture-context-menu=/tmp/menu.png"],
    hydrate: async () => hydration
  });
  controller.open({ x: 100, y: 100 });
  const win = FakeBrowserWindow.instances[0];
  win.webContents.emit("did-finish-load");

  controller.dispose();
  finishHydration([]);
  await flushPromises();
  t.mock.timers.tick(1000);
  await flushPromises();

  assert.deepEqual(win.webContents.messages, []);
  assert.equal(win.webContents.captureCount, 0);
  assert.deepEqual(calls.writes, []);
  assert.equal(calls.quit, 0);
});
