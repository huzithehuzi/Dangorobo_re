// @ts-check
// transform으로 자리를 잡는 요소의 :active 규칙은 공용 누름 규칙을 **명시도로** 이겨야 한다.
//
// 공용 규칙은 `button:active:not(:disabled) { transform: scale(0.94) }`(명시도 0,2,1)이다.
// `.fab:active`(0,2,0)처럼 그보다 낮으면 누르는 순간 요소가 translate(-50%, -50%)를 잃고
// 자기 크기의 절반만큼 오른쪽 아래로 튄다. transition 때문에 "미끄러지듯" 보인다.
// 같은 버그가 두 번 났다 — 2026-08-08 `.gradient-stop`("정지점이 이리저리 움직인다"),
// 2026-08-14 `.fab`("버튼이 오른쪽 아래로 미끄러진다"). 세 번째를 막으려고 규칙으로 굳힌다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
/** 공용 누름 규칙 `button:active:not(:disabled)`의 클래스·유사클래스 개수. */
const SHARED_PRESS_CLASS_COUNT = 2;

/** @param {string} dir @returns {string[]} */
function cssFiles(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...cssFiles(full));
    else if (entry.name.endsWith(".css")) found.push(full);
  }
  return found;
}

/**
 * 클래스·속성·유사클래스의 개수(명시도의 b 자리). `:not(...)`은 CSS 규칙대로 안쪽을 센다.
 * 여기 쓰이는 선택자는 전부 단순형이라 이 근사로 충분하다.
 * @param {string} selector
 */
function classCount(selector) {
  const flattened = selector.replace(/:not\(/g, "").replace(/\)/g, "");
  const classes = flattened.match(/\.[a-zA-Z_-][\w-]*/g) || [];
  const attributes = flattened.match(/\[[^\]]+\]/g) || [];
  // ::before 같은 유사요소는 b가 아니라 c 자리이므로 제외한다.
  const pseudoClasses = flattened.match(/(?<!:):[a-zA-Z-]+/g) || [];
  return classes.length + attributes.length + pseudoClasses.length;
}

test("transform을 옮기는 :active 규칙은 공용 누름 규칙보다 명시도가 높다", () => {
  const files = [...cssFiles(path.join(ROOT, "ui")), ...cssFiles(path.join(ROOT, "src", "pet"))];
  assert.ok(files.length > 0, "검사할 CSS를 찾지 못했다");

  /** @type {string[]} */
  const offenders = [];
  for (const file of files) {
    const css = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectorGroup = match[1].trim();
      const body = match[2];
      if (!selectorGroup.includes(":active")) continue;
      // 자리를 옮기는 transform만 문제다. scale만 쓰는 규칙은 덮어써도 티가 안 난다.
      if (!/transform\s*:[^;]*translate/.test(body)) continue;
      for (const selector of selectorGroup.split(",")) {
        const trimmed = selector.trim();
        if (!trimmed.includes(":active")) continue;
        if (classCount(trimmed) > SHARED_PRESS_CLASS_COUNT) continue;
        offenders.push(`${path.relative(ROOT, file)}: ${trimmed}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "공용 `button:active:not(:disabled)`(0,2,1)에 져서 누를 때 오른쪽 아래로 튄다. " +
      "부모 클래스를 앞에 붙여 명시도를 올려라:\n" + offenders.join("\n")
  );
});

test("공용 누름 규칙의 모양이 바뀌면 이 검사의 기준도 다시 잡아야 한다", () => {
  const base = fs.readFileSync(path.join(ROOT, "ui", "lib", "window-base.css"), "utf8");
  assert.ok(
    base.includes("button:active:not(:disabled) { transform: scale(0.94); }"),
    "공용 누름 규칙이 바뀌었다 — SHARED_PRESS_CLASS_COUNT를 다시 계산할 것"
  );
});
