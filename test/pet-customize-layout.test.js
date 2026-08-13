const test = require("node:test");
const assert = require("node:assert/strict");

const { assignCustomizeSides } = require("../src/pet/customize-layout.js");

/**
 * @param {Map<string, {side: string, order: number}>} assignment
 * @returns {string[]} "id:side:order" 문자열로 펼쳐 비교하기 쉽게 만든다.
 */
function flatten(assignment) {
  return [...assignment].map(([id, slot]) => `${id}:${slot.side}:${slot.order}`);
}

test("위에서부터 좌우 번갈아 배정하고 같은 수면 왼쪽을 먼저 채운다", () => {
  const assignment = assignCustomizeSides([
    { id: "body", anchorY: 40 },
    { id: "ear", anchorY: 10 },
    { id: "tail", anchorY: 30 },
    { id: "headgear", anchorY: 20 }
  ]);

  // anchorY 오름차순(ear→headgear→tail→body)으로 left, right, left, right.
  assert.deepEqual(flatten(assignment), [
    "ear:left:0",
    "headgear:right:0",
    "tail:left:1",
    "body:right:1"
  ]);
});

test("홀수 개면 왼쪽이 하나 더 많다", () => {
  const assignment = assignCustomizeSides([
    { id: "a", anchorY: 1 },
    { id: "b", anchorY: 2 },
    { id: "c", anchorY: 3 }
  ]);

  const sides = [...assignment.values()].map((slot) => slot.side);
  assert.deepEqual(sides, ["left", "right", "left"]);
});

test("order는 열마다 0부터 이어진다", () => {
  const assignment = assignCustomizeSides(
    [1, 2, 3, 4, 5, 6].map((n) => ({ id: `p${n}`, anchorY: n }))
  );

  const left = [...assignment].filter(([, slot]) => slot.side === "left");
  const right = [...assignment].filter(([, slot]) => slot.side === "right");
  assert.deepEqual(left.map(([, slot]) => slot.order), [0, 1, 2]);
  assert.deepEqual(right.map(([, slot]) => slot.order), [0, 1, 2]);
});

test("빈 목록은 빈 배정을 준다", () => {
  assert.equal(assignCustomizeSides([]).size, 0);
});

// 렌더러는 매 프레임 측정 배열을 새로 만들지만, 정렬이 인자를 건드리면 호출부가
// 측정 순서를 재사용할 수 없게 된다.
test("입력 배열의 순서를 바꾸지 않는다", () => {
  const measured = [
    { id: "a", anchorY: 30 },
    { id: "b", anchorY: 10 }
  ];
  assignCustomizeSides(measured);
  assert.deepEqual(measured.map((entry) => entry.id), ["a", "b"]);
});
