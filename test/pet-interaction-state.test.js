// @ts-check
// main이 알려주는 상호작용 상태. preload 브리지를 주입받으므로 Electron 없이 합성 이벤트로
// 검증한다. 축하 만료는 가상 시간으로 본다.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPetInteractionState,
  CELEBRATE_DURATION_MS
} = require("../src/pet/pet-interaction-state.js");

// 모듈은 다른 펫 모듈과 같이 window.desktopPet을 직접 쓴다(계약 테스트가 그 표기를
// 훑는다). 그래서 여기서는 브리지를 주입하는 대신 window를 스텁해 콜백을 붙잡는다.
/** @param {import("node:test").TestContext} context */
function setup(context) {
  /** @type {Record<string, Function>} */
  const handlers = {};
  /** @param {string} name */
  const capture = (name) => (/** @type {Function} */ callback) => { handlers[name] = callback; };
  const previousWindow = /** @type {any} */ (globalThis).window;
  /** @type {any} */ (globalThis).window = {
    desktopPet: {
      onTypingIntensity: capture("typing"),
      onPetting: capture("petting"),
      onCelebrate: capture("celebrate"),
      onCapsLock: capture("capsLock"),
      onIdle: capture("idle"),
      onDragState: capture("drag")
    }
  };
  context.after(() => { /** @type {any} */ (globalThis).window = previousWindow; });

  let clock = 1000;
  /** @type {string[]} */
  const pettingCalls = [];
  const state = createPetInteractionState({
    now: () => clock,
    onPettingStart: () => pettingCalls.push("start"),
    onPettingStop: () => pettingCalls.push("stop")
  });
  return {
    state,
    handlers,
    pettingCalls,
    /** @param {number} ms */
    advance: (ms) => { clock += ms; }
  };
}

test("브리지 이벤트 여섯 개를 모두 등록한다", (context) => {
  const { handlers } = setup(context);
  assert.deepEqual(
    Object.keys(handlers).sort(),
    ["capsLock", "celebrate", "drag", "idle", "petting", "typing"]
  );
});

test("시작 상태는 전부 꺼져 있다", (context) => {
  const { state } = setup(context);
  assert.equal(state.getTargetTypingIntensity(), 0);
  assert.equal(state.isPetting(), false);
  assert.equal(state.isCelebrating(), false);
  assert.equal(state.isCapsLockActive(), false);
  assert.equal(state.isIdle(), false);
  assert.equal(state.isDragging(), false);
});

test("타이핑 강도 목표치는 받은 값을 그대로 들고 있는다", (context) => {
  const { state, handlers } = setup(context);
  handlers.typing(0.42);
  assert.equal(state.getTargetTypingIntensity(), 0.42);
  handlers.typing(0);
  assert.equal(state.getTargetTypingIntensity(), 0);
});

test("쓰다듬기 전이에서만 시작·종료를 알린다", (context) => {
  const { state, handlers, pettingCalls } = setup(context);

  handlers.petting({ active: true });
  assert.equal(state.isPetting(), true);
  assert.deepEqual(pettingCalls, ["start"]);

  // 같은 상태가 연달아 와도 하트를 다시 뿌리지 않는다.
  handlers.petting({ active: true });
  assert.deepEqual(pettingCalls, ["start"]);

  handlers.petting({ active: false });
  assert.equal(state.isPetting(), false);
  assert.deepEqual(pettingCalls, ["start", "stop"]);

  handlers.petting({ active: false });
  assert.deepEqual(pettingCalls, ["start", "stop"]);
});

test("축하는 받은 시각부터 정해진 시간 동안만 켜져 있다", (context) => {
  const { state, handlers, advance } = setup(context);
  handlers.celebrate();
  assert.equal(state.isCelebrating(), true);

  advance(CELEBRATE_DURATION_MS - 1);
  assert.equal(state.isCelebrating(), true, "만료 직전에는 아직 켜져 있다");

  advance(1);
  assert.equal(state.isCelebrating(), false, "만료 시각에 정확히 꺼진다");
});

test("축하가 겹치면 마지막 시점부터 다시 센다", (context) => {
  const { state, handlers, advance } = setup(context);
  handlers.celebrate();
  advance(CELEBRATE_DURATION_MS - 100);
  handlers.celebrate();

  advance(200);
  assert.equal(state.isCelebrating(), true, "첫 축하 기준으로는 이미 지났지만 갱신됐다");
  advance(CELEBRATE_DURATION_MS);
  assert.equal(state.isCelebrating(), false);
});

test("CapsLock·유휴·드래그는 각자의 플래그를 엄격히 boolean으로 읽는다", (context) => {
  const { state, handlers } = setup(context);

  handlers.capsLock({ active: true });
  handlers.idle({ idle: true });
  handlers.drag({ dragging: true });
  assert.equal(state.isCapsLockActive(), true);
  assert.equal(state.isIdle(), true);
  assert.equal(state.isDragging(), true);

  // truthy이기만 한 값은 켜지 않는다(=== true 비교를 유지한다).
  handlers.capsLock(/** @type {any} */ ({ active: "yes" }));
  handlers.idle(/** @type {any} */ ({ idle: 1 }));
  handlers.drag(/** @type {any} */ ({ dragging: "dragging" }));
  assert.equal(state.isCapsLockActive(), false);
  assert.equal(state.isIdle(), false);
  assert.equal(state.isDragging(), false);

  // 값이 아예 없거나 null이어도 조용히 꺼진다.
  handlers.capsLock(/** @type {any} */ (null));
  handlers.idle(/** @type {any} */ ({}));
  handlers.drag(/** @type {any} */ (undefined));
  assert.equal(state.isCapsLockActive(), false);
  assert.equal(state.isIdle(), false);
  assert.equal(state.isDragging(), false);
});

test("서로 다른 상태는 간섭하지 않는다", (context) => {
  const { state, handlers } = setup(context);
  handlers.drag({ dragging: true });
  handlers.petting({ active: true });
  handlers.typing(1);

  assert.equal(state.isDragging(), true);
  assert.equal(state.isPetting(), true);
  assert.equal(state.getTargetTypingIntensity(), 1);
  assert.equal(state.isIdle(), false);
  assert.equal(state.isCapsLockActive(), false);
  assert.equal(state.isCelebrating(), false);
});
