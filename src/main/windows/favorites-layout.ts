// 접힌 창이 더 크면 투명 영역까지 바탕화면 클릭을 막는다. 펼친 크기는 12개 파이 메뉴의
// 최대 반지름(114px)과 그림자 여백이 들어가는 값이라 두 크기를 한곳에서 함께 관리한다.
const FAVORITES_DOCK_COLLAPSED = 80;
const FAVORITES_DOCK_EXPANDED = 300;
const FAVORITES_DOCK_BOTTOM_OFFSET = 60;

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Rectangle = { x: number; y: number; width: number; height: number };

function defaultFavoritesWindowPosition(
  workArea: Rectangle,
  favoritesWindowWidth: number,
  screenMargin: number,
  petWindowWidth: number
): Point {
  return {
    x: workArea.x + workArea.width - favoritesWindowWidth - screenMargin - petWindowWidth,
    y: workArea.y + screenMargin
  };
}

function defaultFavoritesDockPosition(
  workArea: Rectangle,
  screenMargin: number,
  petWindowWidth: number
): Point {
  return {
    x: workArea.x + workArea.width - FAVORITES_DOCK_COLLAPSED - screenMargin - petWindowWidth,
    y: workArea.y + workArea.height - FAVORITES_DOCK_COLLAPSED - screenMargin - FAVORITES_DOCK_BOTTOM_OFFSET
  };
}

/**
 * 창이 걸쳐 있는 디스플레이를 고를 때 쓰는 중심점이다. 너비·높이의 절반을 먼저
 * 반올림하는 기존 순서를 유지해야 홀수 크기 창의 디스플레이 선택이 달라지지 않는다.
 */
function favoritesPanelDisplayProbe(position: Point, size: Size): Point {
  return {
    x: position.x + Math.round(size.width / 2),
    y: position.y + Math.round(size.height / 2)
  };
}

function clampFavoritesPanelPosition(position: Point, size: Size, workArea: Rectangle): Point {
  return {
    x: Math.min(Math.max(position.x, workArea.x), workArea.x + workArea.width - size.width),
    y: Math.min(Math.max(position.y, workArea.y), workArea.y + workArea.height - size.height)
  };
}

function favoritesDockCenter(position: Point): Point {
  return favoritesPanelDisplayProbe(position, {
    width: FAVORITES_DOCK_COLLAPSED,
    height: FAVORITES_DOCK_COLLAPSED
  });
}

function favoritesPieDisplayProbe(centerX: number, centerY: number): Point {
  return { x: Math.round(centerX), y: Math.round(centerY) };
}

function favoritesPieExpandedBounds(centerX: number, centerY: number, workArea: Rectangle): Rectangle {
  return {
    x: Math.round(Math.min(
      Math.max(centerX - FAVORITES_DOCK_EXPANDED / 2, workArea.x),
      workArea.x + workArea.width - FAVORITES_DOCK_EXPANDED
    )),
    y: Math.round(Math.min(
      Math.max(centerY - FAVORITES_DOCK_EXPANDED / 2, workArea.y),
      workArea.y + workArea.height - FAVORITES_DOCK_EXPANDED
    )),
    width: FAVORITES_DOCK_EXPANDED,
    height: FAVORITES_DOCK_EXPANDED
  };
}

function favoritesDockCollapsedBounds(position: Point): Rectangle {
  return {
    x: position.x,
    y: position.y,
    width: FAVORITES_DOCK_COLLAPSED,
    height: FAVORITES_DOCK_COLLAPSED
  };
}

/**
 * 펼친 창을 작업 영역 안으로 민 뒤에도, 다시 접을 위치가 펼친 창의 중앙을 가리키게 한다.
 */
function favoritesDockExpandedLayout(
  collapsedPosition: Point,
  workArea: Rectangle
): { bounds: Rectangle; collapsedPosition: Point } {
  const center = favoritesDockCenter(collapsedPosition);
  const bounds = favoritesPieExpandedBounds(center.x, center.y, workArea);
  return {
    bounds,
    collapsedPosition: {
      x: Math.round(bounds.x + (FAVORITES_DOCK_EXPANDED - FAVORITES_DOCK_COLLAPSED) / 2),
      y: Math.round(bounds.y + (FAVORITES_DOCK_EXPANDED - FAVORITES_DOCK_COLLAPSED) / 2)
    }
  };
}

export {
  FAVORITES_DOCK_COLLAPSED,
  FAVORITES_DOCK_EXPANDED,
  defaultFavoritesWindowPosition,
  defaultFavoritesDockPosition,
  favoritesPanelDisplayProbe,
  clampFavoritesPanelPosition,
  favoritesDockCenter,
  favoritesPieDisplayProbe,
  favoritesPieExpandedBounds,
  favoritesDockCollapsedBounds,
  favoritesDockExpandedLayout
};
export type { Point, Size, Rectangle };
