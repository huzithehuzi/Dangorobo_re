// 펫 창(300px 논리 창)의 화면 배치 수학. screen 조회는 main.js가 하고, 여기는 workArea를
// 인자로 받는 순수 계산만 둔다(favorites-layout.ts와 같은 분담). "논리 위치"는 항상 300px
// 창 기준 좌상단 좌표이고 y는 REST_WINDOW_EXTRA_TOP을 포함한다 — 규칙 전체는 main.js의
// CUSTOMIZE_WINDOW_WIDTH 주석 참고.

const WINDOW_WIDTH = 300;
const WINDOW_HEIGHT = 420;
const REST_WINDOW_EXTRA_TOP = 300;
const SCREEN_MARGIN = 10;

// renderer.ts의 모델/카메라 상수를 그대로 복제해 머리 위/발밑의 실제 화면 픽셀 위치를 계산한다.
// (renderer.ts: BASE_PET_SCALE, BASE_PET_Y, PET_BOTTOM_ANCHOR_Y, camera fov/거리)
// 머리 꼭대기(modelTopLocalY)는 GLB 모델 로드 후 실제 바운딩 박스로 계산되므로 고정값이 아니라
// renderer가 pet:report-visual-top으로 보내주는 값을 그대로 쓴다. (GLB 교체 전 절차적 모델 기준값 2.05를 기본값으로 둔다)
// renderer.ts와 동일하게 화면 잘림 방지를 위해 0.82배 축소 보정(2026-08-01) — 값을 바꾸면
// renderer.ts의 BASE_PET_SCALE/BASE_PET_Y와 반드시 같이 맞출 것.
const MODEL_BASE_SCALE = 0.5904; // 0.72 * 0.82
const MODEL_BASE_Y = -0.8185; // -0.65 + 0.72*(1-0.82)*(-1.3)
const MODEL_BOTTOM_LOCAL_Y = -1.3;
const CAMERA_FOV_DEG = 31;
const CAMERA_DISTANCE = 7;
const DEFAULT_MODEL_TOP_LOCAL_Y = 2.05;

type Point = { x: number; y: number };
type WorkArea = { x: number; y: number; width: number; height: number };

function visualHorizontalHalfWidth(scale: number) {
  return 122 * scale;
}

function worldYToLocalPixelY(worldY: number) {
  const halfFovRad = (CAMERA_FOV_DEG / 2) * (Math.PI / 180);
  const ndcY = worldY / (CAMERA_DISTANCE * Math.tan(halfFovRad));
  return (1 - ndcY) * (WINDOW_HEIGHT / 2);
}

function visualVerticalBounds(scale: number, modelTopLocalY: number) {
  const modelScale = MODEL_BASE_SCALE * scale;
  return {
    top: worldYToLocalPixelY(MODEL_BASE_Y + modelScale * modelTopLocalY),
    bottom: worldYToLocalPixelY(MODEL_BASE_Y + modelScale * MODEL_BOTTOM_LOCAL_Y)
  };
}

// 논리 위치가 어느 모니터에 속하는지 판정할 때 쓰는 창 중심점.
function petWindowProbePoint(position: Point | null | undefined) {
  return {
    x: Math.round(Number(position?.x) || 0) + Math.round(WINDOW_WIDTH / 2),
    y: Math.round(Number(position?.y) || 0) + Math.round(WINDOW_HEIGHT / 2)
  };
}

/**
 * 창 박스가 아니라 실제 모델 시각 경계가 화면 가장자리에 닿도록 보정한다.
 */
function clampPetPositionToWorkArea(
  position: Point | null | undefined,
  workArea: WorkArea,
  visual: { scale: number; modelTopLocalY: number }
) {
  const horizontalInset = Math.max(0, WINDOW_WIDTH / 2 - visualHorizontalHalfWidth(visual.scale));
  const minX = workArea.x - horizontalInset;
  const maxX = Math.max(minX, workArea.x + workArea.width - WINDOW_WIDTH + horizontalInset);
  const { top: visualTop, bottom: visualBottom } = visualVerticalBounds(visual.scale, visual.modelTopLocalY);
  const topInset = Math.max(0, visualTop);
  const bottomInset = Math.max(0, WINDOW_HEIGHT - visualBottom);
  const minY = workArea.y - topInset;
  const maxY = Math.max(minY, workArea.y + workArea.height - WINDOW_HEIGHT + bottomInset);
  return {
    x: Math.min(maxX, Math.max(minX, Math.round(Number(position?.x) || minX))),
    y: Math.min(maxY, Math.max(minY, Math.round(Number(position?.y) || minY)))
  };
}

/**
 * 커스터마이징 모드용 추가 보정 — 넓어진 창(± inset)까지 workArea 안에 들어오게 한다.
 * base는 이미 clampPetPositionToWorkArea를 거친 논리 위치이고 inset은 petWindowXInset()이다.
 */
function clampCustomizePositionToWorkArea(base: Point, workArea: WorkArea, inset: number) {
  const minX = workArea.x + inset;
  const maxX = Math.max(minX, workArea.x + workArea.width - WINDOW_WIDTH - inset);
  // 논리 y는 창 상단 + REST_WINDOW_EXTRA_TOP이므로, 창 상단 = y - REST_WINDOW_EXTRA_TOP,
  // 창 하단 = y - REST_WINDOW_EXTRA_TOP + (WINDOW_HEIGHT + REST_WINDOW_EXTRA_TOP) = y + WINDOW_HEIGHT.
  const minY = workArea.y + REST_WINDOW_EXTRA_TOP;
  const maxY = Math.max(minY, workArea.y + workArea.height - WINDOW_HEIGHT);
  return {
    x: Math.min(maxX, Math.max(minX, base.x)),
    y: Math.min(maxY, Math.max(minY, base.y))
  };
}

function defaultPetPosition(workArea: WorkArea) {
  return {
    x: workArea.x + workArea.width - WINDOW_WIDTH - SCREEN_MARGIN,
    y: workArea.y + workArea.height - WINDOW_HEIGHT - SCREEN_MARGIN
  };
}

export {
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
};
export type { Point, WorkArea };
