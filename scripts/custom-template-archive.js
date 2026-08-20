"use strict";

const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { replaceFileWithRollback, verifyArchiveEntries } = require("./source-archive.js");

// 배포용 커스텀 템플릿 ZIP의 구성. 얼굴 키 목록은 src/main/custom-face.ts의
// CUSTOM_FACE_EXPRESSION_KEYS와 같아야 하며, test/custom-template-archive.test.js가
// 두 목록이 어긋나면 실패한다(빌드 스크립트가 electron에 의존하지 않도록 값을 복제했다).
const TEMPLATE_DIRECTORY = "assets/custom-template";
const TEMPLATE_FACE_EXPRESSION_KEYS = Object.freeze([
  "normal",
  "normal_blink",
  "happy",
  "angry",
  "sad",
  "alarm",
  "shocked"
]);
const TEMPLATE_BODY_FILE_NAME = "custom_body_template.png";
const TEMPLATE_ARCHIVE_FILE_NAME = "custom_template.zip";

/**
 * ZIP 안에 들어가야 하는 파일 이름 목록. 커스텀 얼굴 가져오기는 폴더 구조를 무시하고
 * 파일명만 보므로 폴더 없이 평평하게 담는다.
 * @returns {string[]}
 */
function templateEntryNames()
{
  return [
    TEMPLATE_BODY_FILE_NAME,
    ...TEMPLATE_FACE_EXPRESSION_KEYS.map((key) => `customface_${key}.png`)
  ];
}

/**
 * @param {Buffer} data
 * @returns {boolean}
 */
function isPng(data)
{
  return data.length >= 8
    && data.readUInt32BE(0) === 0x89504e47
    && data.readUInt32BE(4) === 0x0d0a1a0a;
}

/**
 * 템플릿 원본 폴더가 기대한 파일만, 전부 PNG로 갖고 있는지 확인한다.
 * @param {string} rootDir
 * @returns {{ directory: string, files: string[], totalBytes: number }}
 */
function verifyTemplateManifest(rootDir)
{
  const resolvedRoot = path.resolve(rootDir);
  const absoluteDirectory = path.join(resolvedRoot, TEMPLATE_DIRECTORY);
  const expectedNames = templateEntryNames();
  let totalBytes = 0;

  const directoryStats = fs.lstatSync(absoluteDirectory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory())
  {
    throw new Error(`템플릿 원본 디렉터리가 아닙니다: ${TEMPLATE_DIRECTORY}`);
  }

  const actualNames = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    .map((entry) =>
    {
      if (!entry.isFile())
      {
        throw new Error(`템플릿 원본에는 파일만 둘 수 있습니다: ${TEMPLATE_DIRECTORY}/${entry.name}`);
      }
      return entry.name;
    })
    .sort();
  const sortedExpected = [...expectedNames].sort();

  if (actualNames.length !== sortedExpected.length
    || actualNames.some((name, index) => name !== sortedExpected[index]))
  {
    throw new Error(
      `템플릿 원본 파일 목록이 다릅니다. 기대: ${sortedExpected.join(", ")} / 실제: ${actualNames.join(", ")}`
    );
  }

  for (const name of sortedExpected)
  {
    const data = fs.readFileSync(path.join(absoluteDirectory, name));
    if (!isPng(data))
    {
      throw new Error(`템플릿 원본이 PNG가 아닙니다: ${TEMPLATE_DIRECTORY}/${name}`);
    }
    totalBytes += data.length;
  }

  return { directory: TEMPLATE_DIRECTORY, files: expectedNames, totalBytes };
}

/**
 * @param {string} rootDir
 * @param {string} outputPath
 */
function buildTemplateArchive(rootDir, outputPath)
{
  const resolvedRoot = path.resolve(rootDir);
  const resolvedOutput = path.resolve(outputPath);
  const manifest = verifyTemplateManifest(resolvedRoot);
  const archive = new AdmZip();
  const stableTimestamp = new Date(2000, 0, 1, 0, 0, 0);

  for (const name of manifest.files)
  {
    const data = fs.readFileSync(path.join(resolvedRoot, TEMPLATE_DIRECTORY, name));
    const entry = archive.addFile(name, data, "", 0o644);
    entry.header.time = stableTimestamp;
  }

  const outputDirectory = path.dirname(resolvedOutput);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(resolvedOutput)}.${process.pid}.tmp`
  );

  try
  {
    archive.writeZip(temporaryPath);
    verifyArchiveEntries(new AdmZip(temporaryPath), manifest.files);
    replaceFileWithRollback(temporaryPath, resolvedOutput);
  }
  catch (error)
  {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }

  return { ...manifest, outputPath: resolvedOutput };
}

/**
 * @param {string} rootDir
 * @returns {string}
 */
function defaultArchivePath(rootDir)
{
  return path.join(rootDir, "release", TEMPLATE_ARCHIVE_FILE_NAME);
}

/**
 * @param {string[]} args
 */
function runCli(args)
{
  const rootDir = path.resolve(__dirname, "..");
  if (args.length > 1 || (args.length === 1 && args[0] !== "--verify"))
  {
    throw new Error("사용법: node scripts/custom-template-archive.js [--verify]");
  }

  if (args[0] === "--verify")
  {
    const manifest = verifyTemplateManifest(rootDir);
    process.stdout.write(
      `커스텀 템플릿 구성 확인 완료: ${manifest.files.length}개 파일, ${manifest.totalBytes} bytes\n`
    );
    return;
  }

  const result = buildTemplateArchive(rootDir, defaultArchivePath(rootDir));
  process.stdout.write(
    `커스텀 템플릿 ZIP 생성 완료: ${result.outputPath} (${result.files.length}개 파일)\n`
  );
}

if (require.main === module)
{
  try
  {
    runCli(process.argv.slice(2));
  }
  catch (error)
  {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  TEMPLATE_ARCHIVE_FILE_NAME,
  TEMPLATE_BODY_FILE_NAME,
  TEMPLATE_DIRECTORY,
  TEMPLATE_FACE_EXPRESSION_KEYS,
  buildTemplateArchive,
  defaultArchivePath,
  templateEntryNames,
  verifyTemplateManifest
};
