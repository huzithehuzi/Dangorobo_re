const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");

// custom-face.js는 electron의 app.getPath에 의존하므로 require 전에 mock을 끼운다.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-template-"));
const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getPath: () => userDataDir } }
});

const { CUSTOM_FACE_EXPRESSION_KEYS, importCustomFaceZip, customFacePngPath } =
  require("../src/main/custom-face.js");
const {
  TEMPLATE_BODY_FILE_NAME,
  TEMPLATE_DIRECTORY,
  TEMPLATE_FACE_EXPRESSION_KEYS,
  buildTemplateArchive,
  templateEntryNames,
  verifyTemplateManifest
} = require("../scripts/custom-template-archive.js");

const rootDir = path.resolve(__dirname, "..");

test("템플릿 얼굴 키 목록이 custom-face.ts의 표정 키와 같다", () =>
{
  assert.deepEqual([...TEMPLATE_FACE_EXPRESSION_KEYS], [...CUSTOM_FACE_EXPRESSION_KEYS]);
});

test("템플릿 원본 폴더가 기대한 PNG만 갖고 있다", () =>
{
  const manifest = verifyTemplateManifest(rootDir);
  assert.deepEqual([...manifest.files].sort(), [...templateEntryNames()].sort());
  assert.ok(manifest.totalBytes > 0);
});

test("템플릿 원본에 파일이 하나라도 빠지면 검증이 실패한다", (t) =>
{
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-template-staging-"));
  t.after(() => fs.rmSync(stagingRoot, { recursive: true, force: true }));
  const stagingDirectory = path.join(stagingRoot, TEMPLATE_DIRECTORY);
  fs.mkdirSync(stagingDirectory, { recursive: true });

  const names = templateEntryNames();
  for (const name of names.slice(1))
  {
    fs.copyFileSync(path.join(rootDir, TEMPLATE_DIRECTORY, name), path.join(stagingDirectory, name));
  }

  assert.throws(() => verifyTemplateManifest(stagingRoot), /템플릿 원본 파일 목록이 다릅니다/);
});

test("생성한 ZIP은 폴더 없이 평평하고 커스텀 얼굴 가져오기가 표정 전부를 받아들인다", (t) =>
{
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-template-out-"));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  const outputPath = path.join(outputDirectory, "custom_template.zip");

  buildTemplateArchive(rootDir, outputPath);

  const entryNames = new AdmZip(outputPath).getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.entryName)
    .sort();
  assert.deepEqual(entryNames, [...templateEntryNames()].sort());
  assert.ok(entryNames.includes(TEMPLATE_BODY_FILE_NAME));

  const imported = importCustomFaceZip(outputPath);
  assert.equal(imported.ok, true);
  assert.deepEqual(
    [...(imported.ok ? imported.keys : [])].sort(),
    [...CUSTOM_FACE_EXPRESSION_KEYS].sort()
  );
  for (const key of CUSTOM_FACE_EXPRESSION_KEYS)
  {
    assert.ok(fs.existsSync(customFacePngPath(key)));
  }
});
