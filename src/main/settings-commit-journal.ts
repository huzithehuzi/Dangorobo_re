import * as crypto from "node:crypto";
import * as fs from "node:fs";
import {
  quarantineCorruptFile,
  recoverInterruptedAtomicWriteSync,
  writeFileAtomicSync
} from "./atomic-file.js";

const SETTINGS_COMMIT_JOURNAL_VERSION = 1;
const MAX_KEY_FILE_BYTES = 16 * 1024;
const MAX_ENCODED_KEY_FILE_LENGTH = Math.ceil(MAX_KEY_FILE_BYTES / 3) * 4;

type SettingsCommitPaths = {
  journalPath: string;
  settingsPath: string;
  assistantKeysPath: string;
};

type SettingsCommitJournal = {
  version: 1;
  phase: "commit" | "rollback";
  targetSettingsSha256: string;
  previousAssistantKeysFile: string | null;
  targetAssistantKeysFile: string;
};

type SettingsCommitRecoveryResult =
  | { status: "none" | "corrupt" }
  | { status: "completed" | "rolledBack" };

function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function encodeFile(data: Buffer): string {
  if (data.length > MAX_KEY_FILE_BYTES) {
    throw new Error("암호화 키 파일이 설정 저장 저널 제한을 초과했다.");
  }
  return data.toString("base64");
}

function decodeFile(data: string): Buffer {
  const decoded = Buffer.from(data, "base64");
  if (decoded.length > MAX_KEY_FILE_BYTES || decoded.toString("base64") !== data) {
    throw new Error("설정 저장 저널의 암호화 키 파일이 올바르지 않다.");
  }
  return decoded;
}

function isSettingsCommitJournal(value: unknown): value is SettingsCommitJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SettingsCommitJournal>;
  return candidate.version === SETTINGS_COMMIT_JOURNAL_VERSION
    && (candidate.phase === "commit" || candidate.phase === "rollback")
    && typeof candidate.targetSettingsSha256 === "string"
    && /^[0-9a-f]{64}$/.test(candidate.targetSettingsSha256)
    && (candidate.previousAssistantKeysFile === null
      || (typeof candidate.previousAssistantKeysFile === "string"
        && candidate.previousAssistantKeysFile.length <= MAX_ENCODED_KEY_FILE_LENGTH))
    && typeof candidate.targetAssistantKeysFile === "string"
    && candidate.targetAssistantKeysFile.length <= MAX_ENCODED_KEY_FILE_LENGTH;
}

function readJournal(journalPath: string): SettingsCommitJournal {
  const value: unknown = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  if (!isSettingsCommitJournal(value)) {
    throw new Error("설정 저장 저널 구조가 올바르지 않다.");
  }
  if (value.previousAssistantKeysFile !== null) {
    decodeFile(value.previousAssistantKeysFile);
  }
  decodeFile(value.targetAssistantKeysFile);
  return value;
}

function writeJournal(journalPath: string, journal: SettingsCommitJournal): void {
  writeFileAtomicSync(journalPath, JSON.stringify(journal, null, 2));
}

function prepareSettingsCommit(
  paths: SettingsCommitPaths,
  targetSettingsContents: string,
  targetAssistantKeysContents: string
): void {
  if (fs.existsSync(paths.journalPath)) {
    throw new Error("완료되지 않은 설정 저장 저널이 남아 있다.");
  }
  const previousAssistantKeysFile = fs.existsSync(paths.assistantKeysPath)
    ? encodeFile(fs.readFileSync(paths.assistantKeysPath))
    : null;
  const journal: SettingsCommitJournal = {
    version: SETTINGS_COMMIT_JOURNAL_VERSION,
    phase: "commit",
    targetSettingsSha256: sha256(targetSettingsContents),
    previousAssistantKeysFile,
    targetAssistantKeysFile: encodeFile(Buffer.from(targetAssistantKeysContents, "utf8"))
  };
  writeJournal(paths.journalPath, journal);
}

function markSettingsCommitRollback(paths: SettingsCommitPaths): void {
  const journal = readJournal(paths.journalPath);
  writeJournal(paths.journalPath, { ...journal, phase: "rollback" });
}

function finishSettingsCommit(paths: SettingsCommitPaths): void {
  fs.rmSync(paths.journalPath, { force: true });
}

function settingsFileMatchesTarget(
  paths: SettingsCommitPaths,
  journal: SettingsCommitJournal
): boolean {
  if (!fs.existsSync(paths.settingsPath)) return false;
  return sha256(fs.readFileSync(paths.settingsPath)) === journal.targetSettingsSha256;
}

function restoreAssistantKeysFile(filePath: string, encoded: string | null): void {
  if (encoded === null) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  writeFileAtomicSync(filePath, decodeFile(encoded));
}

function recoverPendingSettingsCommit(
  paths: SettingsCommitPaths
): SettingsCommitRecoveryResult {
  recoverInterruptedAtomicWriteSync(paths.journalPath);
  recoverInterruptedAtomicWriteSync(paths.settingsPath);
  recoverInterruptedAtomicWriteSync(paths.assistantKeysPath);
  if (!fs.existsSync(paths.journalPath)) return { status: "none" };

  let journal: SettingsCommitJournal;
  try {
    journal = readJournal(paths.journalPath);
  } catch (error) {
    console.error("[Settings] 설정 저장 저널 손상 감지:", error);
    quarantineCorruptFile(paths.journalPath);
    return { status: "corrupt" };
  }

  const shouldComplete = journal.phase === "commit"
    && settingsFileMatchesTarget(paths, journal);
  restoreAssistantKeysFile(
    paths.assistantKeysPath,
    shouldComplete
      ? journal.targetAssistantKeysFile
      : journal.previousAssistantKeysFile
  );
  finishSettingsCommit(paths);
  return { status: shouldComplete ? "completed" : "rolledBack" };
}

function settlePendingSettingsCommit(
  paths: SettingsCommitPaths
): SettingsCommitRecoveryResult {
  const result = recoverPendingSettingsCommit(paths);
  if (result.status === "corrupt") {
    throw new Error("손상된 설정 저장 저널을 격리했다. 새 저장을 시작할 수 없다.");
  }
  return result;
}

export {
  SETTINGS_COMMIT_JOURNAL_VERSION,
  finishSettingsCommit,
  markSettingsCommitRollback,
  prepareSettingsCommit,
  recoverPendingSettingsCommit,
  settlePendingSettingsCommit,
  sha256
};
export type {
  SettingsCommitJournal,
  SettingsCommitPaths,
  SettingsCommitRecoveryResult
};
