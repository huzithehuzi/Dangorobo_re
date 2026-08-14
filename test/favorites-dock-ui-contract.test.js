// @ts-check
// 플로팅 독(파이 메뉴) 렌더러의 입력 배선 계약.
//
// 이 창의 가운데 버튼은 클릭과 드래그를 겸한다. 드래그가 시작되면 창이 포인터 밑에서
// 움직이는데, 그 순간 pointerup·click이 버튼이 아니라 조상(.dock)으로 간다(2026-08-14 실측:
// 누른 채 6px만 움직여도 그렇다). 그래서 **드래그의 끝과 cursor 방식의 닫기를 버튼에만
// 걸면 안 된다** — 걸어두면 드래그가 안 끝나 창이 마우스를 계속 따라다니고, 버튼의 토글도
// 실행되지 않는다. React 실행 환경이 없으므로 소스의 배선을 직접 읽어 고정한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Windows 체크아웃은 CRLF라 줄바꿈이 붙는 패턴이 조용히 어긋난다.
const source = fs
  .readFileSync(path.join(__dirname, "..", "ui", "favorites-dock", "App.tsx"), "utf8")
  .replace(/\r\n?/g, "\n");

test("드래그의 끝은 window에서 받는다", () => {
  for (const type of ["pointerup", "pointercancel", "pointermove"]) {
    assert.ok(
      source.includes(`window.addEventListener("${type}"`),
      `${type}을 window에서 받지 않는다 — 창이 움직이면 버튼으로 오지 않는다`
    );
    assert.ok(
      source.includes(`window.removeEventListener("${type}"`),
      `${type} 리스너를 정리하지 않는다`
    );
  }
});

test("가운데 버튼에는 드래그를 시작하는 핸들러만 남긴다", () => {
  assert.ok(source.includes("onPointerDown={onFabPointerDown}"), "드래그 시작은 버튼에서 받는다");
  for (const attribute of ["onPointerUp=", "onPointerMove=", "onPointerCancel="]) {
    assert.ok(
      !source.includes(`${attribute}{onFab`),
      `${attribute}를 버튼에 걸면 창이 움직였을 때 드래그가 끝나지 않는다`
    );
  }
});

test("드래그가 끝나면 시작 지점을 반드시 비운다", () => {
  const endDrag = source.slice(source.indexOf("const endFabDrag"), source.indexOf("useEffect(() => {", source.indexOf("const endFabDrag")));
  assert.ok(endDrag.includes("dragOriginRef.current = null"), "시작 지점을 비우지 않으면 드래그가 살아남는다");
  assert.ok(endDrag.includes("favoritesDockDragEnd()"), "main에도 드래그 종료를 알려야 한다");
  assert.ok(endDrag.includes("setFavoritesDockExpanded"), "문턱을 못 넘었으면 여닫아야 한다");
});

test("버튼을 뗀 것을 놓쳐도 드래그가 살아남지 않는다", () => {
  assert.ok(
    source.includes("event.buttons === 0"),
    "pointerup을 놓친 경우의 안전망이 없다 — 드래그가 영원히 창을 끌고 다닌다"
  );
});

test("cursor 방식의 닫기는 컨테이너에서 받는다", () => {
  assert.ok(source.includes("onClick={onDockClick}"), "닫기를 컨테이너에 걸지 않았다");
  const dockClick = source.slice(source.indexOf("const onDockClick"), source.indexOf("const onFabContextMenu"));
  assert.ok(dockClick.includes("if (!cursorMode) return"), "dock 방식에서는 닫히면 안 된다");
  assert.ok(dockClick.includes('closest?.(".pie-item")'), "항목 클릭은 실행 경로가 닫으므로 건너뛴다");
  assert.ok(dockClick.includes("setFavoritesDockExpanded(false)"), "닫기를 보내지 않는다");
});
