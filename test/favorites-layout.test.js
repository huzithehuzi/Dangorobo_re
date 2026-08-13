// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
} = require("../src/main/windows/favorites-layout.js");

const negativeWorkArea = { x: -1920, y: -40, width: 1920, height: 1040 };

test("즐겨찾기 창과 독의 기본 위치는 음수 좌표 작업 영역을 그대로 따른다", () => {
  assert.deepEqual(
    defaultFavoritesWindowPosition(negativeWorkArea, 264, 10, 300),
    { x: -574, y: -30 }
  );
  assert.deepEqual(
    defaultFavoritesDockPosition(negativeWorkArea, 10, 300),
    { x: -390, y: 850 }
  );
});

test("디스플레이 탐색점은 홀수 크기의 절반을 먼저 반올림한다", () => {
  assert.deepEqual(
    favoritesPanelDisplayProbe({ x: -1900, y: -30 }, { width: 201, height: 341 }),
    { x: -1799, y: 141 }
  );
  assert.deepEqual(favoritesDockCenter({ x: -390, y: 850 }), { x: -350, y: 890 });
});

test("독립 창과 접힌 독은 선택된 작업 영역의 네 가장자리 안으로 보정된다", () => {
  const windowSize = { width: 264, height: 340 };
  assert.deepEqual(
    clampFavoritesPanelPosition({ x: -3000, y: -1000 }, windowSize, negativeWorkArea),
    { x: -1920, y: -40 }
  );
  assert.deepEqual(
    clampFavoritesPanelPosition({ x: 200, y: 2000 }, windowSize, negativeWorkArea),
    { x: -264, y: 660 }
  );
  assert.deepEqual(
    clampFavoritesPanelPosition(
      { x: 200, y: 2000 },
      { width: FAVORITES_DOCK_COLLAPSED, height: FAVORITES_DOCK_COLLAPSED },
      negativeWorkArea
    ),
    { x: -80, y: 920 }
  );
});

test("창이 작업 영역보다 큰 경우에도 기존 오른쪽·아래 경계 우선 계산을 유지한다", () => {
  assert.deepEqual(
    clampFavoritesPanelPosition(
      { x: -1900, y: 0 },
      { width: 2100, height: 1200 },
      negativeWorkArea
    ),
    { x: -2100, y: -200 }
  );
});

test("커서 파이 탐색점과 중앙 배치는 각각 기존 반올림 순서를 유지한다", () => {
  assert.deepEqual(favoritesPieDisplayProbe(-1919.5, -39.6), { x: -1919, y: -40 });
  assert.deepEqual(
    favoritesPieExpandedBounds(-960, 480, negativeWorkArea),
    { x: -1110, y: 330, width: FAVORITES_DOCK_EXPANDED, height: FAVORITES_DOCK_EXPANDED }
  );
});

test("커서 파이는 음수 좌표 모니터의 네 가장자리를 넘지 않는다", () => {
  assert.deepEqual(
    favoritesPieExpandedBounds(-1919.4, -39.6, negativeWorkArea),
    { x: -1920, y: -40, width: 300, height: 300 }
  );
  assert.deepEqual(
    favoritesPieExpandedBounds(-0.6, 999.4, negativeWorkArea),
    { x: -300, y: 700, width: 300, height: 300 }
  );
});

test("독을 펼치고 접을 때 여유 공간에서는 버튼 중심과 저장 위치가 유지된다", () => {
  const collapsedPosition = { x: -1000, y: 200 };
  const layout = favoritesDockExpandedLayout(collapsedPosition, negativeWorkArea);
  assert.deepEqual(layout, {
    bounds: { x: -1110, y: 90, width: 300, height: 300 },
    collapsedPosition
  });
  assert.deepEqual(favoritesDockCollapsedBounds(layout.collapsedPosition), {
    x: -1000,
    y: 200,
    width: 80,
    height: 80
  });
});

test("가장자리에서 펼친 독은 보정된 파이 중앙을 새 접힘 위치로 기억한다", () => {
  const layout = favoritesDockExpandedLayout({ x: -1920, y: -40 }, negativeWorkArea);
  assert.deepEqual(layout, {
    bounds: { x: -1920, y: -40, width: 300, height: 300 },
    collapsedPosition: { x: -1810, y: 70 }
  });
  assert.deepEqual(favoritesDockCenter(layout.collapsedPosition), { x: -1770, y: 110 });
  assert.deepEqual(
    favoritesDockCenter(layout.collapsedPosition),
    { x: layout.bounds.x + layout.bounds.width / 2, y: layout.bounds.y + layout.bounds.height / 2 }
  );
});

test("작업 영역이 파이보다 작을 때의 오른쪽·아래 경계 우선 동작도 보존한다", () => {
  assert.deepEqual(
    favoritesPieExpandedBounds(50, 50, { x: 0, y: 0, width: 200, height: 180 }),
    { x: -100, y: -120, width: 300, height: 300 }
  );
});
