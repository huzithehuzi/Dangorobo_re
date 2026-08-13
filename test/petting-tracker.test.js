const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PETTING_REVERSALS_TO_START,
  PETTING_IDLE_TIMEOUT_MS,
  PETTING_MIN_TRAVEL_PX,
  PETTING_CHAT_TRIGGER_REVERSALS,
  createPettingTracker
} = require("../src/main/petting-tracker.js");

/**
 * @param {import("node:test").TestContext} t
 */
function createHarness(t) {
  // 활성화되면 해제 타이머(900ms)가 걸린다 — 실제 타이머를 남기지 않도록 항상 가짜 타이머를 쓴다.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  /** @type {boolean[]} */
  const activeChanges = [];
  let chatCalls = 0;
  const tracker = createPettingTracker({
    onActiveChange: (active) => activeChanges.push(active),
    onPettingChat: () => {
      chatCalls += 1;
    }
  });
  return {
    tracker,
    activeChanges,
    chatCalls: () => chatCalls,
    /** 왕복 한 번(= 방향 전환 1회)마다 임계값을 넘는 거리로 좌우로 움직인다. */
    sweep: (/** @type {number} */ times) => {
      for (let i = 0; i < times; i++) {
        tracker.track(i % 2 === 0 ? 100 : 200);
      }
    }
  };
}

test("임계값은 분리 전 값 그대로다", () => {
  assert.equal(PETTING_REVERSALS_TO_START, 2);
  assert.equal(PETTING_IDLE_TIMEOUT_MS, 900);
  assert.equal(PETTING_MIN_TRAVEL_PX, 6);
  assert.equal(PETTING_CHAT_TRIGGER_REVERSALS, 8);
});

test("첫 좌표는 기준점만 잡고 아무것도 발동하지 않는다", (t) => {
  const h = createHarness(t);
  h.tracker.track(100);
  assert.deepEqual(h.activeChanges, []);
});

test("방향 전환 2회에서 쓰다듬기가 켜진다", (t) => {
  const h = createHarness(t);
  h.tracker.track(100);
  h.tracker.track(200); // 오른쪽 — 첫 방향이라 전환 아님
  assert.deepEqual(h.activeChanges, []);
  h.tracker.track(100); // 왼쪽 — 전환 1회
  assert.deepEqual(h.activeChanges, []);
  h.tracker.track(200); // 오른쪽 — 전환 2회
  assert.deepEqual(h.activeChanges, [true]);
});

test("같은 방향으로만 움직이면 아무리 멀리 가도 켜지지 않는다", (t) => {
  const h = createHarness(t);
  for (let x = 0; x <= 1000; x += 50) h.tracker.track(x);
  assert.deepEqual(h.activeChanges, []);
});

test("손떨림 수준의 미세 이동은 방향 전환으로 세지 않는다", (t) => {
  const h = createHarness(t);
  h.tracker.track(100);
  // 5px씩 좌우로 흔들어도(임계값 6 미만) 전환이 쌓이지 않는다.
  for (let i = 0; i < 20; i++) h.tracker.track(i % 2 === 0 ? 105 : 100);
  assert.deepEqual(h.activeChanges, []);
});

test("미세 이동은 기준점을 갱신하지 않아 이동량이 누적된다", (t) => {
  const h = createHarness(t);
  h.tracker.track(100);
  // 5px씩 세 번 — 각각은 임계값 미만이지만 기준점이 100에 머물러 있다.
  h.tracker.track(103);
  h.tracker.track(104);
  assert.deepEqual(h.activeChanges, []);
  // 100 기준으로 7px이므로 여기서 처음 방향이 잡힌다.
  h.tracker.track(107);
  h.tracker.track(100);
  h.tracker.track(107);
  assert.deepEqual(h.activeChanges, [true]);
});

test("활성 상태는 중복 통지하지 않는다", (t) => {
  const h = createHarness(t);
  h.sweep(12);
  assert.deepEqual(h.activeChanges, [true]);
});

// 첫 호출은 기준점만 잡고 두 번째 호출이 첫 방향을 정하므로, sweep(n)의 방향 전환은 n - 2회다.
test("왕복 8회부터 쓰다듬기 대화가 한 번만 발동한다", (t) => {
  const h = createHarness(t);
  h.sweep(10); // 전환 8회
  assert.equal(h.chatCalls(), 1);
  h.sweep(10);
  assert.equal(h.chatCalls(), 1);
});

test("왕복이 8회에 못 미치면 대화는 발동하지 않는다", (t) => {
  const h = createHarness(t);
  h.sweep(9); // 전환 7회
  assert.equal(h.chatCalls(), 0);
  assert.deepEqual(h.activeChanges, [true]);
});

test("마지막 왕복 후 900ms가 지나면 해제된다", (t) => {
  const h = createHarness(t);
  h.sweep(4);
  assert.deepEqual(h.activeChanges, [true]);
  t.mock.timers.tick(PETTING_IDLE_TIMEOUT_MS - 1);
  assert.deepEqual(h.activeChanges, [true]);
  t.mock.timers.tick(1);
  assert.deepEqual(h.activeChanges, [true, false]);
});

test("해제 타이머는 왕복이 이어지는 동안 계속 미뤄진다", (t) => {
  const h = createHarness(t);
  h.sweep(4);
  t.mock.timers.tick(800);
  h.tracker.track(100);
  t.mock.timers.tick(800);
  assert.deepEqual(h.activeChanges, [true]);
  t.mock.timers.tick(100);
  assert.deepEqual(h.activeChanges, [true, false]);
});

test("해제 후에는 대화가 다시 발동할 수 있다", (t) => {
  const h = createHarness(t);
  h.sweep(10);
  assert.equal(h.chatCalls(), 1);
  t.mock.timers.tick(PETTING_IDLE_TIMEOUT_MS);
  assert.deepEqual(h.activeChanges, [true, false]);
  h.sweep(10);
  assert.equal(h.chatCalls(), 2);
});

// 해제 타이머는 방향과 횟수만 지우고 기준 x는 남긴다 — 커서가 머리 위에 그대로 있으면
// 다음 왕복이 기준점 잡기부터 다시 시작하지 않는다. reset()과 다른 점이다.
test("해제는 기준 x를 남기므로 다음 왕복이 한 번 일찍 걸린다", (t) => {
  const h = createHarness(t);
  h.sweep(4);
  t.mock.timers.tick(PETTING_IDLE_TIMEOUT_MS);
  assert.deepEqual(h.activeChanges, [true, false]);
  // 기준 x가 남아 있어 첫 호출이 곧바로 방향을 정한다 — 전환 2회에 3번이면 충분하다.
  h.tracker.track(100);
  h.tracker.track(200);
  assert.deepEqual(h.activeChanges, [true, false]);
  h.tracker.track(100);
  assert.deepEqual(h.activeChanges, [true, false, true]);
});

test("reset은 진행 중인 왕복과 해제 타이머를 모두 버린다", (t) => {
  const h = createHarness(t);
  h.sweep(4);
  assert.deepEqual(h.activeChanges, [true]);
  h.tracker.reset();
  assert.deepEqual(h.activeChanges, [true, false]);
  // 버려진 타이머가 뒤늦게 다시 통지하지 않는다.
  t.mock.timers.tick(PETTING_IDLE_TIMEOUT_MS * 2);
  assert.deepEqual(h.activeChanges, [true, false]);
  // 방향 누적도 초기화되므로 다시 전환 2회를 채워야 켜진다.
  h.tracker.track(100);
  h.tracker.track(200);
  assert.deepEqual(h.activeChanges, [true, false]);
  h.tracker.track(100);
  h.tracker.track(200);
  assert.deepEqual(h.activeChanges, [true, false, true]);
});

test("꺼져 있을 때 reset을 반복해도 통지하지 않는다", (t) => {
  const h = createHarness(t);
  h.tracker.reset();
  h.tracker.reset();
  assert.deepEqual(h.activeChanges, []);
});
