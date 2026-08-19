"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");
const {
  SOURCE_DIRECTORIES,
  SOURCE_ROOT_FILES,
  buildSourceArchive,
  isExcludedFile,
  listSourceFiles,
  replaceFileWithRollback,
  verifySourceManifest
} = require("../scripts/source-archive.js");

const repositoryRoot = path.resolve(__dirname, "..");

function createFixture()
{
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-source-archive-"));

  for (const relativeFile of SOURCE_ROOT_FILES)
  {
    const absoluteFile = path.join(rootDir, relativeFile);
    fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
    const content = relativeFile === "package.json"
      ? JSON.stringify({ name: "fixture", version: "1.2.3", build: { productName: "Dangorobo" } })
      : `${relativeFile}\n`;
    fs.writeFileSync(absoluteFile, content);
  }

  for (const relativeDirectory of SOURCE_DIRECTORIES)
  {
    fs.mkdirSync(path.join(rootDir, relativeDirectory), { recursive: true });
    fs.writeFileSync(path.join(rootDir, relativeDirectory, "included.txt"), relativeDirectory);
  }

  return rootDir;
}

/**
 * Windows에서 파일 symlink는 개발자 모드나 관리자 권한이 필요할 수 있다. 권한이나 플랫폼
 * 지원이 없는 경우에만 해당 fixture를 명시적으로 건너뛴다.
 * @param {import("node:test").TestContext} context
 * @param {string} targetPath
 * @param {string} linkPath
 * @param {"file" | "dir" | "junction"} type
 * @returns {boolean}
 */
function createSymlinkOrSkip(context, targetPath, linkPath, type)
{
  try
  {
    fs.symlinkSync(targetPath, linkPath, type);
    return true;
  }
  catch (error)
  {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (["EACCES", "EINVAL", "ENOSYS", "EPERM", "UNKNOWN"].includes(code))
    {
      context.skip(`이 환경은 symlink fixture를 만들 수 없습니다 (${code || "unknown"}).`);
      return false;
    }
    throw error;
  }
}

test("실제 저장소의 소스 목록은 빌드 입력을 포함하고 제자리 TS emit을 제외한다", () =>
{
  const manifest = verifySourceManifest(repositoryRoot);

  assert.ok(manifest.files.includes("ui/vite.config.mts"));
  assert.ok(manifest.files.includes(".github/workflows/ci.yml"));
  assert.ok(manifest.files.includes("types/sql-js.d.ts"));
  assert.ok(manifest.files.includes("test/source-archive.test.js"));
  assert.ok(manifest.files.includes("scripts/source-archive.js"));
  assert.ok(manifest.files.includes("docs/DEVELOPMENT.md"));
  assert.ok(manifest.files.includes("docs/CHANGELOG.md"));
  assert.ok(manifest.files.includes("tsconfig.build.json"));
  assert.ok(manifest.files.includes("THIRD_PARTY_NOTICES.md"));
  assert.ok(manifest.files.includes("src/main.ts"));
  assert.ok(manifest.files.includes("src/main/assistant/ask-gemini.ts"));
  assert.ok(manifest.files.includes("src/main/assistant/date-time-context.ts"));
  assert.ok(manifest.files.includes("src/preload.ts"));
  assert.ok(manifest.files.includes("src/pet/renderer.ts"));
  assert.ok(manifest.files.includes("src/pet/tsconfig.build.json"));
  assert.ok(manifest.files.includes("src/shared/theme-catalog.ts"));
  assert.ok(!manifest.files.includes("src/main.js"));
  assert.ok(!manifest.files.includes("src/main/assistant/ask-gemini.js"));
  assert.ok(!manifest.files.includes("src/main/assistant/date-time-context.js"));
  assert.ok(!manifest.files.includes("src/preload.js"));
  assert.ok(!manifest.files.includes("src/pet/renderer.js"));
  assert.ok(!manifest.files.includes("src/shared/date-time-context.js"));
  assert.ok(!manifest.files.includes("src/shared/theme-catalog.js"));
  assert.ok(manifest.files.every((relativePath) => !relativePath.startsWith("docs/archive/")));
  assert.ok(manifest.files.every((relativePath) => !isExcludedFile(relativePath)));
  assert.ok(manifest.files.every((relativePath) => !relativePath.startsWith("dist/")));
  assert.ok(manifest.files.every((relativePath) => !relativePath.startsWith("release/")));

  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["build:pet"],
    "tsc -p src/pet/tsconfig.json && tsc -p src/pet/tsconfig.build.json"
  );
  assert.equal(packageJson.scripts["build:runtime"], "npm run build:main && npm run build:pet");
  assert.equal(packageJson.scripts.precheck, "npm run build:runtime");
  assert.equal(packageJson.scripts.pretest, "npm run build:runtime");
  assert.equal(packageJson.scripts.prestart, "npm run ui:build && npm run build:runtime");
  assert.equal(
    packageJson.scripts.predist,
    "npm run source:verify && npm run template:verify && npm run ui:build && npm run build:runtime"
  );
  assert.equal(packageJson.scripts.postdist, "npm run source:dist && npm run template:dist");
});

test("소스 ZIP은 화이트리스트 파일만 단일 버전 폴더 아래에 생성한다", (context) =>
{
  const rootDir = createFixture();
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(rootDir, "src", "main"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "src", "main", "converted.ts"), "export {};\n");
  fs.writeFileSync(path.join(rootDir, "src", "main", "converted.js"), "generated\n");
  fs.writeFileSync(path.join(rootDir, "src", "main", "source.js"), "source\n");
  fs.writeFileSync(path.join(rootDir, "src", "preload.ts"), "export {};\n");
  fs.writeFileSync(path.join(rootDir, "src", "preload.js"), "generated preload\n");
  fs.mkdirSync(path.join(rootDir, "src", "pet"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "src", "pet", "renderer.ts"), "export {};\n");
  fs.writeFileSync(path.join(rootDir, "src", "pet", "renderer.js"), "generated renderer\n");
  fs.writeFileSync(path.join(rootDir, "src", "assistant-keys.json"), "secret\n");
  fs.writeFileSync(path.join(rootDir, "src", "assistant-keys.json.rollback-10-20-1"), "old secret\n");
  fs.writeFileSync(path.join(rootDir, "src", "settings-save-journal.json"), "encrypted transaction\n");
  fs.writeFileSync(path.join(rootDir, "src", "settings-save-journal.json.recovery-copy"), "encrypted transaction copy\n");
  fs.writeFileSync(path.join(rootDir, "src", "assistant-memory.db-wal"), "user data\n");
  fs.writeFileSync(path.join(rootDir, "src", "ordinary.txt.rollback"), "interrupted replacement\n");
  fs.writeFileSync(path.join(rootDir, "src", "ordinary.txt.rollback-10-20-1"), "interrupted replacement\n");
  fs.writeFileSync(path.join(rootDir, "src", "debug.log"), "log\n");
  fs.writeFileSync(path.join(rootDir, "src", "cache.tsbuildinfo"), "generated\n");
  fs.writeFileSync(path.join(rootDir, "ui", ".env.local"), "API_KEY=secret\n");
  fs.mkdirSync(path.join(rootDir, "ui", "dist"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "ui", "dist", "bundle.js"), "generated\n");

  const outputPath = path.join(rootDir, "release", "source.zip");
  const result = buildSourceArchive(rootDir, outputPath);
  const firstArchive = fs.readFileSync(outputPath);
  buildSourceArchive(rootDir, outputPath);
  const archive = new AdmZip(outputPath);
  const entries = archive.getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.entryName);

  assert.equal(result.archivePrefix, "Dangorobo-1.2.3");
  assert.ok(entries.includes("Dangorobo-1.2.3/src/main/converted.ts"));
  assert.ok(entries.includes("Dangorobo-1.2.3/src/main/source.js"));
  assert.ok(entries.includes("Dangorobo-1.2.3/src/preload.ts"));
  assert.ok(entries.includes("Dangorobo-1.2.3/src/pet/renderer.ts"));
  assert.ok(!entries.includes("Dangorobo-1.2.3/src/main/converted.js"));
  assert.ok(!entries.includes("Dangorobo-1.2.3/src/preload.js"));
  assert.ok(!entries.includes("Dangorobo-1.2.3/src/pet/renderer.js"));
  assert.ok(!entries.some((entryName) => entryName.includes("assistant-keys.json")));
  assert.ok(!entries.some((entryName) => entryName.includes("settings-save-journal.json")));
  assert.ok(!entries.some((entryName) => entryName.includes("assistant-memory.db-wal")));
  assert.ok(!entries.some((entryName) => /\.rollback(?:-[^/]+)?$/.test(entryName)));
  assert.ok(!entries.some((entryName) => entryName.endsWith("debug.log")));
  assert.ok(!entries.some((entryName) => entryName.endsWith("cache.tsbuildinfo")));
  assert.ok(!entries.some((entryName) => entryName.includes(".env.local")));
  assert.ok(!entries.some((entryName) => entryName.includes("/dist/")));
  assert.equal(
    archive.readAsText("Dangorobo-1.2.3/src/main/source.js"),
    "source\n"
  );
  assert.deepEqual(fs.readFileSync(outputPath), firstArchive);
  assert.equal(fs.existsSync(outputPath + ".rollback"), false);
});

test("필수 구성 파일이나 디렉터리가 없으면 검증에 실패한다", (context) =>
{
  const rootDir = createFixture();
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  fs.rmSync(path.join(rootDir, "ui"), { recursive: true, force: true });
  assert.throws(
    () => listSourceFiles(rootDir),
    /ui/
  );
});

test("필수 루트 파일 symlink는 저장소 밖 내용을 가리켜도 소스 ZIP에 넣지 않는다", (context) =>
{
  const rootDir = createFixture();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-source-outside-file-"));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  context.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));

  const outsideFile = path.join(outsideDir, "outside-secret.txt");
  const linkedRootFile = path.join(rootDir, "README.md");
  const outputPath = path.join(rootDir, "release", "source.zip");
  fs.writeFileSync(outsideFile, "outside secret\n");
  fs.rmSync(linkedRootFile);
  if (!createSymlinkOrSkip(context, outsideFile, linkedRootFile, "file"))
  {
    return;
  }

  assert.throws(
    () => buildSourceArchive(rootDir, outputPath),
    /심볼릭 링크.*README\.md/
  );
  assert.equal(fs.existsSync(outputPath), false);
});

test("필수 루트 디렉터리 symlink는 저장소 밖 내용을 가리켜도 소스 ZIP에 넣지 않는다", (context) =>
{
  const rootDir = createFixture();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-source-outside-dir-"));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  context.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));

  const linkedDirectory = path.join(rootDir, "src");
  const outputPath = path.join(rootDir, "release", "source.zip");
  fs.writeFileSync(path.join(outsideDir, "outside-secret.txt"), "outside secret\n");
  fs.rmSync(linkedDirectory, { recursive: true, force: true });
  const symlinkType = process.platform === "win32" ? "junction" : "dir";
  if (!createSymlinkOrSkip(context, outsideDir, linkedDirectory, symlinkType))
  {
    return;
  }

  assert.throws(
    () => buildSourceArchive(rootDir, outputPath),
    /심볼릭 링크.*src/
  );
  assert.equal(fs.existsSync(outputPath), false);
});

test("새 ZIP 설치 rename이 실패하면 직전 ZIP을 원래 경로에 복원한다", (context) =>
{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-source-swap-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const destinationPath = path.join(directory, "source.zip");
  const stagedPath = path.join(directory, "source.zip.tmp");
  fs.writeFileSync(destinationPath, "previous archive");
  fs.writeFileSync(stagedPath, "new archive");

  const operations = {
    existsSync: fs.existsSync,
    rmSync: fs.rmSync,
    /** @param {string} sourcePath @param {string} targetPath */
    renameSync(sourcePath, targetPath)
    {
      if (sourcePath === stagedPath && targetPath === destinationPath)
      {
        throw new Error("새 ZIP 설치 실패");
      }
      fs.renameSync(sourcePath, targetPath);
    }
  };

  assert.throws(
    () => replaceFileWithRollback(stagedPath, destinationPath, operations),
    /직전 ZIP을 복원했습니다/
  );
  assert.equal(fs.readFileSync(destinationPath, "utf8"), "previous archive");
  assert.equal(fs.readFileSync(stagedPath, "utf8"), "new archive");
  assert.equal(fs.existsSync(destinationPath + ".rollback"), false);
});

test("새 ZIP 설치와 직전 ZIP 복원이 모두 실패하면 복구 위치와 두 오류를 전파한다", (context) =>
{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-source-swap-double-failure-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const destinationPath = path.join(directory, "source.zip");
  const stagedPath = path.join(directory, "source.zip.tmp");
  const rollbackPath = destinationPath + ".rollback";
  fs.writeFileSync(destinationPath, "previous archive");
  fs.writeFileSync(stagedPath, "new archive");

  const operations = {
    existsSync: fs.existsSync,
    rmSync: fs.rmSync,
    /** @param {string} sourcePath @param {string} targetPath */
    renameSync(sourcePath, targetPath)
    {
      if ((sourcePath === stagedPath || sourcePath === rollbackPath)
          && targetPath === destinationPath)
      {
        throw new Error(sourcePath === stagedPath ? "새 ZIP 설치 실패" : "직전 ZIP 복원 실패");
      }
      fs.renameSync(sourcePath, targetPath);
    }
  };

  assert.throws(
    () => replaceFileWithRollback(stagedPath, destinationPath, operations),
    (error) =>
    {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(error.message, /자동 복원이 모두 실패/);
      assert.match(error.message, new RegExp(rollbackPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    }
  );
  assert.equal(fs.existsSync(destinationPath), false);
  assert.equal(fs.readFileSync(rollbackPath, "utf8"), "previous archive");
  assert.equal(fs.readFileSync(stagedPath, "utf8"), "new archive");
});
