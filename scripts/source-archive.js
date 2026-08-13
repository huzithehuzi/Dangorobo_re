"use strict";

const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");

const SOURCE_DIRECTORIES = Object.freeze([
  ".github",
  "src",
  "assets",
  "docs",
  "ui",
  "types",
  "test",
  "scripts"
]);

const SOURCE_ROOT_FILES = Object.freeze([
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "README.md",
  "README.en.md",
  "README.ja.md",
  "THIRD_PARTY_NOTICES.md",
  "eslint.config.js",
  "package-lock.json",
  "package.json",
  "tsconfig.build.json",
  "tsconfig.json"
]);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".dangorobo-user-data",
  ".git",
  ".nyc_output",
  "coverage",
  "custom-body",
  "custom-face",
  "dist",
  "node_modules",
  "out",
  "release",
  "summaries",
  "user-data"
]);

const USER_STATE_FILE_NAMES = new Set([
  "assistant-episodes.json",
  "assistant-keys.json",
  "assistant-logs.json",
  "assistant-memory.db",
  "assistant-memory.json",
  "checklist.json",
  "favorites-panels.json",
  "pet-position.json",
  "pet-settings-backup.json",
  "pet-settings.json",
  "settings-save-journal.json"
]);

const EXCLUDED_FILE_NAMES = new Set([
  ".DS_Store",
  "Desktop.ini",
  "Thumbs.db",
  ...USER_STATE_FILE_NAMES
]);

/**
 * @typedef {{
 *   existsSync: (filePath: string) => boolean,
 *   renameSync: (oldPath: string, newPath: string) => void,
 *   rmSync: (filePath: string, options?: { force?: boolean }) => void
 * }} FileSwapOperations
 */

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function comparePaths(left, right)
{
  if (left < right)
  {
    return -1;
  }
  if (left > right)
  {
    return 1;
  }
  return 0;
}

/**
 * @param {string} relativePath
 * @returns {string}
 */
function normalizeRelativePath(relativePath)
{
  return relativePath.split(path.sep).join("/");
}

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
function isExcludedFile(relativePath)
{
  const normalizedPath = normalizeRelativePath(relativePath);
  const pathParts = normalizedPath.split("/");
  const fileName = pathParts[pathParts.length - 1];

  if (pathParts.slice(0, -1).some((part) => EXCLUDED_DIRECTORY_NAMES.has(part)))
  {
    return true;
  }
  if (EXCLUDED_FILE_NAMES.has(fileName))
  {
    return true;
  }
  for (const stateFileName of USER_STATE_FILE_NAMES)
  {
    if (fileName.startsWith(`${stateFileName}.`))
    {
      return true;
    }
  }
  if (/^\.env(?:\.|$)/i.test(fileName))
  {
    return true;
  }
  if (/^memories-.*\.json$/i.test(fileName))
  {
    return true;
  }
  if (/^assistant-memory\.db-/i.test(fileName))
  {
    return true;
  }
  if (/^(?:\.eslintcache|.*\.tsbuildinfo)$/i.test(fileName))
  {
    return true;
  }
  if (/\.rollback(?:-[^/]+)?$/i.test(fileName))
  {
    return true;
  }
  if (/\.(?:bak|corrupt-[^./]+|log|p12|pem|pfx|private-key|temp|tmp)$/i.test(fileName))
  {
    return true;
  }
  if (/^(?:id_ed25519|id_rsa)(?:\.pub)?$/i.test(fileName))
  {
    return true;
  }
  if (/^(?:npm|pnpm|yarn)-debug\.log/i.test(fileName))
  {
    return true;
  }
  return false;
}

/**
 * @param {string} rootDir
 * @param {string} relativeDirectory
 * @returns {string[]}
 */
function collectDirectoryFiles(rootDir, relativeDirectory)
{
  const absoluteDirectory = path.join(rootDir, relativeDirectory);
  const directoryStats = fs.lstatSync(absoluteDirectory);
  if (directoryStats.isSymbolicLink())
  {
    throw new Error(`소스 아카이브에는 심볼릭 링크를 넣을 수 없습니다: ${relativeDirectory}`);
  }
  if (!directoryStats.isDirectory())
  {
    throw new Error(`소스 디렉터리가 아닙니다: ${relativeDirectory}`);
  }

  const files = [];
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    .sort((left, right) => comparePaths(left.name, right.name));

  for (const entry of entries)
  {
    const relativePath = normalizeRelativePath(path.join(relativeDirectory, entry.name));
    if (entry.isSymbolicLink())
    {
      throw new Error(`소스 아카이브에는 심볼릭 링크를 넣을 수 없습니다: ${relativePath}`);
    }
    if (entry.isDirectory())
    {
      if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name))
      {
        files.push(...collectDirectoryFiles(rootDir, relativePath));
      }
      continue;
    }
    if (entry.isFile() && !isExcludedFile(relativePath))
    {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * @param {string[]} files
 * @returns {Set<string>}
 */
function findInPlaceEmitPaths(files)
{
  const emittedPaths = new Set();
  for (const relativePath of files)
  {
    if (!relativePath.startsWith("src/")
      || relativePath.startsWith("src/vendor/")
      || !relativePath.endsWith(".ts")
      || relativePath.endsWith(".d.ts"))
    {
      continue;
    }
    emittedPaths.add(`${relativePath.slice(0, -3)}.js`);
  }
  return emittedPaths;
}

/**
 * @param {string} rootDir
 * @returns {string[]}
 */
function listSourceFiles(rootDir)
{
  const resolvedRoot = path.resolve(rootDir);
  const files = [];

  for (const relativeFile of SOURCE_ROOT_FILES)
  {
    const absoluteFile = path.join(resolvedRoot, relativeFile);
    const fileStats = fs.lstatSync(absoluteFile);
    if (fileStats.isSymbolicLink())
    {
      throw new Error(`소스 아카이브에는 심볼릭 링크를 넣을 수 없습니다: ${relativeFile}`);
    }
    if (!fileStats.isFile())
    {
      throw new Error(`필수 소스 파일이 아닙니다: ${relativeFile}`);
    }
    files.push(relativeFile);
  }

  for (const relativeDirectory of SOURCE_DIRECTORIES)
  {
    const directoryFiles = collectDirectoryFiles(resolvedRoot, relativeDirectory);
    if (directoryFiles.length === 0)
    {
      throw new Error(`소스 디렉터리가 비어 있습니다: ${relativeDirectory}`);
    }
    files.push(...directoryFiles);
  }

  const emittedPaths = findInPlaceEmitPaths(files);
  return [...new Set(files)]
    .filter((relativePath) => !emittedPaths.has(relativePath))
    .sort(comparePaths);
}

/**
 * @param {string} rootDir
 * @returns {{ productName: string, version: string }}
 */
function readPackageMetadata(rootDir)
{
  const packagePath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const productName = packageJson.build?.productName || packageJson.name;
  const version = packageJson.version;

  if (typeof productName !== "string" || !/^[A-Za-z0-9._-]+$/.test(productName))
  {
    throw new Error("package.json의 productName이 안전한 파일 이름이 아닙니다.");
  }
  if (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(version))
  {
    throw new Error("package.json의 version이 안전한 파일 이름이 아닙니다.");
  }

  return { productName, version };
}

/**
 * @param {string} rootDir
 * @returns {{ productName: string, version: string, files: string[], totalBytes: number }}
 */
function verifySourceManifest(rootDir)
{
  const resolvedRoot = path.resolve(rootDir);
  const files = listSourceFiles(resolvedRoot);
  const metadata = readPackageMetadata(resolvedRoot);
  let totalBytes = 0;

  for (const relativePath of files)
  {
    if (isExcludedFile(relativePath))
    {
      throw new Error(`제외 대상이 소스 목록에 들어갔습니다: ${relativePath}`);
    }
    const fileStats = fs.lstatSync(path.join(resolvedRoot, relativePath));
    if (fileStats.isSymbolicLink() || !fileStats.isFile())
    {
      throw new Error(`검증 중 소스 파일 형식이 바뀌었습니다: ${relativePath}`);
    }
    totalBytes += fileStats.size;
  }

  return { ...metadata, files, totalBytes };
}

/**
 * @param {AdmZip} archive
 * @param {string[]} expectedEntries
 */
function verifyArchiveEntries(archive, expectedEntries)
{
  const actualEntries = archive.getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.entryName)
    .sort(comparePaths);
  const sortedExpected = [...expectedEntries].sort(comparePaths);

  if (actualEntries.length !== sortedExpected.length
    || actualEntries.some((entryName, index) => entryName !== sortedExpected[index]))
  {
    throw new Error("생성된 ZIP의 파일 목록이 검증한 소스 목록과 다릅니다.");
  }
}

/**
 * 검증을 마친 임시 파일을 최종 경로에 설치한다. 기존 파일은 같은 디렉터리의 rollback
 * 경로로 먼저 옮기며, 새 파일 설치가 실패하면 즉시 되돌린다.
 * @param {string} stagedPath
 * @param {string} destinationPath
 * @param {FileSwapOperations} [operations]
 */
function replaceFileWithRollback(stagedPath, destinationPath, operations = fs)
{
  const rollbackPath = `${destinationPath}.rollback`;

  if (operations.existsSync(rollbackPath))
  {
    if (!operations.existsSync(destinationPath))
    {
      try
      {
        operations.renameSync(rollbackPath, destinationPath);
      }
      catch (error)
      {
        throw new Error(
          `이전 소스 ZIP 교체를 복구하지 못했습니다. 직전 파일 위치: ${rollbackPath}`,
          { cause: error }
        );
      }
    }
    else
    {
      try
      {
        operations.rmSync(rollbackPath, { force: true });
      }
      catch (error)
      {
        throw new Error(`이전 소스 ZIP rollback 파일을 정리하지 못했습니다: ${rollbackPath}`, {
          cause: error
        });
      }
    }
  }

  if (!operations.existsSync(destinationPath))
  {
    operations.renameSync(stagedPath, destinationPath);
    return;
  }

  operations.renameSync(destinationPath, rollbackPath);
  try
  {
    operations.renameSync(stagedPath, destinationPath);
  }
  catch (installError)
  {
    try
    {
      operations.renameSync(rollbackPath, destinationPath);
    }
    catch (restoreError)
    {
      // 두 오류는 errors[]로 전파하고, 복원 실패가 직접 원인이므로 cause로도 잇는다.
      throw new AggregateError(
        [installError, restoreError],
        `새 소스 ZIP 설치와 직전 ZIP 자동 복원이 모두 실패했습니다. 직전 파일 위치: ${rollbackPath}`,
        { cause: restoreError }
      );
    }
    throw new Error("새 소스 ZIP을 설치하지 못해 직전 ZIP을 복원했습니다.", {
      cause: installError
    });
  }

  try
  {
    operations.rmSync(rollbackPath, { force: true });
  }
  catch (error)
  {
    throw new Error(`교체한 소스 ZIP의 rollback 파일을 정리하지 못했습니다: ${rollbackPath}`, {
      cause: error
    });
  }
}

/**
 * @param {string} rootDir
 * @param {string} outputPath
 */
function buildSourceArchive(rootDir, outputPath)
{
  const resolvedRoot = path.resolve(rootDir);
  const resolvedOutput = path.resolve(outputPath);
  const manifest = verifySourceManifest(resolvedRoot);
  const archivePrefix = `${manifest.productName}-${manifest.version}`;
  const archive = new AdmZip();
  const stableTimestamp = new Date(2000, 0, 1, 0, 0, 0);
  const expectedEntries = [];

  for (const relativePath of manifest.files)
  {
    const entryName = `${archivePrefix}/${relativePath}`;
    const absolutePath = path.join(resolvedRoot, relativePath);
    const fileStats = fs.lstatSync(absolutePath);
    if (fileStats.isSymbolicLink() || !fileStats.isFile())
    {
      throw new Error(`생성 중 소스 파일 형식이 바뀌었습니다: ${relativePath}`);
    }
    const data = fs.readFileSync(absolutePath);
    const entry = archive.addFile(entryName, data, "", 0o644);
    entry.header.time = stableTimestamp;
    expectedEntries.push(entryName);
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
    const writtenArchive = new AdmZip(temporaryPath);
    verifyArchiveEntries(writtenArchive, expectedEntries);
    replaceFileWithRollback(temporaryPath, resolvedOutput);
  }
  catch (error)
  {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }

  return {
    ...manifest,
    archivePrefix,
    outputPath: resolvedOutput
  };
}

/**
 * @param {string} rootDir
 * @returns {string}
 */
function defaultArchivePath(rootDir)
{
  const metadata = readPackageMetadata(rootDir);
  return path.join(
    rootDir,
    "release",
    `${metadata.productName}-${metadata.version}-Source.zip`
  );
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes)
{
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * @param {string[]} args
 */
function runCli(args)
{
  const rootDir = path.resolve(__dirname, "..");
  if (args.length > 1 || (args.length === 1 && args[0] !== "--verify"))
  {
    throw new Error("사용법: node scripts/source-archive.js [--verify]");
  }

  if (args[0] === "--verify")
  {
    const manifest = verifySourceManifest(rootDir);
    process.stdout.write(
      `소스 아카이브 구성 확인 완료: ${manifest.files.length}개 파일, ${formatBytes(manifest.totalBytes)}\n`
    );
    return;
  }

  const result = buildSourceArchive(rootDir, defaultArchivePath(rootDir));
  process.stdout.write(
    `소스 아카이브 생성 완료: ${result.outputPath} (${result.files.length}개 파일)\n`
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
  SOURCE_DIRECTORIES,
  SOURCE_ROOT_FILES,
  buildSourceArchive,
  defaultArchivePath,
  findInPlaceEmitPaths,
  isExcludedFile,
  listSourceFiles,
  replaceFileWithRollback,
  verifyArchiveEntries,
  verifySourceManifest
};
