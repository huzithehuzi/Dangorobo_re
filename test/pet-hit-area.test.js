const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HEAD_REGION_RATIO,
  TRAY_ICON_HIT_MARGIN,
  MEDIA_PLAYER_HIT_MARGIN,
  isPointInRect,
  isPointOverPetVisual,
  isPointOverPetHeadVisual,
  isPointOverWindowRect,
  isPointOverTrayRect,
  isPointOverMediaPlayerRect
} = require("../src/main/windows/pet-hit-area.js");
const { DEFAULT_MODEL_TOP_LOCAL_Y, REST_WINDOW_EXTRA_TOP } = require("../src/main/windows/pet-window-layout.js");

// 기본 배율의 펫 창. 창 높이는 WINDOW_HEIGHT(420) + 투명 상단 여백(300)이다.
const PET_BOUNDS = { x: 1000, y: 500, width: 300, height: 720 };
const VISUAL_1X = { scale: 1, modelTopLocalY: DEFAULT_MODEL_TOP_LOCAL_Y };
// 펫은 항상 창 가로 중앙에 있다.
const PET_CENTER_X = PET_BOUNDS.width / 2;

// 분리 시점에 기존 수식으로 직접 계산해 박아 둔 경계값 — 수식이 바뀌면 여기가 깨진다.
// visualVerticalBounds(1, 2.05) = { top: 167.614..., bottom: 381.570... }
// 세로 여백 12, 가로 halfWidth = 122 * scale + 10.
const VISUAL_TOP_1X = 167.61428170791942;
const VISUAL_BOTTOM_1X = 381.57010087694766;
const HEAD_BOTTOM_1X = VISUAL_TOP_1X + (VISUAL_BOTTOM_1X - VISUAL_TOP_1X) * 0.45;

/**
 * 모델 기준 로컬 좌표를 실제 DIP 화면 좌표로 옮긴다.
 * @param {number} localX
 * @param {number} localY
 */
function petPoint(localX, localY) {
  return { x: PET_BOUNDS.x + localX, y: PET_BOUNDS.y + REST_WINDOW_EXTRA_TOP + localY };
}

test("머리 영역 비율과 히트 여백은 분리 전 값 그대로다", () => {
  assert.equal(HEAD_REGION_RATIO, 0.45);
  assert.equal(TRAY_ICON_HIT_MARGIN, 6);
  assert.equal(MEDIA_PLAYER_HIT_MARGIN, 6);
  assert.ok(Math.abs(HEAD_BOTTOM_1X - 263.8944) < 0.001);
});

test("펫 세로 판정은 시각 경계에 12px 여백을 준다", () => {
  assert.equal(isPointOverPetVisual(petPoint(PET_CENTER_X, 250), PET_BOUNDS, VISUAL_1X), true);
  // top - 12 = 155.614 — 155는 밖, 156은 안.
  assert.equal(isPointOverPetVisual(petPoint(PET_CENTER_X, 155), PET_BOUNDS, VISUAL_1X), false);
  assert.equal(isPointOverPetVisual(petPoint(PET_CENTER_X, 156), PET_BOUNDS, VISUAL_1X), true);
  // bottom + 12 = 393.570 — 393은 안, 394는 밖.
  assert.equal(isPointOverPetVisual(petPoint(PET_CENTER_X, 393), PET_BOUNDS, VISUAL_1X), true);
  assert.equal(isPointOverPetVisual(petPoint(PET_CENTER_X, 394), PET_BOUNDS, VISUAL_1X), false);
});

test("펫 가로 판정은 창 중앙 기준 halfWidth + 10px다", () => {
  // 창 중앙은 bounds.width / 2 = 150, 허용 반폭은 122 + 10 = 132.
  assert.equal(isPointOverPetVisual(petPoint(18, 250), PET_BOUNDS, VISUAL_1X), true);
  assert.equal(isPointOverPetVisual(petPoint(17, 250), PET_BOUNDS, VISUAL_1X), false);
  assert.equal(isPointOverPetVisual(petPoint(282, 250), PET_BOUNDS, VISUAL_1X), true);
  assert.equal(isPointOverPetVisual(petPoint(283, 250), PET_BOUNDS, VISUAL_1X), false);
});

test("가로 중심은 WINDOW_WIDTH가 아니라 실제 창 폭을 따라간다", () => {
  // 커스터마이징 모드에서 창이 넓어져도 펫은 창 가로 중앙에 있다.
  const wideBounds = { ...PET_BOUNDS, width: 500 };
  const localY = REST_WINDOW_EXTRA_TOP + 250;
  const at = (/** @type {number} */ localX) => ({ x: wideBounds.x + localX, y: wideBounds.y + localY });
  assert.equal(isPointOverPetVisual(at(250), wideBounds, VISUAL_1X), true);
  assert.equal(isPointOverPetVisual(at(118), wideBounds, VISUAL_1X), true);
  assert.equal(isPointOverPetVisual(at(117), wideBounds, VISUAL_1X), false);
  // 300px 창이었다면 안쪽이었을 좌표가 500px 창에서는 밖이다.
  assert.equal(isPointOverPetVisual(at(18), wideBounds, VISUAL_1X), false);
});

test("배율을 줄이면 히트 영역도 함께 줄어든다", () => {
  const half = { scale: 0.5, modelTopLocalY: DEFAULT_MODEL_TOP_LOCAL_Y };
  // visualVerticalBounds(0.5, 2.05) = { top: 233.078..., bottom: 340.056... }
  assert.equal(isPointOverPetVisual(petPoint(PET_CENTER_X, 250), PET_BOUNDS, half), true);
  // 1배에서는 안쪽이던 위/아래가 0.5배에서는 밖이다.
  assert.equal(isPointOverPetVisual(petPoint(PET_CENTER_X, 180), PET_BOUNDS, half), false);
  assert.equal(isPointOverPetVisual(petPoint(PET_CENTER_X, 370), PET_BOUNDS, half), false);
  // 허용 반폭은 61 + 10 = 71.
  assert.equal(isPointOverPetVisual(petPoint(79, 250), PET_BOUNDS, half), true);
  assert.equal(isPointOverPetVisual(petPoint(78, 250), PET_BOUNDS, half), false);
});

test("머리 판정은 시각 경계 위쪽 45%까지만이고 아래 여백을 주지 않는다", () => {
  // headBottom = 263.894 — 몸통 판정은 393까지 받지만 머리는 여기서 끊긴다.
  assert.equal(isPointOverPetHeadVisual(petPoint(PET_CENTER_X, 263), PET_BOUNDS, VISUAL_1X), true);
  assert.equal(isPointOverPetHeadVisual(petPoint(PET_CENTER_X, 264), PET_BOUNDS, VISUAL_1X), false);
  assert.equal(isPointOverPetVisual(petPoint(PET_CENTER_X, 264), PET_BOUNDS, VISUAL_1X), true);
  // 위쪽 여백 12px는 몸통과 똑같이 준다.
  assert.equal(isPointOverPetHeadVisual(petPoint(PET_CENTER_X, 156), PET_BOUNDS, VISUAL_1X), true);
  assert.equal(isPointOverPetHeadVisual(petPoint(PET_CENTER_X, 155), PET_BOUNDS, VISUAL_1X), false);
  // 가로 규칙은 몸통과 같다.
  assert.equal(isPointOverPetHeadVisual(petPoint(17, 200), PET_BOUNDS, VISUAL_1X), false);
});

test("사각형 판정은 경계를 포함한다", () => {
  const rect = { x: 100, y: 200, width: 300, height: 150 };
  assert.equal(isPointInRect({ x: 100, y: 200 }, rect), true);
  assert.equal(isPointInRect({ x: 400, y: 350 }, rect), true);
  assert.equal(isPointInRect({ x: 99, y: 200 }, rect), false);
  assert.equal(isPointInRect({ x: 401, y: 350 }, rect), false);
  assert.equal(isPointInRect({ x: 100, y: 351 }, rect), false);
  assert.equal(isPointOverWindowRect({ x: 250, y: 275 }, rect), true);
  assert.equal(isPointOverWindowRect({ x: 99, y: 275 }, rect), false);
});

test("트레이 아이콘은 바로 옆 6px까지 겹침으로 본다", () => {
  const trayBounds = { x: 1800, y: 1040, width: 24, height: 24 };
  assert.equal(isPointOverTrayRect({ x: 1794, y: 1034 }, trayBounds), true);
  assert.equal(isPointOverTrayRect({ x: 1793, y: 1034 }, trayBounds), false);
  assert.equal(isPointOverTrayRect({ x: 1830, y: 1070 }, trayBounds), true);
  assert.equal(isPointOverTrayRect({ x: 1831, y: 1070 }, trayBounds), false);
});

test("미디어 플레이어는 투명 여백을 뺀 모델 기준이 아니라 창 상단 기준이다", () => {
  const rect = { left: 10, top: 20, width: 100, height: 40 };
  // 창 상단(bounds.y) 기준이므로 REST_WINDOW_EXTRA_TOP을 더하지 않는다.
  const at = (/** @type {number} */ localX, /** @type {number} */ localY) =>
    ({ x: PET_BOUNDS.x + localX, y: PET_BOUNDS.y + localY });
  assert.equal(isPointOverMediaPlayerRect(at(60, 40), PET_BOUNDS, rect), true);
  // 6px 여백.
  assert.equal(isPointOverMediaPlayerRect(at(4, 14), PET_BOUNDS, rect), true);
  assert.equal(isPointOverMediaPlayerRect(at(3, 14), PET_BOUNDS, rect), false);
  assert.equal(isPointOverMediaPlayerRect(at(116, 66), PET_BOUNDS, rect), true);
  assert.equal(isPointOverMediaPlayerRect(at(117, 66), PET_BOUNDS, rect), false);
  // 같은 좌표를 모델 기준으로 읽었다면 한참 아래였다 — 두 기준이 다름을 못박는다.
  assert.equal(isPointOverMediaPlayerRect(petPoint(60, 40), PET_BOUNDS, rect), false);
});
