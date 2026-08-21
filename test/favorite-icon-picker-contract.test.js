// @ts-check
// 즐겨찾기 아이콘·색상 선택 팝오버가 "잘려서 못 고르는" 상태로 되돌아가지 않게 고정한다.
//
// 2026-08-20 리포트: 팝오버가 카드 안의 `position: absolute`라 스크롤 패널과 형제 카드에
// 잘리고, 안에 든 공용 색 선택기의 호스트가 26×26으로 묶여 있어서 펼친 색 패널이 그 상자를
// 넘쳐 클릭조차 못 했다. 그래서 두 가지를 함께 못박는다 — 팝오버는 최상위 레이어(native
// popover)에 뜨고, 색 선택기 호스트에는 고정 크기를 주지 않는다.
// React·CSSOM 실행 환경이 없으므로 소스 텍스트를 직접 읽는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (/** @type {string[]} */ ...parts) =>
  fs.readFileSync(path.join(root, ...parts), "utf8").replace(/\r\n?/g, "\n");

const tsx = read("ui", "settings", "tabs-interaction.tsx");
const css = read("ui", "settings", "settings.css");

/** @param {string} selector */
function ruleBody(selector) {
  const start = css.indexOf(selector + " {");
  assert.notEqual(start, -1, `${selector} 규칙이 없다`);
  return css.slice(start, css.indexOf("}", start));
}

test("아이콘 선택 팝오버는 네이티브 popover로 띄운다", () => {
  assert.ok(tsx.includes('popover="auto"'), "popover 속성이 없으면 최상위 레이어에 뜨지 않는다");
  assert.ok(tsx.includes("showPopover()"), "showPopover()를 부르지 않으면 보이지 않는다");
  assert.ok(tsx.includes('event.newState === "closed"'), "브라우저가 닫았을 때 React 상태가 남는다");
  const body = ruleBody(".favorite-icon-picker");
  assert.ok(
    !body.includes("position: absolute"),
    "카드 안 absolute로 되돌리면 스크롤 패널·형제 카드에 잘린다"
  );
  // 누른 버튼에 붙어 있어야 어느 항목을 편집하는 중인지 알 수 있고, 아래 공간이 좁으면
  // most-block-size가 위로 뒤집어 준다(그 order가 없으면 좁은 쪽에 눌린 채로 남는다).
  assert.ok(body.includes("position-anchor: --favorite-icon-anchor"), "팝오버가 버튼에 묶여 있지 않다");
  assert.ok(body.includes("position-try-order: most-block-size"), "공간이 좁은 쪽에서 뒤집히지 않는다");
  assert.ok(
    ruleBody(".favorite-icon-button.picker-open").includes("anchor-name: --favorite-icon-anchor"),
    "열린 버튼에 anchor-name이 없으면 팝오버가 앵커를 못 찾는다"
  );
});

test("색 선택기 호스트에는 고정 크기를 주지 않는다", () => {
  const body = ruleBody(".favorite-icon-color");
  for (const property of ["width:", "height:"]) {
    assert.ok(
      !body.includes(property),
      `.favorite-icon-color에 ${property}가 있으면 펼친 색 패널이 그 상자를 넘쳐 잘린다`
    );
  }
});
