// @ts-check
// 전역 입력 훅의 이벤트 처리. uiohook-napi는 Windows 실기가 있어야 실제 입력이 들어오므로
// 훅에 붙이는 대신 핸들러를 직접 불러 검증한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createInputMonitor, typingIntensityFrom, UIOHOOK_CAPS_LOCK_KEYCODE } =
  require("../src/main/input-monitor.js");

// Windows 체크아웃은 CRLF라, 소스 구간을 문자열로 잘라내는 단언이 줄바꿈 바이트에 걸린다.
// 여기서 보는 것은 배선 구조뿐이므로 LF로 맞춘다.
/** @param {...string} segments */
function readSource(...segments) {
  return fs.readFileSync(path.join(...segments), "utf8").replace(/\r\n?/g, "\n");
}

const DEFAULT_UI = {
  clickThrough: true,
  restActive: false,
  customizeActive: false,
  assistantPanelActive: false,
  favoritesPanelActive: false,
  imageResizePanelActive: false,
  translatePanelActive: false,
  documentSummaryPanelActive: false
};

/**
 * @param {{
 *   settings?: {
 *     keyboardSquishEnabled?: boolean, keyboardClickEnabled?: boolean,
 *     mouseSquishEnabled?: boolean, mouseClickEnabled?: boolean,
 *     sleepAfterMinutes?: number, mediaPlayer?: {enabled?: boolean}
 *   },
 *   ui?: Partial<Record<string, boolean>>,
 *   dnd?: boolean,
 *   overPet?: boolean, overMedia?: boolean, overPanel?: boolean, overMenu?: boolean,
 *   contextMenuOpen?: boolean, alwaysDrag?: boolean, dragging?: boolean,
 *   now?: () => number,
 *   readCapsLockState?: () => Promise<boolean | undefined>
 * }} [overrides]
 */
function createHarness(overrides = {}) {
  /** @type {{channel: string, payload: unknown}[]} */
  const sent = [];
  const calls = {
    sent,
    menuClosed: 0,
    menuOpened: 0,
    dragStarts: 0,
    dragEnds: 0,
    dragUpdates: 0,
    pettingUpdates: 0,
    shortcuts: 0,
    applyInteraction: 0,
    /** @type {Array<{pet: boolean, media: boolean}>} */
    interactionStates: []
  };
  const state = {
    overPet: overrides.overPet === true,
    overMedia: overrides.overMedia === true,
    overPanel: overrides.overPanel === true,
    overMenu: overrides.overMenu === true,
    contextMenuOpen: overrides.contextMenuOpen === true,
    alwaysDrag: overrides.alwaysDrag !== false,
    dragging: overrides.dragging === true,
    dnd: overrides.dnd === true,
    ui: { ...overrides.ui },
    settings: { ...overrides.settings }
  };
  const monitor = createInputMonitor({
    pointer: {
      isPointOverWindowBounds: () => state.overMenu,
      isPointOverPet: () => state.overPet,
      isPointOverMediaPlayer: () => state.overMedia,
      isPointOverFloatingPanel: () => state.overPanel,
      alwaysDragEnabled: () => state.alwaysDrag,
      isDragging: () => state.dragging,
      startPetDrag: () => { calls.dragStarts += 1; },
      updatePetDrag: () => { calls.dragUpdates += 1; },
      endPetDrag: () => { calls.dragEnds += 1; },
      updateHeadPetting: () => { calls.pettingUpdates += 1; }
    },
    sendToPet: (channel, payload) => sent.push({ channel, payload }),
    getSettings: () => ({
      keyboardSquishEnabled: true,
      keyboardClickEnabled: true,
      mouseSquishEnabled: true,
      mouseClickEnabled: true,
      sleepAfterMinutes: 1,
      mediaPlayer: { enabled: true },
      ...state.settings
    }),
    getUiState: () => ({ ...DEFAULT_UI, ...state.ui }),
    isDndActive: () => state.dnd,
    readCapsLockState: overrides.readCapsLockState ?? (async () => undefined),
    contextMenuWindow: () => (
      state.contextMenuOpen ? { isDestroyed: () => false } : null
    ),
    closePetContextMenu: () => { calls.menuClosed += 1; },
    openPetContextMenu: () => { calls.menuOpened += 1; },
    getCursorPoint: () => ({ x: 0, y: 0 }),
    dispatchMouseShortcut: () => { calls.shortcuts += 1; },
    applyMouseInteractionState: () => {
      calls.applyInteraction += 1;
      calls.interactionStates.push({
        pet: monitor.isPetHoverInteractive(),
        media: monitor.isMediaPlayerHoverInteractive()
      });
    },
    now: overrides.now
  });
  return { monitor, calls, state };
}

/** @param {{sent: {channel: string, payload: unknown}[]}} calls */
const channels = (calls) => calls.sent.map((message) => message.channel);

/** @param {{sent: {channel: string, payload: unknown}[]}} calls @param {string} channel */
const payloads = (calls, channel) => calls.sent
  .filter((message) => message.channel === channel)
  .map((message) => message.payload);

test("키를 누르고 있는 동안 스퀴시와 클릭 사운드는 한 번만 울린다", () => {
  const { monitor, calls } = createHarness();
  monitor.onKeyDown({ keycode: 30 });
  monitor.onKeyDown({ keycode: 30 });
  monitor.onKeyDown({ keycode: 30 });
  assert.deepEqual(channels(calls), ["pet:squish-pulse", "pet:click-sound"]);
  // 키를 떼면 다시 울린다.
  monitor.onKeyUp({ keycode: 30 });
  monitor.onKeyDown({ keycode: 30 });
  assert.equal(channels(calls).length, 4);
});

test("동기화된 캡스락은 자동 반복 중 재조회 없이 한 번만 토글한다", async () => {
  let reads = 0;
  const { monitor, calls } = createHarness({
    readCapsLockState: async () => { reads += 1; return false; }
  });
  await monitor.initializeCapsLockState();
  calls.sent.length = 0;
  monitor.sendCapsLockState();
  monitor.onKeyDown({ keycode: UIOHOOK_CAPS_LOCK_KEYCODE });
  monitor.onKeyDown({ keycode: UIOHOOK_CAPS_LOCK_KEYCODE });
  assert.equal(monitor.capsLockActive(), true);
  assert.deepEqual(payloads(calls, "pet:caps-lock"), [
    { active: false },
    { active: true }
  ]);
  monitor.onKeyUp({ keycode: UIOHOOK_CAPS_LOCK_KEYCODE });
  monitor.onKeyDown({ keycode: UIOHOOK_CAPS_LOCK_KEYCODE });
  assert.equal(monitor.capsLockActive(), false);
  assert.deepEqual(payloads(calls, "pet:caps-lock").at(-1), { active: false });
  assert.equal(reads, 1, "초기 동기화 뒤 키 입력은 PowerShell을 다시 띄우지 않는다");
});

test("초기 캡스락 조회는 true와 false를 저장하고 undefined는 건너뛴다", async () => {
  for (const active of [true, false]) {
    const { monitor, calls } = createHarness({ readCapsLockState: async () => active });
    await monitor.initializeCapsLockState();
    assert.equal(monitor.capsLockActive(), active);
    assert.deepEqual(payloads(calls, "pet:caps-lock"), [{ active }]);
  }

  const unsupported = createHarness({ readCapsLockState: async () => undefined });
  await unsupported.monitor.initializeCapsLockState();
  assert.deepEqual(payloads(unsupported.calls, "pet:caps-lock"), []);
});

test("캡스락 입력과 초기 조회가 겹치면 입력 뒤 시작한 실제 상태 조회가 승리한다", async () => {
  /** @type {Array<(active: boolean) => void>} */
  const resolvers = [];
  const readCapsLockState = () => new Promise((resolve) => { resolvers.push(resolve); });
  const { monitor, calls } = createHarness({ readCapsLockState });
  const initializing = monitor.initializeCapsLockState();
  monitor.onKeyDown({ keycode: UIOHOOK_CAPS_LOCK_KEYCODE });
  assert.equal(resolvers.length, 2, "초기 조회 뒤 입력 시 실제 상태를 다시 읽는다");
  resolvers[0](true);
  await initializing;
  assert.equal(monitor.capsLockActive(), true, "오래된 초기 응답은 입력 직후 임시 상태를 덮지 않는다");
  resolvers[1](false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(monitor.capsLockActive(), false);
  assert.deepEqual(payloads(calls, "pet:caps-lock"), [
    { active: true },
    { active: false }
  ]);
});

test("초기 동기화 전 연속 CapsLock 입력은 마지막 입력 뒤 조회만 반영한다", async () => {
  /** @type {Array<(active: boolean) => void>} */
  const resolvers = [];
  const { monitor, calls } = createHarness({
    readCapsLockState: () => new Promise((resolve) => { resolvers.push(resolve); })
  });
  const initializing = monitor.initializeCapsLockState();
  monitor.onKeyDown({ keycode: UIOHOOK_CAPS_LOCK_KEYCODE });
  monitor.onKeyUp({ keycode: UIOHOOK_CAPS_LOCK_KEYCODE });
  monitor.onKeyDown({ keycode: UIOHOOK_CAPS_LOCK_KEYCODE });
  assert.equal(resolvers.length, 3);
  resolvers[0](true);
  await initializing;
  resolvers[1](true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(monitor.capsLockActive(), false, "오래된 두 응답은 무시한다");
  resolvers[2](true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(monitor.capsLockActive(), true);
  assert.deepEqual(payloads(calls, "pet:caps-lock").at(-1), { active: true });
});

test("stop 뒤 도착한 초기 캡스락 조회는 상태나 창을 건드리지 않는다", async () => {
  /** @type {(active: boolean) => void} */
  let resolveState = () => {};
  const initialState = new Promise((resolve) => { resolveState = resolve; });
  const { monitor, calls } = createHarness({ readCapsLockState: () => initialState });
  const initializing = monitor.initializeCapsLockState();
  monitor.stop();
  resolveState(true);
  await initializing;
  assert.equal(monitor.capsLockActive(), false);
  assert.deepEqual(payloads(calls, "pet:caps-lock"), []);
});

test("초기 캡스락 조회 실패는 상태를 바꾸지 않고 오류를 소비한다", async (t) => {
  const expected = new Error("조회 실패");
  /** @type {unknown[][]} */
  const errors = [];
  /** @param {unknown[]} args */
  function captureError(...args) {
    errors.push(args);
  }
  t.mock.method(console, "error", captureError);
  const { monitor, calls } = createHarness({
    readCapsLockState: async () => { throw expected; }
  });
  await monitor.initializeCapsLockState();
  assert.equal(monitor.capsLockActive(), false);
  assert.deepEqual(payloads(calls, "pet:caps-lock"), []);
  assert.deepEqual(errors, [["캡스락 상태를 읽지 못했습니다:", expected]]);
});

test("종료하거나 최신 조회가 시작된 뒤의 오래된 캡스락 실패는 기록하지 않는다", async (t) => {
  /** @type {Array<{reject: (error: Error) => void, resolve: (active: boolean) => void}>} */
  const pending = [];
  /** @type {unknown[][]} */
  const errors = [];
  /** @param {unknown[]} args */
  function captureStaleError(...args) {
    errors.push(args);
  }
  t.mock.method(console, "error", captureStaleError);
  const { monitor } = createHarness({
    readCapsLockState: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }); })
  });

  const stale = monitor.initializeCapsLockState();
  const latest = monitor.initializeCapsLockState();
  pending[1].resolve(false);
  await latest;
  pending[0].reject(new Error("오래된 실패"));
  await stale;
  assert.deepEqual(errors, []);

  const afterStop = monitor.initializeCapsLockState();
  monitor.stop();
  pending[2].reject(new Error("종료 뒤 실패"));
  await afterStop;
  assert.deepEqual(errors, []);
});

test("방해 금지 중에는 클릭 사운드를 울리지 않는다", () => {
  const keyboard = createHarness({ dnd: true });
  keyboard.monitor.onKeyDown({ keycode: 30 });
  assert.deepEqual(channels(keyboard.calls), ["pet:squish-pulse"]);

  const mouse = createHarness({ dnd: true });
  mouse.monitor.onMouseDown({ button: 1, x: 0, y: 0 });
  assert.deepEqual(channels(mouse.calls), ["pet:squish-pulse"]);
});

test("스퀴시·클릭 사운드 설정을 각각 끌 수 있다", () => {
  const noSquish = createHarness({ settings: { keyboardSquishEnabled: false } });
  noSquish.monitor.onKeyDown({ keycode: 30 });
  assert.deepEqual(channels(noSquish.calls), ["pet:click-sound"]);

  const noClick = createHarness({ settings: { mouseClickEnabled: false } });
  noClick.monitor.onMouseDown({ button: 1, x: 0, y: 0 });
  assert.deepEqual(channels(noClick.calls), ["pet:squish-pulse"]);
});

test("우클릭 메뉴가 떠 있으면 바깥 클릭은 닫고 안쪽 클릭은 흘려보낸다", () => {
  const outside = createHarness({ contextMenuOpen: true, overMenu: false, overPet: true });
  outside.monitor.onMouseDown({ button: 1, x: 0, y: 0 });
  assert.equal(outside.calls.menuClosed, 1);
  // 메뉴가 떠 있는 동안에는 드래그를 시작하지 않는다(메뉴 항목 클릭이 끌림으로 잡히면 안 된다).
  assert.equal(outside.calls.dragStarts, 0);

  const inside = createHarness({ contextMenuOpen: true, overMenu: true, overPet: true });
  inside.monitor.onMouseDown({ button: 1, x: 0, y: 0 });
  assert.equal(inside.calls.menuClosed, 0);
  assert.equal(inside.calls.dragStarts, 0);
});

test("펫 위 우클릭은 메뉴를 연다", async () => {
  const { monitor, calls } = createHarness({ overPet: true });
  monitor.onMouseDown({ button: 2, x: 0, y: 0 });
  // openPetContextMenu는 setImmediate로 미룬다 — 한 틱 기다린 뒤 확인한다.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.menuOpened, 1);
});

test("휴식·커스터마이징·클릭스루 해제 중에는 우클릭 메뉴를 열지 않는다", async () => {
  for (const ui of [{ restActive: true }, { customizeActive: true }, { clickThrough: false }]) {
    const { monitor, calls } = createHarness({ overPet: true, ui });
    monitor.onMouseDown({ button: 2, x: 0, y: 0 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.menuOpened, 0, JSON.stringify(ui));
  }
});

test("펫 몸통 좌클릭은 드래그를 시작한다", () => {
  const { monitor, calls } = createHarness({ overPet: true });
  monitor.onMouseDown({ button: 1, x: 0, y: 0 });
  assert.equal(calls.dragStarts, 1);
});

test("미디어 플레이어·겹친 패널 위 좌클릭은 드래그로 삼지 않는다", () => {
  for (const overrides of [{ overMedia: true }, { overPanel: true }, { alwaysDrag: false }]) {
    const { monitor, calls } = createHarness({ overPet: true, ...overrides });
    monitor.onMouseDown({ button: 1, x: 0, y: 0 });
    assert.equal(calls.dragStarts, 0, JSON.stringify(overrides));
  }
  // 커스터마이징 모드에서도 막는다(색 팔레트가 펫 위로 겹쳐 열린다).
  const customizing = createHarness({ overPet: true, ui: { customizeActive: true } });
  customizing.monitor.onMouseDown({ button: 1, x: 0, y: 0 });
  assert.equal(customizing.calls.dragStarts, 0);
});

test("드래그 중 마우스 이동은 위치만 갱신하고 쓰다듬기로 넘어가지 않는다", () => {
  const { monitor, calls } = createHarness({ dragging: true, overPet: true });
  monitor.onMouseMove({ x: 10, y: 10 });
  assert.equal(calls.dragUpdates, 1);
  assert.equal(calls.pettingUpdates, 0);
  assert.equal(monitor.isPetHoverInteractive(), false);
});

test("우클릭 메뉴가 떠 있는 동안 마우스 이동은 호버 상태를 건드리지 않는다", () => {
  const { monitor, calls } = createHarness({ contextMenuOpen: true, overPet: true });
  monitor.onMouseMove({ x: 10, y: 10 });
  assert.equal(calls.pettingUpdates, 0);
  assert.equal(calls.applyInteraction, 0);
});

test("펫 위로 들어오면 즉시 마우스를 받게 바꾼다", () => {
  const { monitor, calls } = createHarness({ overPet: true });
  monitor.onMouseMove({ x: 10, y: 10 });
  assert.equal(monitor.isPetHoverInteractive(), true);
  assert.equal(calls.applyInteraction, 1);
  assert.deepEqual(calls.interactionStates, [{ pet: true, media: false }]);
});

test("펫 이탈은 120ms 뒤 반영한다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { monitor, calls, state } = createHarness({ overPet: true });
  t.after(() => monitor.stop());
  monitor.onMouseMove({ x: 10, y: 10 });
  state.overPet = false;
  monitor.onMouseMove({ x: 20, y: 20 });
  t.mock.timers.tick(119);
  assert.equal(monitor.isPetHoverInteractive(), true);
  assert.equal(calls.applyInteraction, 1);
  t.mock.timers.tick(1);
  assert.equal(monitor.isPetHoverInteractive(), false);
  assert.equal(calls.applyInteraction, 2);
  assert.deepEqual(calls.interactionStates.at(-1), { pet: false, media: false });
});

test("같은 모니터에서 펫 이탈 뒤 재진입하면 예약을 취소하고 다시 이탈할 수 있다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { monitor, calls, state } = createHarness({ overPet: true });
  t.after(() => monitor.stop());
  monitor.onMouseMove({ x: 10, y: 10 });
  state.overPet = false;
  monitor.onMouseMove({ x: 20, y: 20 });
  t.mock.timers.tick(60);
  state.overPet = true;
  monitor.onMouseMove({ x: 10, y: 10 });
  t.mock.timers.tick(120);
  assert.equal(monitor.isPetHoverInteractive(), true);
  assert.equal(calls.applyInteraction, 1);

  state.overPet = false;
  monitor.onMouseMove({ x: 20, y: 20 });
  t.mock.timers.tick(120);
  assert.equal(monitor.isPetHoverInteractive(), false);
  assert.equal(calls.applyInteraction, 2);
});

test("펫 이탈을 반복해도 해제 타이머는 하나만 동작한다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { monitor, calls, state } = createHarness({ overPet: true });
  t.after(() => monitor.stop());
  monitor.onMouseMove({ x: 10, y: 10 });
  state.overPet = false;
  monitor.onMouseMove({ x: 20, y: 20 });
  monitor.onMouseMove({ x: 21, y: 21 });
  monitor.onMouseMove({ x: 22, y: 22 });
  t.mock.timers.tick(120);
  assert.equal(monitor.isPetHoverInteractive(), false);
  assert.equal(calls.applyInteraction, 2);
});

test("말풍선이 떠 있으면 펫 호버로 마우스를 가로채지 않는다", () => {
  for (const overrides of [
    { ui: { restActive: true } },
    { ui: { assistantPanelActive: true } },
    { ui: { customizeActive: true } },
    { ui: { clickThrough: false } },
    { overPanel: true }
  ]) {
    const { monitor, calls } = createHarness({ overPet: true, ...overrides });
    monitor.onMouseMove({ x: 10, y: 10 });
    assert.equal(monitor.isPetHoverInteractive(), false, JSON.stringify(overrides));
    assert.equal(calls.applyInteraction, 0, JSON.stringify(overrides));
  }
});

test("미디어 플레이어 위 호버는 플레이어가 켜져 있을 때만 잡는다", () => {
  const on = createHarness({ overMedia: true });
  on.monitor.onMouseMove({ x: 10, y: 10 });
  assert.equal(on.monitor.isMediaPlayerHoverInteractive(), true);
  assert.deepEqual(on.calls.interactionStates, [{ pet: false, media: true }]);

  const off = createHarness({ overMedia: true, settings: { mediaPlayer: { enabled: false } } });
  off.monitor.onMouseMove({ x: 10, y: 10 });
  assert.equal(off.monitor.isMediaPlayerHoverInteractive(), false);
});

test("미디어 호버는 겹치는 UI·모드가 하나라도 활성화되면 잡지 않는다", () => {
  const blockedStates = [
    { clickThrough: false },
    { customizeActive: true },
    { restActive: true },
    { assistantPanelActive: true },
    { favoritesPanelActive: true },
    { imageResizePanelActive: true },
    { translatePanelActive: true },
    { documentSummaryPanelActive: true }
  ];
  for (const ui of blockedStates) {
    const { monitor, calls } = createHarness({ overMedia: true, ui });
    monitor.onMouseMove({ x: 10, y: 10 });
    assert.equal(monitor.isMediaPlayerHoverInteractive(), false, JSON.stringify(ui));
    assert.equal(calls.applyInteraction, 0, JSON.stringify(ui));
  }
});

test("미디어 호버 이탈과 재진입도 같은 모니터의 타이머를 취소한다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { monitor, calls, state } = createHarness({ overMedia: true });
  t.after(() => monitor.stop());
  monitor.onMouseMove({ x: 10, y: 10 });
  state.overMedia = false;
  monitor.onMouseMove({ x: 20, y: 20 });
  t.mock.timers.tick(60);
  state.overMedia = true;
  monitor.onMouseMove({ x: 10, y: 10 });
  t.mock.timers.tick(120);
  assert.equal(monitor.isMediaPlayerHoverInteractive(), true);
  assert.equal(calls.applyInteraction, 1);

  state.overMedia = false;
  monitor.onMouseMove({ x: 20, y: 20 });
  t.mock.timers.tick(119);
  assert.equal(monitor.isMediaPlayerHoverInteractive(), true);
  t.mock.timers.tick(1);
  assert.equal(monitor.isMediaPlayerHoverInteractive(), false);
  assert.equal(calls.applyInteraction, 2);
  assert.deepEqual(calls.interactionStates.at(-1), { pet: false, media: false });
});

test("펫과 미디어 호버 이탈 타이머는 독립적으로 둘 다 해제한다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { monitor, calls, state } = createHarness({ overPet: true, overMedia: true });
  t.after(() => monitor.stop());
  monitor.onMouseMove({ x: 10, y: 10 });
  assert.equal(calls.applyInteraction, 2);
  state.overPet = false;
  state.overMedia = false;
  monitor.onMouseMove({ x: 20, y: 20 });
  t.mock.timers.tick(120);
  assert.equal(monitor.isPetHoverInteractive(), false);
  assert.equal(monitor.isMediaPlayerHoverInteractive(), false);
  assert.equal(calls.applyInteraction, 4);
});

test("resetPetHover는 미디어 상태와 타이머를 건드리지 않는다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { monitor, calls, state } = createHarness({ overPet: true, overMedia: true });
  t.after(() => monitor.stop());
  monitor.onMouseMove({ x: 10, y: 10 });
  state.overPet = false;
  state.overMedia = false;
  monitor.onMouseMove({ x: 20, y: 20 });
  monitor.resetPetHover();
  assert.equal(monitor.isPetHoverInteractive(), false);
  assert.equal(monitor.isMediaPlayerHoverInteractive(), true);
  t.mock.timers.tick(120);
  assert.equal(monitor.isMediaPlayerHoverInteractive(), false);
  assert.equal(calls.applyInteraction, 3);
});

test("resetMediaHover는 펫 상태와 타이머를 건드리지 않는다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { monitor, calls, state } = createHarness({ overPet: true, overMedia: true });
  t.after(() => monitor.stop());
  monitor.onMouseMove({ x: 10, y: 10 });
  state.overPet = false;
  state.overMedia = false;
  monitor.onMouseMove({ x: 20, y: 20 });
  monitor.resetMediaHover();
  assert.equal(monitor.isMediaPlayerHoverInteractive(), false);
  assert.equal(monitor.isPetHoverInteractive(), true);
  t.mock.timers.tick(120);
  assert.equal(monitor.isPetHoverInteractive(), false);
  assert.equal(calls.applyInteraction, 3);
});

test("마우스 버튼은 단축키 매칭을 거친다", () => {
  // Mouse4/5는 Electron globalShortcut을 못 써서 이 훅에서 직접 매칭한다.
  const { monitor, calls } = createHarness();
  monitor.onMouseDown({ button: 4, x: 0, y: 0 });
  assert.equal(calls.shortcuts, 1);
  // 우클릭 메뉴가 떠 있어도 단축키 매칭 자체는 먼저 일어난다.
  const menuOpen = createHarness({ contextMenuOpen: true });
  menuOpen.monitor.onMouseDown({ button: 4, x: 0, y: 0 });
  assert.equal(menuOpen.calls.shortcuts, 1);
});

test("start는 중복 없이 타이핑 틱 하나를 걸고 stop은 걷는다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { monitor, calls } = createHarness();
  // start()가 setInterval을 걸므로, assert가 먼저 실패해도 반드시 걷어야 한다 —
  // 안 그러면 남은 인터벌 때문에 테스트 러너가 끝나지 않는다.
  t.after(() => monitor.stop());
  monitor.start();
  monitor.start();
  t.mock.timers.tick(99);
  assert.equal(payloads(calls, "pet:typing-intensity").length, 0);
  t.mock.timers.tick(1);
  assert.equal(payloads(calls, "pet:typing-intensity").length, 1);
  monitor.stop();
  t.mock.timers.tick(200);
  assert.equal(payloads(calls, "pet:typing-intensity").length, 1);
});

test("stop은 펫·미디어 이탈 예약과 타이핑 interval을 모두 정리한다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { monitor, calls, state } = createHarness({ overPet: true, overMedia: true });
  t.after(() => monitor.stop());
  monitor.onMouseMove({ x: 10, y: 10 });
  state.overPet = false;
  state.overMedia = false;
  monitor.onMouseMove({ x: 20, y: 20 });
  monitor.start();
  monitor.stop();
  t.mock.timers.tick(200);
  assert.equal(monitor.isPetHoverInteractive(), false);
  assert.equal(monitor.isMediaPlayerHoverInteractive(), false);
  assert.equal(calls.applyInteraction, 2);
  assert.equal(payloads(calls, "pet:typing-intensity").length, 0);
});

test("stop 뒤에는 누른 키·타이핑 기록·interval 장부가 비워져 다시 시작할 수 있다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let clock = 10_000;
  const { monitor, calls } = createHarness({ now: () => clock });
  t.after(() => monitor.stop());
  monitor.onKeyDown({ keycode: 30 });
  monitor.stop();
  monitor.onKeyDown({ keycode: 30 });
  assert.equal(payloads(calls, "pet:squish-pulse").length, 2, "held key 장부를 비운다");
  monitor.onKeyUp({ keycode: 30 });
  monitor.stop();
  monitor.tickTyping();
  assert.equal(payloads(calls, "pet:typing-intensity").at(-1), 0, "타이핑 기록을 비운다");

  monitor.start();
  t.mock.timers.tick(100);
  const afterRestart = payloads(calls, "pet:typing-intensity").length;
  assert.equal(afterRestart, 2, "정지 뒤 interval을 다시 시작한다");
  monitor.stop();
  clock += 100;
  t.mock.timers.tick(100);
  assert.equal(payloads(calls, "pet:typing-intensity").length, afterRestart);
});

test("마우스를 떼면 드래그를 끝낸다", () => {
  const { monitor, calls } = createHarness();
  monitor.onMouseUp();
  assert.equal(calls.dragEnds, 1);
});

test("유휴 상태는 정확한 임계값에서 한 번 켜지고 입력 뒤 새 기준시각으로 돌아간다", () => {
  let clock = 0;
  const { monitor, calls } = createHarness({ now: () => clock });
  clock = 59_999;
  monitor.tickTyping();
  assert.equal(monitor.idleActive(), false);
  assert.deepEqual(payloads(calls, "pet:idle"), []);
  clock = 60_000;
  monitor.tickTyping();
  monitor.tickTyping();
  assert.equal(monitor.idleActive(), true);
  assert.deepEqual(payloads(calls, "pet:idle"), [{ idle: true }]);

  clock = 60_001;
  monitor.onMouseMove({ x: 1, y: 1 });
  assert.equal(monitor.idleActive(), false);
  assert.deepEqual(payloads(calls, "pet:idle"), [{ idle: true }, { idle: false }]);
  clock = 120_000;
  monitor.tickTyping();
  assert.equal(monitor.idleActive(), false);
  clock = 120_001;
  monitor.tickTyping();
  assert.equal(monitor.idleActive(), true);
  assert.deepEqual(payloads(calls, "pet:idle").at(-1), { idle: true });
});

test("유휴 기준은 모니터 생성 시각과 현재 sleepAfterMinutes를 사용한다", () => {
  let clock = 42_000;
  const { monitor, calls, state } = createHarness({
    now: () => clock,
    settings: { sleepAfterMinutes: 1 }
  });
  state.settings.sleepAfterMinutes = 2;
  clock = 161_999;
  monitor.tickTyping();
  assert.equal(monitor.idleActive(), false);
  clock = 162_000;
  monitor.tickTyping();
  assert.equal(monitor.idleActive(), true);
  assert.deepEqual(payloads(calls, "pet:idle"), [{ idle: true }]);
});

test("키·마우스 버튼·마우스 이동은 각각 유휴 상태를 한 번만 깨운다", () => {
  /** @type {Array<(monitor: ReturnType<typeof createInputMonitor>) => void>} */
  const inputActions = [
    (monitor) => monitor.onKeyDown({ keycode: 30 }),
    (monitor) => monitor.onMouseDown({ button: 1, x: 0, y: 0 }),
    (monitor) => monitor.onMouseMove({ x: 1, y: 1 })
  ];
  for (const act of inputActions) {
    let clock = 0;
    const { monitor, calls } = createHarness({ now: () => clock });
    clock = 60_000;
    monitor.tickTyping();
    clock += 1;
    act(monitor);
    act(monitor);
    assert.deepEqual(payloads(calls, "pet:idle"), [{ idle: true }, { idle: false }]);
  }
});

test("타이핑 강도는 1.5초 창의 초당 타수에서 나온다", () => {
  // 6.5타/초가 1.0이 되도록 맞춘 값이다.
  assert.equal(typingIntensityFrom([], 10_000), 0);
  const tenKeys = Array.from({ length: 10 }, (_, index) => 10_000 - index * 10);
  // 1.5초에 10타 = 6.67타/초 → 1을 살짝 넘는다.
  assert.ok(typingIntensityFrom(tenKeys, 10_000) > 1);
  // 아무리 빨라도 1.1에서 멈춘다.
  const manyKeys = Array.from({ length: 200 }, () => 10_000);
  assert.equal(typingIntensityFrom(manyKeys, 10_000), 1.1);
  // 1.5초보다 오래된 입력은 세지 않는다.
  assert.equal(typingIntensityFrom([1_000, 2_000], 10_000), 0);
});

test("타이핑 강도 틱은 오래된 입력을 버리고 펫에 보낸다", () => {
  let clock = 10_000;
  const { monitor, calls } = createHarness({ now: () => clock });
  monitor.onKeyDown({ keycode: 30 });
  monitor.tickTyping();
  const first = calls.sent.filter((message) => message.channel === "pet:typing-intensity");
  assert.equal(first.length, 1);
  assert.ok(Number(first[0].payload) > 0);

  clock += 5_000;
  monitor.tickTyping();
  const second = calls.sent.filter((message) => message.channel === "pet:typing-intensity");
  assert.equal(second[1].payload, 0);
});

test("main은 입력 상태를 중복 소유하지 않고 input-monitor의 getter와 reset을 쓴다", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const mainSource = readSource(repoRoot, "src", "main.ts");
  const monitorSource = readSource(repoRoot, "src", "main", "input-monitor.ts");

  for (const name of [
    "petHoverInteractive", "mediaPlayerHoverInteractive", "mediaHoverDebounceTimer",
    "capsLockActive", "lastInputAt", "idleActive"
  ]) {
    assert.doesNotMatch(mainSource, new RegExp(`\\blet\\s+${name}\\b`), `${name}은 main이 소유하지 않는다`);
  }

  const depsStart = monitorSource.indexOf("type InputMonitorDependencies = {");
  const depsEnd = monitorSource.indexOf("\n};\n\nconst UIOHOOK_CAPS_LOCK_KEYCODE", depsStart);
  assert.ok(depsStart >= 0 && depsEnd > depsStart, "input-monitor 의존성 선언을 찾는다");
  const depsSource = monitorSource.slice(depsStart, depsEnd);
  for (const oldDependency of [
    "toggleCapsLock", "markUserInput:", "updateIdleState:",
    "getPetHoverInteractive", "setPetHoverInteractive",
    "getMediaPlayerHoverInteractive", "setMediaPlayerHoverInteractive"
  ]) {
    assert.doesNotMatch(depsSource, new RegExp(oldDependency), `${oldDependency} 세터 주입을 되살리지 않는다`);
  }

  // 호버 두 값을 실제로 읽는 곳은 pet-interaction-mode로 옮겼다. 엔트리는 그 모듈에
  // input-monitor의 getter를 그대로 넘기기만 한다 — 값을 복사해 두면 소유가 갈린다.
  assert.match(
    mainSource,
    /isPetHoverInteractive: \(\) => inputMonitor\.isPetHoverInteractive\(\),\s*isMediaPlayerHoverInteractive: \(\) => inputMonitor\.isMediaPlayerHoverInteractive\(\),/
  );
  // 미디어 감시를 끌 때 예약된 호버 해제를 실제로 취소하고 바로 상태를 다시 적용한다.
  assert.match(mainSource, /inputMonitor\.resetMediaHover\(\);\s*petInteraction\.apply\(\);/);
  assert.match(mainSource, /resetPetHover: \(\) => inputMonitor\.resetPetHover\(\)/);
  assert.match(mainSource, /sendCapsLockState: \(\) => inputMonitor\.sendCapsLockState\(\)/);
  assert.match(
    mainSource,
    /const readCapsLockState = createCapsLockStateReader\(\{[\s\S]*?\}\);[\s\S]*?const inputMonitor = createInputMonitor\(\{[\s\S]*?readCapsLockState,/
  );
  assert.match(mainSource, /void inputMonitor\.initializeCapsLockState\(\);/);
  assert.match(mainSource, /app\.on\("will-quit", \(\) => \{[\s\S]*?inputMonitor\.stop\(\);/);
});
