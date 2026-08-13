const test = require("node:test");
const assert = require("node:assert/strict");

const { idleRoutineEase, stretchReachAmount, squishCurve } = require("../src/pet/motion-curves.js");

/**
 * @param {number} actual
 * @param {number} expected
 * @param {string} [message]
 */
function near(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message || "값"}: ${actual}이(가) ${expected}에 가깝지 않다`
  );
}

/**
 * 커브가 구간 경계에서 끊기면 펫 동작이 뚝 튀어 보인다. 경계 양쪽 값이 이어지는지 본다.
 * @param {(progress: number) => number} curve
 * @param {number} boundary
 */
function assertContinuousAt(curve, boundary) {
  const epsilon = 1e-6;
  assert.ok(
    Math.abs(curve(boundary - epsilon) - curve(boundary)) < 1e-4,
    `${boundary} 경계에서 커브가 끊긴다`
  );
}

test("idleRoutineEase는 0에서 시작해 중앙에서 최대가 되고 끝에서 0으로 돌아온다", () => {
  near(idleRoutineEase(0), 0, "시작");
  near(idleRoutineEase(0.5), 1, "중앙");
  near(idleRoutineEase(1), 0, "끝");
});

test("idleRoutineEase는 0~1 밖의 진행도를 잘라낸다", () => {
  near(idleRoutineEase(-3), idleRoutineEase(0), "음수");
  near(idleRoutineEase(4), idleRoutineEase(1), "1 초과");
});

test("stretchReachAmount는 천천히 뻗고 유지하다 빠르게 내린다", () => {
  near(stretchReachAmount(0), 0, "시작");
  // 45%까지 올라가고 70%까지 다 뻗은 채로 유지한다.
  near(stretchReachAmount(0.45), 1, "다 뻗은 지점");
  near(stretchReachAmount(0.6), 1, "유지 구간");
  near(stretchReachAmount(0.7), 1, "내리기 시작");
  // 88%에 다 내려오고 그 뒤로는 계속 0이다.
  near(stretchReachAmount(0.88), 0, "다 내려온 지점");
  near(stretchReachAmount(1), 0, "끝");

  assert.ok(stretchReachAmount(0.2) > 0 && stretchReachAmount(0.2) < 1, "올라가는 중");
  assert.ok(stretchReachAmount(0.8) > 0 && stretchReachAmount(0.8) < 1, "내려오는 중");
  // 내리는 구간(0.7~0.88, 18%)이 올리는 구간(0~0.45, 45%)보다 짧다.
  assert.ok(stretchReachAmount(0.79) < stretchReachAmount(0.225), "내리기가 올리기보다 빠르다");
});

test("stretchReachAmount는 올라가는 동안 되돌아가지 않는다", () => {
  let previous = -1;
  for (let step = 0; step <= 45; step += 1) {
    const value = stretchReachAmount(step / 100);
    assert.ok(value >= previous, `${step / 100}에서 값이 줄었다`);
    previous = value;
  }
});

test("stretchReachAmount의 구간 경계가 이어진다", () => {
  for (const boundary of [0.45, 0.7, 0.88]) assertContinuousAt(stretchReachAmount, boundary);
});

test("stretchReachAmount는 0~1 밖의 진행도를 잘라낸다", () => {
  near(stretchReachAmount(-1), 0, "음수");
  near(stretchReachAmount(2), 0, "1 초과");
});

test("squishCurve는 눌렸다가 반대로 살짝 튀고 제자리로 돌아온다", () => {
  near(squishCurve(0), 0, "시작");
  near(squishCurve(0.3), 1, "가장 눌린 지점");
  near(squishCurve(0.68), -0.18, "반대로 튄 지점");
  near(squishCurve(1), 0, "끝");
  assert.ok(squishCurve(0.5) < 1 && squishCurve(0.5) > -0.18, "되돌아오는 중");
});

test("squishCurve의 구간 경계가 이어진다", () => {
  for (const boundary of [0.3, 0.68]) assertContinuousAt(squishCurve, boundary);
});

// 렌더 루프는 재생이 끝난 뒤에도 진행도를 계속 키우며 이 커브를 부른다. 1을 넘겨도 0에
// 머물러야 스퀴시가 끝난 뒤 몸이 다시 튀지 않는다.
test("squishCurve는 진행도가 1을 넘어도 0에 머문다", () => {
  near(squishCurve(1.5), 0, "1.5");
  near(squishCurve(12), 0, "12");
  near(squishCurve(-1), 0, "음수");
});
