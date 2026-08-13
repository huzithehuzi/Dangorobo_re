// @ts-check
// React 창의 글자 크기 유틸리티 계약.
//
// 바닐라 창 시절에는 한 CSS 규칙 안에서 `font: inherit;` 다음에
// `font-size: calc(12px * var(--ui-font-size-scale));`를 쓰면 뒤에 온 font-size가 이겼다.
// Tailwind로 옮기면서 그 두 줄이 `[font:inherit]`과 `fs-12` **두 유틸리티**로 갈라졌는데,
// 클래스 속성에 적은 순서와 무관하게 생성 CSS의 정렬 순서가 승자를 정한다. 임의 속성
// 유틸리티(`[font:inherit]`)는 font-size 유틸리티보다 **뒤에** 나오고 명시도가 같아서
// `font: inherit` 축약이 크기를 상속값(루트 16px)으로 되돌린다 — 2026-08-13에 우클릭·트레이
// 메뉴 글씨가 12px에서 16px로 커지고, main이 12px 기준으로 계산한 창 폭에 안 맞아 항목
// 라벨이 말줄임으로 잘렸다. 체크리스트 입력창·삭제 버튼과 즐겨찾기 창도 같이 커져 있었다.
//
// Tailwind preflight가 이미 `button,input,select,optgroup,textarea`에 `font: inherit`을
// 걸어 주므로(그쪽은 base 레이어라 유틸리티에 항상 진다) 이 유틸리티는 지워도 손실이 없다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const uiRoot = path.join(repoRoot, "ui");

/** ui/ 아래의 모든 소스 파일. @returns {string[]} */
function uiSourceFiles() {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx|ts|css|html)$/.test(entry.name)) found.push(full);
    }
  };
  walk(uiRoot);
  return found;
}

test("React 창은 font 축약 유틸리티로 글자 크기를 덮지 않는다", () => {
  const offenders = uiSourceFiles().filter((file) =>
    fs.readFileSync(file, "utf8").includes("[font:inherit]")
  );
  assert.deepEqual(
    offenders.map((file) => path.relative(repoRoot, file)),
    [],
    "preflight가 이미 걸어주는 유틸리티이며, 쓰면 fs-* 크기를 조용히 덮는다"
  );
});

test("우클릭·트레이 메뉴 항목은 정해진 글자 크기 유틸리티를 유지한다", () => {
  // 크기 유틸리티가 사라지면 창 폭 계산(main)과 어긋나 라벨이 말줄임으로 잘린다.
  const menuSource = fs.readFileSync(path.join(uiRoot, "pet-context-menu", "App.tsx"), "utf8");
  assert.match(menuSource, /const itemButtonBase =[\s\S]*?\bfs-12\b/, "메뉴 항목은 fs-12");
  assert.match(menuSource, /\bfs-10\b/, "즐겨찾기 격자 라벨은 fs-10");
});
