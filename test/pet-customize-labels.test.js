// @ts-check
// 커스터마이징 라벨·팔레트 모듈의 소유권 계약. 이 모듈은 document·window에 붙어 있어
// Node로 실행할 수 없으므로(assistant-panels·bubble-panels와 같은 부류) 배선과 소유권을
// 소스 수준에서 확인하고, 실제 화면은 --capture-customize로 대조한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

// Windows 체크아웃은 CRLF라, 소스 구간을 문자열로 잘라내는 단언이 줄바꿈 바이트에 걸린다.
// 여기서 보는 것은 배선 구조뿐이므로 LF로 맞춘다.
/** @param {...string} segments */
function readSource(...segments) {
  return fs.readFileSync(path.join(repoRoot, ...segments), "utf8").replace(/\r\n?/g, "\n");
}

// 이 파일의 단언은 "무엇을 쓰지 않는가"를 많이 보는데, 설계 의도를 적어둔 주석에 그 이름이
// 그대로 등장한다. 주석을 걷어내고 실제 코드만 본다.
/** @param {string} source */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const rendererSource = codeOnly(readSource("src", "pet", "renderer.ts"));
const moduleSource = codeOnly(readSource("src", "pet", "customize-labels.ts"));
// 매 프레임 갱신 호출은 프레임 루프 모듈로 옮겨갔다.
const loopSource = codeOnly(readSource("src", "pet", "animation-loop.ts"));

test("커스터마이징 라벨 상태는 모듈이 소유하고 렌더러는 getter로만 읽는다", () => {
  // 세터를 주입하는 형태로 되돌아가면 이름만 바뀐 같은 코드가 된다.
  for (const name of [
    "customizeModeActive", "customizeRows", "customizeAssignment",
    "customizeAssignmentSignature", "customizePaletteTarget", "customizeAnchorVec"
  ]) {
    assert.doesNotMatch(
      rendererSource,
      new RegExp(`^(?:let|const)\\s+${name}\\b`, "m"),
      `${name}은 렌더러가 소유하지 않는다`
    );
  }
  for (const name of ["modeActive", "paletteTarget", "assignment", "assignmentSignature"]) {
    assert.match(moduleSource, new RegExp(`^  let ${name}\\b`, "m"), `${name}은 모듈이 소유한다`);
  }

  assert.match(moduleSource, /isActive: \(\) => modeActive/);
  assert.doesNotMatch(moduleSource, /^\s*set[A-Z]\w*:\s*\(/m, "세터를 내보내지 않는다");

  assert.match(rendererSource, /if \(customizeLabels\.isActive\(\)\) customizeLabels\.syncInputs\(/);
  // 라벨은 파츠의 월드 좌표를 따라가야 해서 프레임 루프가 렌더 직후 매 프레임 부른다.
  assert.match(loopSource, /customizeLabels\.updateLayout\(\);/);
  assert.doesNotMatch(rendererSource, /customizeLabels\.updateLayout\(\)/);
  assert.match(
    rendererSource,
    /window\.desktopPet\.onCustomizeMode\(\(payload\) => customizeLabels\.setActive\(payload\.active, payload\.bodyColors\)\);/
  );
});

test("렌더러는 라벨 배치 계산을 직접 하지 않고 모듈에만 맡긴다", () => {
  for (const symbol of [
    "assignCustomizeSides", "stackLabelColumn", "labelRowLeft", "leaderGeometry",
    "CUSTOMIZE_TOP_LIMIT", "CUSTOMIZE_TOOLBAR_SPACE"
  ]) {
    assert.doesNotMatch(rendererSource, new RegExp(`\\b${symbol}\\b`), `${symbol}은 모듈로 옮겼다`);
    assert.match(moduleSource, new RegExp(`\\b${symbol}\\b`), `${symbol}은 모듈이 쓴다`);
  }
});

test("3D 앵커와 로컬 색 적용은 렌더러가 소유하고 콜백으로 넘긴다", () => {
  // 앵커는 모델 그릇 여섯 개를, 로컬 색은 latestSettings를 봐야 해서 모듈로 옮기지 않는다.
  assert.match(rendererSource, /^function customizeAnchorObject\(id: string\) \{/m);
  assert.match(rendererSource, /^function applyLocalBodyColor\(id: string, color: string\) \{/m);
  assert.match(rendererSource, /anchorObject: customizeAnchorObject/);
  assert.match(rendererSource, /applyLocalColor: applyLocalBodyColor/);
  // 모듈이 이 상태를 직접 잡으면 소유권이 두 곳으로 갈린다.
  for (const owned of ["loadedMeshes", "facePlates", "bodyPlates", "tailPivot", "latestSettings"]) {
    assert.doesNotMatch(moduleSource, new RegExp(`\\b${owned}\\b`), `${owned}은 모듈이 건드리지 않는다`);
  }
});

test("Escape 처리 순서를 유지하려고 라벨 모듈을 assistant 패널보다 먼저 만든다", () => {
  // 둘 다 window keydown으로 Escape를 보므로 등록 순서가 곧 처리 순서다. 분해 전에도
  // 커스터마이징 쪽이 먼저였고, 뒤집히면 커스터마이징 중 Escape가 다른 패널에 먼저 간다.
  const labels = rendererSource.indexOf("const customizeLabels = createCustomizeLabels({");
  const assistant = rendererSource.indexOf("const assistantPanels = createAssistantPanels({");
  assert.ok(labels >= 0 && assistant > labels, "createCustomizeLabels가 createAssistantPanels보다 앞선다");

  const escapeGuard = moduleSource.indexOf('if (event.key !== "Escape" || !modeActive) return;');
  const paletteFirst = moduleSource.indexOf("if (!el.palette.hidden) {", escapeGuard);
  assert.ok(escapeGuard >= 0 && paletteFirst > escapeGuard, "Escape는 팔레트를 먼저 닫는다");
});
