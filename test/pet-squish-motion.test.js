// @ts-check
// 스퀴시·출렁임 재생 상태. 발동(키·마우스·드래그)과 소비(몸통 변형)가 갈라져 있어서
// 캡처로는 "언제 시작해서 언제 끝나는지"를 볼 수 없다 — 시간축 성질을 여기서 고정한다.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSquishMotion,
  SQUISH_DURATION,
  WOBBLE_DURATION,
  DRAG_SQUISH_INTERVAL
} = require("../src/pet/squish-motion.js");

const STRENGTH = 9;

/**
 * 주어진 시간만큼 진행하며 스퀴시·출렁임의 최대 절댓값을 모은다.
 * @param {ReturnType<typeof createSquishMotion>} motion
 * @param {number} seconds
 * @param {number} [step]
 */
function run(motion, seconds, step = 1 / 240) {
  let squishPeak = 0;
  let wobblePeak = 0;
  for (let i = 0; i < Math.round(seconds / step); i += 1) {
    const { squishAmount, wobbleAmount } = motion.advance(step, STRENGTH);
    squishPeak = Math.max(squishPeak, Math.abs(squishAmount));
    wobblePeak = Math.max(wobblePeak, Math.abs(wobbleAmount));
  }
  return { squishPeak, wobblePeak };
}

test("시작 상태는 이미 다 재생된 상태라 아무 변형도 주지 않는다", () => {
  const motion = createSquishMotion();
  assert.equal(motion.getSquishElapsed(), SQUISH_DURATION);
  assert.equal(motion.getWobbleElapsed(), WOBBLE_DURATION);

  const { squishPeak, wobblePeak } = run(motion, 1);
  assert.equal(squishPeak, 0, "창을 켜자마자 스퀴시가 돌지 않는다");
  assert.equal(wobblePeak, 0);
});

test("trigger는 스퀴시와 출렁임을 처음부터 다시 재생한다", () => {
  const motion = createSquishMotion();
  motion.trigger();
  assert.equal(motion.getSquishElapsed(), 0);
  assert.equal(motion.getWobbleElapsed(), 0);

  const { squishPeak, wobblePeak } = run(motion, WOBBLE_DURATION);
  assert.ok(squishPeak > 0, "스퀴시가 실제로 나온다");
  assert.ok(wobblePeak > 0, "출렁임도 따라 나온다");
});

test("스퀴시는 지속 시간에서 정확히 멈추고 넘어가지 않는다", () => {
  const motion = createSquishMotion();
  motion.trigger();
  // 지속 시간을 넘겨 진행해도 진행값은 정확히 지속 시간에서 잘린다.
  run(motion, SQUISH_DURATION * 1.5);
  assert.equal(motion.getSquishElapsed(), SQUISH_DURATION);

  // 그 뒤로는 스퀴시 성분이 0이다(출렁임은 아직 남아 있을 수 있다).
  const after = motion.advance(1 / 240, STRENGTH);
  assert.equal(after.squishAmount, 0);
});

test("출렁임은 페이드 봉투로 끝에서 0까지 눌린다(툭 끊기지 않는다)", () => {
  // 지수 감쇠만으로는 마지막 10% 구간에서도 최대 2.0e-3까지 남아 실루엣이 지글거린다.
  // 봉투를 씌우면 같은 구간 최대가 2.5e-4로 떨어진다 — 그 사이를 임계로 잡는다.
  const motion = createSquishMotion();
  motion.trigger();
  const step = 1 / 2000;
  let tailPeak = 0;
  for (let i = 0; i < Math.round(WOBBLE_DURATION / step); i += 1) {
    const { wobbleAmount } = motion.advance(step, STRENGTH);
    if (motion.getWobbleElapsed() / WOBBLE_DURATION > 0.9) {
      tailPeak = Math.max(tailPeak, Math.abs(wobbleAmount));
    }
  }
  assert.ok(tailPeak < 1e-3, `마지막 10% 구간이 충분히 눌린다(실제 ${tailPeak.toExponential(2)})`);

  run(motion, 1);
  assert.equal(motion.getWobbleElapsed(), WOBBLE_DURATION);
  assert.equal(motion.advance(1 / 240, STRENGTH).wobbleAmount, 0);
});

test("출렁임은 부호가 바뀌며 감쇠한다", () => {
  const motion = createSquishMotion();
  motion.trigger();
  /** @type {number[]} */
  const samples = [];
  for (let i = 0; i < Math.round(WOBBLE_DURATION * 240); i += 1) {
    samples.push(motion.advance(1 / 240, STRENGTH).wobbleAmount);
  }
  assert.ok(samples.some((value) => value > 0), "양의 마루가 있다");
  assert.ok(samples.some((value) => value < 0), "음의 골도 있다 — 감쇠 진동이다");

  const firstHalfPeak = Math.max(...samples.slice(0, samples.length / 2).map(Math.abs));
  const secondHalfPeak = Math.max(...samples.slice(samples.length / 2).map(Math.abs));
  assert.ok(secondHalfPeak < firstHalfPeak, "뒤로 갈수록 잦아든다");
});

test("세기 설정은 스퀴시·출렁임 진폭에 비례한다", () => {
  const weak = createSquishMotion();
  const strong = createSquishMotion();
  weak.trigger();
  strong.trigger();

  let weakWobble = 0;
  let strongWobble = 0;
  let weakSquish = 0;
  let strongSquish = 0;
  for (let i = 0; i < Math.round(WOBBLE_DURATION * 240); i += 1) {
    const w = weak.advance(1 / 240, 5);
    const t = strong.advance(1 / 240, 20);
    weakWobble = Math.max(weakWobble, Math.abs(w.wobbleAmount));
    strongWobble = Math.max(strongWobble, Math.abs(t.wobbleAmount));
    weakSquish = Math.max(weakSquish, Math.abs(w.squishAmount));
    strongSquish = Math.max(strongSquish, Math.abs(t.squishAmount));
  }
  assert.ok(weakSquish > 0 && weakWobble > 0);
  assert.ok(Math.abs(strongWobble / weakWobble - 4) < 1e-9, "출렁임: 20%는 5%의 정확히 4배다");
  assert.ok(Math.abs(strongSquish / weakSquish - 4) < 1e-9, "스퀴시: 20%는 5%의 정확히 4배다");
});

test("stop은 재생을 끝난 상태로 만든다", () => {
  const motion = createSquishMotion();
  motion.trigger();
  motion.advance(0.02, STRENGTH);
  motion.stop();

  assert.equal(motion.getSquishElapsed(), SQUISH_DURATION);
  assert.equal(motion.getWobbleElapsed(), WOBBLE_DURATION);
  const { squishPeak, wobblePeak } = run(motion, 1);
  assert.equal(squishPeak, 0);
  assert.equal(wobblePeak, 0);
});

test("연속 입력은 대기열을 만들지 않고 마지막 입력에서 다시 시작한다", () => {
  const motion = createSquishMotion();
  motion.trigger();
  motion.advance(SQUISH_DURATION * 0.9, STRENGTH);
  motion.trigger();

  assert.equal(motion.getSquishElapsed(), 0, "누적되지 않고 처음으로 되돌아간다");
  // 다시 처음부터 SQUISH_DURATION 동안만 재생된다.
  run(motion, SQUISH_DURATION);
  assert.equal(motion.advance(1 / 240, STRENGTH).squishAmount, 0);
});

test("드래그 중에는 일정 간격으로 스퀴시를 다시 트리거한다", () => {
  const motion = createSquishMotion();
  // 첫 프레임에 타이머가 0이라 곧바로 한 번 트리거된다.
  motion.advanceDragPulse(1 / 240, true);
  assert.equal(motion.getSquishElapsed(), 0);
  assert.ok(Math.abs(motion.getDragTimer() - DRAG_SQUISH_INTERVAL) < 1e-12);

  // 간격이 지나기 전에는 다시 트리거하지 않는다.
  motion.advance(SQUISH_DURATION, STRENGTH);
  motion.advanceDragPulse(DRAG_SQUISH_INTERVAL * 0.5, true);
  assert.equal(motion.getSquishElapsed(), SQUISH_DURATION, "아직 재트리거 없음");

  // 간격을 넘기면 다시 재생된다.
  motion.advanceDragPulse(DRAG_SQUISH_INTERVAL * 0.6, true);
  assert.equal(motion.getSquishElapsed(), 0);
});

test("드래그가 끝나면 간격 타이머를 0으로 되돌려 다음 드래그가 즉시 반응한다", () => {
  const motion = createSquishMotion();
  motion.advanceDragPulse(1 / 240, true);
  assert.ok(motion.getDragTimer() > 0);

  motion.advanceDragPulse(1 / 240, false);
  assert.equal(motion.getDragTimer(), 0);

  motion.stop();
  motion.advanceDragPulse(1 / 240, true);
  assert.equal(motion.getSquishElapsed(), 0, "다음 드래그는 기다리지 않고 바로 반응한다");
});

test("드래그하지 않으면 아무것도 트리거하지 않는다", () => {
  const motion = createSquishMotion();
  for (let i = 0; i < 240; i += 1) motion.advanceDragPulse(1 / 60, false);
  assert.equal(motion.getSquishElapsed(), SQUISH_DURATION);
  assert.equal(motion.getWobbleElapsed(), WOBBLE_DURATION);
});

test("같은 시간을 잘게 나눠 진행해도 진행도가 같다(프레임률 독립)", () => {
  const coarse = createSquishMotion();
  const fine = createSquishMotion();
  coarse.trigger();
  fine.trigger();

  // 지속 시간의 절반까지 — 잘리기 전 구간이라야 누적 방식의 차이가 드러난다.
  const half = SQUISH_DURATION / 2;
  coarse.advance(half, STRENGTH);
  for (let i = 0; i < 128; i += 1) fine.advance(half / 128, STRENGTH);

  assert.ok(
    Math.abs(coarse.getSquishElapsed() - fine.getSquishElapsed()) < 1e-12,
    "60Hz든 240Hz든 같은 시간이 지나면 같은 지점이다"
  );
});
