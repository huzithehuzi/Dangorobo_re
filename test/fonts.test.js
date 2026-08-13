const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { getPowershellExePath, listInstalledFonts, normalizeFontList } = require("../src/main/fonts.js");

test("PowerShell 경로는 SystemRoot를 따르고 없으면 C:\\Windows로 떨어진다", (t) => {
  const original = process.env.SystemRoot;
  t.after(() => {
    if (original === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = original;
  });

  process.env.SystemRoot = "D:\\Win";
  assert.equal(
    getPowershellExePath(),
    path.join("D:\\Win", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  );

  delete process.env.SystemRoot;
  assert.equal(
    getPowershellExePath(),
    path.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  );
});

test("Windows가 아니면 폰트를 조회하지 않고 빈 목록을 준다", () => {
  // 이 테스트가 macOS/Linux CI에서 PowerShell을 실행하려 들지 않는다는 계약이다.
  if (process.platform === "win32") return;
  assert.deepEqual(listInstalledFonts(), []);
});

test("폰트가 하나뿐이면 배열이 아닌 값 하나로 와도 받는다", () => {
  // PowerShell의 ConvertTo-Json은 항목이 하나면 배열로 감싸지 않는다.
  assert.deepEqual(normalizeFontList("Arial"), ["Arial"]);
  assert.deepEqual(normalizeFontList(["Arial"]), ["Arial"]);
});

// 중복 제거는 정확히 같은 문자열끼리만이고, 정렬만 대소문자를 무시한다. 대소문자만 다른
// 이름은 서로 다른 폰트일 수 있어서 남기며, PowerShell 쪽 Sort-Object -Unique가 이미
// 걸러주므로 여기 Set은 안전망이다.
test("같은 이름은 하나로 합치고 대소문자를 무시해 정렬한다", () => {
  assert.deepEqual(
    normalizeFontList(["Verdana", "arial", "Arial", "Batang", "verdana", "Arial"]),
    ["arial", "Arial", "Batang", "Verdana", "verdana"]
  );
});

test("앞뒤 공백은 다듬고 빈 이름은 버린다", () => {
  assert.deepEqual(normalizeFontList(["  Arial  ", "", "   ", null, undefined]), ["Arial"]);
});

test("제어 문자가 섞인 이름은 버린다", () => {
  // 이름은 설정에 저장돼 CSS font-family로 나가므로 보이지 않는 문자를 통과시키지 않는다.
  assert.deepEqual(normalizeFontList(["Arial", "Ma\u0000licious", "Tab\u0009Name", "Del\u007fName"]), ["Arial"]);
});

test("비정상적으로 긴 이름은 버린다", () => {
  assert.deepEqual(normalizeFontList(["A".repeat(120)]), ["A".repeat(120)]);
  assert.deepEqual(normalizeFontList(["A".repeat(121)]), []);
});

test("빈 입력과 배열이 아닌 잡값도 목록으로 정리된다", () => {
  assert.deepEqual(normalizeFontList([]), []);
  assert.deepEqual(normalizeFontList(null), []);
  assert.deepEqual(normalizeFontList(123), ["123"]);
});
