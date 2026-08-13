// @ts-check
// 꼬리 흔들림의 위상·각도·굽힘 누적. 3D·DOM을 전혀 참조하지 않는 순수 계산이라 Node에서
// 그대로 돌린다. 캡처는 한 프레임만 찍으므로 "속도가 바뀔 때 위상이 튀지 않는다" 같은
// 시간축 성질은 여기서만 확인할 수 있다.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createTailMotion,
  TAIL_REST_ANGLE,
  TAIL_BEND_STRENGTH
} = require("../src/pet/tail-motion.js");

/** @type {import("../src/pet/tail-motion.js").TailMotionInputs} */
const IDLE = { typingIntensity: 0, speedMultiplier: 1, answerMotion: null, routineMotion: null };

/** @param {Partial<import("../src/pet/tail-motion.js").TailMotionInputs>} overrides */
function inputs(overrides) {
  return { ...IDLE, ...overrides };
}

test("아무 입력도 없으면 쉬는 각도로 수렴하고 굽힘은 0으로 간다", () => {
  const tail = createTailMotion();
  assert.equal(tail.getAngle(), TAIL_REST_ANGLE);

  // 흔들다가 멈춘 상태에서 시작해 본다.
  for (let i = 0; i < 60; i += 1) tail.advance(1 / 60, inputs({ typingIntensity: 1 }));
  assert.notEqual(tail.getAngle(), TAIL_REST_ANGLE);

  for (let i = 0; i < 600; i += 1) tail.advance(1 / 60, IDLE);
  assert.ok(Math.abs(tail.getAngle() - TAIL_REST_ANGLE) < 1e-6, "쉬는 각도로 수렴한다");
  assert.ok(Math.abs(tail.getBend()) < 1e-6, "굽힘이 0으로 수렴한다");
});

test("가만히 있으면 위상은 전혀 누적되지 않는다", () => {
  const tail = createTailMotion();
  for (let i = 0; i < 100; i += 1) tail.advance(1 / 60, IDLE);
  assert.equal(tail.getPhase(), 0);
});

test("타이핑 강도가 위상 속도와 진폭을 함께 올린다", () => {
  const slow = createTailMotion();
  const fast = createTailMotion();
  slow.advance(1, inputs({ typingIntensity: 0.1 }));
  fast.advance(1, inputs({ typingIntensity: 1 }));

  // 각속도 = (1.45 + 강도 * 3.05) * 배율
  assert.ok(Math.abs(slow.getPhase() - (1.45 + 0.1 * 3.05)) < 1e-12);
  assert.ok(Math.abs(fast.getPhase() - (1.45 + 3.05)) < 1e-12);
  assert.ok(fast.getPhase() > slow.getPhase());
});

test("꼬리 속도 배율은 위상 속도에만 곱해진다", () => {
  const normal = createTailMotion();
  const doubled = createTailMotion();
  normal.advance(1, inputs({ typingIntensity: 0.5 }));
  doubled.advance(1, inputs({ typingIntensity: 0.5, speedMultiplier: 2 }));

  assert.ok(Math.abs(doubled.getPhase() - normal.getPhase() * 2) < 1e-12);
});

test("속도가 중간에 바뀌어도 위상은 이어서 누적된다(순간이동하지 않는다)", () => {
  // elapsed에 속도를 곱하는 방식이면 속도가 바뀌는 순간 위상이 통째로 튄다.
  // 여기서는 매 프레임 delta * 각속도를 더하므로 앞서 쌓인 위상이 보존된다.
  const tail = createTailMotion();
  tail.advance(1, inputs({ typingIntensity: 1 }));
  const afterFast = tail.getPhase();

  tail.advance(1, inputs({ typingIntensity: 0.1 }));
  const expected = afterFast + (1.45 + 0.1 * 3.05);
  assert.ok(Math.abs(tail.getPhase() - expected) < 1e-12, "느려져도 이미 쌓인 위상을 유지한다");
});

test("굽힘은 각도보다 90도 앞선 코사인이라 각도가 최대일 때 0에 가깝다", () => {
  const tail = createTailMotion();
  // 위상을 정확히 pi/2로 맞춘다: 각속도 = 1.45 + 1*3.05 = 4.5
  const angularSpeed = 1.45 + 3.05;
  tail.advance(Math.PI / 2 / angularSpeed, inputs({ typingIntensity: 1 }));
  assert.ok(Math.abs(tail.getPhase() - Math.PI / 2) < 1e-12);

  // sin(pi/2)=1로 각도 목표는 최대, cos(pi/2)=0으로 굽힘 목표는 0이다.
  // 추종 때문에 실제 값은 목표보다 작지만 부호와 대소 관계는 그대로다.
  assert.ok(tail.getAngle() > TAIL_REST_ANGLE, "각도는 쉬는 각도보다 위로 간다");
  assert.ok(Math.abs(tail.getBend()) < 0.05, "같은 순간 굽힘은 0 근처다");
});

test("답변 모션은 타이핑이 없을 때만 쓰이고 자체 진폭·속도를 따른다", () => {
  const answer = { tailAmplitude: 0.3, tailSpeed: 5 };
  const idleTyping = createTailMotion();
  idleTyping.advance(1, inputs({ answerMotion: answer }));
  assert.ok(Math.abs(idleTyping.getPhase() - 5) < 1e-12);

  // 타이핑 중이면 답변 모션이 아니라 타이핑 쪽 각속도를 쓴다.
  const typing = createTailMotion();
  typing.advance(1, inputs({ typingIntensity: 1, answerMotion: answer }));
  assert.ok(Math.abs(typing.getPhase() - (1.45 + 3.05)) < 1e-12);
});

test("진폭이 0인 답변 모션은 흔들지 않는다", () => {
  const tail = createTailMotion();
  tail.advance(1, inputs({ answerMotion: { tailAmplitude: 0, tailSpeed: 9 } }));
  assert.equal(tail.getPhase(), 0);
});

test("stretch 루틴은 위상을 쓰지 않고 각도·굽힘을 한쪽으로 당긴다", () => {
  const tail = createTailMotion();
  for (let i = 0; i < 120; i += 1) {
    tail.advance(1 / 60, inputs({ routineMotion: { kind: "stretch", amount: 1 } }));
  }
  assert.equal(tail.getPhase(), 0, "흔드는 동작이 아니라 위상을 누적하지 않는다");
  assert.ok(tail.getAngle() < TAIL_REST_ANGLE, "쉬는 각도보다 아래로 당긴다");
  assert.ok(tail.getBend() < 0, "굽힘도 음수 방향이다");
});

test("흔드는 루틴 셋은 각자의 각속도로 위상을 누적한다", () => {
  /** @type {[string, number][]} */
  const cases = [["perkup", 4.2], ["wave", 3.8], ["shakeOff", 9.5]];
  for (const [kind, angularSpeed] of cases) {
    const tail = createTailMotion();
    tail.advance(1, inputs({ routineMotion: { kind, amount: 1 } }));
    assert.ok(Math.abs(tail.getPhase() - angularSpeed) < 1e-12, kind);
  }
});

test("루틴 amount가 0이면 위상은 돌아도 각도는 쉬는 각도에 머문다", () => {
  const tail = createTailMotion();
  for (let i = 0; i < 120; i += 1) {
    tail.advance(1 / 60, inputs({ routineMotion: { kind: "wave", amount: 0 } }));
  }
  assert.ok(tail.getPhase() > 0, "위상 자체는 누적된다");
  assert.ok(Math.abs(tail.getAngle() - TAIL_REST_ANGLE) < 1e-6);
});

test("굽힘 목표는 진폭에 TAIL_BEND_STRENGTH를 곱한 크기를 넘지 않는다", () => {
  const tail = createTailMotion();
  const amplitude = 0.2 + 1 * 0.43;
  let peak = 0;
  for (let i = 0; i < 600; i += 1) {
    const { bend } = tail.advance(1 / 60, inputs({ typingIntensity: 1 }));
    peak = Math.max(peak, Math.abs(bend));
  }
  assert.ok(peak > 0, "실제로 휜다");
  assert.ok(peak <= amplitude * TAIL_BEND_STRENGTH + 1e-9, "목표 진폭을 넘지 않는다");
});

test("목표 각도에 한 프레임 만에 도달하지 않고 따라간다", () => {
  // 추종을 없애고 목표를 즉시 대입하면 상태가 바뀌는 순간 꼬리가 뚝 끊긴다.
  const tail = createTailMotion();
  const target = TAIL_REST_ANGLE - 0.3;
  const { angle } = tail.advance(1 / 60, inputs({ routineMotion: { kind: "stretch", amount: 1 } }));

  assert.ok(angle < TAIL_REST_ANGLE, "목표 방향으로 움직이긴 한다");
  assert.ok(angle > target, "한 프레임에 목표까지 가지는 않는다");
});

test("빠르게 흔들 때 추종 속도를 같이 올려 진폭이 깎이지 않는다", () => {
  // 추종 속도가 9로 고정이면 각속도가 그보다 빠를 때 저역통과 필터처럼 진폭이 깎여
  // "빠르게 흔들수록 오히려 덜 휜다"는 문제가 있었다(각속도 비례로 올려 고친 부분).
  const amplitude = 0.3;
  const tail = createTailMotion();
  let peak = 0;
  for (let i = 0; i < 1200; i += 1) {
    const { angle } = tail.advance(1 / 240, inputs({
      answerMotion: { tailAmplitude: amplitude, tailSpeed: 9 }
    }));
    peak = Math.max(peak, Math.abs(angle - TAIL_REST_ANGLE));
  }
  assert.ok(peak > amplitude * 0.9, `목표 진폭의 90% 이상 따라가야 한다(실제 ${peak.toFixed(4)})`);
});

test("타이핑도 각속도에 비례해 추종 속도를 올린다", () => {
  // 강도 1이면 각속도 4.5, 목표 진폭 0.63이다. 비례 추종(22.5)이면 목표의 98%까지
  // 따라가지만 9로 고정하면 89%까지밖에 못 따라간다 — 그 사이를 임계로 잡는다.
  const amplitude = 0.2 + 0.43;
  const tail = createTailMotion();
  let peak = 0;
  for (let i = 0; i < 2400; i += 1) {
    const { angle } = tail.advance(1 / 240, inputs({ typingIntensity: 1 }));
    peak = Math.max(peak, Math.abs(angle - TAIL_REST_ANGLE));
  }
  assert.ok(peak > amplitude * 0.95, `목표 진폭의 95% 이상 따라가야 한다(실제 ${(peak / amplitude).toFixed(4)})`);
});

test("advance가 돌려주는 값은 내부 상태와 같다", () => {
  const tail = createTailMotion();
  const result = tail.advance(1 / 60, inputs({ typingIntensity: 0.7 }));
  assert.equal(result.angle, tail.getAngle());
  assert.equal(result.bend, tail.getBend());
});
