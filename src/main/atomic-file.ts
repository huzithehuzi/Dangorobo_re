// 사용자 데이터 파일의 원자적 저장/복구 공용 헬퍼 (2026-08-10, P0-3).
// - 저장: 임시 파일에 먼저 쓰고 rename으로 교체해, 쓰다가 중단돼도 잘린 파일이 남지 않는다.
//   (memory-persistence.js에 있던 tmp+rename 패턴을 공용화한 것)
// - Windows 교체 폴백: 기존 파일을 rollback 슬롯에 보존하고 새 파일 설치 실패 시 되돌린다.
// - backup 옵션: 교체 직전 원본을 .bak으로 복사해 "마지막 정상본"을 항상 남긴다.
// - 로드: 본 파일이 깨졌으면 .corrupt-<시각>으로 격리해 증거를 보존하고 .bak에서 복구를 시도한다.
//   격리를 안 하면 다음 저장이 손상 원본을 덮어써서 복구 경로가 사라진다.
import * as fs from "node:fs";
import * as path from "node:path";

const WINDOWS_REPLACE_ERROR_CODES = new Set(["EACCES", "EBUSY", "EEXIST", "EPERM"]);
let rollbackPathSequence = 0;

type AtomicWriteFileSystem = Pick<
  typeof fs,
  "writeFileSync" | "existsSync" | "copyFileSync" | "renameSync" | "rmSync"
>;
type AtomicWriteDependencies = {
  fileSystem?: AtomicWriteFileSystem;
  platform?: NodeJS.Platform;
  createRollbackPath?: (filePath: string) => string;
};
type AtomicWriteOptions = { backup?: boolean };
type ReadJsonOptions = { validate?: (data: unknown) => boolean };
type ReadJsonResult =
  | { status: "ok"; data: unknown; recoveredFromBackup: boolean }
  | { status: "missing" | "corrupt" };
type InterruptedAtomicWriteRecoveryResult =
  | { status: "none" | "cleaned" | "promoted" }
  | { status: "restored"; rollbackPath: string };

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
}

function createRollbackPath(filePath: string) {
  rollbackPathSequence += 1;
  return `${filePath}.rollback-${process.pid}-${Date.now()}-${rollbackPathSequence}`;
}

/**
 * Windows가 기존 대상 위 rename을 거부한 경우에만 교체 슬롯 폴백을 사용한다.
 * 다른 플랫폼과 다른 오류는 원인이 다르므로 원본을 움직이지 않고 그대로 전파한다.
 */
function shouldUseWindowsReplaceFallback(error: unknown, platform: NodeJS.Platform) {
  return platform === "win32" && WINDOWS_REPLACE_ERROR_CODES.has(errorCode(error));
}

function removeTemporaryFile(fileSystem: AtomicWriteFileSystem, filePath: string) {
  try {
    fileSystem.rmSync(filePath, { force: true });
  } catch (error) {
    console.error(`[AtomicFile] 임시 파일 정리 실패: ${filePath}`, error);
  }
}

function interruptedRollbackPaths(filePath: string): string[] {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const stableName = `${baseName}.rollback`;
  const uniquePrefix = `${baseName}.rollback-`;
  let names: string[];
  try {
    names = fs.readdirSync(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  return names
    .filter(name => name === stableName || name.startsWith(uniquePrefix))
    .map(name => path.join(directory, name))
    .sort();
}

/**
 * Windows 교체 폴백 도중 프로세스가 종료되어 남은 temp/rollback 조합을 복구한다.
 * primary가 없을 때 rollback 후보가 여러 개면 어느 원본이 최신인지 추측하지 않는다.
 */
function recoverInterruptedAtomicWriteSync(
  filePath: string
): InterruptedAtomicWriteRecoveryResult {
  const tempPath = filePath + ".tmp";
  const primaryExists = fs.existsSync(filePath);
  const tempExists = fs.existsSync(tempPath);
  const rollbackPaths = interruptedRollbackPaths(filePath);

  if (primaryExists) {
    if (rollbackPaths.length > 1) {
      console.warn(
        `[AtomicFile] primary가 있어 오래된 rollback 후보 ${rollbackPaths.length}개를 정리한다: ${filePath}`
      );
    }
    for (const rollbackPath of rollbackPaths) {
      fs.rmSync(rollbackPath, { force: true });
    }
    if (tempExists) fs.rmSync(tempPath, { force: true });
    return {
      status: rollbackPaths.length > 0 || tempExists ? "cleaned" : "none"
    };
  }

  if (rollbackPaths.length > 1) {
    throw new Error(
      `[AtomicFile] 원본이 없고 rollback 후보가 여러 개라 자동 복구할 수 없다: ${rollbackPaths.join(", ")}`
    );
  }
  if (rollbackPaths.length === 1) {
    const rollbackPath = rollbackPaths[0];
    fs.renameSync(rollbackPath, filePath);
    if (tempExists) fs.rmSync(tempPath, { force: true });
    return { status: "restored", rollbackPath };
  }
  if (tempExists) {
    fs.renameSync(tempPath, filePath);
    return { status: "promoted" };
  }
  return { status: "none" };
}

/**
 * 데이터를 임시 파일에 쓴 뒤 rename으로 원자적으로 교체한다.
 */
function writeFileAtomicSync(
  filePath: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {},
  dependencies: AtomicWriteDependencies = {}
) {
  if (!dependencies.fileSystem) {
    recoverInterruptedAtomicWriteSync(filePath);
  }
  const fileSystem = dependencies.fileSystem || fs;
  const platform = dependencies.platform || process.platform;
  const rollbackPathFactory = dependencies.createRollbackPath || createRollbackPath;
  const tempPath = filePath + ".tmp";
  if (typeof data === "string") {
    fileSystem.writeFileSync(tempPath, data, "utf8");
  } else {
    fileSystem.writeFileSync(tempPath, data);
  }
  if (options.backup && fileSystem.existsSync(filePath)) {
    try {
      // rename이 아니라 copy를 쓴다 — 백업 후 교체 rename이 실패해도 본 파일이 그대로 남는다.
      fileSystem.copyFileSync(filePath, filePath + ".bak");
    } catch (error) {
      // 백업 실패(디스크 부족 등)가 저장 자체를 막으면 안 된다.
      console.error(`[AtomicFile] 백업 실패(저장은 계속): ${filePath}`, error);
    }
  }
  try {
    fileSystem.renameSync(tempPath, filePath);
    return;
  } catch (initialError) {
    if (!fileSystem.existsSync(filePath)
      || !shouldUseWindowsReplaceFallback(initialError, platform)) {
      throw initialError;
    }

    const rollbackPath = rollbackPathFactory(filePath);
    if (fileSystem.existsSync(rollbackPath)) {
      throw new Error(`[AtomicFile] 교체 슬롯이 이미 존재한다: ${rollbackPath}`, {
        cause: initialError
      });
    }
    try {
      fileSystem.renameSync(filePath, rollbackPath);
    } catch (moveError) {
      throw new AggregateError(
        [initialError, moveError],
        `[AtomicFile] 기존 파일을 안전한 교체 슬롯으로 옮기지 못했다: ${filePath}`
      );
    }

    try {
      fileSystem.renameSync(tempPath, filePath);
    } catch (installError) {
      try {
        fileSystem.renameSync(rollbackPath, filePath);
      } catch (restoreError) {
        throw new AggregateError(
          [initialError, installError, restoreError],
          `[AtomicFile] 새 파일 설치와 원본 복원에 모두 실패했다. 원본 후보: ${rollbackPath}`
        );
      }
      removeTemporaryFile(fileSystem, tempPath);
      throw new Error(
        `[AtomicFile] 새 파일 설치에 실패해 원본을 복원했다: ${filePath}`,
        { cause: installError }
      );
    }

    try {
      fileSystem.rmSync(rollbackPath, { force: true });
    } catch (cleanupError) {
      console.error(`[AtomicFile] 교체 전 원본 정리 실패: ${rollbackPath}`, cleanupError);
    }
  }
}

/**
 * 깨진 파일을 다음 저장이 덮어쓰지 못하도록 이름을 바꿔 보존한다.
 */
function quarantineCorruptFile(filePath: string): string | null {
  try {
    const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
    fs.renameSync(filePath, quarantinePath);
    return quarantinePath;
  } catch (error) {
    console.error(`[AtomicFile] 손상 파일 격리 실패: ${filePath}`, error);
    return null;
  }
}

/**
 * JSON 파일을 읽는다. 본 파일이 깨졌으면 격리한 뒤 .bak에서 복구를 시도한다.
 * "파일 없음"과 "파일 손상"을 구분해 돌려준다 — 손상인데 기본값으로 조용히
 * 되돌아가면 사용자는 데이터가 왜 사라졌는지 알 수 없다.
 */
function readJsonWithRecovery(
  filePath: string,
  options: ReadJsonOptions = {}
): ReadJsonResult {
  let interruptedRecoveryFailed = false;
  try {
    recoverInterruptedAtomicWriteSync(filePath);
  } catch (error) {
    console.error(`[AtomicFile] 중단된 저장 복구 실패: ${filePath}`, error);
    interruptedRecoveryFailed = true;
  }
  const parseCandidate = (candidatePath: string): unknown => {
    const data = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
    if (options.validate && !options.validate(data)) {
      throw new Error("JSON 데이터 구조가 올바르지 않다");
    }
    return data;
  };
  const backupPath = filePath + ".bak";
  const primaryExists = fs.existsSync(filePath);
  if (primaryExists) {
    try {
      const data = parseCandidate(filePath);
      return { status: "ok", data, recoveredFromBackup: false };
    } catch (error) {
      console.error(`[AtomicFile] 파일 손상 감지: ${filePath}`, error);
      quarantineCorruptFile(filePath);
    }
  }
  if (fs.existsSync(backupPath)) {
    try {
      const data = parseCandidate(backupPath);
      console.warn(`[AtomicFile] 백업에서 복구: ${backupPath}`);
      return { status: "ok", data, recoveredFromBackup: true };
    } catch (error) {
      console.error(`[AtomicFile] 백업도 손상됨: ${backupPath}`, error);
    }
  }
  return { status: primaryExists || interruptedRecoveryFailed ? "corrupt" : "missing" };
}

export {
  writeFileAtomicSync,
  recoverInterruptedAtomicWriteSync,
  quarantineCorruptFile,
  readJsonWithRecovery
};
export type {
  AtomicWriteDependencies,
  AtomicWriteFileSystem,
  AtomicWriteOptions,
  InterruptedAtomicWriteRecoveryResult,
  ReadJsonOptions,
  ReadJsonResult
};
