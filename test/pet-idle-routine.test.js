const test = require("node:test");
const assert = require("node:assert/strict");

const {
  IDLE_ROUTINES,
  IDLE_ROUTINE_REPEAT_WEIGHT_FACTOR,
  IDLE_ROUTINE_INTERRUPT_FADE_SECONDS,
  IDLE_ROUTINE_FIRST_GAP_MIN_MS,
  IDLE_ROUTINE_FIRST_GAP_SPREAD_MS,
  createIdleRoutineScheduler
} = require("../src/pet/idle-routine.js");

const MIN_GAP_MS = 10000;
const MAX_GAP_MS = 20000;
/** 검증용 표 — 가중치 규칙만 보려고 종류를 둘로 줄인다. */
const PAIR = [
  { kind: "a", duration: 1000 },
  { kind: "b", duration: 1000 }
];

/**
 * @param {{rolls?: number[], routines?: {kind: string, duration: number, weight?: number}[]}} [options]
 */
function createHarness({ rolls = [], routines } = {}) {
  let index = 0;
  const scheduler = createIdleRoutineScheduler({
    getGapRange: () => ({ minGapMs: MIN_GAP_MS, maxGapMs: MAX_GAP_MS }),
    // 지정한 값을 순서대로 쓰고 다 쓰면 0을 돌려준다(= 항상 가장 이른 시각/첫 항목).
    random: () => (index < rolls.length ? rolls[index++] : 0),
    routines
  });
  return { scheduler, usedRolls: () => index };
}

test("상수는 분리 전 값 그대로다", () => {
  assert.equal(IDLE_ROUTINE_REPEAT_WEIGHT_FACTOR, 0.25);
  assert.equal(IDLE_ROUTINE_INTERRUPT_FADE_SECONDS, 0.18);
  assert.equal(IDLE_ROUTINE_FIRST_GAP_MIN_MS, 10000);
  assert.equal(IDLE_ROUTINE_FIRST_GAP_SPREAD_MS, 12000);
  assert.deepEqual(
    IDLE_ROUTINES.map((routine) => routine.kind),
    ["lookAround", "stretch", "perkup", "wave", "doze", "sniffAround", "pawLick", "shakeOff"]
  );
  // doze만 뽑힐 확률을 낮춰 뒀다.
  assert.deepEqual(
    IDLE_ROUTINES.filter((routine) => routine.weight !== undefined),
    [{ kind: "doze", duration: 2600, weight: 0.5 }]
  );
});

// 창을 띄우자마자 펫이 움직이면 방금 한 조작에 대한 반응으로 오해한다.
test("첫 행동은 설정 간격이 아니라 10~22초 뒤에 나온다", () => {
  const early = createHarness({ rolls: [0] });
  early.scheduler.scheduleFirst(0);
  assert.equal(early.scheduler.update(9999, true), null, "10초 전에는 안 나온다");
  assert.ok(early.scheduler.update(10000, true), "10초에 나온다");

  const late = createHarness({ rolls: [1] });
  late.scheduler.scheduleFirst(0);
  assert.equal(late.scheduler.update(21999, true), null, "22초 전에는 안 나온다");
  assert.ok(late.scheduler.update(22000, true), "22초에 나온다");
});

test("행동이 끝나면 설정 간격으로 다시 예약한다", () => {
  const { scheduler } = createHarness({ rolls: [0, 0, 1], routines: PAIR });
  scheduler.scheduleFirst(0);
  assert.ok(scheduler.update(10000, true), "첫 행동 시작");
  // duration(1000ms)을 채우면 끝나고 다음 예약(roll 1 → 최대 간격)이 잡힌다.
  assert.equal(scheduler.update(11000, true), null, "끝나는 프레임은 동작을 주지 않는다");
  assert.equal(scheduler.update(11000 + MAX_GAP_MS - 1, true), null, "예약 전에는 안 나온다");
  assert.ok(scheduler.update(11000 + MAX_GAP_MS, true), "예약 시각에 다음 행동이 나온다");
});

test("진행 중에는 종류와 진행도, 세기를 함께 준다", () => {
  const { scheduler } = createHarness({ rolls: [0, 0], routines: PAIR });
  scheduler.scheduleFirst(0);
  scheduler.update(10000, true);

  const half = scheduler.update(10500, true);
  assert.equal(half?.kind, "a");
  assert.equal(half?.progress, 0.5);
  // 세기는 진행도 사인 곡선을 따라 중앙에서 최대다.
  assert.ok(Math.abs((half?.amount ?? 0) - 1) < 1e-9);

  const quarter = scheduler.update(10250, true);
  assert.ok((quarter?.amount ?? 0) < 1, "중앙보다 약하다");
});

test("직전에 나온 종류는 가중치를 깎아 연속 등장 확률을 낮춘다", () => {
  // 두 종류가 같은 가중치면 뽑기 값 0.3은 원래 첫 항목("a")을 고른다. 직전이 "a"라
  // 가중치가 0.25로 깎이면 같은 값이 "b"로 넘어간다.
  const damped = createHarness({ rolls: [0, 0, 0, 0.3], routines: PAIR });
  damped.scheduler.scheduleFirst(0);
  assert.equal(damped.scheduler.update(10000, true)?.kind, "a");
  damped.scheduler.update(11000, true);
  assert.equal(damped.scheduler.update(11000 + MIN_GAP_MS, true)?.kind, "b");

  // 깎인 뒤에도 충분히 작은 값이면 같은 종류가 다시 나올 수 있다(배제가 아니라 약화다).
  const repeated = createHarness({ rolls: [0, 0, 0, 0.1], routines: PAIR });
  repeated.scheduler.scheduleFirst(0);
  assert.equal(repeated.scheduler.update(10000, true)?.kind, "a");
  repeated.scheduler.update(11000, true);
  assert.equal(repeated.scheduler.update(11000 + MIN_GAP_MS, true)?.kind, "a");
});

test("방해받으면 즉시 끊지 않고 0.18초에 걸쳐 감쇠시킨다", () => {
  const { scheduler } = createHarness({ rolls: [0, 0], routines: PAIR });
  scheduler.scheduleFirst(0);
  scheduler.update(10000, true);
  const full = scheduler.update(10500, true);

  const fading = scheduler.update(10500, false, IDLE_ROUTINE_INTERRUPT_FADE_SECONDS / 2);
  assert.equal(fading?.kind, "a", "감쇠 중에도 같은 행동을 계속 보여준다");
  assert.ok(Math.abs((fading?.amount ?? 0) - (full?.amount ?? 0) / 2) < 1e-9, "세기가 절반이 된다");

  assert.equal(
    scheduler.update(10500, false, IDLE_ROUTINE_INTERRUPT_FADE_SECONDS / 2),
    null,
    "감쇠가 끝나면 버린다"
  );
});

test("감쇠 도중에 방해가 끝나면 같은 속도로 되돌아온다", () => {
  const { scheduler } = createHarness({ rolls: [0, 0], routines: PAIR });
  scheduler.scheduleFirst(0);
  scheduler.update(10000, true);
  const full = scheduler.update(10500, true);
  scheduler.update(10500, false, IDLE_ROUTINE_INTERRUPT_FADE_SECONDS / 2);

  const restored = scheduler.update(10500, true, IDLE_ROUTINE_INTERRUPT_FADE_SECONDS / 2);
  assert.ok(Math.abs((restored?.amount ?? 0) - (full?.amount ?? 0)) < 1e-9, "세기가 원래대로 돌아온다");
});

// requestAnimationFrame이 멈췄다 다시 돌면(절전·디스플레이 꺼짐) now가 훌쩍 뛴다.
// 그대로 두면 깨어난 첫 프레임에 행동이 바로 튀어나온다(2026-08-07 리포트).
test("예약 시각을 최대 간격 넘게 지나쳤으면 발동하지 않고 다시 예약만 한다", () => {
  const { scheduler } = createHarness({ rolls: [0, 0], routines: PAIR });
  scheduler.scheduleFirst(0);
  const wakeUp = 10000 + MAX_GAP_MS;
  assert.equal(scheduler.update(wakeUp, true), null, "깨어난 첫 프레임에는 안 나온다");
  assert.equal(scheduler.update(wakeUp + MIN_GAP_MS - 1, true), null, "다시 잡은 예약 전에도 안 나온다");
  assert.ok(scheduler.update(wakeUp + MIN_GAP_MS, true), "다시 잡은 예약 시각에 나온다");
});

// 행동을 뽑을 때는 다음 예약 시각을 미루지 않는다. 그래서 렌더러의 applyPetSettings는
// cancel()과 schedule()을 반드시 함께 부른다 — 하나만 부르면 설정을 저장할 때마다
// 곧바로 새 행동이 튀어나온다.
test("cancel()만 하면 다음 프레임에 바로 새 행동이 나오고, schedule()을 함께 불러야 미뤄진다", () => {
  const cancelOnly = createHarness({ rolls: [0, 0, 0], routines: PAIR });
  cancelOnly.scheduler.scheduleFirst(0);
  cancelOnly.scheduler.update(10000, true);
  cancelOnly.scheduler.cancel();
  assert.ok(cancelOnly.scheduler.update(10001, true), "예약이 그대로라 즉시 다시 뽑힌다");

  const paired = createHarness({ rolls: [0, 0, 0], routines: PAIR });
  paired.scheduler.scheduleFirst(0);
  paired.scheduler.update(10000, true);
  paired.scheduler.cancel();
  paired.scheduler.schedule(10001);
  assert.equal(paired.scheduler.update(10002, true), null, "다시 예약하면 미뤄진다");
  assert.ok(paired.scheduler.update(10001 + MIN_GAP_MS, true), "새 예약 시각에 나온다");
});

test("설정 간격이 뒤집혀 들어와도 음수 간격을 만들지 않는다", () => {
  const scheduler = createIdleRoutineScheduler({
    getGapRange: () => ({ minGapMs: 30000, maxGapMs: 5000 }),
    random: () => 0,
    routines: PAIR
  });
  scheduler.schedule(0);
  assert.equal(scheduler.update(4999, true), null, "작은 쪽보다 이르게 나오지 않는다");
  assert.ok(scheduler.update(5000, true), "작은 쪽을 최소 간격으로 쓴다");
});
