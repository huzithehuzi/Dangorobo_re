// @ts-check
// 펫 창이 마우스를 받을 조건. 잘못되면 펫 뒤의 앱을 못 누르거나(과하게 받음) 펫을
// 못 누른다(덜 받음) — 둘 다 바로 체감되는 버그다.
//
// 핵심은 **interactive와 focusable의 조건이 다르다**는 것이다. 호버는 마우스만 받고
// 포커스는 넘기지 않는다 — 커서를 얹었다고 작업 중인 창의 포커스를 빼앗으면 타이핑이 끊긴다.
const test = require("node:test");
const assert = require("node:assert/strict");

const { createPetInteractionMode } = require("../src/main/windows/pet-interaction-mode.js");

function setup(overrides = {}) {
  /** @type {any[]} */
  const focusable = [];
  /** @type {any[]} */
  const ignoreMouse = [];
  /** @type {any[]} */
  const sent = [];
  /** @type {any[]} */
  const logs = [];
  const win = {
    destroyed: false,
    isDestroyed: () => win.destroyed,
    /** @param {boolean} value */
    setFocusable: (value) => focusable.push(value),
    /** @param {boolean} ignore @param {any} options */
    setIgnoreMouseEvents: (ignore, options) => ignoreMouse.push({ ignore, options }),
    webContents: {
      /** @param {string} channel @param {any} payload */
      send: (channel, payload) => sent.push({ channel, payload })
    }
  };
  const state = {
    panelActive: false,
    customizeActive: false,
    petHover: false,
    mediaHover: false,
    ensureVisibleCount: 0
  };
  const deps = {
    petWindow: () => win,
    anyPanelActive: () => state.panelActive,
    isCustomizeActive: () => state.customizeActive,
    isPetHoverInteractive: () => state.petHover,
    isMediaPlayerHoverInteractive: () => state.mediaHover,
    ensurePetVisible: () => { state.ensureVisibleCount += 1; },
    /** @param {string} op @param {any} detail */
    logWindowOp: (op, detail) => logs.push({ op, detail }),
    panelDetail: () => ({ assistantPanelActive: false }),
    ...overrides
  };
  return {
    mode: createPetInteractionMode(/** @type {any} */ (deps)),
    win, state, focusable, ignoreMouse, sent, logs,
    /** 마지막 apply() 결과 */
    last: () => ({
      focusable: focusable[focusable.length - 1],
      interactive: ignoreMouse.length ? !ignoreMouse[ignoreMouse.length - 1].ignore : undefined
    })
  };
}

test("아무 일도 없으면 클릭이 통과한다", () => {
  const { mode, last } = setup();
  mode.apply();
  assert.deepEqual(last(), { focusable: false, interactive: false });
});

test("호버는 마우스만 받고 포커스는 넘기지 않는다", () => {
  // 커서를 얹었다고 작업 중인 창의 포커스를 빼앗으면 타이핑이 끊긴다.
  const { mode, state, last } = setup();

  state.petHover = true;
  mode.apply();
  assert.deepEqual(last(), { focusable: false, interactive: true }, "펫 호버");

  state.petHover = false;
  state.mediaHover = true;
  mode.apply();
  assert.deepEqual(last(), { focusable: false, interactive: true }, "미디어 호버");
});

test("휴식 알림·말풍선·커스터마이징은 포커스까지 받는다", () => {
  // 확인 버튼을 누르고 글자를 입력해야 하므로 포커스가 필요하다.
  for (const key of ["panelActive", "customizeActive"]) {
    const { mode, state, last } = setup();
    /** @type {any} */ (state)[key] = true;
    mode.apply();
    assert.deepEqual(last(), { focusable: true, interactive: true }, key);
  }

  const rest = setup();
  rest.mode.setRestActive(true);
  rest.mode.apply();
  assert.deepEqual(rest.last(), { focusable: true, interactive: true }, "휴식 알림");
});

test("이동 모드(클릭 통과 해제)는 포커스까지 받는다", () => {
  const { mode, last } = setup();
  mode.setClickThrough(false);
  assert.deepEqual(last(), { focusable: true, interactive: true });

  mode.setClickThrough(true);
  assert.deepEqual(last(), { focusable: false, interactive: false });
});

test("setClickThrough는 펫 창에도 알린다", () => {
  const { mode, sent } = setup();
  mode.setClickThrough(false);
  assert.deepEqual(sent, [{ channel: "pet:interaction-mode", payload: { clickThrough: false } }]);
});

test("클릭 통과로 돌아올 때만 창이 화면 안에 있는지 확인한다", () => {
  // 이동 모드에서 화면 밖으로 끌고 갔을 수 있다.
  const { mode, state } = setup();
  mode.setClickThrough(false);
  assert.equal(state.ensureVisibleCount, 0, "이동 모드로 들어갈 때는 확인하지 않는다");

  mode.setClickThrough(true);
  assert.equal(state.ensureVisibleCount, 1);
});

test("조건이 겹쳐도 한 번만 적용한다", () => {
  const { mode, state, focusable, ignoreMouse } = setup();
  state.panelActive = true;
  state.petHover = true;
  state.customizeActive = true;
  mode.apply();
  assert.equal(focusable.length, 1);
  assert.equal(ignoreMouse.length, 1);
  assert.deepEqual(ignoreMouse[0], { ignore: false, options: { forward: true } });
});

test("마우스를 안 받을 때도 forward 옵션은 유지한다", () => {
  // forward가 빠지면 통과된 클릭이 아래 창에 전달되지 않는다.
  const { mode, ignoreMouse } = setup();
  mode.apply();
  assert.deepEqual(ignoreMouse[0], { ignore: true, options: { forward: true } });
});

test("파괴된 창에는 아무것도 하지 않는다", () => {
  const { mode, win, focusable, ignoreMouse, logs } = setup();
  win.destroyed = true;
  mode.apply();
  assert.equal(focusable.length, 0);
  assert.equal(ignoreMouse.length, 0);
  assert.equal(logs.length, 0);
});

test("판단 근거를 전부 기록에 남긴다", () => {
  const { mode, state, logs } = setup();
  state.petHover = true;
  mode.setRestActive(true);
  mode.apply();

  assert.equal(logs.length, 1);
  assert.equal(logs[0].op, "applyMouseInteractionState");
  assert.deepEqual(logs[0].detail, {
    interactive: true, focusable: true, restActive: true, customizeActive: false,
    petHoverInteractive: true, mediaPlayerHoverInteractive: false, clickThrough: true,
    assistantPanelActive: false
  });
});

test("휴식 알림 상태는 읽어 갈 수 있다", () => {
  const { mode } = setup();
  assert.equal(mode.isRestActive(), false);
  assert.equal(mode.isClickThrough(), true);
  mode.setRestActive(true);
  assert.equal(mode.isRestActive(), true);
});
