// @ts-check
// 설정 검색 회귀 테스트 (2026-08-21).
//
// 탭이 13개까지 늘어나 "기능이 있는데 못 찾는" 상황이 생겨 넣은 기능이다. 여기서 고정하는
// 것은 세 가지 계약이다:
//   1. 색인을 손으로 관리하지 않는다(렌더된 DOM에서 만든다) — 안 그러면 조용히 낡는다
//   2. 검색창의 Enter가 설정을 저장하지 않는다 — 저장 버튼이 있는 <form> 안이라 기본 동작이 submit이다
//   3. 갈 수 없는 탭은 결과에 넣지 않는다
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { t, SUPPORTED_LANGUAGES } = require("../src/shared/i18n.js");

const ROOT = path.join(__dirname, "..");

/** @param {string} relativePath */
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n?/g, "\n");
}

const searchSource = read("ui/settings/search.tsx");
const appSource = read("ui/settings/App.tsx");

test("검색은 손으로 만든 색인이 아니라 렌더된 패널에서 항목을 찾는다", () => {
  // 설정 항목 목록을 검색 코드에 복사해 두면 탭을 고칠 때마다 같이 고쳐야 하고,
  // 안 고치면 새 설정이 검색에서 조용히 빠진다.
  assert.match(searchSource, /document\.querySelectorAll<HTMLElement>\("\[data-tab-panel\]"\)/);
  assert.match(
    searchSource,
    /const ROW_SELECTOR = "\.setting-row, \.toggle-row, \.text-field";/,
    "rows.tsx의 세 행 종류를 그대로 훑어야 한다"
  );
});

test("모든 탭 패널에 data-tab-panel이 붙어 있다", () => {
  // 하나라도 빠지면 그 탭의 설정은 검색에서 통째로 사라진다(에러 없이).
  /* 탭 id는 camelCase도 있다("patchNotes"). `[a-z]+`로 잡으면 그런 탭이 양쪽 집합에서 함께
     빠져 "일치"로 통과해 버린다 — 검사가 무력해지는 자리라 대문자를 포함해 읽는다. */
  const panels = [...appSource.matchAll(/<section data-tab-panel="([A-Za-z]+)"/g)].map((m) => m[1]);
  const activeChecks = [...appSource.matchAll(/activeTab === "([A-Za-z]+)" \? " active" : ""/g)]
    .map((m) => m[1]);
  assert.ok(panels.length > 0, "패널을 찾지 못했다");
  assert.deepEqual(
    [...new Set(activeChecks)].sort(),
    [...new Set(panels)].sort(),
    "패널 목록과 data-tab-panel 목록이 어긋난다"
  );
});

test("검색창의 Enter는 설정을 저장하지 않는다", () => {
  // 이 입력칸은 저장 버튼이 있는 <form> 안에 있다 — 막지 않으면 검색하려다 저장된다.
  const keyHandler = searchSource.slice(searchSource.indexOf("const onKeyDown"));
  const enterBlock = keyHandler.slice(0, keyHandler.indexOf("if (event.key === \"Escape\")"));
  assert.match(enterBlock, /event\.key === "Enter"/);
  assert.match(enterBlock, /event\.preventDefault\(\)/);
});

test("결과 항목은 submit 버튼이 되지 않는다", () => {
  // <form> 안의 <button>은 기본이 type="submit"이다 — 결과를 누르면 저장돼 버린다.
  const resultButton = searchSource.slice(searchSource.indexOf('className={`settings-search-result'));
  assert.match(searchSource.slice(0, searchSource.indexOf("settings-search-result-label")), /type="button"/);
  assert.ok(resultButton.length > 0);
});

test("갈 수 없는 탭은 결과에 넣지 않는다", () => {
  // 잠금 전 개발자 탭, 꺼진 기억 관리 탭이 결과로 나오면 눌러도 이동할 수 없다.
  assert.match(searchSource, /const tabLabel = tabLabels\[tabId\];\s*\n\s*if \(!tabLabel\) continue;/);
  assert.match(
    appSource,
    /for \(const group of tabGroups\) \{\s*\n\s*for \(const tab of group\.tabs\) labels\[tab\.id\] = tt\(tab\.labelKey\);/,
    "탭 라벨은 실제로 보이는 탭 목록(tabGroups)에서 파생해야 한다"
  );
});

test("이동 후에는 라벨로 행을 다시 찾는다", () => {
  // 결과에 DOM 노드를 담아 두면 그 사이 리렌더로 떼어진 노드를 붙잡아 스크롤이 안 먹는다.
  const jump = searchSource.slice(searchSource.indexOf("const jumpTo ="));
  assert.match(jump, /requestAnimationFrame/, "탭이 보이기 전에는 스크롤이 안 먹는다");
  assert.match(jump, /rowLabel\(candidate\) === hit\.label/);
  assert.match(jump, /scrollIntoView/);
  assert.match(jump, /classList\.add\("settings-search-hit"\)/);
});

test("선택지 텍스트가 라벨에 섞이지 않는다", () => {
  // textContent를 그대로 쓰면 <select>의 모든 선택지가 들어와 결과 줄을 못 읽게 된다.
  const labelFn = searchSource.slice(searchSource.indexOf("function rowLabel"));
  assert.match(labelFn, /\.input-wrap, select, input, textarea, button/);
  assert.match(labelFn, /\.remove\(\)/);
});

test("강조 표시는 움직임 최소화 설정에서도 남는다", () => {
  // 어디로 이동했는지 알려주는 정보라, 애니메이션만 끄고 표시 자체는 유지해야 한다.
  const css = read("ui/settings/settings.css");
  const reduceBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  const hitRule = reduceBlock.slice(reduceBlock.indexOf(".settings-search-hit"));
  assert.match(hitRule.slice(0, 260), /outline-color:/, "표시는 남겨야 한다");
  assert.match(hitRule.slice(0, 260), /animation: none/, "애니메이션은 꺼야 한다");
});

test("검색 문구는 세 언어에 모두 있다", () => {
  for (const key of ["settings.search.placeholder", "settings.search.ariaLabel", "settings.search.noResults"]) {
    for (const language of SUPPORTED_LANGUAGES) {
      const value = t(language, key);
      assert.notEqual(value, key, `${language}의 ${key}가 비어 있다`);
    }
  }
});

test("입력해야 나타나는 UI를 실제 창에서 확인할 QA 경로가 있다", () => {
  // React 제어 입력은 value 대입만으로 onChange가 돌지 않아 결과 목록이 안 뜬다.
  const qaCapture = read("src/main/qa-capture.ts");
  assert.ok(qaCapture.includes("--capture-settings-type="));
  assert.match(
    qaCapture,
    /getOwnPropertyDescriptor\(HTMLInputElement\.prototype, "value"\)\.set/,
    "네이티브 setter로 넣어야 React 상태가 갱신된다"
  );
});
