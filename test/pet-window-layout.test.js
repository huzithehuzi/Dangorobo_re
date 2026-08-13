const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
  REST_WINDOW_EXTRA_TOP,
  SCREEN_MARGIN,
  DEFAULT_MODEL_TOP_LOCAL_Y,
  visualHorizontalHalfWidth,
  visualVerticalBounds,
  petWindowProbePoint,
  clampPetPositionToWorkArea,
  clampCustomizePositionToWorkArea,
  defaultPetPosition
} = require("../src/main/windows/pet-window-layout.js");

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };
const VISUAL_1X = { scale: 1, modelTopLocalY: DEFAULT_MODEL_TOP_LOCAL_Y };

/**
 * @param {number} actual
 * @param {number} expected
 */
function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.001, `${actual} ≠ ${expected}`);
}

test("창 상수는 분리 전 값 그대로다", () => {
  assert.equal(WINDOW_WIDTH, 300);
  assert.equal(WINDOW_HEIGHT, 420);
  assert.equal(REST_WINDOW_EXTRA_TOP, 300);
  assert.equal(SCREEN_MARGIN, 10);
  assert.equal(DEFAULT_MODEL_TOP_LOCAL_Y, 2.05);
});

test("시각 경계는 renderer 상수에서 유도한 기준값과 일치한다", () => {
  // 분리 시점에 기존 수식으로 직접 계산해 박아 둔 값 — 수식이 바뀌면 여기가 깨진다.
  const bounds1x = visualVerticalBounds(1, 2.05);
  assertClose(bounds1x.top, 167.61428170791942);
  assertClose(bounds1x.bottom, 381.57010087694766);
  const boundsHalf = visualVerticalBounds(0.5, 2.05);
  assertClose(boundsHalf.top, 233.07837563277133);
  assertClose(boundsHalf.bottom, 340.0562852172855);
  assert.equal(visualHorizontalHalfWidth(1), 122);
  assert.equal(visualHorizontalHalfWidth(0.5), 61);
});

test("probe는 논리 위치의 창 중심점이고 좌표를 반올림한다", () => {
  assert.deepEqual(petWindowProbePoint({ x: 10.6, y: -3.4 }), { x: 161, y: 207 });
  // 좌표가 없거나 NaN이면 0으로 본다
  assert.deepEqual(petWindowProbePoint(null), { x: 150, y: 210 });
  assert.deepEqual(petWindowProbePoint({ x: Number.NaN, y: 5 }), { x: 150, y: 215 });
});

test("화면 안쪽 위치는 반올림만 하고 그대로 둔다", () => {
  assert.deepEqual(
    clampPetPositionToWorkArea({ x: 500.4, y: 300.6 }, WORK_AREA, VISUAL_1X),
    { x: 500, y: 301 }
  );
});

test("좌우는 시각 반폭만큼 화면 밖으로 나갈 수 있다", () => {
  // scale 1: halfWidth 122 → inset 28
  const clamped = clampPetPositionToWorkArea({ x: -999, y: 100 }, WORK_AREA, VISUAL_1X);
  assert.deepEqual(clamped, { x: -28, y: 100 });
  const right = clampPetPositionToWorkArea({ x: 99999, y: 100 }, WORK_AREA, VISUAL_1X);
  assert.deepEqual(right, { x: 1920 - 300 + 28, y: 100 });
  // 시각 반폭이 창 반폭(150) 이상이면 inset 0
  const big = clampPetPositionToWorkArea({ x: -999, y: 100 }, WORK_AREA, { scale: 1.5, modelTopLocalY: 2.05 });
  assert.deepEqual(big, { x: 0, y: 100 });
});

test("상하는 머리 위·발밑 여백만큼 화면 밖으로 나갈 수 있다", () => {
  const top = clampPetPositionToWorkArea({ x: 100, y: -99999 }, WORK_AREA, VISUAL_1X);
  assertClose(top.y, -167.61428170791942);
  const bottom = clampPetPositionToWorkArea({ x: 100, y: 99999 }, WORK_AREA, VISUAL_1X);
  assertClose(bottom.y, 1080 - 420 + (420 - 381.57010087694766));
});

test("좌표 0은 최소 경계로 떨어진다 — 분리 전과 같은 falsy 처리", () => {
  const clamped = clampPetPositionToWorkArea({ x: 0, y: 0 }, WORK_AREA, VISUAL_1X);
  assert.equal(clamped.x, -28);
  assertClose(clamped.y, -167.61428170791942);
});

test("음수 원점 모니터에서도 workArea 기준으로 보정한다", () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1080 };
  const clamped = clampPetPositionToWorkArea({ x: -5000, y: 400 }, area, VISUAL_1X);
  assert.deepEqual(clamped, { x: -1920 - 28, y: 400 });
  // 이 모니터의 y 하한: -200 + 1080 - 420 + 발밑 여백
  const low = clampPetPositionToWorkArea({ x: -100, y: 9999 }, area, VISUAL_1X);
  assertClose(low.y, -200 + 1080 - 420 + (420 - 381.57010087694766));
});

test("커스터마이즈 보정은 넓어진 창을 workArea 안에 가둔다", () => {
  const inset = 190; // (680 - 300) / 2
  assert.deepEqual(
    clampCustomizePositionToWorkArea({ x: -28, y: 400 }, WORK_AREA, inset),
    { x: 190, y: 400 }
  );
  assert.deepEqual(
    clampCustomizePositionToWorkArea({ x: 1648, y: 400 }, WORK_AREA, inset),
    { x: 1920 - 300 - 190, y: 400 }
  );
  // 논리 y의 하한은 REST_WINDOW_EXTRA_TOP(창 상단이 workArea 위로 나가지 않게)
  assert.deepEqual(
    clampCustomizePositionToWorkArea({ x: 500, y: -100 }, WORK_AREA, inset),
    { x: 500, y: 300 }
  );
  assert.deepEqual(
    clampCustomizePositionToWorkArea({ x: 500, y: 9999 }, WORK_AREA, inset),
    { x: 500, y: 1080 - 420 }
  );
});

test("기본 위치는 우하단에서 여백 10px", () => {
  assert.deepEqual(defaultPetPosition(WORK_AREA), {
    x: 1920 - 300 - 10,
    y: 1080 - 420 - 10
  });
  assert.deepEqual(defaultPetPosition({ x: 100, y: 50, width: 800, height: 600 }), {
    x: 100 + 800 - 310,
    y: 50 + 600 - 430
  });
});
