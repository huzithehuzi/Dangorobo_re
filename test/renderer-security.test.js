// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.join(__dirname, "..");
const rendererHtmlFiles = [
  "src/pet/index.html",
  "ui/checklist/index.html",
  "ui/favorites-dock/index.html",
  "ui/favorites-window/index.html",
  "ui/logs/index.html",
  "ui/pet-context-menu/index.html",
  "ui/settings/index.html"
];

test("모든 로컬 렌더러는 외부 코드 실행을 막는 CSP를 선언한다", () => {
  for (const relativePath of rendererHtmlFiles) {
    const html = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/g);
    assert.equal(match?.length, 1, `${relativePath}에 CSP가 정확히 하나 있어야 한다`);
    const policy = match?.[0] || "";
    assert.match(policy, /default-src 'self'/);
    assert.match(policy, /script-src 'self'/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /base-uri 'none'/);
    assert.match(policy, /connect-src 'self'/);
    assert.ok(!policy.includes("unsafe-eval"));
    assert.doesNotMatch(policy, /https?:|wss?:/);
  }
});

test("펫 렌더러 CSP는 현재 import map만 해시로 허용한다", () => {
  const html = fs.readFileSync(path.join(repositoryRoot, "src/pet/index.html"), "utf8");
  const importMap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/)?.[1];
  assert.ok(importMap);
  assert.ok(policy);
  const hash = crypto.createHash("sha256").update(importMap).digest("base64");
  assert.ok(policy.includes(`'sha256-${hash}'`));
  assert.ok(!policy.includes("script-src 'self' 'unsafe-inline'"));
  assert.match(policy, /connect-src 'self' blob:/);
});

test("말풍선 패널의 상태 문구는 innerHTML을 거치지 않는다", () => {
  // 번역·리사이즈 실패 사유가 그대로 들어오는 자리다. 문자열로 이어붙이면 오류 메시지
  // 안의 <, & 가 마크업으로 해석돼 실제로 요소가 만들어진다.
  const source = fs.readFileSync(path.join(repositoryRoot, "src/pet/bubble-panels.ts"), "utf8");
  const showStatus = source.match(/showStatus: \(text: string, color: string\) => \{[\s\S]*?\n {6}\}/)?.[0];
  assert.ok(showStatus, "bubble-panels.ts에 showStatus 구현이 있어야 한다");
  assert.doesNotMatch(showStatus, /innerHTML/);
  assert.match(showStatus, /\.textContent = text/);
});

test("일곱 BrowserWindow는 context isolation을 켜고 Node 통합을 끈다", () => {
  // 일곱 창의 생성 옵션은 모두 팩토리 한 곳에 있다. 엔트리나 컨트롤러에서 직접 만들기
  // 시작하면 개수·생성 위치 검사가 함께 걸린다.
  const windowSourceFiles = ["src/main/windows/window-factory.ts"];
  const sources = windowSourceFiles.map((relativePath) => ({
    relativePath,
    text: fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8")
  }));
  const combined = sources.map((source) => source.text).join("\n");

  // 렌더러 HTML 하나당 창 하나다.
  assert.equal((combined.match(/new BrowserWindow\(/g) || []).length, rendererHtmlFiles.length);
  assert.doesNotMatch(
    fs.readFileSync(path.join(repositoryRoot, "src/main.ts"), "utf8"),
    /new BrowserWindow\(/
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(repositoryRoot, "src/main/windows/pet-menu-controller.ts"), "utf8"),
    /new BrowserWindow\(/
  );

  // 일곱 창이 공유하는 webPreferences가 두 옵션을 안전한 값으로 고정한다.
  const factoryText = sources[0].text;
  const sharedPreferences = factoryText.match(/function baseWebPreferences\([\s\S]*?\n\}/)?.[0];
  assert.ok(sharedPreferences, "window-factory.ts에 baseWebPreferences()가 있어야 한다");
  assert.match(sharedPreferences, /contextIsolation: true/);
  assert.match(sharedPreferences, /nodeIntegration: false/);

  // 각 창의 webPreferences는 그 공용 값을 쓰거나 같은 값을 직접 적는다.
  const preferenceBlocks = combined.split(/webPreferences:/).slice(1);
  assert.equal(preferenceBlocks.length, rendererHtmlFiles.length);
  for (const block of preferenceBlocks) {
    const head = block.slice(0, 220);
    const secure = /baseWebPreferences\(/.test(head)
      || (/contextIsolation: true/.test(head) && /nodeIntegration: false/.test(head));
    assert.ok(secure, `안전하지 않은 webPreferences: ${head.slice(0, 80)}`);
  }

  for (const { relativePath, text } of sources) {
    assert.doesNotMatch(text, /contextIsolation: false/, relativePath);
    assert.doesNotMatch(text, /nodeIntegration: true/, relativePath);
  }
});
