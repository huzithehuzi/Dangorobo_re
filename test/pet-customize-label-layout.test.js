const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CUSTOMIZE_ROW_GAP,
  CUSTOMIZE_SIDE_MARGIN,
  CUSTOMIZE_TOOLBAR_SPACE,
  CUSTOMIZE_TOP_LIMIT,
  stackLabelColumn,
  labelRowLeft,
  leaderGeometry
} = require("../src/pet/customize-label-layout.js");

const BOUNDS = { topLimit: CUSTOMIZE_TOP_LIMIT, bottomLimit: 720 - CUSTOMIZE_TOOLBAR_SPACE };

/**
 * 카드가 서로 겹치지 않는지 본다(간격까지 지켰는지는 별도로 확인한다).
 * @param {number[]} tops
 * @param {{anchorY: number, height: number}[]} items
 */
function assertNoOverlap(tops, items) {
  for (let index = 1; index < tops.length; index += 1) {
    const previousBottom = tops[index - 1] + items[index - 1].height;
    assert.ok(
      tops[index] >= previousBottom + CUSTOMIZE_ROW_GAP,
      `${index - 1}번(${previousBottom})과 ${index}번(${tops[index]})이 겹치거나 너무 붙었다`
    );
  }
}

test("상수는 분리 전 값 그대로다", () => {
  assert.equal(CUSTOMIZE_ROW_GAP, 6);
  assert.equal(CUSTOMIZE_SIDE_MARGIN, 8);
  assert.equal(CUSTOMIZE_TOOLBAR_SPACE, 48);
  assert.equal(CUSTOMIZE_TOP_LIMIT, 4);
});

test("여유가 있으면 카드는 앵커 높이의 한가운데에 놓인다", () => {
  const items = [
    { anchorY: 200, height: 44 },
    { anchorY: 400, height: 44 }
  ];
  assert.deepEqual(stackLabelColumn(items, BOUNDS), [178, 378]);
});

// 파츠는 전부 창 아래쪽에 몰려 있어 앵커를 그대로 쓰면 카드가 서로 겹친다.
test("앵커가 붙어 있으면 아래로 밀어 겹침을 없앤다", () => {
  const items = [
    { anchorY: 500, height: 44 },
    { anchorY: 505, height: 44 },
    { anchorY: 510, height: 44 }
  ];
  const tops = stackLabelColumn(items, BOUNDS);
  assert.deepEqual(tops, [478, 528, 578]);
  assertNoOverlap(tops, items);
});

test("아래로 넘치면 뒤에서부터 끌어올린다", () => {
  // 여섯 장을 창 아래쪽에 몰아넣으면 그대로는 bottomLimit(672)을 넘는다.
  const items = [600, 610, 620, 630, 640, 650].map((anchorY) => ({ anchorY, height: 44 }));
  const tops = stackLabelColumn(items, BOUNDS);
  const lastBottom = tops[tops.length - 1] + 44;
  assert.ok(lastBottom <= BOUNDS.bottomLimit, `마지막 카드 아래(${lastBottom})가 한계를 넘었다`);
  assertNoOverlap(tops, items);
});

test("위아래로 다 안 들어가면 위쪽 한계를 지킨다", () => {
  // 열 하나에 카드를 너무 많이 넣어 세로 공간이 모자란 경우.
  const items = new Array(20).fill(null).map((_, index) => ({ anchorY: 400 + index, height: 44 }));
  const tops = stackLabelColumn(items, BOUNDS);
  assert.ok(tops.every((top) => top >= BOUNDS.topLimit), "위쪽 한계를 넘어 올라갔다");
  assert.equal(tops[0], BOUNDS.topLimit, "첫 카드가 위쪽 한계에 붙는다");
});

test("앵커가 창 위로 벗어나도 위쪽 한계 아래에 둔다", () => {
  const tops = stackLabelColumn([{ anchorY: -500, height: 44 }], BOUNDS);
  assert.deepEqual(tops, [BOUNDS.topLimit]);
});

test("빈 열은 빈 결과를 준다", () => {
  assert.deepEqual(stackLabelColumn([], BOUNDS), []);
});

test("카드 높이가 다르면 각자의 높이만큼 자리를 차지한다", () => {
  const items = [
    { anchorY: 300, height: 60 },
    { anchorY: 305, height: 44 }
  ];
  const tops = stackLabelColumn(items, BOUNDS);
  assert.equal(tops[0], 270);
  assert.equal(tops[1], 270 + 60 + CUSTOMIZE_ROW_GAP);
  assertNoOverlap(tops, items);
});

test("왼쪽 열은 여백에 붙고 오른쪽 열은 카드 폭만큼 안으로 들어온다", () => {
  assert.equal(labelRowLeft("left", 132, 300), CUSTOMIZE_SIDE_MARGIN);
  assert.equal(labelRowLeft("right", 132, 300), 300 - CUSTOMIZE_SIDE_MARGIN - 132);
});

test("연결선은 카드 안쪽 끝에서 파츠까지의 길이와 각도를 준다", () => {
  // 왼쪽 카드의 안쪽 끝은 x=8+132=140, 세로 중심은 top+height/2=222.
  const straight = leaderGeometry(
    "left",
    { width: 132, height: 44, top: 200 },
    { x: 240, y: 222 },
    300
  );
  assert.equal(straight.length, 100, "수평 거리");
  assert.equal(straight.rotationRad, 0, "같은 높이면 수평");
  assert.equal(straight.left, 132, "카드 오른쪽 끝에서 시작");
  assert.equal(straight.top, 22, "카드 세로 중심");
  assert.equal(straight.transformOrigin, "left center");
});

// 카드가 앵커보다 위아래로 밀렸을 때 각도가 반영되지 않으면 연결선이 파츠를 안 가리킨다.
test("카드가 파츠보다 위로 밀리면 연결선이 아래를 향한다", () => {
  const tilted = leaderGeometry(
    "left",
    { width: 132, height: 44, top: 100 },
    { x: 240, y: 222 },
    300
  );
  assert.ok(tilted.rotationRad > 0, "아래를 향해야 한다");
  assert.equal(tilted.length, Math.round(Math.hypot(100, 100)));
});

test("오른쪽 열의 연결선은 카드 왼쪽으로 뻗고 반대 방향으로 돈다", () => {
  // 오른쪽 카드의 안쪽 끝은 x=300-8-132=160.
  const right = leaderGeometry(
    "right",
    { width: 132, height: 44, top: 200 },
    { x: 60, y: 222 },
    300
  );
  assert.equal(right.length, 100);
  assert.equal(right.left, -100, "선을 카드 왼쪽에 놓는다");
  assert.equal(right.transformOrigin, "right center");
  // 왼쪽을 향하는 선(atan2 = π)을 원점 기준으로 되돌리면 0이 된다.
  assert.ok(Math.abs(right.rotationRad) < 1e-9, `수평이어야 한다: ${right.rotationRad}`);
});

test("앵커가 카드 안쪽 끝과 같으면 길이가 0이다", () => {
  const zero = leaderGeometry(
    "left",
    { width: 132, height: 44, top: 200 },
    { x: 140, y: 222 },
    300
  );
  assert.equal(zero.length, 0);
});
