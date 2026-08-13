const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { findStaleTsArtifacts } = require("../src/main/dev-build-guard.js");

/** @param {(root: string) => void} build */
function withTempDir(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-build-guard-"));
  try {
    build(root);
    return findStaleTsArtifacts(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * @param {string} filePath
 * @param {number} mtimeSecondsAgo
 */
function writeFileAged(filePath, mtimeSecondsAgo) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "// x");
  const time = new Date(Date.now() - mtimeSecondsAgo * 1000);
  fs.utimesSync(filePath, time, time);
}

test("산출물이 최신이면 아무것도 보고하지 않는다", () => {
  const stale = withTempDir((root) => {
    writeFileAged(path.join(root, "main/windows/foo.ts"), 60);
    writeFileAged(path.join(root, "main/windows/foo.js"), 10);
  });
  assert.deepEqual(stale, []);
});

test("소스가 산출물보다 새로우면 보고한다", () => {
  const stale = withTempDir((root) => {
    writeFileAged(path.join(root, "main/foo.ts"), 10);
    writeFileAged(path.join(root, "main/foo.js"), 60);
  });
  assert.deepEqual(stale, [path.join("main", "foo.ts")]);
});

test("산출물이 아예 없어도 보고한다", () => {
  const stale = withTempDir((root) => {
    writeFileAged(path.join(root, "main/foo.ts"), 10);
  });
  assert.deepEqual(stale, [path.join("main", "foo.ts")]);
});

test("펫 renderer 산출물이 소스보다 오래되면 보고한다", () => {
  const stale = withTempDir((root) => {
    writeFileAged(path.join(root, "pet/renderer.ts"), 10);
    writeFileAged(path.join(root, "pet/renderer.js"), 60);
  });
  assert.deepEqual(stale, [path.join("pet", "renderer.ts")]);
});

test("펫 renderer 산출물이 없으면 보고한다", () => {
  const stale = withTempDir((root) => {
    writeFileAged(path.join(root, "pet/renderer.ts"), 10);
  });
  assert.deepEqual(stale, [path.join("pet", "renderer.ts")]);
});

test(".d.ts와 vendor·node_modules는 무시한다", () => {
  const stale = withTempDir((root) => {
    writeFileAged(path.join(root, "types.d.ts"), 10);
    writeFileAged(path.join(root, "vendor/three.ts"), 10);
    writeFileAged(path.join(root, "node_modules/pkg/index.ts"), 10);
  });
  assert.deepEqual(stale, []);
});

test("순수 .js 파일만 있으면 아무것도 보고하지 않는다", () => {
  const stale = withTempDir((root) => {
    writeFileAged(path.join(root, "main/bar.js"), 10);
  });
  assert.deepEqual(stale, []);
});
