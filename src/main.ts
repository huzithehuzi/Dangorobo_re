import "./main/legacy-user-data.js";

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  screen,
  safeStorage,
  shell
} from "electron";
import type { OpenDialogOptions, WebContents } from "electron";
import { uIOhook } from "uiohook-napi";
import {
  DEFAULT_SETTINGS,
  normalizeBodyColors,
  getDefaultCustomizationPresets,
  normalizeAlarmSoundFilePath,
  migrateLegacySettings,
  normalizeSettings
} from "./main/settings-schema.js";
import type { Settings } from "./main/settings-schema.js";
import { getPowershellExePath, listInstalledFonts } from "./main/fonts.js";
import {
  buildAssistantLogEntry,
  buildPetChatLogEntry
} from "./main/assistant/assistant-logs.js";
import { registerAssistantLogsIpcHandlers } from "./main/assistant/assistant-logs-ipc.js";
import {
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_WINDOW_WIDTH,
  CHECKLIST_WINDOW_HEIGHT,
  normalizeChecklistItem,
  loadChecklist as loadChecklistFromDisk,
  saveChecklist as saveChecklistToDisk
} from "./main/windows/checklist.js";
import type { ChecklistState } from "./main/windows/checklist.js";
import { registerChecklistIpcHandlers } from "./main/windows/checklist-ipc.js";
import {
  readCustomFaceTextures,
  importCustomFaceZip
} from "./main/custom-face.js";
import {
  readCustomBodyTexture,
  importCustomBodyImage
} from "./main/custom-body.js";
import { resizeClipboardImage } from "./main/image-resize.js";
import { createAlarmScheduler } from "./main/alarm-scheduler.js";
import { createWeatherService } from "./main/weather-service.js";
import { createAutoUpdateService } from "./main/auto-update-service.js";
import { createMediaMonitor } from "./main/media-monitor.js";
import type { MediaUpdate } from "./main/media-monitor.js";
import { createCapsLockStateReader } from "./main/caps-lock-state.js";
import { createDndMonitor } from "./main/dnd-monitor.js";
import { createDndVisibility } from "./main/windows/dnd-visibility.js";
import { createPetPositionController } from "./main/windows/pet-position-controller.js";
import { createPetInteractionMode } from "./main/windows/pet-interaction-mode.js";
import { createAssistantHistory } from "./main/assistant/assistant-history.js";
import { createSettingsPreview } from "./main/windows/settings-preview.js";
import { createGlobalShortcutManager, shortcutConflictError } from "./main/global-shortcut-manager.js";
import {
  executeSettingsSaveTransaction
} from "./main/settings-save-transaction.js";
import type { SettingsSaveTransactionResult } from "./main/settings-save-transaction.js";
import {
  finishSettingsCommit,
  markSettingsCommitRollback,
  prepareSettingsCommit,
  recoverPendingSettingsCommit,
  settlePendingSettingsCommit
} from "./main/settings-commit-journal.js";
import { createFavoriteIconService } from "./main/windows/favorite-icon-service.js";
import type { PetMenuActions } from "./main/windows/pet-menu-model.js";
import {
  loadFavoritesPanels as loadFavoritesPanelsFromDisk,
  saveFavoritesPanels as saveFavoritesPanelsToDisk
} from "./main/windows/favorites-panels.js";
import type { FavoritesPanelsState } from "./main/windows/favorites-panels.js";
import {
  appendConversationTurnToHistory,
  appendEpisodeMemory,
  MAX_CONVERSATION_HISTORY_TURNS,
  generateEpisodeSummaryPrompt
} from "./main/memory/memory-persistence.js";
import type { EpisodeSummary } from "./main/memory/memory-persistence.js";
import {
  initializeDatabase as initializeMemoryDb,
  closeDatabase as closeMemoryDb,
  getMemoryCount,
  getAllMemories,
  getMemoriesByCategory,
  getOpenLoops,
  deleteMemory,
  setMemoryVerified,
  archiveAllMemories,
  closeOpenLoop,
  forgetOpenLoop,
  forgetMemory,
  getForgottenMemories,
  getForgottenMemoryCount,
  restoreForgottenMemory,
  insertMemory,
  insertOpenLoop,
  insertEpisode,
  getEpisodesCount,
  getOpenLoopsCount,
  archiveStaleOpenLoops
} from "./main/memory/memory-sqlite.js";
import { registerMemoryIpcHandlers } from "./main/memory/memory-ipc.js";
import {
  findRelatedMemories,
  buildMemoryContextBlock,
  buildOpenLoopsContextBlock,
  selectFreshOpenLoops,
  selectPromptOpenLoops
} from "./main/memory/memory-search.js";
import { validateExtractedMemory, detectForgetSignals } from "./main/memory/memory-extraction.js";
import { createMemoryExtractionRunner } from "./main/memory/memory-extraction-runner.js";
import { createPetChatService } from "./main/assistant/pet-chat-service.js";
import { createEpisodeSummaryRunner } from "./main/assistant/episode-summary-runner.js";
import { createAlarmQueue } from "./main/alarm-queue.js";
import type { RestAlert } from "./main/alarm-queue.js";
import { createGeminiTransport } from "./main/assistant/gemini-transport.js";
import { createAskGemini } from "./main/assistant/ask-gemini.js";
import type { AskGeminiOptions } from "./main/assistant/ask-gemini.js";
import { createTranslateWithGemini } from "./main/assistant/translate.js";
import {
  writeFileAtomicSync,
  readJsonWithRecovery
} from "./main/atomic-file.js";
import { summaryHtmlDocument, createSummarizeDocument } from "./main/assistant/document-summary.js";
import {
  buildAssistantInstructions,
  rememberedAssistantQuestion,
  rememberedAssistantAnswer,
  buildAssistantHistoryBlock,
  buildRecentEpisodeSummaryBlock,
  buildOneOffHistoryBlock,
  parseEpisodeSummaryResponse as parseEpisodeSummaryResponseCore,
  errorMessage,
  mapAssistantErrorMessage
} from "./main/assistant/assistant-core.js";
import { findStaleTsArtifacts } from "./main/dev-build-guard.js";
import {
  WINDOW_WIDTH,
  SCREEN_MARGIN,
} from "./main/windows/pet-window-layout.js";
import { currentDateTimeContext } from "./main/assistant/date-time-context.js";
import { runQaCaptureHarness } from "./main/qa-capture.js";
import type { QaCaptureContext } from "./main/qa-capture.js";
import { registerAppearanceIpcHandlers } from "./main/appearance-ipc.js";
import {
  activatePresetAssets,
  capturePresetAssets,
  deletePresetAssets,
  exportPresetSet,
  importPresetSet,
  readPresetFaceTextureDataUrl,
  seedLegacyPresetAssets
} from "./main/custom-preset-assets.js";
import { registerFavoritesIpcHandlers } from "./main/windows/favorites-ipc.js";
import { registerAssistantIpcHandlers } from "./main/assistant/assistant-ipc.js";
import { registerSettingsIpcHandlers } from "./main/settings-ipc.js";
import { registerPetShellIpcHandlers } from "./main/windows/pet-shell-ipc.js";
import {
  buildPetWindow,
  buildSettingsWindow,
  buildAssistantLogWindow,
  buildChecklistWindow
} from "./main/windows/window-factory.js";
import { createFavoritesWindowController } from "./main/windows/favorites-windows.js";
import { createPetPointer } from "./main/windows/pet-pointer.js";
import { createInputMonitor } from "./main/input-monitor.js";
import { createPetBubblePanels } from "./main/windows/pet-bubble-panels.js";
import { createPetMenuController } from "./main/windows/pet-menu-controller.js";
import { hideSurfacesForQuit } from "./main/windows/quit-surfaces.js";

type I18nModule = {
  t: (language: string, key: string, vars?: Record<string, string | number>) => string;
  detectDefaultLanguage: (locale: string) => string;
};

type Timer = ReturnType<typeof setTimeout> | undefined;
type Point = { x: number; y: number };
type MediaPlayerRect = { left: number; top: number; width: number; height: number };
type PublicSettings = Settings & { assistantKeyConfigured: boolean };
type LegacyEventSource<TEvent = unknown, TDetail = unknown> = {
  on: (eventName: string, listener: (event: TEvent, detail: TDetail) => void) => unknown;
};
type AssistantInstructionOptions = Pick<AskGeminiOptions, "includeDateTime">;
type AssistantHistoryOptions = { maxTurns?: number; totalBudget?: number };

const { t, detectDefaultLanguage } = require("./shared/i18n.js") as I18nModule;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// TS 전환 파일의 빌드가 소스보다 낡았으면 옛 코드가 조용히 실행된다 — prestart를 타지 않는
// `npx electron .`(QA 캡처)이 정확히 그 함정이라 개발 실행에서만 여기서 즉시 멈춘다.
if (!app.isPackaged) {
  const staleTsSources = findStaleTsArtifacts(__dirname);
  if (staleTsSources.length > 0) {
    const message = `TS 소스가 빌드 산출물보다 새로워 실행을 중단합니다. \`npm run build:runtime\`을 먼저 실행하세요:\n${staleTsSources.join("\n")}`;
    console.error(message);
    dialog.showErrorBox("Dangorobo — 빌드가 낡음", message);
    app.exit(1);
  }
}

// 펫 주변 커스터마이징 모드(2026-08-06): 펫 좌우에 파츠 색상 라벨을 띄우려면 기본 300px
// 창으로는 폭이 모자란다(펫 시각 반폭이 122*scale이라 좌우 여백이 몇십 px밖에 안 남는다).
// 그래서 이 모드에서만 창을 **좌우 대칭으로** 넓힌다.
//
// 핵심 규칙: `petPosition.current()`을 비롯한 모든 "논리 위치"는 언제나 300px 창 기준의 좌상단
// 좌표다. 넓어진 폭은 petPosition.setBounds()가 x를 petWindowXInset()만큼 왼쪽으로 당겨서 흡수하므로
// 펫 자체의 화면상 위치는 모드를 켜고 꺼도 1px도 움직이지 않는다. 반대로 창의 실제 x를
// 읽어오는 곳(getPosition/getBounds)에서는 inset을 다시 더해 논리 위치로 되돌려야 한다.
const CUSTOMIZE_WINDOW_WIDTH = 680;
let customizeActive = false;
function petWindowWidth(): number {
  return customizeActive ? CUSTOMIZE_WINDOW_WIDTH : WINDOW_WIDTH;
}
function petWindowXInset(): number {
  return Math.round((petWindowWidth() - WINDOW_WIDTH) / 2);
}
// 창의 실제 x → 논리 위치 x
function petWindowLogicalX(actualX: number): number {
  return Math.round(actualX) + petWindowXInset();
}
// 설정창의 즉시 미리보기. 되돌릴지 판단하는 플래그와 값은 이 모듈이 함께 들고 있다.
const settingsPreview = createSettingsPreview({
  publicSettings,
  broadcast: (next) => {
    petWindow?.webContents.send("pet:settings-updated", next);
    // 체크리스트도 말풍선 테마를 따르므로 테마 미리보기를 같이 받아야 한다.
    if (checklistWindow && !checklistWindow.isDestroyed()) {
      checklistWindow.webContents.send("pet:settings-updated", next);
    }
    favoritesWindows.sendToPanels("pet:settings-updated", next);
  },
  sendToPet: (next) => petWindow?.webContents.send("pet:settings-updated", next)
});

// AI 대화가 남기는 세 기록(화면 로그·대화 이력·에피소드)의 소유자.
const assistantHistory = createAssistantHistory({
  onLogAdded: (entry) => {
    if (assistantLogWindow && !assistantLogWindow.isDestroyed()) {
      assistantLogWindow.webContents.send("assistant-log:added", entry);
    }
  }
});

// 펫 창이 마우스를 받을 조건. interactive는 호버를 포함하고 focusable은 포함하지 않는다.
const petInteraction = createPetInteractionMode({
  petWindow: () => petWindow,
  anyPanelActive: () => bubblePanels.anyActive(),
  isCustomizeActive: () => customizeActive,
  isPetHoverInteractive: () => inputMonitor.isPetHoverInteractive(),
  isMediaPlayerHoverInteractive: () => inputMonitor.isMediaPlayerHoverInteractive(),
  ensurePetVisible: () => petPosition.ensureVisible(),
  logWindowOp,
  panelDetail: () => ({
    assistantPanelActive: bubblePanels.isAssistantActive(),
    favoritesPanelActive: bubblePanels.isFavoritesActive(),
    imageResizePanelActive: bubblePanels.isImageResizeActive(),
    translatePanelActive: bubblePanels.isTranslateActive(),
    documentSummaryPanelActive: bubblePanels.isDocumentSummaryActive()
  })
});

// 펫 창의 논리 위치 소유자. screen·app 경계는 주입해 Node로 검증할 수 있게 둔다.
const petPosition = createPetPositionController({
  userDataPath: () => app.getPath("userData"),
  primaryWorkArea: () => screen.getPrimaryDisplay().workArea,
  displayNearestPoint: (point) => screen.getDisplayNearestPoint(point),
  petWindow: () => petWindow,
  petScalePercent: () => settings?.petScalePercent ?? DEFAULT_SETTINGS.petScalePercent,
  petWindowWidth,
  petWindowXInset,
  petWindowLogicalX,
  logWindowOp
});

const APP_ICON_FILE = process.platform === "win32" ? "app-icon.ico" : "app-icon.png";
const APP_ICON_PATH = path.join(__dirname, "../assets", APP_ICON_FILE);
// 창 팩토리는 main.js의 __dirname을 모르므로 공통 경로를 이 객체로 넘겨받는다.
const windowChrome = {
  preloadPath: path.join(__dirname, "preload.js"),
  iconPath: APP_ICON_PATH
};

// React로 전환한 창(현재 logs)은 Vite 빌드 산출물(dist/ui/<이름>/)을 로드한다 (2026-08-10).
// 개발 중 HMR을 쓰려면 `npm run ui:dev`로 dev 서버를 띄우고
// DANGOROBO_UI_DEV=http://localhost:5173 환경변수와 함께 앱을 실행한다.
function loadUiWindow(win: BrowserWindow, name: string): void {
  const devServer = process.env.DANGOROBO_UI_DEV;
  if (devServer) {
    win.loadURL(`${devServer.replace(/\/+$/, "")}/${name}/index.html`);
  } else {
    win.loadFile(path.join(__dirname, `../dist/ui/${name}/index.html`));
  }
}
const MERMAID_VENDOR_PATH = path.join(__dirname, "vendor/mermaid/mermaid.min.js");

// 창 z-order가 간헐적으로 뒤섞이는 현상(원인 미확정, 3차례 시도했지만 재현이 계속됨)을
// 진단하기 위한 임시 로그. 창 관련 네이티브 호출/포커스 전환을 타임스탬프와 함께
// %USERPROFILE%/AppData/Roaming/<앱이름>/window-debug.log 에 남긴다. 다음에 z-order가
// 다시 꼬이면 이 로그를 확인해 직전에 무슨 호출이 있었는지 역추적한다.
const WINDOW_DEBUG_LOG_MAX_BYTES = 512 * 1024;
function windowDebugLogPath(): string {
  return path.join(app.getPath("userData"), "window-debug.log");
}
function windowLabel(win: BrowserWindow | null | undefined): string {
  if (!win) return "none";
  if (win === petWindow) return "pet";
  if (win === settingsWindow) return "settings";
  if (win === assistantLogWindow) return "logs";
  return "unknown";
}
function logWindowOp(op: string, detail?: unknown): void {
  try {
    const line = `${new Date().toISOString()} ${op}${detail ? " " + JSON.stringify(detail) : ""}\n`;
    const logPath = windowDebugLogPath();
    fs.appendFileSync(logPath, line, "utf8");
    if (fs.statSync(logPath).size > WINDOW_DEBUG_LOG_MAX_BYTES) {
      const trimmed = fs.readFileSync(logPath, "utf8").slice(-WINDOW_DEBUG_LOG_MAX_BYTES / 2);
      fs.writeFileSync(logPath, trimmed, "utf8");
    }
  } catch {
    // 진단용 부가 기능이 본 기능에 영향을 주면 안 되므로 실패는 조용히 무시한다.
  }
}

/**
 * "여기서는 창이 반드시 살아 있다"는 불변식을 코드로 적는다. 창 핸들은 모듈 전역
 * 변수라 언제든 비워질 수 있어 타입상 항상 null 가능인데, 바로 앞에서 창을 만들었거나
 * 만들어져 있음을 확인한 자리들이 있다. 그런 자리에서 이 함수를 통과시킨 값을 쓴다.
 * 없으면 그 자체가 버그이므로 조용히 넘기지 않고 던진다(전에도 null이면 TypeError였다).
 */
function requireWindow(win: BrowserWindow | null | undefined): BrowserWindow {
  if (!win) throw new Error("창이 있어야 하는 자리인데 없다");
  return win;
}

let petWindow: BrowserWindow | null | undefined;
let settingsWindow: BrowserWindow | null | undefined;
let assistantLogWindow: BrowserWindow | null | undefined;
let checklistWindow: BrowserWindow | null | undefined;
let checklistPositionSaveTimer: Timer;
let appIsQuitting = false;
let mediaPlayerVisible = false;
let mediaPlayerRect: MediaPlayerRect | null = null;
let trayCountdownTimer: Timer;
const alarmScheduler = createAlarmScheduler((id) => alarmQueue.fireAlarm(id));
const weatherService = createWeatherService();
const autoUpdateService = createAutoUpdateService({ getLanguage: () => settings.language });
const alarmQueue = createAlarmQueue({
  scheduler: alarmScheduler,
  getSettings: () => settings,
  saveSettings: () => saveSettings(),
  isRestActive: () => petInteraction.isRestActive(),
  isDndActive: () => dndVisibility.isActive(),
  showAlert: (alarm) => startRestAlert(alarm),
  // daily 알람에 날씨 브리핑이 켜져 있으면 발동 직전에만 메시지를 오늘·내일 날씨로 바꿔
  // 보여준다 — settings.alarms에 저장된 원본 message는 그대로 둔다(alarm-queue.ts 참고).
  resolveAlarmForDisplay: async (alarm) => {
    if (alarm.type !== "daily" || !alarm.weatherBriefingEnabled) return alarm;
    const { message, lines } = await weatherService.getWeatherBriefing(settings.weatherCity, settings.language);
    return { ...alarm, message, weatherLines: lines };
  }
});
let settings: Settings = { ...DEFAULT_SETTINGS };
let geminiApiKey = "";

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!app.isReady()) return;
    if (!petWindow || petWindow.isDestroyed()) createPetWindow();
    const win = requireWindow(petWindow);
    petPosition.place();
    win.showInactive();
  });
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "pet-settings.json");
}

function settingsSaveJournalPath(): string {
  return path.join(app.getPath("userData"), "settings-save-journal.json");
}

// loadSettings()와 "설정 전체 백업/복원"(settings:import-all) 둘 다 "저장된 임의의
// JSON을 신뢰할 수 있는 settings 객체로 정규화"해야 하므로 이 로직을 공유 함수로 뺐다.
// 정규화 본체는 settings:save 핸들러와 공유하는 settings-schema.js의 normalizeSettings()이고,
// 여기서는 "저장된 파일에만" 필요한 옛 키 마이그레이션을 앞에 붙일 뿐이다.
function normalizeStoredSettings(stored: unknown): Settings {
  return normalizeSettings(migrateLegacySettings(stored));
}

function loadSettings() {
  // "파일 없음"(첫 실행)과 "파일 손상"을 구분한다. 손상이면 원본을 격리하고
  // .bak(직전 정상 저장본)에서 복구를 시도한다 — 예전에는 어느 쪽이든 조용히
  // 전체 기본값으로 돌아가서, 다음 저장이 손상 원본을 덮으면 복구가 불가능했다.
  const result = readJsonWithRecovery(settingsPath(), {
    validate: (value) => Boolean(
      value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length > 0
    )
  });
  if (result.status === "ok") {
    try {
      settings = normalizeStoredSettings(result.data);
      if (result.recoveredFromBackup) {
        console.warn("[Settings] 설정 파일이 손상돼 백업(.bak)에서 복구했다.");
      }
      return;
    } catch (error) {
      console.error("[Settings] 저장된 설정 정규화 실패 — 기본값으로 시작한다:", error);
    }
  } else if (result.status === "corrupt") {
    console.error("[Settings] 설정 파일과 백업이 모두 손상됨 — 기본값으로 시작한다. 손상 원본은 .corrupt-*로 격리됨.");
  }
  const language = detectDefaultLanguage(app.getLocale());
  settings = {
    ...DEFAULT_SETTINGS,
    language,
    customizationPresets: getDefaultCustomizationPresets(language)
  };
}

function saveSettings(settingsToSave: Settings = settings): void {
  writeFileAtomicSync(settingsPath(), JSON.stringify(settingsToSave, null, 2), { backup: true });
}

function assistantKeysPath(): string {
  return path.join(app.getPath("userData"), "assistant-keys.json");
}

function settingsCommitPaths() {
  return {
    journalPath: settingsSaveJournalPath(),
    settingsPath: settingsPath(),
    assistantKeysPath: assistantKeysPath()
  };
}

function loadAssistantKey() {
  geminiApiKey = "";
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const stored = JSON.parse(fs.readFileSync(assistantKeysPath(), "utf8"));
    if (typeof stored.gemini === "string" && stored.gemini) {
      geminiApiKey = safeStorage.decryptString(Buffer.from(stored.gemini, "base64"));
    }
  } catch {}
}

/**
 */
function serializeAssistantKey(
  assistantKey: string = geminiApiKey,
  language: string = settings.language
): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(t(language, "secureStorage.unavailableError"));
  }
  const stored = assistantKey
    ? { gemini: safeStorage.encryptString(assistantKey).toString("base64") }
    : {};
  return JSON.stringify(stored, null, 2);
}

function saveAssistantKey(
  assistantKey: string = geminiApiKey,
  language: string = settings.language
): void {
  // 백업은 남기지 않는다 — 폐기한 옛 키가 .bak에서 조용히 되살아나면 안 된다.
  writeFileAtomicSync(assistantKeysPath(), serializeAssistantKey(assistantKey, language));
}

function createSettingsPersistenceJournal() {
  const paths = settingsCommitPaths();
  let journalPrepared = false;
  let candidateKeyWritePending = false;
  let targetAssistantKeysContents: string | null = null;

  return {
    preparePersistence(
      candidateSettings: Settings,
      candidateAssistantKey: string,
      assistantKeyWillPersist: boolean
    ) {
      settlePendingSettingsCommit(paths);
      if (!assistantKeyWillPersist) return;
      targetAssistantKeysContents = serializeAssistantKey(
        candidateAssistantKey,
        candidateSettings.language
      );
      prepareSettingsCommit(
        paths,
        JSON.stringify(candidateSettings, null, 2),
        targetAssistantKeysContents
      );
      journalPrepared = true;
      candidateKeyWritePending = true;
    },
    persistAssistantKey(assistantKey: string, language: string) {
      if (candidateKeyWritePending && targetAssistantKeysContents !== null) {
        candidateKeyWritePending = false;
        writeFileAtomicSync(paths.assistantKeysPath, targetAssistantKeysContents);
        return;
      }
      saveAssistantKey(assistantKey, language);
    },
    markPersistenceRollback() {
      if (journalPrepared) markSettingsCommitRollback(paths);
    },
    completePersistence() {
      if (!journalPrepared) return;
      finishSettingsCommit(paths);
      journalPrepared = false;
    },
    cancelPersistence() {
      if (!journalPrepared) return;
      finishSettingsCommit(paths);
      journalPrepared = false;
    }
  };
}

function recoverSettingsPersistenceBeforeLoad() {
  try {
    const result = recoverPendingSettingsCommit(settingsCommitPaths());
    if (result.status === "completed") {
      console.warn("[Settings] 중단된 설정 저장을 완료했다.");
    } else if (result.status === "rolledBack") {
      console.warn("[Settings] 중단된 설정 저장을 이전 암호화 키 상태로 복원했다.");
    }
    return result.status !== "corrupt";
  } catch (error) {
    console.error("[Settings] 중단된 설정 저장 복구 실패 — 이번 세션은 API 키를 사용하지 않는다:", error);
    return false;
  }
}

function publicSettings(): PublicSettings {
  return { ...settings, assistantKeyConfigured: Boolean(geminiApiKey) };
}

// 커스텀 얼굴: 사용자가 불러온 zip 안의 customface_(표정이름).png 를 이 폴더에
// 영구 저장해둔다(설정 파일에는 이미지 자체를 넣지 않는다 — 용량·재현성 문제).
// 커스텀 얼굴(zip 임포트)의 경로/정규화/저장은 src/main/custom-face.js로 분리됨(2026-08-07).

// 체크리스트는 설정(pet-settings.json)이 아니라 자체 파일에 저장한다 — 항목/창 위치/열림
// 여부가 설정창의 저장·취소 흐름과 무관하게 즉시 반영·유지되어야 하기 때문이다.
// 경로/정규화/로드/저장은 src/main/windows/checklist.js로 분리됨(2026-08-07) — 창 생성·IPC처럼
// petWindow/settings 등 공유 상태를 참조하는 부분은 main.ts에 남겨뒀다.
let checklistState: ChecklistState = { open: false, position: null, size: null, items: [] };

const globalShortcutManager = createGlobalShortcutManager({
  globalShortcut,
  getSettings: () => settings,
  isAssistantKeyConfigured: () => Boolean(geminiApiKey),
  // bubblePanels는 이 아래에서 만들어지므로 참조를 호출 시점까지 미룬다.
  handlers: {
    assistant: () => bubblePanels.openAssistantQuestion(),
    favorites: toggleFavoritesUi,
    imageResize: () => bubblePanels.openImageResize(),
    checklist: () => {
      if (checklistState.open) closeChecklistWindow();
      else openChecklistWindow();
    },
    translate: () => bubblePanels.openTranslate(),
    documentSummary: () => bubblePanels.openDocumentSummary()
  }
});
const {
  registerAssistantShortcut,
  registerFavoritesShortcut,
  registerImageResizeShortcut,
  registerChecklistShortcut,
  registerTranslateShortcut,
  registerDocumentSummaryShortcut,
  unregisterManagedShortcuts,
  applyGlobalShortcuts,
  restoreGlobalShortcuts,
  dispatchMouseShortcut
} = globalShortcutManager;

// ── 즐겨찾기 표시 방식: 독립 창 / 플로팅 독 (2026-08-06 신설) ─────────────────
// 두 창 모두 체크리스트 창과 같은 패턴이다. 위치·크기·열림 여부는 설정창의 저장·취소
// 흐름과 무관하게 즉시 유지돼야 하므로 pet-settings.json이 아니라 자체 파일에 넣는다.
// 창의 크기와 화면 경계 보정은 src/main/windows/favorites-layout.js의 순수 함수로 계산한다.

let favoritesPanelsSaveTimer: Timer;
let favoritesPanelsState: FavoritesPanelsState = {
  window: { open: false, position: null, size: null },
  dock: { open: false, position: null }
};

// 경로/정규화/로드/저장은 src/main/windows/favorites-panels.js로 분리됨(2026-08-07) — 창 생성·
// 파이 메뉴·IPC처럼 petWindow/settings 등 공유 상태를 참조하는 부분은 main.ts에 남겨뒀다.

function scheduleFavoritesPanelsSave() {
  clearTimeout(favoritesPanelsSaveTimer);
  favoritesPanelsSaveTimer = setTimeout(() => saveFavoritesPanelsToDisk(favoritesPanelsState), 250);
}

// 체크리스트 창을 옮기거나 크기를 바꿀 때 같은 타이머를 공유해 디바운스 저장한다.
function scheduleChecklistGeometrySave() {
  clearTimeout(checklistPositionSaveTimer);
  checklistPositionSaveTimer = setTimeout(() => saveChecklistToDisk(checklistState), 250);
}

function appendAssistantLog(question: string, answer: string): void {
  const entry = buildAssistantLogEntry(question, answer, settings.assistantGeminiModel, settings.assistantPersonality);
  if (!entry) return;
  assistantHistory.appendLog(entry);
}

// 질문(assistant:ask)과 펫 대화 답장(pet-chat:reply)이 공유하는 기록 경로. 답장은 화면
// 로그를 petChatService가 따로 남기고, 장기 기억 추출 카운터도 올리지 않는다.
function recordAssistantConversationTurn(
  question: string,
  answer: string,
  { appendLog, countTowardExtraction }: { appendLog: boolean; countTowardExtraction: boolean }
): void {
  if (appendLog) appendAssistantLog(question, answer);
  if (!settings.assistantMemoryEnabled) return;
  const turn = {
    question: rememberedAssistantQuestion(question),
    answer: rememberedAssistantAnswer(answer)
  };
  assistantHistory.pushTurn(turn, settings.assistantMemoryTurns);
  appendConversationTurnToHistory(turn.question, turn.answer, MAX_CONVERSATION_HISTORY_TURNS);

  /* 잊어달라는 요청은 추출 주기(3턴)를 기다리지 않고 **즉시** 처리한다. 러너는 마지막
     질문에서만 잊기 신호를 찾으므로, 주기를 기다리면 그 사이 마지막 질문이 다른 말로
     바뀌어 신호가 감지되지 않고 요청이 통째로 사라진다 — 3번 중 2번이 그랬다. 펫 대화
     답장은 카운터를 아예 올리지 않아(countTowardExtraction: false) 그쪽 요청은 영영
     사라졌다. 그래서 이 판정은 카운터보다, 그리고 그 early return보다 앞에 있어야 한다. */
  const forgetRequested = detectForgetSignals(turn.question);
  const dueForExtraction = countTowardExtraction && assistantHistory.countTurnForExtraction();
  if (!dueForExtraction && !forgetRequested) return;
  /* 잊기로 당겨 실행할 때는 카운터를 건드리지 않는다 — 그 배치는 잊기만 하고 일반 추출을
     건너뛰므로, 원래 주기의 추출은 예정대로 와야 한다. */
  // 추출이 끝난 뒤 정리한다 — 시작할 때만 정리하면 앱을 며칠씩 켜 두는 동안 표가 쌓인다.
  // 러너는 내부에서 예외를 삼키므로 이 then은 거부되지 않는다.
  void triggerMemoryExtraction(assistantHistory.getHistory(), settings.language)
    .then(pruneStaleOpenLoops);
}

function appendPetChatLog(petMessage: string, userReply: string, petReply: string): void {
  const entry = buildPetChatLogEntry(petMessage, userReply, petReply, settings.assistantGeminiModel, settings.assistantPersonality);
  if (!entry) return;
  assistantHistory.appendLog(entry);
}

function startupExecutablePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function applyAutoStart(enabled: boolean): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: startupExecutablePath(),
      args: ["--autostart"]
    });
  } catch (error) {
    console.error("Windows auto-start setting could not be changed:", error);
  }
}

// 즐겨찾기 아이콘 서비스는 Electron을 직접 알지 않는다. Windows 바로가기 해석과 셸
// 아이콘 조회만 composition root에서 주입해 Node 테스트에서도 같은 폴백 순서를 검증한다.
const favoriteIconService = createFavoriteIconService({
  platform: process.platform,
  powershellPath: getPowershellExePath,
  execFile: (file, args, options, callback) => {
    execFile(file, args, options, (error, stdout) => callback(error, stdout));
  },
  readShortcutLink: (target) => shell.readShortcutLink(target),
  getFileIcon: (target, options) => app.getFileIcon(target, options)
});
const favoriteCustomIconDataUrl = favoriteIconService.customIconDataUrl;
const clearFavoriteAutoIconCache = favoriteIconService.clearCache;
const hydrateFavoriteMenuItems = favoriteIconService.hydrateMenuItems;

const readCapsLockState = createCapsLockStateReader({
  platform: process.platform,
  powershellPath: getPowershellExePath,
  execFile: (file, args, options, callback) => {
    execFile(file, args, options, (error, stdout) => callback(error, String(stdout)));
  }
});

// 미디어 세션 감시와 방해 금지 감지는 PowerShell 자식 프로세스를 띄우고 그 출력을 읽는
// 같은 모양의 일이라 각각 src/main/media-monitor.js·dnd-monitor.js로 분리했다(2026-08-10).
// 두 모듈은 프로세스 수명과 출력 파싱만 알고, 그 결과로 어떤 창을 어떻게 할지는 모른다 —
// 아래 콜백이 그 경계다(alarm-scheduler.js와 같은 의존성 주입 패턴).

function broadcastMediaUpdate(data: MediaUpdate): void {
  // 알람 소리도 Chromium <audio> 요소라 재생되는 순간 Windows SMTC가 "현재 세션"으로
  // 잡아버린다(실측, 2026-08) — media-monitor.js는 세션 출처를 구분하지 않고 그대로
  // 전달하므로, 휴식 알림이 떠 있는 동안은 그 상태를 무시하고 플레이어를 숨긴다. 안 그러면
  // 미디어 플레이어에 알람 소리 재생 버튼이 뜨고, 누르면 알람이 다시 울린다.
  const effectiveData: MediaUpdate = petInteraction.isRestActive() ? { status: "None" } : data;
  mediaPlayerVisible = effectiveData.status === "Playing" || effectiveData.status === "Paused";
  if (!mediaPlayerVisible) mediaPlayerRect = null;
  petWindow?.webContents.send("pet:media-update", effectiveData);
}

const mediaMonitor = createMediaMonitor({
  powershellPath: getPowershellExePath,
  onUpdate: broadcastMediaUpdate,
  shouldRestart: () => Boolean(settings.mediaPlayer?.enabled)
});

function startMediaMonitor() {
  mediaMonitor.start();
}

// 프로세스를 끄는 것과 별개로 화면 상태(플레이어 표시·마우스 통과)를 되돌려야 한다.
function stopMediaMonitor() {
  mediaMonitor.stop();
  mediaPlayerVisible = false;
  mediaPlayerRect = null;
  inputMonitor.resetMediaHover();
  petInteraction.apply();
  petWindow?.webContents.send("pet:media-update", { status: "None" });
}

function sendMediaCommand(action: string): void {
  // broadcastMediaUpdate가 휴식 알림 중엔 플레이어를 숨기지만, 그 사이 큐에 남아 있던
  // 클릭이 뒤늦게 도착하는 경우까지 막는 이중 방어다.
  if (petInteraction.isRestActive()) return;
  mediaMonitor.sendCommand(action);
}

const dndVisibility = createDndVisibility({
  petWindow: () => petWindow,
  checklistWindow: () => checklistWindow,
  favoritesWindows: {
    window: () => favoritesWindows.window(),
    dockWindow: () => favoritesWindows.dockWindow()
  },
  alarmQueue,
  ensurePetVisible: () => petPosition.ensureVisible(),
  logWindowOp
});

const dndMonitor = createDndMonitor({
  powershellPath: getPowershellExePath,
  onStateChange: (active, reason) => dndVisibility.apply(active, reason),
  shouldRestart: () => Boolean(settings.fullscreenDndEnabled)
});

function startDndMonitor() {
  dndMonitor.start();
}

function stopDndMonitor() {
  dndMonitor.stop();
}

// 모드를 켜고 끌 때 위치를 되돌리기 위해 진입 직전의 논리 위치를 기억한다.
// enteredPosition은 "진입 보정 직후의 위치" — 모드 중에 사용자가 펫을 직접 드래그했는지
// 판별하는 데 쓴다. 직접 옮겼다면 되돌리지 않는다(옮긴 게 무시되면 더 이상하다).
let customizeReturnPosition: Point | null = null;
let customizeEnteredPosition: Point | null = null;
// 취소 버튼용. 이 모드는 색을 고르는 즉시 저장하므로, 되돌릴 수 있게 진입 시점의
// bodyColors를 그대로 떠 둔다.
let customizeColorSnapshot: Settings["bodyColors"] | null = null;

function setCustomizeMode(enabled: boolean): void {
  const next = Boolean(enabled);
  if (next === customizeActive) return;
  if (!petWindow || petWindow.isDestroyed()) {
    if (!next) return;
    createPetWindow();
  }
  const customizeWindow = requireWindow(petWindow);
  if (next) {
    const entering = petPosition.current();
    customizeReturnPosition = entering ? { ...entering } : null;
    customizeColorSnapshot = (settings.bodyColors || []).map((entry) => ({ ...entry }));
    customizeActive = true;
    // resizable:false인 창은 Windows에서 프로그램적 리사이즈도 막힐 수 있어 잠깐 풀어준다.
    customizeWindow.setResizable(true);
    const nextPosition = petPosition.clampForCustomize(petPosition.current() || petPosition.defaultPosition());
    petPosition.setCurrent(nextPosition);
    customizeEnteredPosition = { ...nextPosition };
    petPosition.setBounds(nextPosition);
    customizeWindow.setResizable(false);
    petInteraction.apply();
    if (!customizeWindow.isVisible()) customizeWindow.showInactive();
    customizeWindow.webContents.send("pet:customize-mode", { active: true, bodyColors: settings.bodyColors });
  } else {
    customizeActive = false;
    customizeWindow.setResizable(true);
    // 진입 보정으로 펫을 옮겼다면 원래 자리로 되돌린다. 단 모드 중에 사용자가 직접
    // 드래그해 옮겼다면(= savedPosition이 진입 직후 값과 다르다) 그 위치를 존중한다.
    const currentPosition = petPosition.current();
    const movedByUser = !customizeEnteredPosition || !currentPosition
      || currentPosition.x !== customizeEnteredPosition.x || currentPosition.y !== customizeEnteredPosition.y;
    const nextPosition = petPosition.clamp(
      (movedByUser ? currentPosition : customizeReturnPosition) || currentPosition || petPosition.defaultPosition()
    );
    petPosition.setCurrent(nextPosition);
    petPosition.setBounds(nextPosition);
    customizeWindow.setResizable(false);
    customizeReturnPosition = null;
    customizeEnteredPosition = null;
    customizeColorSnapshot = null;
    petInteraction.apply();
    customizeWindow.webContents.send("pet:customize-mode", { active: false });
    petPosition.save();
  }
  rebuildTrayMenu();
}

// 전역 훅 좌표의 커서 판정과 펫 드래그·머리 쓰다듬기는 windows/pet-pointer.js가 맡는다.
const petPointer = createPetPointer({
  petWindow: () => petWindow,
  checklistWindow: () => checklistWindow,
  favoritesWindow: () => favoritesWindows.window(),
  favoritesDockWindow: () => favoritesWindows.dockWindow(),
  // petMenu는 아래에서 만들어지므로 실제 입력이 들어올 때까지 읽기를 미룬다.
  tray: () => petMenu.tray(),
  getSettings: () => settings,
  getModelTopLocalY: () => petPosition.getModelTopLocalY(),
  isMediaPlayerVisible: () => mediaPlayerVisible,
  getMediaPlayerRect: () => mediaPlayerRect,
  isRestActive: () => petInteraction.isRestActive(),
  petWindowLogicalX,
  clampPetPosition: (position) => petPosition.clamp(position),
  setPetBounds: (position) => petPosition.setBounds(position),
  setSavedPosition: (position) => {
    petPosition.setCurrent(position);
  },
  savePosition: () => petPosition.save(),
  onPettingChat: () => petChatService.triggerPettingChat(),
  screenToDipPoint: (point) => screen.screenToDipPoint(point)
});


// 펫 말풍선을 빌려 쓰는 다섯 패널의 열림 상태는 windows/pet-bubble-panels.js가 소유한다.
// 서로 배타적이라 여는 쪽에서 나머지를 닫는 규칙을 그 모듈 한 곳에 모아뒀다.
const bubblePanels = createPetBubblePanels({
  sendToPet: (channel, payload) => petWindow?.webContents.send(channel, payload),
  showPetWindow: () => {
    petPosition.ensureVisible();
    petWindow?.show();
    petWindow?.focus();
  },
  getSettings: () => settings,
  hasAssistantKey: () => Boolean(geminiApiKey),
  isRestActive: () => petInteraction.isRestActive(),
  applyMouseInteractionState: () => petInteraction.apply(),
  // inputMonitor는 아래에서 조립되므로 패널을 실제로 열 때까지 getter 평가를 미룬다.
  resetPetHover: () => inputMonitor.resetPetHover(),
  endPetChatSession: () => petChatService.endSession(),
  buildFavoriteLaunchItems: () => buildFavoriteLaunchItems(),
  readClipboardText: () => clipboard.readText()
});

// 말풍선·독립 창·플로팅 독이 모두 같은 항목 목록을 쓴다.
// 내장 아이콘 템플릿을 고른 항목은 실행 파일 아이콘 추출(PowerShell 호출 포함)을
// 아예 건너뛴다 — 필요도 없고, 즐겨찾기 창이 뜨는 속도에도 도움이 된다.
async function buildFavoriteLaunchItems() {
  return favoriteIconService.buildLaunchItems(settings.favoriteItems);
}


// 단축키·트레이 메뉴가 부르는 공용 진입점. 표시 방식(favoritesDisplayMode)에 따라
// 말풍선을 띄우거나, 독립 창/플로팅 독을 토글한다.
function toggleFavoritesUi() {
  if (!settings.favoritesEnabled) return;
  if (settings.favoritesDisplayMode === "window") {
    if (favoritesPanelsState.window.open) favoritesWindows.closeWindow();
    else favoritesWindows.openWindow();
    return;
  }
  if (settings.favoritesDisplayMode === "dock") {
    // 단축키는 "독 창 on/off"가 아니라 **파이 메뉴 여닫기**다. 예전엔 창 자체를 껐는데,
    // 작은 버튼을 못 보고 단축키만 누른 사용자에게는 아무 일도 안 일어나는 것처럼
    // 보였다("파이 메뉴가 호출 안됨", 2026-08-06). 독을 완전히 숨기는 건 버튼 우클릭.
    const dock = favoritesWindows.dockWindow();
    if (!favoritesPanelsState.dock.open || !dock || dock.isDestroyed()) {
      favoritesWindows.openDockWindow();
      // 창이 뜬 직후엔 아직 렌더러가 준비 전일 수 있어 살짝 뒤에 펼친다.
      setTimeout(() => favoritesWindows.setDockExpanded(true), 260);
      return;
    }
    favoritesWindows.setDockExpanded(!favoritesWindows.isDockExpanded());
    return;
  }
  if (settings.favoritesDisplayMode === "cursor") {
    // 커서 방식은 "창 on/off"가 아니라 "지금 커서 자리에 열기"다. 이미 떠 있으면 닫는다.
    // 판단은 플래그가 아니라 창의 표시 상태로 한다(isCursorPieOpen 주석 참고).
    if (favoritesWindows.isCursorPieOpen()) favoritesWindows.closeCursorPie();
    else favoritesWindows.openCursorPie();
    return;
  }
  bubblePanels.openFavorites();
}

async function activateFavoriteItem(id: string) {
  if (!settings.favoritesEnabled) {
    return { ok: false, error: t(settings.language, "favorites.closedError") };
  }
  const item = settings.favoriteItems.find((entry) => entry.id === id);
  if (!item) return { ok: false, error: t(settings.language, "favorites.notFoundError") };
  if (!fs.existsSync(item.target)) return { ok: false, error: t(settings.language, "favorites.movedError") };
  const openError = await shell.openPath(item.target);
  return openError ? { ok: false, error: openError } : { ok: true };
}

function createPetWindow() {
  buildPetWindow({
    chrome: windowChrome,
    petPagePath: path.join(__dirname, "pet/index.html"),
    windowWidth: petWindowWidth,
    devToolsRequested: process.argv.includes("--pet-devtools"),
    // 배치와 클릭스루가 petWindow 바인딩을 읽으므로 창을 만들자마자 채운다.
    attach: (win) => {
      petWindow = win;
    },
    logWindowOp,
    placePetWindow: () => petPosition.place(),
    setClickThrough: (enabled: boolean) => petInteraction.setClickThrough(enabled),
    // inputMonitor는 아래에서 조립되지만 ready-to-show 시점에는 초기화가 끝나 있다.
    sendCapsLockState: () => inputMonitor.sendCapsLockState(),
    onMoved: () => petPosition.handleMoved(),
    onClosed: () => {
      petWindow = undefined;
    },
    isAppQuitting: () => appIsQuitting
  });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = buildSettingsWindow({
    chrome: windowChrome,
    title: t(settings.language, "window.settingsTitle"),
    height: Math.min(800, Math.max(620, screen.getPrimaryDisplay().workArea.height - 40)),
    loadUiWindow,
    logWindowOp,
    openExternal: (url) => shell.openExternal(url),
    ipcMain,
    isAppQuitting: () => appIsQuitting,
    confirmDiscardChanges: async (win) => {
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: [t(settings.language, "common.close"), t(settings.language, "common.cancel")],
        defaultId: 1,
        cancelId: 1,
        title: t(settings.language, "dialog.unsavedTitle"),
        message: t(settings.language, "dialog.unsavedMessage")
      });
      return response === 0;
    },
    onClosed: () => {
      logWindowOp("settingsWindow:closed");
      const shouldRestore = settingsPreview.takeRestoreNeeded();
      settingsWindow = undefined;
      if (shouldRestore) {
        const restored = publicSettings();
        petWindow?.webContents.send("pet:settings-updated", restored);
        if (checklistWindow && !checklistWindow.isDestroyed()) {
          checklistWindow.webContents.send("pet:settings-updated", restored);
        }
        favoritesWindows.sendToPanels("pet:settings-updated", restored);
      }
    }
  });
}

function createAssistantLogWindow() {
  if (assistantLogWindow && !assistantLogWindow.isDestroyed()) {
    assistantLogWindow.focus();
    return;
  }

  assistantLogWindow = buildAssistantLogWindow({
    chrome: windowChrome,
    title: t(settings.language, "window.logsTitle"),
    loadUiWindow,
    onClosed: () => {
      assistantLogWindow = undefined;
    }
  });
}

function defaultChecklistPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - CHECKLIST_WINDOW_WIDTH - SCREEN_MARGIN - WINDOW_WIDTH,
    y: workArea.y + workArea.height - CHECKLIST_WINDOW_HEIGHT - SCREEN_MARGIN
  };
}

function createChecklistWindow() {
  if (checklistWindow && !checklistWindow.isDestroyed()) {
    checklistWindow.show();
    checklistWindow.focus();
    return;
  }

  // 저장된 크기가 있으면 그대로, 없으면 기본 크기(사용자가 한 번도 리사이즈 안 한 경우).
  const size = checklistState.size || { width: CHECKLIST_WINDOW_WIDTH, height: CHECKLIST_WINDOW_HEIGHT };
  // 저장된 좌표가 지금 모니터 구성에서 화면 밖일 수 있으니 작업 영역 안으로 보정한다.
  const stored = checklistState.position || defaultChecklistPosition();
  const { workArea } = screen.getDisplayNearestPoint({
    x: stored.x + Math.round(size.width / 2),
    y: stored.y + Math.round(size.height / 2)
  });
  const position = {
    x: Math.min(Math.max(stored.x, workArea.x), workArea.x + workArea.width - size.width),
    y: Math.min(Math.max(stored.y, workArea.y), workArea.y + workArea.height - size.height)
  };
  checklistWindow = buildChecklistWindow({
    chrome: windowChrome,
    title: t(settings.language, "window.checklistTitle"),
    bounds: { ...position, ...size },
    loadUiWindow,
    onMoved: (moved) => {
      checklistState.position = moved;
      scheduleChecklistGeometrySave();
    },
    onResized: (resized) => {
      checklistState.size = resized;
      scheduleChecklistGeometrySave();
    },
    onClosed: () => {
      checklistWindow = undefined;
      // Alt+F4처럼 자체 닫기 버튼을 거치지 않고 닫힌 경우에도 "닫힌 상태"로 기억해야
      // 다음 실행 때 되살아나지 않는다(앱 종료 중이면 열림 상태를 그대로 보존).
      if (!appIsQuitting && checklistState.open) {
        checklistState.open = false;
        saveChecklistToDisk(checklistState);
        rebuildTrayMenu();
      }
    }
  });
}

function openChecklistWindow() {
  createChecklistWindow();
  if (checklistState.open) return;
  checklistState.open = true;
  saveChecklistToDisk(checklistState);
  rebuildTrayMenu();
}

function closeChecklistWindow() {
  if (checklistWindow && !checklistWindow.isDestroyed()) checklistWindow.close();
  if (!checklistState.open) return;
  checklistState.open = false;
  saveChecklistToDisk(checklistState);
  rebuildTrayMenu();
}

// 즐겨찾기 독립 창과 플로팅 독의 창 핸들·기하·생명주기는 windows/favorites-windows.js가
// 소유한다. 여기서는 설정·저장 상태와 트레이 갱신만 넘겨준다.
const favoritesWindows = createFavoritesWindowController({
  chrome: windowChrome,
  loadUiWindow,
  translate: (key) => t(settings.language, key),
  getSettings: () => settings,
  getPanelsState: () => favoritesPanelsState,
  savePanelsState: () => saveFavoritesPanelsToDisk(favoritesPanelsState),
  schedulePanelsSave: scheduleFavoritesPanelsSave,
  isAppQuitting: () => appIsQuitting,
  rebuildTrayMenu: () => rebuildTrayMenu(),
  buildFavoriteLaunchItems: () => buildFavoriteLaunchItems()
});

function assistantInstructions(options: AssistantInstructionOptions = {}): string {
  const includeDateTime = options.includeDateTime !== false;
  const dateTimeContext = includeDateTime ? currentDateTimeContext(new Date(), settings.language) : "";
  return buildAssistantInstructions(settings, dateTimeContext, options);
}

// assistant:ask에서 fire-and-forget으로 부른다 — 응답을 기다리지 않고, 실패해도
// 러너 안에서 로그만 남긴다.
const triggerMemoryExtraction = createMemoryExtractionRunner({
  ask: (userPrompt, options) => askGemini(userPrompt, [], options),
  getAllMemories,
  insertMemory,
  getOpenLoops,
  closeOpenLoop,
  // 잊기 후보는 기억 추출이 보는 목록(EXISTING_MEMORIES_PROMPT_LIMIT)과 별개다 —
  // 사용자가 지목할 수 있는 범위를 러너가 정한다.
  getForgettableMemories: (limit) => getAllMemories(limit),
  forgetMemory,
  forgetOpenLoop,
  insertEpisode,
  insertOpenLoop
});

// 오래 언급되지 않은 미완료 주제를 닫는다. 시작할 때와 기억 추출이 돌 때마다 부른다 —
// 이미 닫힌 주제는 건드리지 않으므로 여러 번 불러도 안전하다. 프롬프트 노출 상한과는
// 목적이 다르다(그쪽은 "펫이 먼저 꺼내지 않게", 이쪽은 "표가 쌓이지 않게").
function pruneStaleOpenLoops(): void {
  const archived = archiveStaleOpenLoops(undefined, settings.language);
  if (archived > 0) {
    console.log(`[Memory] 오래된 미완료 주제 ${archived}개를 자동 정리했다.`);
  }
}

function assistantHistoryBlock(options: AssistantHistoryOptions = {}): string {
  return buildAssistantHistoryBlock(settings, assistantHistory.getHistory(), options);
}

function getRecentEpisodeSummaryBlock(options: Record<string, unknown> = {}): string {
  return buildRecentEpisodeSummaryBlock(settings, assistantHistory.getEpisodeSummaries(), options);
}

// 프롬프트에 넣을 장기 기억 블록. 에피소드 요약과 같은 규칙으로 기억 기능이 꺼져 있으면
// 아무것도 넣지 않는다.
// 2026-08-10에 연결했다 — 그 전까지 기억은 저장·표시만 되고 답변에는 전혀 쓰이지 않았다
// (memory-search.js가 만들어져 있는데 아무도 호출하지 않는 상태였다).
const RELATED_MEMORY_CANDIDATE_LIMIT = 100; // DB에서 훑어볼 기억 수
const RELATED_MEMORY_PROMPT_LIMIT = 5; // 그중 실제로 프롬프트에 넣을 수
// 미완료 주제는 나이 상한(3일)을 넘긴 것도 사용자가 그 이야기를 꺼내면 되살아나므로,
// 상한 안쪽만 필요한 판정(hasOpenLoops)보다 넉넉히 훑는다.
const RELATED_OPEN_LOOP_CANDIDATE_LIMIT = 50;
function relatedMemoryBlock(
  question: string,
  options: { recallOpenLoops?: boolean } = {}
): string {
  if (!settings.assistantMemoryEnabled) return "";
  try {
    const related = findRelatedMemories(
      getAllMemories(RELATED_MEMORY_CANDIDATE_LIMIT),
      question,
      RELATED_MEMORY_PROMPT_LIMIT
    );
    return buildMemoryContextBlock(related, settings.language) +
      buildOpenLoopsContextBlock(
        selectPromptOpenLoops(
          getOpenLoops(RELATED_OPEN_LOOP_CANDIDATE_LIMIT),
          // 사용자 발화가 아닌 프롬프트(펫이 먼저 말 걸기)에서는 되살리지 않는다 —
          // 지시문 단어에 옛 주제가 걸리면 3일 상한이 무의미해진다.
          options.recallOpenLoops === false ? "" : question
        ),
        settings.language
      );
  } catch (error) {
    // 기억을 못 읽는다고 답변 자체가 실패하면 안 된다 — 기억 없이 그냥 답한다.
    console.error("[Memory] 관련 기억 블록을 만들지 못했다:", error);
    return "";
  }
}

const geminiTransport = createGeminiTransport({
  getLanguage: () => settings.language,
  getModel: () => settings.assistantGeminiModel,
  getApiKey: () => geminiApiKey
});

function oneOffHistoryBlock(extraTurns: { question: string; answer: string }[]): string {
  return buildOneOffHistoryBlock(settings.language, extraTurns);
}

const translateWithGemini = createTranslateWithGemini({
  generateContent: geminiTransport.generateContent,
  getLanguage: () => settings.language
});


const summarizeDocumentWithGemini = createSummarizeDocument({
  generateContent: geminiTransport.generateContent,
  getLanguage: () => settings.language
});

function documentSummaryDirectory() {
  return path.join(app.getPath("userData"), "summaries");
}

function writeSummaryDocument(markdown: string): string {
  const dir = documentSummaryDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const html = summaryHtmlDocument(markdown, settings);
  // mermaid.min.js는 요약마다 3.5MB를 복제하지 않도록 폴더 안에 한 번만 둔다(없을 때만 복사).
  if (html.includes("mermaid.min.js")) {
    const vendorTarget = path.join(dir, "mermaid.min.js");
    if (!fs.existsSync(vendorTarget)) {
      fs.copyFileSync(MERMAID_VENDOR_PATH, vendorTarget);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dir, `summary-${stamp}.html`);
  fs.writeFileSync(filePath, html, "utf8");
  return filePath;
}

const askGemini = createAskGemini({
  generateContent: geminiTransport.generateContent,
  getLanguage: () => settings.language,
  instructionsBlock: assistantInstructions,
  historyBlock: assistantHistoryBlock,
  episodeBlock: getRecentEpisodeSummaryBlock,
  memoryBlock: relatedMemoryBlock,
  oneOffBlock: oneOffHistoryBlock
});

function parseEpisodeSummaryResponse(responseText: unknown): Partial<EpisodeSummary> | null {
  return parseEpisodeSummaryResponseCore(responseText, new Date(), assistantHistory.getHistory().length);
}

// before-quit에서 부른다 — 생명주기 제어(preventDefault/재-quit)는 그쪽에 있다.
const runQuitEpisodeSummary = createEpisodeSummaryRunner({
  ask: (userPrompt, options) => askGemini(userPrompt, [], options),
  parseSummary: parseEpisodeSummaryResponse,
  appendEpisode: appendEpisodeMemory
});

function assistantErrorMessage(error: unknown): string {
  return mapAssistantErrorMessage(error, settings.language);
}
// 타이머 관리(computeAlarmDelayMs 포함)는 src/main/alarm-scheduler.js로 분리됨(2026-08-07).
// 알람이 실제로 울렸을 때 무엇을 하는지(once 알람 삭제, 큐에 넣기 등)는 settings/알림 큐를
// 참조해야 해서 main.ts에 그대로 둔다.
function scheduleAllAlarms() {
  alarmScheduler.scheduleAll(settings.alarms);
  rebuildTrayMenu();
}

function startRestAlert(alarm: RestAlert): void {
  if (petInteraction.isRestActive()) return;
  bubblePanels.closeAssistant();
  bubblePanels.closeFavorites();
  bubblePanels.closeImageResize();
  bubblePanels.closeTranslate();
  bubblePanels.closeDocumentSummary();
  petInteraction.setRestActive(true);
  petPointer.resetPetting();

  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  else petPosition.ensureVisible();
  const restWindow = requireWindow(petWindow);
  // show() 전에 포커스를 받을 수 있게 만들어야 확인 버튼을 누를 수 있다. setFocusable을
  // 직접 부르지 않고 apply()를 태우는 이유는 그쪽이 "마지막으로 건 값" 캐시의 소유자라서다
  // — 밖에서 몰래 바꾸면 캐시가 어긋나 다음 전환이 통째로 씹힌다. restActive는 위에서 이미
  // 켰으므로 여기서 apply()는 focusable/interactive를 둘 다 켠다.
  petInteraction.apply();
  restWindow.show();
  petInteraction.setClickThrough(false);
  restWindow.webContents.send("pet:rest-start", {
    title: alarm.title,
    message: alarm.message,
    soundDataUrl: alarmSoundDataUrl(alarm),
    weatherLines: alarm.weatherLines ?? null
  });
  rebuildTrayMenu();
}

// 알람마다 고른 커스텀 소리 파일을 매번 읽어 data URL로 돌려준다(값을 캐싱하지 않는 이유는
// custom-face.js의 readCustomFaceTextures와 달리 알람은 자주 안 울려서 매번 읽어도 비용이
// 작고, 사용자가 파일을 바꾸거나 지워도 다음 발동 때 바로 반영돼야 해서다).
function alarmSoundDataUrl(alarm: RestAlert): string | null {
  if (!alarm.soundFile) return null;
  try {
    const mime = path.extname(alarm.soundFile).toLowerCase() === ".mp3" ? "audio/mpeg" : "audio/wav";
    return `data:${mime};base64,${fs.readFileSync(alarm.soundFile).toString("base64")}`;
  } catch {
    return null;
  }
}

function confirmRestAlert() {
  if (!petInteraction.isRestActive()) return;
  petInteraction.setRestActive(false);
  petWindow?.webContents.send("pet:rest-end");

  // setClickThrough(true)가 이미 apply()를 태워 focusable을 내린다. 여기서 setFocusable을
  // 또 부르면 캐시가 어긋날 뿐 아니라, 말풍선이 떠 있는 경우 apply()가 켜둔 focusable을
  // 되돌려 입력을 못 받게 만든다.
  petInteraction.setClickThrough(true);
  rebuildTrayMenu();
  setTimeout(alarmQueue.tryShowNext, 400);
}

const petChatService = createPetChatService({
  ask: (prompt, options) => askGemini(prompt, [], options),
  getSettings: () => settings,
  hasApiKey: () => Boolean(geminiApiKey),
  isAutoChatBlocked: () => petInteraction.isRestActive() || bubblePanels.isAssistantActive() || bubblePanels.isFavoritesActive() ||
    bubblePanels.isImageResizeActive() || bubblePanels.isTranslateActive() || bubblePanels.isDocumentSummaryActive() || dndVisibility.isActive() || !petInteraction.isClickThrough(),
  hasConversationHistory: () => assistantHistory.getHistory().length > 0,
  // 기억이 꺼져 있으면 relatedMemoryBlock이 아무것도 넣지 않으므로, 기억을 소재로 삼는
  // 화제도 후보에서 빠져야 한다 — 재료 없이 지시만 주면 모델이 기억을 지어낸다.
  hasLongTermMemory: () => settings.assistantMemoryEnabled && getMemoryCount() > 0,
  // 펫이 먼저 꺼낼 수 있는 주제만 센다 — 전체 개수로 재면 오래된 주제만 남은 상태에서
  // "미완료 주제 중 하나를 골라 물어보라"는 지시만 가고 목록은 비어 모델이 주제를 지어낸다.
  // selectPromptOpenLoops로 재면 안 된다: 그쪽은 사용자 질문에 걸려 되살아난 옛 주제까지
  // 세므로, 오프너에는 없는 목록을 두고 지시가 나간다(오프너는 되살리기를 끈다).
  hasOpenLoops: () => settings.assistantMemoryEnabled &&
    selectFreshOpenLoops(getOpenLoops()).length > 0,
  openPanel: (message, expression) => {
    bubblePanels.setAssistantActive(true);
    petWindow?.webContents.send("pet-chat:open", { message, expression });
  },
  logSession: appendPetChatLog
});

// 트레이 아이콘과 자체 우클릭 팝업의 창·타이머·툴팁 상태는 컨트롤러가 소유한다.
// main은 다른 도메인으로 이어지는 명령과 최신 메뉴 상태만 조립한다.
const petMenuActions: PetMenuActions = {
  togglePet: () => {
    if (!petWindow || petWindow.isDestroyed()) {
      createPetWindow();
      return;
    }
    if (petWindow.isVisible()) {
      logWindowOp("tray:togglePet:hide");
      petWindow.hide();
    } else {
      logWindowOp("tray:togglePet:show");
      petPosition.place();
      petPosition.ensureVisible();
      petWindow.showInactive();
    }
  },
  toggleMoveMode: () => {
    if (!petWindow || petWindow.isDestroyed()) createPetWindow();
    requireWindow(petWindow).show();
    petInteraction.setClickThrough(!petInteraction.isClickThrough());
    rebuildTrayMenu();
  },
  openSettings: createSettingsWindow,
  openLogs: createAssistantLogWindow,
  toggleChecklist: () => {
    if (checklistState.open) closeChecklistWindow();
    else openChecklistWindow();
  },
  openAssistant: bubblePanels.openAssistantQuestion,
  openFavorites: toggleFavoritesUi,
  activateFavorite: activateFavoriteItem,
  toggleAutoStart: () => {
    settings.autoStartEnabled = !settings.autoStartEnabled;
    saveSettings();
    applyAutoStart(settings.autoStartEnabled);
    rebuildTrayMenu();
    petMenu.refresh();
  },
  checkWeatherNow: () => {
    weatherService.getWeatherBriefing(settings.weatherCity, settings.language).then(({ message, lines }) => {
      alarmQueue.enqueue({
        id: `weather-check-${Date.now()}`,
        title: t(settings.language, "weather.alertTitle"),
        message,
        weatherLines: lines
      });
    });
  },
  quit: () => app.quit()
};

const petMenu = createPetMenuController({
  chrome: windowChrome,
  argv: process.argv,
  loadUiWindow,
  getMenuState: () => ({
    settings,
    countdown: alarmQueue.countdownText(),
    clickThrough: petInteraction.isClickThrough(),
    restActive: petInteraction.isRestActive(),
    alwaysDragEnabled: petPointer.alwaysDragEnabled(),
    assistantKeyConfigured: Boolean(geminiApiKey),
    assistantLogCount: assistantHistory.getLogs().length,
    checklistOpen: checklistState.open
  }),
  actions: petMenuActions,
  hydrateFavoriteMenuItems,
  translate: t,
  logWindowOp,
  writeCaptureFile: (filePath, contents) => fs.writeFileSync(filePath, contents),
  quit: () => app.quit()
});

// 이 선언보다 위에서 만드는 객체들은 콜백 안에서만 호출하므로 petMenu 초기화 뒤 최신 소유자를 읽는다.
function rebuildTrayMenu(): void {
  petMenu.rebuild();
}


// 전역 입력 훅의 이벤트 처리는 input-monitor.js가 맡는다. 훅 자체를 주입해서 Windows
// 실기 없이도 합성 이벤트로 판단 로직을 검증할 수 있게 한다.
const inputMonitor = createInputMonitor({
  pointer: petPointer,
  sendToPet: (channel, payload) => petWindow?.webContents.send(channel, payload),
  getSettings: () => settings,
  getUiState: () => ({
    clickThrough: petInteraction.isClickThrough(),
    restActive: petInteraction.isRestActive(),
    customizeActive,
    assistantPanelActive: bubblePanels.isAssistantActive(),
    favoritesPanelActive: bubblePanels.isFavoritesActive(),
    imageResizePanelActive: bubblePanels.isImageResizeActive(),
    translatePanelActive: bubblePanels.isTranslateActive(),
    documentSummaryPanelActive: bubblePanels.isDocumentSummaryActive()
  }),
  isDndActive: () => dndVisibility.isActive(),
  readCapsLockState,
  contextMenuWindow: petMenu.contextMenuWindow,
  closePetContextMenu: petMenu.close,
  openPetContextMenu: petMenu.open,
  // 파이가 실제로 떠 있을 때만 창을 넘긴다 — 접힌 뒤에도 넘기면 그 뒤의 모든 클릭이
  // "바깥 클릭"으로 잡혀 펫 드래그가 통째로 막힌다.
  favoritesCursorPieWindow: () => (
    favoritesWindows.isCursorPieOpen() ? favoritesWindows.dockWindow() : null
  ),
  closeFavoritesCursorPie: () => favoritesWindows.closeCursorPie(),
  getCursorPoint: () => screen.getCursorScreenPoint(),
  dispatchMouseShortcut: (event) => dispatchMouseShortcut(event),
  applyMouseInteractionState: () => petInteraction.apply()
});

function startInputMonitor() {
  uIOhook.on("keydown", inputMonitor.onKeyDown);
  uIOhook.on("keyup", inputMonitor.onKeyUp);
  uIOhook.on("mousedown", inputMonitor.onMouseDown);
  uIOhook.on("mouseup", inputMonitor.onMouseUp);
  uIOhook.on("mousemove", inputMonitor.onMouseMove);
  uIOhook.start();
  inputMonitor.start();
}

// 개발·QA 하네스가 손대는 범위를 한곳에 모아 명시한다. 창 핸들은 하네스가 create*Window()를
// 부른 뒤에 읽어야 하므로 값이 아니라 getter로 넘긴다.
function qaCaptureContext(): QaCaptureContext {
  return {
    argv: process.argv,
    getSettings: () => settings,
    translate: t,
    publicSettings,
    requireWindow,
    petWindow: () => petWindow,
    settingsWindow: () => settingsWindow,
    assistantLogWindow: () => assistantLogWindow,
    checklistWindow: () => checklistWindow,
    favoritesWindow: () => favoritesWindows.window(),
    favoritesDockWindow: () => favoritesWindows.dockWindow(),
    createSettingsWindow,
    createAssistantLogWindow,
    createChecklistWindow,
    createFavoritesWindow: favoritesWindows.createWindow,
    createFavoritesDockWindow: favoritesWindows.createDockWindow,
    openPetContextMenu: petMenu.open,
    openFavoritesCursorPie: favoritesWindows.openCursorPie,
    setFavoritesDockExpanded: favoritesWindows.setDockExpanded,
    setFavoritesPanelActive: bubblePanels.setFavoritesActive,
    setAssistantPanelActive: bubblePanels.setAssistantActive,
    setCustomizeMode,
    setClickThrough: (enabled: boolean) => petInteraction.setClickThrough(enabled),
    startRestAlert,
    isPointOverPet: petPointer.isPointOverPet,
    assistantInstructions,
    relatedMemoryBlock,
    buildFavoriteLaunchItems,
    hydrateFavoriteMenuItems
  };
}

app.whenReady().then(async () => {
  // 앱 이름 변경(2026-08-09) 이후 "설정이 다 사라졌다"는 혼동이 생기면 제일 먼저 볼 값이다 —
  // 어느 userData 폴더를 실제로 쓰고 있는지(예전 이름 / 새 이름) 한 줄로 남긴다.
  logWindowOp("app:userData", { path: app.getPath("userData") });
  const assistantKeyRecoverySafe = recoverSettingsPersistenceBeforeLoad();
  loadSettings();
  // 프리셋마다 커스텀 이미지를 갖는 기능(2026-08-20) 전에 저장된 프리셋에 자기 이미지 파일을
  // 한 번 채워 준다 — 안 하면 옛 프리셋들만 계속 활성 이미지 한 벌을 공유한다.
  const seededPresetAssets = seedLegacyPresetAssets(settings.customizationPresets);
  if (seededPresetAssets > 0) {
    console.log(`[Customization] 옛 프리셋 ${seededPresetAssets}개에 커스텀 이미지 파일을 채웠다.`);
  }
  if (assistantKeyRecoverySafe) loadAssistantKey();
  assistantHistory.loadLogs();
  // initializeMemoryDb는 async다. await 없이 if(!...)로 검사하면 Promise가 항상
  // truthy라 실패 분기가 죽은 코드가 되고, DB 준비 전에 메모리 IPC가 열린다.
  const memoryDbReady = await initializeMemoryDb();
  if (!memoryDbReady) {
    // JSON 폴백 같은 건 없다 — 실패하면 이번 세션은 장기 기억 없이 동작한다
    // (memory-sqlite의 모든 접근 함수가 db 없음을 확인하고 빈 결과를 돌려준다).
    console.error("[Main] 장기 기억 DB 초기화 실패 — 이번 세션은 장기 기억 없이 실행된다.");
  }
  if (settings.assistantMemoryEnabled) {
    assistantHistory.loadMemory();
  }
  pruneStaleOpenLoops();
  checklistState = loadChecklistFromDisk();
  favoritesPanelsState = loadFavoritesPanelsFromDisk();
  favoritesWindows.primeSyncBaseline();
  void inputMonitor.initializeCapsLockState();
  settings.assistantEnabled = settings.assistantEnabled && Boolean(geminiApiKey);
  applyAutoStart(settings.autoStartEnabled);
  petPosition.load();
  createPetWindow();
  registerAssistantShortcut(settings);
  registerFavoritesShortcut(settings);
  registerImageResizeShortcut(settings);
  registerChecklistShortcut(settings);
  registerTranslateShortcut(settings);
  registerDocumentSummaryShortcut(settings);
  if (settings.mediaPlayer.enabled) startMediaMonitor();
  if (settings.fullscreenDndEnabled) startDndMonitor();
  // 껐다 켜도 열어뒀던 체크리스트는 그대로 다시 띄운다.
  if (checklistState.open) createChecklistWindow();
  // 즐겨찾기 독립 창/플로팅 독도 마지막 상태를 복원한다(지금 고른 표시 방식일 때만).
  if (settings.favoritesEnabled && settings.favoritesDisplayMode === "window" && favoritesPanelsState.window.open) {
    favoritesWindows.createWindow();
  }
  if (settings.favoritesEnabled && settings.favoritesDisplayMode === "dock" && favoritesPanelsState.dock.open) {
    favoritesWindows.createDockWindow();
  }
  // 커서 방식은 창을 숨긴 채 미리 만들어둔다(단축키를 처음 눌렀을 때 바로 뜨도록).
  if (settings.favoritesEnabled && settings.favoritesDisplayMode === "cursor") {
    favoritesWindows.createDockWindow({ show: false });
  }
  petMenu.createTray();
  // 개발 실행(app.isPackaged === false)에서는 electron-updater가 dev-app-update.yml을
  // 찾다가 실패하며 시끄러운 로그만 남기므로, 패키징된 배포본에서만 확인한다.
  if (app.isPackaged) autoUpdateService.checkForUpdates();
  trayCountdownTimer = setInterval(() => {
    rebuildTrayMenu();
    if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
      petPosition.ensureVisible();
      // alwaysOnTop 창끼리도 topmost 밴드 안에서 순서가 있어서, 다른 프로그램이
      // 자기 창을 새로 topmost로 올리면 펫보다 위로 갈 수 있다(펫이 다른 창
      // 밑으로 가라앉는 현상). moveTop()은 포커스를 뺏지 않고 z-order만
      // 맨 위로 되돌리므로 주기적으로 재확인한다.
      petWindow.moveTop();
    }
  }, 30000);

  const qaCapture = runQaCaptureHarness(qaCaptureContext());
  if (qaCapture.stopInitialization) return;

  scheduleAllAlarms();
  petChatService.schedule();

  if (!qaCapture.captureActive) {
    try {
      startInputMonitor();
    } catch (error) {
      console.error("Global keyboard monitor could not start:", error);
    }

    globalShortcut.register("CommandOrControl+Shift+P", () => {
      // 상시 드래그 모드에선 이동 모드로 전환할 필요가 없다(오히려 창 전체가 클릭을
      // 가로채게 되어 혼란스러움).
      if (!petInteraction.isRestActive() && !petPointer.alwaysDragEnabled()) {
        petInteraction.setClickThrough(!petInteraction.isClickThrough());
        rebuildTrayMenu();
      }
    });
    globalShortcut.register("CommandOrControl+Shift+Q", () => app.quit());
    if (!registerAssistantShortcut()) {
      console.error(`Assistant shortcut could not be registered: ${settings.assistantShortcut}`);
    }
    if (!registerFavoritesShortcut()) {
      console.error(`Favorites shortcut could not be registered: ${settings.favoritesShortcut}`);
    }
  }

  screen.on("display-metrics-changed", () => petPosition.ensureVisible());
  screen.on("display-added", () => petPosition.ensureVisible());
  screen.on("display-removed", () => petPosition.ensureVisible());
});

ipcMain.handle("settings:get", () => publicSettings());
ipcMain.handle("fonts:list-installed", () => listInstalledFonts());
registerAssistantLogsIpcHandlers(ipcMain, {
  getLogs: () => assistantHistory.getLogs(),
  setLogs: (logs) => assistantHistory.setLogs(logs),
  isLogWindowSender: (sender) => Boolean(
    assistantLogWindow
      && !assistantLogWindow.isDestroyed()
      && sender === assistantLogWindow.webContents
  ),
  save: () => assistantHistory.saveLogs()
});
ipcMain.handle("alarm:pick-sound", async (event) => {
  if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) {
    return { ok: false };
  }
  const result = await dialog.showOpenDialog(settingsWindow, {
    title: t(settings.language, "alarm.soundPickerTitle"),
    properties: ["openFile"],
    filters: [{ name: t(settings.language, "alarm.soundPickerFilterName"), extensions: ["mp3", "wav"] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  return { ok: true, filePath: result.filePaths[0] };
});

function isFavoritesPanelSender(sender: WebContents): boolean {
  return [favoritesWindows.window(), favoritesWindows.dockWindow()]
    .some((win) => win && !win.isDestroyed() && sender === win.webContents);
}

function isSettingsWindowSender(sender: unknown): boolean {
  return Boolean(settingsWindow && !settingsWindow.isDestroyed() && sender === settingsWindow.webContents);
}

function isPetWindowSender(sender: unknown): boolean {
  return Boolean(petWindow && !petWindow.isDestroyed() && sender === petWindow.webContents);
}

registerFavoritesIpcHandlers(ipcMain, {
  getSettings: () => settings,
  translate: t,
  isSettingsSender: isSettingsWindowSender,
  isFavoritesPanelSender: (sender) => isFavoritesPanelSender(sender as WebContents),
  isFavoritesWindowSender: (sender) => {
    const win = favoritesWindows.window();
    return Boolean(win && !win.isDestroyed() && sender === win.webContents);
  },
  isFavoritesDockSender: (sender) => {
    const dock = favoritesWindows.dockWindow();
    return Boolean(dock && !dock.isDestroyed() && sender === dock.webContents);
  },
  isFavoritesPanelActive: () => bubblePanels.isFavoritesActive(),
  showOpenDialog: (options) => dialog.showOpenDialog(requireWindow(settingsWindow), {
    title: options.title,
    filters: options.filters,
    properties: options.properties as OpenDialogOptions["properties"]
  }),
  customIconDataUrl: favoriteCustomIconDataUrl,
  buildLaunchItems: buildFavoriteLaunchItems,
  activateFavoriteItem,
  setDockExpanded: favoritesWindows.setDockExpanded,
  closeFavoritesPanel: bubblePanels.closeFavorites,
  closeFavoritesWindow: favoritesWindows.closeWindow,
  closeFavoritesDockWindow: favoritesWindows.closeDockWindow,
  beginDockDrag: favoritesWindows.beginDockDrag,
  moveDockBy: favoritesWindows.moveDockBy,
  endDockDrag: favoritesWindows.endDockDrag
});

function applyLivePreview(patch: Partial<Settings>): void {
  settingsPreview.apply(patch);
}
// 단축키 녹화 중에는 설정 가능한 앱 기능 6개의 전역 단축키를 잠깐 꺼둔다 — 안 그러면
// 새 조합을 누르는 도중에 그 조합이 우연히 지금 등록된(저장되지 않은 예전) 단축키와
// 같아서, 녹화 중인데도 질문창이 열리는 등 다른 펫 기능이 같이 실행돼버렸다("단축키를
// 커스텀하는 동안, 다른 기능들이 눌려서 실행이 됨", 2026-08-02). 녹화가 끝나면(성공/취소 상관없이) 현재
// 저장된 설정 기준으로 다시 등록한다 — 이 시점엔 아직 저장 버튼을 안 눌렀을 수도 있으니
// "저장된" settings를 기준으로 되돌리는 게 맞다(방금 녹화한 값은 폼에만 있고 저장 시점에
// 반영됨).
ipcMain.on("settings:shortcut-recording-start", (event) => {
  if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) return;
  unregisterManagedShortcuts();
});
ipcMain.on("settings:shortcut-recording-end", (event) => {
  if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) return;
  restoreGlobalShortcuts(settings);
});

// ── 펫 주변 커스터마이징 모드 (2026-08-06) ────────────────────────────────
// 설정창의 커스터마이징 탭은 "저장 버튼을 눌러야 확정"이지만, 펫에 직접 붙은 편집기는
// 색을 바꾸는 즉시 확정·저장한다(직접 조작한 결과가 남지 않으면 오히려 헷갈린다).
// 설정창이 열려 있으면 그 폼의 색상 컨트롤도 같이 갱신해줘야 한다 — 안 하면 나중에
// 설정창에서 저장 버튼을 누를 때 폼에 남아 있던 옛 색으로 덮어써버린다.
function commitCustomizeColors(nextColors: unknown): void {
  settings.bodyColors = normalizeBodyColors(nextColors);
  saveSettings();
  // 미리보기 중이었다면 그 스냅샷에도 반영해, 설정창을 저장 없이 닫아도 여기서 고른
  // 색이 되돌려지지 않게 한다.
  settingsPreview.syncBodyColors(settings.bodyColors);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("settings:body-colors-changed", settings.bodyColors);
  }
}

registerAppearanceIpcHandlers(ipcMain, {
  getSettings: () => settings,
  isSettingsSender: isSettingsWindowSender,
  isPetSender: isPetWindowSender,
  translate: t,
  describeError: errorMessage,
  applyLivePreview,
  commitCustomizeColors,
  setCustomizeMode,
  getCustomizeColorSnapshot: () => customizeColorSnapshot,
  setCustomizationPresets: (presets) => {
    settings.customizationPresets = presets;
  },
  saveSettings: () => saveSettings(),
  hasPetWindow: () => Boolean(petWindow && !petWindow.isDestroyed()),
  sendToPet: (channel, payload) => petWindow?.webContents.send(channel, payload),
  showSaveDialog: (options) => dialog.showSaveDialog(requireWindow(settingsWindow), options),
  showOpenDialog: (options) => dialog.showOpenDialog(requireWindow(settingsWindow), {
    title: options.title,
    filters: options.filters,
    properties: options.properties as OpenDialogOptions["properties"]
  }),
  capturePresetAssets,
  deletePresetAssets,
  activatePresetAssets,
  readPresetFaceTexture: readPresetFaceTextureDataUrl,
  exportPresetSet,
  importPresetSet,
  importCustomFaceZip,
  readCustomFaceTextures,
  importCustomBodyImage,
  readCustomBodyTexture
});
registerChecklistIpcHandlers(ipcMain, {
  getItems: () => checklistState.items,
  setItems: (items) => {
    checklistState.items = items;
  },
  isChecklistSender: (sender) => Boolean(
    checklistWindow
      && !checklistWindow.isDestroyed()
      && sender === checklistWindow.webContents
  ),
  normalizeItem: normalizeChecklistItem,
  maxItems: CHECKLIST_MAX_ITEMS,
  save: () => saveChecklistToDisk(checklistState),
  celebrate: () => petWindow?.webContents.send("pet:celebrate"),
  close: closeChecklistWindow
});
ipcMain.on("settings:test-alarm", (event, soundFile: unknown) => {
  if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) return;
  alarmQueue.enqueue({
    id: "test",
    title: t(settings.language, "alarm.testTitle"),
    message: t(settings.language, "alarm.testMessage"),
    // 알람 추가 폼에서 아직 저장 전인 커스텀 소리를 골라둔 상태로 "지금 알람 테스트"를 누르면
    // 그 소리로 미리 들려준다 — 안 그러면 항상 기본 소리만 나서 "커스텀 소리가 재생 안 된다"는
    // 오해를 산다(실제로는 파일 선택 자체가 저장된 알람에는 정상 반영됨).
    soundFile: normalizeAlarmSoundFilePath(soundFile)
  });
});
// 개발자 모드(2026-08-15): 설정창 숨김 탭에서만 보내는 채널이라 다른 단축키·설정과
// 이름이 겹치지 않게 dev- 접두어를 붙인다. 셋 다 설정창 sender만 받는다(test-alarm과 동일).
ipcMain.on("settings:dev-test-weather-briefing", (event) => {
  if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) return;
  weatherService.getWeatherBriefing(settings.weatherCity, settings.language).then(({ message, lines }) => {
    alarmQueue.enqueue({
      id: `dev-weather-test-${Date.now()}`,
      title: t(settings.language, "weather.alertTitle"),
      message,
      weatherLines: lines
    });
  });
});
ipcMain.on("settings:dev-force-expression", (event, expressionKey: unknown) => {
  if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) return;
  petWindow?.webContents.send("pet:dev-force-expression", typeof expressionKey === "string" ? expressionKey : null);
});
ipcMain.on("settings:dev-set-debug-overlay", (event, enabled: unknown) => {
  if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) return;
  petWindow?.webContents.send("pet:dev-debug-overlay", enabled === true);
});
// ── 커스터마이징 프리셋 썸네일 (2026-08-06) ────────────────────────────────
// 설정창에는 Three.js 씬이 없어서 직접 그릴 수 없다. 모델·조명·후처리가 이미 살아
// 있는 펫 창에 "이 프리셋들의 머리를 그려서 PNG로 달라"고 위임하고, 그 답을
// 설정창의 invoke에 그대로 돌려준다(요청 id로 짝을 맞춘다).
// data URL은 pet-settings.json에 저장하지 않는다 — 커스텀 얼굴 이미지와 같은 이유로
// 설정 파일이 무거워진다. 설정창이 필요할 때마다 다시 요청한다.
// 설정 전체 백업/복원(2026-08-02 추가). API 키는 여기 포함하지 않는다 — settings 객체
// 자체에 API 키가 없고(별도 파일 assistant-keys.json에 safeStorage로 암호화 저장,
// Windows DPAPI가 이 PC·이 계정에 묶여 있어 다른 PC로 복사해도 못 씀), 어차피 비밀값을
// 평문 JSON으로 내보내는 건 좋은 패턴이 아니라서 의도적으로 뺐다. 복원 후 API 키가
// 필요하면 "일반" 탭에서 다시 입력해야 한다.


// settings:save와 settings:import-all이 공유하는 트랜잭션 조립. 차이는 두 곳뿐이다 —
// 백업 가져오기는 API 키를 바꾸지 못하고, 정규화할 때 저장된 키 유무로 assistantEnabled를
// 다시 정한다(백업 파일이 켜져 있어도 이 PC에 키가 없으면 켜면 안 된다).
function runSettingsSaveTransaction(
  payload: unknown,
  mode: "save" | "import"
): SettingsSaveTransactionResult<Settings> {
  const persistenceJournal = createSettingsPersistenceJournal();
  return executeSettingsSaveTransaction({
    previousSettings: settings,
    previousAssistantKey: geminiApiKey,
    nextSettings: payload,
    // 정규화 본체는 loadSettings()와 공유한다(settings-schema.js의 normalizeSettings).
    // previousSettings를 fallback으로 넘겨야 설정창에 입력이 없는 키(autoStartEnabled·
    // customizationPresets·translateTargetLanguage)가 저장할 때마다 기본값으로 돌아가지 않는다.
    normalizeSettings: mode === "save" ? normalizeSettings : (source) => {
      const importedSettings = normalizeStoredSettings(source);
      importedSettings.assistantEnabled = importedSettings.assistantEnabled && Boolean(geminiApiKey);
      return importedSettings;
    },
    shortcutConflictError,
    applyShortcuts: (candidateSettings, assistantKeyConfigured) =>
      applyGlobalShortcuts(candidateSettings, assistantKeyConfigured),
    restoreShortcuts: (targetSettings, assistantKeyConfigured) => {
      if (!restoreGlobalShortcuts(targetSettings, assistantKeyConfigured)) {
        throw new Error("이전 전역 단축키를 모두 복원하지 못했습니다.");
      }
    },
    persistAssistantKey: mode === "save" ? persistenceJournal.persistAssistantKey : () => {
      throw new Error("설정 백업은 API 키를 변경할 수 없습니다.");
    },
    persistSettings: (targetSettings) => saveSettings(targetSettings),
    preparePersistence: persistenceJournal.preparePersistence,
    markPersistenceRollback: persistenceJournal.markPersistenceRollback,
    completePersistence: persistenceJournal.completePersistence,
    cancelPersistence: persistenceJournal.cancelPersistence
  });
}

function broadcastSettingsUpdate(payload: unknown): void {
  petWindow?.webContents.send("pet:settings-updated", payload);
  if (assistantLogWindow && !assistantLogWindow.isDestroyed()) {
    assistantLogWindow.webContents.send("pet:settings-updated", payload);
  }
  if (checklistWindow && !checklistWindow.isDestroyed()) {
    checklistWindow.webContents.send("pet:settings-updated", payload);
  }
  favoritesWindows.sendToPanels("pet:settings-updated", payload);
}

// 성공한 트랜잭션을 실행 중인 앱에 반영한다. 저장과 백업 가져오기가 공유하며, 알람·자동
// 시작을 바뀐 것만 다시 거는 최적화는 저장 경로에만 있다(가져오기는 전부 새로 잡는다).
function applySavedSettings(
  transaction: Extract<SettingsSaveTransactionResult<Settings>, { ok: true }>,
  mode: "save" | "import"
) {
  if (transaction.cleanupFailures.length > 0) {
    console.error("[Settings] 설정 저장은 완료됐지만 저널 정리에 실패:", transaction.cleanupFailures);
  }
  const previousSettings = settings;
  const updatedSettings = transaction.settings;
  settings = updatedSettings;
  geminiApiKey = transaction.assistantKey;
  // 즐겨찾기 대상이 바뀌었을 수 있으니 추출해둔 자동 아이콘을 버린다.
  clearFavoriteAutoIconCache();
  if (!settings.assistantEnabled) {
    bubblePanels.closeAssistant();
    bubblePanels.closeTranslate();
    bubblePanels.closeDocumentSummary();
  }
  if (!settings.assistantMemoryEnabled) {
    assistantHistory.clearMemory();
  } else if (mode === "save") {
    assistantHistory.trimHistory(settings.assistantMemoryTurns);
  }
  if (!settings.favoritesEnabled) bubblePanels.closeFavorites();
  // 이동 모드로 켜둔 상태에서 상시 드래그로 바꾸면, 창 전체가 클릭을 가로채는 상태로
  // 남아버리므로 클릭 통과를 되돌려준다.
  if (petPointer.alwaysDragEnabled() && !petInteraction.isClickThrough() && !petInteraction.isRestActive()) petInteraction.setClickThrough(true);
  if (settings.mediaPlayer.enabled) startMediaMonitor();
  else stopMediaMonitor();
  if (settings.fullscreenDndEnabled) startDndMonitor();
  else stopDndMonitor();
  if (mode === "import" || previousSettings.autoStartEnabled !== updatedSettings.autoStartEnabled) {
    applyAutoStart(settings.autoStartEnabled);
  }
  const alarmsChanged = JSON.stringify(previousSettings.alarms) !== JSON.stringify(updatedSettings.alarms);
  if (mode === "import" || alarmsChanged) scheduleAllAlarms();
  else rebuildTrayMenu();
  petChatService.schedule();
  // 표시 방식·항목이 바뀌었을 수 있으니 즐겨찾기 창들을 지금 설정에 맞춘다.
  favoritesWindows.syncToSettings();
  const result = { ok: true as const, ...publicSettings() };
  broadcastSettingsUpdate(result);
  if (mode === "save") settingsPreview.clear();
  return result;
}

registerPetShellIpcHandlers(ipcMain, {
  isPetSender: isPetWindowSender,
  isContextMenuSender: petMenu.isContextMenuSender,
  getCursorPoint: () => screen.getCursorScreenPoint(),
  getPetWindowBounds: () => petWindow?.getBounds() ?? null,
  isClickThrough: () => petInteraction.isClickThrough(),
  setModelTopLocalY: (value) => {
    petPosition.setModelTopLocalY(value);
  },
  setMediaPlayerRect: (rect) => {
    mediaPlayerRect = rect;
  },
  confirmRestAlert,
  sendMediaCommand,
  quit: () => app.quit(),
  currentPetMenuItems: petMenu.currentItems,
  closePetContextMenu: petMenu.close
});

registerSettingsIpcHandlers(ipcMain, {
  getSettings: () => settings,
  translate: t,
  describeError: errorMessage,
  isSettingsSender: isSettingsWindowSender,
  showSaveDialog: (options) => dialog.showSaveDialog(requireWindow(settingsWindow), options),
  showOpenDialog: (options) => dialog.showOpenDialog(requireWindow(settingsWindow), {
    title: options.title,
    filters: options.filters,
    properties: options.properties as OpenDialogOptions["properties"]
  }),
  writeTextFile: (filePath, text) => fs.writeFileSync(filePath, text, "utf8"),
  readTextFile: (filePath) => fs.readFileSync(filePath, "utf8"),
  runSaveTransaction: runSettingsSaveTransaction,
  applySavedSettings
}, (failures) => {
  console.error("[Settings] 설정 저장 롤백 중 실패:", failures);
});

registerAssistantIpcHandlers(ipcMain, {
  getSettings: () => settings,
  translate: t,
  describeAssistantError: assistantErrorMessage,
  describeError: errorMessage,
  hasApiKey: () => Boolean(geminiApiKey),
  isPetSender: isPetWindowSender,
  isAssistantPanelActive: () => bubblePanels.isAssistantActive(),
  isTranslatePanelActive: () => bubblePanels.isTranslateActive(),
  isDocumentSummaryPanelActive: () => bubblePanels.isDocumentSummaryActive(),
  isRestActive: () => petInteraction.isRestActive(),
  isDndActive: () => dndVisibility.isActive(),
  askGemini,
  petChat: {
    isSessionActive: () => petChatService.isSessionActive(),
    callNow: () => petChatService.callNow(),
    getOpeningMessage: () => petChatService.getOpeningMessage(),
    recordReply: (reply, answer) => petChatService.recordReply(reply, answer)
  },
  recordAssistantTurn: recordAssistantConversationTurn,
  rebuildTrayMenu,
  closeAssistantPanel: bubblePanels.closeAssistant,
  closeImageResizePanel: bubblePanels.closeImageResize,
  closeTranslatePanel: bubblePanels.closeTranslate,
  closeDocumentSummaryPanel: bubblePanels.closeDocumentSummary,
  resizeClipboardImage,
  translateWithGemini,
  setTranslateTargetLanguage: (target) => {
    settings.translateTargetLanguage = target;
    saveSettings();
  },
  summarizeDocument: summarizeDocumentWithGemini,
  writeSummaryDocument,
  summaryDirectory: documentSummaryDirectory,
  ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
  fileExists: (filePath) => fs.existsSync(filePath),
  openPath: (target) => shell.openPath(target),
  writeClipboardText: (text) => clipboard.writeText(text)
});

registerMemoryIpcHandlers(ipcMain, {
  isAllowedSender: (event) => Boolean(
    settingsWindow && !settingsWindow.isDestroyed()
    && event.sender === settingsWindow.webContents
  ),
  getMemoryCount,
  getOpenLoopsCount,
  getEpisodesCount,
  getMemoriesByCategory,
  getAllMemories,
  getOpenLoops,
  getForgottenMemoryCount,
  getForgottenMemories,
  restoreForgottenMemory,
  setMemoryVerified,
  deleteMemory,
  closeOpenLoop,
  insertMemory,
  archiveAllMemories,
  validateExtractedMemory
});


// 종료 직전 에피소드 요약(guarded quit, 2026-08-10):
// Electron은 before-quit 리스너가 돌려준 Promise를 기다려주지 않으므로, async 리스너로
// await만 걸면 요약 요청·저장이 종료 도중에 끊길 수 있다. 대신 preventDefault()로 종료를
// 한 번 막고, 요약이 끝나면(성공·실패 무관) 다시 quit한다. one-shot 가드로 재진입을 막는다.
let quitSummaryHandled = false;

app.on("before-quit", (event) => {
  appIsQuitting = true;
  // 요약을 기다리는 동안(최대 8초) 펫이 그대로 떠 있으면 종료가 안 먹는 것처럼 보인다.
  hideSurfacesForQuit({ windows: () => BrowserWindow.getAllWindows(), tray: petMenu.tray });
  if (quitSummaryHandled) return;
  quitSummaryHandled = true;
  if (!settings.assistantMemoryEnabled || assistantHistory.getHistory().length === 0) return;
  const summaryPrompt = generateEpisodeSummaryPrompt(assistantHistory.getHistory(), settings.language);
  if (!summaryPrompt) return;
  event.preventDefault();
  runQuitEpisodeSummary(summaryPrompt).finally(() => {
    app.quit();
  });
});
// 창 z-order 진단용: 다른 프로그램으로 포커스가 넘어가고(alt-tab 등) 돌아오는 시점을
// window-debug.log에 남긴다. 재현 시 이 시점과 다른 창 작업 호출이 얼마나 가까운지 대조한다.
app.on("browser-window-focus", (_event, win) => {
  logWindowOp("app:browser-window-focus", { window: windowLabel(win) });
});
app.on("browser-window-blur", (_event, win) => {
  logWindowOp("app:browser-window-blur", { window: windowLabel(win) });
});
// GPU/유틸리티 프로세스가 죽으면(드라이버 크래시 등) webContents의 render-process-gone은
// 안 잡힐 수 있다. 펫 창이 통째로 사라지는 증상은 이쪽일 가능성이 있어 별도로 기록한다.
app.on("child-process-gone", (_event, details) => {
  console.error("💥 자식 프로세스(GPU 등) 종료:", details);
  logWindowOp("app:child-process-gone", details);
});
// "gpu-process-crashed"도 Electron 타입 정의에서 빠진 구식 이벤트다.
(app as unknown as LegacyEventSource).on("gpu-process-crashed", (_event, killed) => {
  console.error("💥 GPU 프로세스 크래시. killed:", killed);
  logWindowOp("app:gpu-process-crashed", { killed });
});
app.on("will-quit", () => {
  // Save conversation history before quit
  if (settings.assistantMemoryEnabled) {
    assistantHistory.saveHistory(settings.assistantMemoryTurns);
  }

  closeMemoryDb();

  alarmScheduler.clearAll();
  petChatService.clearTimer();
  inputMonitor.stop();
  petPosition.dispose();
  petMenu.dispose();
  clearInterval(trayCountdownTimer);
  clearTimeout(checklistPositionSaveTimer);
  globalShortcut.unregisterAll();
  stopMediaMonitor();
  stopDndMonitor();
  try {
    uIOhook.stop();
  } catch {}
});
app.on("window-all-closed", () => {});
