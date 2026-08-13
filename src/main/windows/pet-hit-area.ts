// 커서가 무엇 위에 있는지 판정하는 순수 기하(hit test). 파일 이름을 `-test`로 끝내지 않는
// 이유는 `node --test`의 기본 탐색 패턴(**/*-test.js)에 emit 산출물이 걸려 모듈 자체를
// 테스트 파일로 실행해버리기 때문이다.
// Electron 조회(창 존재·표시 여부·getBounds·
// screenToDipPoint)는 main.ts가 하고 여기는 좌표 계산만 한다 — pet-window-layout.ts와 같은
// 분담이다. **넘어오는 point는 이미 DIP 좌표여야 한다**(uIOhook 원좌표라면 main.ts가
// screenToDipPoint()를 거친 뒤 넘긴다, AGENTS.md 좌표 규칙 참고).

import {
  REST_WINDOW_EXTRA_TOP,
  visualHorizontalHalfWidth,
  visualVerticalBounds
} from "./pet-window-layout.js";
import type { Point } from "./pet-window-layout.js";

type Rect = { x: number; y: number; width: number; height: number };
// 펫 창 안쪽(로컬 픽셀) 기준 사각형 — 렌더러가 pet:report-media-rect로 보고하는 영역이다.
type LocalRect = { left: number; top: number; width: number; height: number };
type PetVisual = { scale: number; modelTopLocalY: number };

// 모델의 실제 시각 경계에 주는 여백. 경계에 딱 붙은 픽셀에서 판정이 튀지 않게 한다.
const PET_HIT_HORIZONTAL_MARGIN = 10;
const PET_HIT_VERTICAL_MARGIN = 12;
// 펫의 실제 시각 경계 중 위쪽 이만큼만 "머리"로 본다(쓰다듬기 판정).
const HEAD_REGION_RATIO = 0.45;
// 아이콘 바로 옆도 겹침으로 보기 위한 여백.
const TRAY_ICON_HIT_MARGIN = 6;
const MEDIA_PLAYER_HIT_MARGIN = 6;

function isPointInRect(point: Point, rect: Rect, margin = 0): boolean {
  return point.x >= rect.x - margin && point.x <= rect.x + rect.width + margin &&
    point.y >= rect.y - margin && point.y <= rect.y + rect.height + margin;
}

// 펫 창은 위쪽에 REST_WINDOW_EXTRA_TOP만큼 투명 여백을 두므로, 모델 기준 로컬 y는
// 창 상단이 아니라 그 여백을 뺀 지점에서 시작한다.
function petLocalPoint(point: Point, bounds: Rect) {
  return {
    x: point.x - bounds.x,
    y: point.y - (bounds.y + REST_WINDOW_EXTRA_TOP)
  };
}

// 펫은 창 폭이 얼마든 항상 창 가로 중앙에 있으므로 WINDOW_WIDTH 상수가 아니라 실제
// bounds.width를 쓴다(커스터마이징 모드에서 창이 넓어져도 그대로 맞는다).
function isWithinPetHalfWidth(localX: number, bounds: Rect, visual: PetVisual): boolean {
  const halfWidth = visualHorizontalHalfWidth(visual.scale) + PET_HIT_HORIZONTAL_MARGIN;
  return Math.abs(localX - bounds.width / 2) <= halfWidth;
}

function isPointOverPetVisual(point: Point, bounds: Rect, visual: PetVisual): boolean {
  const local = petLocalPoint(point, bounds);
  const { top, bottom } = visualVerticalBounds(visual.scale, visual.modelTopLocalY);
  return isWithinPetHalfWidth(local.x, bounds, visual) &&
    local.y >= top - PET_HIT_VERTICAL_MARGIN && local.y <= bottom + PET_HIT_VERTICAL_MARGIN;
}

// 머리 판정은 아래쪽 여백을 주지 않는다 — 머리와 몸통의 경계를 넓히면 몸통을 문질러도
// 쓰다듬기로 걸린다.
function isPointOverPetHeadVisual(point: Point, bounds: Rect, visual: PetVisual): boolean {
  const local = petLocalPoint(point, bounds);
  const { top, bottom } = visualVerticalBounds(visual.scale, visual.modelTopLocalY);
  const headBottom = top + (bottom - top) * HEAD_REGION_RATIO;
  return isWithinPetHalfWidth(local.x, bounds, visual) &&
    local.y >= top - PET_HIT_VERTICAL_MARGIN && local.y <= headBottom;
}

function isPointOverWindowRect(point: Point, bounds: Rect): boolean {
  return isPointInRect(point, bounds);
}

function isPointOverTrayRect(point: Point, bounds: Rect): boolean {
  return isPointInRect(point, bounds, TRAY_ICON_HIT_MARGIN);
}

// 미디어 플레이어는 펫 창 안에 그려지는 DOM이라 창 상단(투명 여백 포함) 기준 로컬 좌표를 쓴다.
function isPointOverMediaPlayerRect(point: Point, bounds: Rect, rect: LocalRect): boolean {
  const localX = point.x - bounds.x;
  const localY = point.y - bounds.y;
  return localX >= rect.left - MEDIA_PLAYER_HIT_MARGIN &&
    localX <= rect.left + rect.width + MEDIA_PLAYER_HIT_MARGIN &&
    localY >= rect.top - MEDIA_PLAYER_HIT_MARGIN &&
    localY <= rect.top + rect.height + MEDIA_PLAYER_HIT_MARGIN;
}

export {
  HEAD_REGION_RATIO,
  TRAY_ICON_HIT_MARGIN,
  MEDIA_PLAYER_HIT_MARGIN,
  isPointInRect,
  isPointOverPetVisual,
  isPointOverPetHeadVisual,
  isPointOverWindowRect,
  isPointOverTrayRect,
  isPointOverMediaPlayerRect
};
export type { Rect, LocalRect, PetVisual };
