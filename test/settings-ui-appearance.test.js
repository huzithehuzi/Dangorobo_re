// @ts-check
// 창 외형을 <html>에 입히는 코드의 소유권과 범위 계약.
//
// 설정창은 React/TS라 Node에서 실행할 수 없으므로 소스를 훑는다(같은 이유로
// settings-store-sync·settings-ui-recovery도 정적 가드다).
//
// 여기서 지키는 것은 두 가지다.
//   1) 외형 적용 코드가 `ui/lib/appearance.ts` 한 곳에만 있을 것. 예전에는 설정창이
//      테마·폰트 적용을 통째로 복제해 갖고 있었다.
//   2) 배율·글자 크기의 허용 범위가 main의 클램프와 같을 것. 저장된 값은 이미 main이
//      잘라 두지만 설정창의 저장 전 미리보기는 사용자가 방금 친 값을 그대로 받는다.
//      범위가 어긋나면 창이 그 배율로 커진 채 저장은 HTML 검증에 막혀 되돌리기 어렵다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

// Windows 체크아웃은 CRLF라, 소스를 문자열로 훑는 단언이 줄바꿈 바이트에 걸린다.
/** @param {...string} segments */
function readSource(...segments) {
  return fs.readFileSync(path.join(repoRoot, ...segments), "utf8").replace(/\r\n?/g, "\n");
}

const appearanceSource = readSource("ui", "lib", "appearance.ts");
const settingsAppSource = readSource("ui", "settings", "App.tsx");
const tabsAppSource = readSource("ui", "settings", "tabs-app.tsx");
const schemaSource = readSource("src", "main", "settings-schema.ts");

/** `const NAME = 70;` 형태의 상수를 읽는다. @param {string} source @param {string} name */
function constantOf(source, name) {
  const match = new RegExp(`const ${name} = (\\d+);`).exec(source);
  assert.ok(match, `${name} 상수를 찾는다`);
  return Number(match[1]);
}

/** main의 `Math.min(max, Math.max(min, ...))` 클램프 범위를 읽는다. @param {string} name */
function mainClampRange(name) {
  const start = schemaSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name}을 찾는다`);
  const body = schemaSource.slice(start, schemaSource.indexOf("\n}", start));
  const match = /Math\.min\((\d+), Math\.max\((\d+),/.exec(body);
  assert.ok(match, `${name}의 클램프 범위를 읽는다`);
  return { max: Number(match[1]), min: Number(match[2]) };
}

test("UI 배율·글자 크기의 허용 범위가 main의 클램프와 같다", () => {
  const scale = mainClampRange("clampUiScalePercent");
  assert.equal(constantOf(appearanceSource, "UI_SCALE_MIN_PERCENT"), scale.min);
  assert.equal(constantOf(appearanceSource, "UI_SCALE_MAX_PERCENT"), scale.max);

  const fontSize = mainClampRange("clampUiFontSizePercent");
  assert.equal(constantOf(appearanceSource, "UI_FONT_SIZE_MIN_PERCENT"), fontSize.min);
  assert.equal(constantOf(appearanceSource, "UI_FONT_SIZE_MAX_PERCENT"), fontSize.max);
});

test("배율과 글자 크기는 적용 직전에 그 범위로 잘린다", () => {
  for (const [name, min, max] of [
    ["applyUiScale", "UI_SCALE_MIN_PERCENT", "UI_SCALE_MAX_PERCENT"],
    ["applyUiFontSize", "UI_FONT_SIZE_MIN_PERCENT", "UI_FONT_SIZE_MAX_PERCENT"]
  ]) {
    const start = appearanceSource.indexOf(`export function ${name}(`);
    assert.ok(start >= 0, `${name}을 찾는다`);
    const body = appearanceSource.slice(start, appearanceSource.indexOf("\n}", start));
    assert.match(body, new RegExp(`Math\\.min\\([\\s\\S]*?${max}`), `${name}이 최대값으로 자른다`);
    assert.match(body, new RegExp(`Math\\.max\\([\\s\\S]*?${min}`), `${name}이 최소값으로 자른다`);
  }
});

test("설정창의 입력 범위는 같은 상수를 쓴다", () => {
  // 숫자를 그대로 적으면 한쪽만 바뀌어도 아무도 못 잡는다.
  assert.match(
    tabsAppSource,
    /uiFontSizePercent[\s\S]*?min=\{UI_FONT_SIZE_MIN_PERCENT\} max=\{UI_FONT_SIZE_MAX_PERCENT\}/
  );
  assert.match(
    tabsAppSource,
    /uiScalePercent[\s\S]*?min=\{UI_SCALE_MIN_PERCENT\} max=\{UI_SCALE_MAX_PERCENT\}/
  );
});

test("외형을 <html>에 입히는 코드는 창 공용 모듈에만 있다", () => {
  // 설정창이 자기 사본을 다시 들이면 두 곳이 조용히 갈린다(2026-08-13에 실제로 그랬다).
  /** @type {Array<[string, RegExp]>} */
  const appliers = [
    ["폰트 프리셋", /dataset\.uiFont/],
    ["로컬 폰트 지정", /--ui-font-family/],
    ["창 배율", /\.zoom =/],
    ["글자 크기", /--ui-font-size-scale/],
    ["말풍선 테마", /dataset\.theme/]
  ];
  for (const [label, pattern] of appliers) {
    assert.doesNotMatch(settingsAppSource, pattern, `${label} 적용을 설정창이 직접 하지 않는다`);
    assert.match(appearanceSource, pattern, `${label} 적용은 공용 모듈에 있다`);
  }
});

test("설정창은 폼 값이 바뀔 때 공용 낱개 함수로 반영한다", () => {
  // 저장 전 미리보기라 클램프를 반드시 거쳐야 한다. 묶음(applyWindowAppearance)을 쓰면
  // 값 하나가 바뀔 때마다 전부 다시 입혀서 effect 단위가 뭉개진다.
  assert.match(
    settingsAppSource,
    /import \{ applyBubbleTheme, applyUiFont, applyUiFontSize, applyUiScale \} from "\.\.\/lib\/appearance";/
  );
  for (const [dependency, call] of [
    ["d?.uiScalePercent", "applyUiScale(d.uiScalePercent)"],
    ["d?.uiFontSizePercent", "applyUiFontSize(d.uiFontSizePercent)"],
    ["d?.uiFontEnabled, d?.uiFontPreset", "applyUiFont(d.uiFontEnabled, d.uiFontPreset)"]
  ]) {
    const start = settingsAppSource.indexOf(call);
    assert.ok(start >= 0, `${call}을 부른다`);
    const deps = settingsAppSource.indexOf(`}, [${dependency}]);`, start);
    assert.ok(deps > start, `${call}이 ${dependency} 변화에만 반응한다`);
  }
});

test("묶음 적용은 낱개 함수를 정해진 순서로 부른다", () => {
  const start = appearanceSource.indexOf("export function applyWindowAppearance(");
  assert.ok(start >= 0, "applyWindowAppearance를 찾는다");
  const body = appearanceSource.slice(start);
  const order = ["applyBubbleTheme(", "applyUiScale(", "applyUiFontSize(", "applyUiFont("];
  let previous = -1;
  for (const call of order) {
    const at = body.indexOf(call);
    assert.ok(at > previous, `${call}이 앞 단계보다 뒤에 온다`);
    previous = at;
  }
  // 내용 기반으로 크기를 정하는 창(컨텍스트 메뉴·플로팅 독)은 배율을 걸지 않는다.
  assert.match(body, /if \(options\.zoom !== false\) applyUiScale\(settings\.uiScalePercent\);/);
});
