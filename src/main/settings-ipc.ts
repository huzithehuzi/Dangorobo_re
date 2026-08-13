import type { IpcMain } from "electron";
import {
  assistantShortcutLabel,
  checklistShortcutLabel,
  documentSummaryShortcutLabel,
  favoritesShortcutLabel,
  imageResizeShortcutLabel,
  translateShortcutLabel
} from "./settings-schema.js";
import { sanitizeSettingsImportPayload } from "./settings-save-transaction.js";
import type { SettingsSaveTransactionResult } from "./settings-save-transaction.js";
import type { Settings } from "./settings-schema.js";

type SettingsIpcEvent = { sender: unknown };
type TransactionResult = SettingsSaveTransactionResult<Settings>;
type TransactionFailure = Extract<TransactionResult, { ok: false }>;
type TransactionSuccess = Extract<TransactionResult, { ok: true }>;
/** 저장이 끝난 뒤 설정창에 돌려주고 다른 창에도 뿌리는 응답. */
type AppliedSettingsResponse = { ok: true } & Record<string, unknown>;

type DialogFilter = { name: string; extensions: string[] };
type SaveDialogResult = { canceled: boolean; filePath?: string };
type OpenDialogResult = { canceled: boolean; filePaths: string[] };

type SettingsIpcDependencies = {
  getSettings: () => Settings;
  translate: (language: string, key: string, vars?: Record<string, string | number>) => string;
  describeError: (error: unknown) => string;
  isSettingsSender: (sender: unknown) => boolean;
  showSaveDialog: (options: { title: string; defaultPath: string; filters: DialogFilter[] }) => Promise<SaveDialogResult>;
  showOpenDialog: (options: { title: string; properties: string[]; filters: DialogFilter[] }) => Promise<OpenDialogResult>;
  writeTextFile: (filePath: string, text: string) => void;
  readTextFile: (filePath: string) => string;
  /**
   * 저널 생성·전역 단축키 적용·정규화 폴백을 묶어 트랜잭션을 실행한다. 두 경로의 차이는
   * mode 하나다 — 백업 가져오기는 API 키를 바꾸지 못하고, 정규화 폴백도 다르다.
   */
  runSaveTransaction: (payload: unknown, mode: "save" | "import") => TransactionResult;
  /** 성공한 트랜잭션을 실행 중인 앱에 반영하고 모든 창에 뿌린 뒤 응답을 만든다. */
  applySavedSettings: (transaction: TransactionSuccess, mode: "save" | "import") => AppliedSettingsResponse;
};

/** 실패한 단축키의 사용자용 라벨. 어느 기능인지 알려주지 않으면 고칠 수가 없다. */
function managedShortcutLabel(shortcutId: string, targetSettings: Settings): string {
  if (shortcutId === "assistant") return assistantShortcutLabel(targetSettings.assistantShortcut);
  if (shortcutId === "favorites") return favoritesShortcutLabel(targetSettings.favoritesShortcut);
  if (shortcutId === "imageResize") return imageResizeShortcutLabel(targetSettings.imageResizeShortcut);
  if (shortcutId === "checklist") return checklistShortcutLabel(targetSettings.checklistShortcut);
  if (shortcutId === "translate") return translateShortcutLabel(targetSettings.translateShortcut);
  return documentSummaryShortcutLabel(targetSettings.documentSummaryShortcut);
}

/**
 * 실패한 트랜잭션을 설정창 응답으로 바꾼다. 롤백까지 실패했으면 recoveryIncomplete를
 * 붙여 설정창이 "되돌리지도 못했다"는 걸 사용자에게 알릴 수 있게 한다.
 */
function settingsTransactionFailureResponse(
  transaction: TransactionFailure,
  deps: Pick<SettingsIpcDependencies, "translate" | "describeError">,
  logRollbackFailures: (failures: TransactionFailure["rollbackFailures"]) => void
) {
  const recoveryIncomplete = transaction.rollbackFailures.length > 0;
  if (recoveryIncomplete) logRollbackFailures(transaction.rollbackFailures);
  const response = (error: string) => ({
    ok: false as const,
    error,
    ...(recoveryIncomplete ? { recoveryIncomplete: true } : {})
  });
  if (transaction.reason === "shortcutConflict") {
    return response(transaction.error);
  }
  if (transaction.reason === "shortcutOccupied") {
    const failedShortcut = managedShortcutLabel(transaction.failedShortcut, transaction.settings);
    return response(deps.translate(transaction.settings.language, "shortcuts.occupiedError", { shortcut: failedShortcut }));
  }
  return response(String(deps.describeError(transaction.error) || transaction.error));
}

/**
 * 설정 저장·백업 내보내기·백업 가져오기 IPC.
 *
 * 세 채널 모두 설정창 sender만 받는다. 저장과 가져오기는 같은 트랜잭션을 거쳐 실패 시
 * 암호화 키·설정·전역 단축키를 이전 상태로 되돌린다 — 이 모듈은 그 결과를 응답으로 바꾸는
 * 일만 하고, 트랜잭션 조립과 실행 중인 앱에 반영하는 일은 main.js가 콜백으로 넘긴다.
 */
function registerSettingsIpcHandlers(
  ipcMain: Pick<IpcMain, "handle" | "on">,
  deps: SettingsIpcDependencies,
  logRollbackFailures: (failures: TransactionFailure["rollbackFailures"]) => void
) {
  const rejectedResponse = () => ({
    ok: false as const,
    error: deps.translate(deps.getSettings().language, "customization.settingsWindowNotFoundError")
  });

  ipcMain.handle("settings:export-all", async (event: SettingsIpcEvent) => {
    if (!deps.isSettingsSender(event.sender)) return rejectedResponse();
    const settings = deps.getSettings();
    const result = await deps.showSaveDialog({
      title: deps.translate(settings.language, "settingsBackup.exportTitle"),
      defaultPath: "pet-settings-backup.json",
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      // API 키는 settings에 없다(별도 파일에 safeStorage로 암호화 저장). 평문 JSON으로
      // 비밀값을 내보내지 않으려고 의도적으로 뺀 구조라, 여기서 따로 지울 것도 없다.
      deps.writeTextFile(result.filePath, JSON.stringify(settings, null, 2));
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: deps.describeError(error) || deps.translate(settings.language, "customization.saveFailedError")
      };
    }
  });

  ipcMain.handle("settings:import-all", async (event: SettingsIpcEvent) => {
    if (!deps.isSettingsSender(event.sender)) return rejectedResponse();
    const { language } = deps.getSettings();
    const result = await deps.showOpenDialog({
      title: deps.translate(language, "settingsBackup.importTitle"),
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    let importPayload: ReturnType<typeof sanitizeSettingsImportPayload>;
    try {
      importPayload = sanitizeSettingsImportPayload(JSON.parse(deps.readTextFile(result.filePaths[0])));
    } catch {
      return { ok: false, error: deps.translate(language, "settingsBackup.invalidFileError") };
    }
    if (!importPayload) {
      return { ok: false, error: deps.translate(language, "settingsBackup.invalidFileError") };
    }
    const transaction = deps.runSaveTransaction(importPayload, "import");
    if (!transaction.ok) {
      return settingsTransactionFailureResponse(transaction, deps, logRollbackFailures);
    }
    return deps.applySavedSettings(transaction, "import");
  });

  ipcMain.handle("settings:save", (event: SettingsIpcEvent, nextSettings: unknown) => {
    if (!deps.isSettingsSender(event.sender)) return rejectedResponse();
    const transaction = deps.runSaveTransaction(nextSettings, "save");
    if (!transaction.ok) {
      return settingsTransactionFailureResponse(transaction, deps, logRollbackFailures);
    }
    return deps.applySavedSettings(transaction, "save");
  });
}

export { registerSettingsIpcHandlers, managedShortcutLabel, settingsTransactionFailureResponse };
export type { SettingsIpcDependencies, SettingsIpcEvent };
