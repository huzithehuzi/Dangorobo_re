import type { IpcMain } from "electron";
import {
  BODY_COLOR_DEFS,
  DEFAULT_SETTINGS,
  generatePresetId,
  normalizeBodyColors,
  normalizeCustomizationPreset,
  normalizeBubbleTheme,
  normalizeBodyCostumeIndex,
  normalizeFaceCosmeticIndex,
  normalizeFaceEyeStyleIndex,
  normalizeFaceMouthStyleIndex,
  normalizeFacePatternIndex,
  normalizeHexColor,
  normalizeLighting,
  normalizePartVariations
} from "./settings-schema.js";
import type { Settings } from "./settings-schema.js";

type AppearanceIpcEvent = { sender: unknown };
type BodyColors = Settings["bodyColors"];
type CustomizationPresets = Settings["customizationPresets"];
type DialogFilter = { name: string; extensions: string[] };
type SaveDialogResult = { canceled: boolean; filePath?: string };
type OpenDialogResult = { canceled: boolean; filePaths: string[] };
type CustomFaceImportResult = { ok: boolean; errorCode?: string; keys?: string[] };

// 펫 창이 모델 로드 중이거나 응답을 못 하면 영원히 매달리지 않도록 빈 결과로 끝낸다
// (설정창은 빈 결과를 플레이스홀더로 처리한다).
const PRESET_THUMBNAIL_TIMEOUT_MS = 8000;
const PRESET_LIMIT = 50;

type AppearanceIpcDependencies = {
  getSettings: () => Settings;
  isSettingsSender: (sender: unknown) => boolean;
  isPetSender: (sender: unknown) => boolean;
  translate: (language: string, key: string) => string;
  describeError: (error: unknown) => string;
  /** 저장하지 않고 펫·체크리스트·즐겨찾기 창에만 즉시 반영하는 미리보기 경로. */
  applyLivePreview: (patch: Partial<Settings>) => void;
  /** 펫에 붙은 편집기의 색 변경은 즉시 확정·저장한다(미리보기와 다르다). */
  commitCustomizeColors: (nextColors: unknown) => void;
  setCustomizeMode: (enabled: boolean) => void;
  getCustomizeColorSnapshot: () => BodyColors | null;
  setCustomizationPresets: (presets: CustomizationPresets) => void;
  saveSettings: () => void;
  hasPetWindow: () => boolean;
  sendToPet: (channel: string, payload: unknown) => void;
  // 대화상자와 파일 IO는 Electron·디스크 경계라 주입해서 Node 테스트가 가능하게 둔다.
  showSaveDialog: (options: { title: string; defaultPath: string; filters: DialogFilter[] }) => Promise<SaveDialogResult>;
  showOpenDialog: (options: { title: string; properties: string[]; filters: DialogFilter[] }) => Promise<OpenDialogResult>;
  writeTextFile: (filePath: string, text: string) => void;
  readTextFile: (filePath: string) => string;
  importCustomFaceZip: (filePath: string) => CustomFaceImportResult;
  readCustomFaceTextures: () => unknown;
  importCustomBodyImage: (filePath: string) => { ok: boolean };
  readCustomBodyTexture: () => unknown;
};

type PendingPresetThumbnailRequest = {
  resolve: (thumbnails: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 외형 미리보기와 펫 주변 커스터마이징 모드의 IPC. 실행 중 교체되는 창·설정을 캡처하지
 * 않고 호출할 때마다 getter와 동작 콜백으로 main.js의 최신 값을 쓴다.
 *
 * 설정창의 커스터마이징 탭은 "저장 버튼을 눌러야 확정"이라 미리보기(applyLivePreview)를
 * 쓰고, 펫에 직접 붙은 편집기는 색을 바꾸는 즉시 확정한다(commitCustomizeColors).
 */
function registerAppearanceIpcHandlers(
  ipcMain: Pick<IpcMain, "handle" | "on">,
  deps: AppearanceIpcDependencies
) {
  const fromSettingsWindow = (event: AppearanceIpcEvent) => deps.isSettingsSender(event.sender);
  const fromPetWindow = (event: AppearanceIpcEvent) => deps.isPetSender(event.sender);

  ipcMain.on("settings:preview-bubble-theme", (event: AppearanceIpcEvent, payload: unknown) => {
    if (!fromSettingsWindow(event)) return;
    const settings = deps.getSettings();
    const preview = isRecord(payload) ? payload : {};
    deps.applyLivePreview({
      bubbleTheme: normalizeBubbleTheme(preview.theme ?? payload),
      bubbleThemeCustomBg: normalizeHexColor(preview.customBg, settings.bubbleThemeCustomBg),
      bubbleThemeCustomAccent: normalizeHexColor(preview.customAccent, settings.bubbleThemeCustomAccent),
      bubbleThemeCustomText: normalizeHexColor(preview.customText, settings.bubbleThemeCustomText)
    });
  });

  ipcMain.on("settings:preview-face-customization", (event: AppearanceIpcEvent, value: unknown) => {
    if (!fromSettingsWindow(event)) return;
    const preview = isRecord(value) ? value : {};
    deps.applyLivePreview({
      facePattern: normalizeFacePatternIndex(preview.facePattern),
      faceCosmetic: normalizeFaceCosmeticIndex(preview.faceCosmetic),
      faceEyeStyle: normalizeFaceEyeStyleIndex(preview.faceEyeStyle),
      faceMouthStyle: normalizeFaceMouthStyleIndex(preview.faceMouthStyle),
      customFaceEnabled: preview.customFaceEnabled === true,
      bodyCostume: normalizeBodyCostumeIndex(preview.bodyCostume),
      customBodyEnabled: preview.customBodyEnabled === true
    });
  });

  ipcMain.on("settings:preview-body-colors", (event: AppearanceIpcEvent, value: unknown) => {
    if (!fromSettingsWindow(event)) return;
    deps.applyLivePreview({ bodyColors: normalizeBodyColors(value) });
  });

  ipcMain.on("settings:preview-part-variations", (event: AppearanceIpcEvent, value: unknown) => {
    if (!fromSettingsWindow(event)) return;
    deps.applyLivePreview({ partVariations: normalizePartVariations(value) });
  });

  ipcMain.on("settings:preview-lighting", (event: AppearanceIpcEvent, value: unknown) => {
    if (!fromSettingsWindow(event)) return;
    deps.applyLivePreview({ lighting: normalizeLighting(value) });
  });

  ipcMain.on("settings:open-pet-customize", (event: AppearanceIpcEvent) => {
    if (!fromSettingsWindow(event)) return;
    deps.setCustomizeMode(true);
  });

  ipcMain.on("pet:customize-set-color", (event: AppearanceIpcEvent, payload: unknown) => {
    if (!fromPetWindow(event)) return;
    const update = isRecord(payload) ? payload : {};
    const id = String(update.id || "");
    if (!BODY_COLOR_DEFS.some((def) => def.id === id)) return;
    const currentColors = deps.getSettings().bodyColors || [];
    deps.commitCustomizeColors(BODY_COLOR_DEFS.map((def) => {
      const current = currentColors.find((entry) => entry?.id === def.id);
      const color = def.id === id ? update.color : current?.color;
      return { id: def.id, color: color ?? def.defaultColor };
    }));
  });

  ipcMain.on("pet:customize-exit", (event: AppearanceIpcEvent) => {
    if (!fromPetWindow(event)) return;
    deps.setCustomizeMode(false);
  });

  // 취소: 진입 시점의 색으로 되돌린 뒤 모드를 닫는다. 스냅샷을 먼저 되돌려야
  // setCustomizeMode(false)가 보내는 알림에도 원래 색이 실린다.
  ipcMain.on("pet:customize-cancel", (event: AppearanceIpcEvent) => {
    if (!fromPetWindow(event)) return;
    const snapshot = deps.getCustomizeColorSnapshot();
    if (snapshot) deps.commitCustomizeColors(snapshot);
    deps.setCustomizeMode(false);
  });

  // ── 프리셋 썸네일 ────────────────────────────────────────────────────────
  // 설정창이 요청하면 펫 창이 오프스크린으로 그려 돌려준다. 요청과 응답이 다른 창을
  // 거치므로 requestId로 짝을 맞추고, 응답이 없으면 타이머가 빈 결과로 끝낸다.
  let requestSeq = 0;
  const pendingRequests = new Map<number, PendingPresetThumbnailRequest>();

  ipcMain.handle("preset:render-thumbnails", (event: AppearanceIpcEvent, payload: unknown) => {
    if (!fromSettingsWindow(event)) return {};
    if (!deps.hasPetWindow()) return {};
    const language = deps.getSettings().language;
    const presets = (Array.isArray(payload) ? payload : [])
      .slice(0, PRESET_LIMIT)
      .map((preset) => normalizeCustomizationPreset(preset, language))
      .filter((preset) => preset.id);
    if (!presets.length) return {};
    const requestId = ++requestSeq;
    return new Promise<Record<string, unknown>>((resolve) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        resolve({});
      }, PRESET_THUMBNAIL_TIMEOUT_MS);
      pendingRequests.set(requestId, { resolve, timer });
      deps.sendToPet("pet:render-preset-thumbnails", { requestId, presets });
    });
  });

  ipcMain.on("pet:preset-thumbnails-result", (event: AppearanceIpcEvent, payload: unknown) => {
    if (!fromPetWindow(event)) return;
    const result = isRecord(payload) ? payload : {};
    const requestId = result.requestId;
    if (typeof requestId !== "number") return;
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRequests.delete(requestId);
    pending.resolve(isRecord(result.thumbnails) ? result.thumbnails : {});
  });

  // ── 커스터마이징 프리셋 ──────────────────────────────────────────────────
  ipcMain.handle("settings:save-customization-preset", (event: AppearanceIpcEvent, payload: unknown) => {
    const settings = deps.getSettings();
    if (!fromSettingsWindow(event)) return settings.customizationPresets;
    const preset = normalizeCustomizationPreset({
      ...(isRecord(payload) ? payload : {}),
      id: generatePresetId()
    }, settings.language);
    deps.setCustomizationPresets([...settings.customizationPresets, preset].slice(-PRESET_LIMIT));
    deps.saveSettings();
    return deps.getSettings().customizationPresets;
  });

  ipcMain.handle("settings:delete-customization-preset", (event: AppearanceIpcEvent, id: unknown) => {
    const settings = deps.getSettings();
    if (!fromSettingsWindow(event)) return settings.customizationPresets;
    deps.setCustomizationPresets(settings.customizationPresets.filter((preset) => preset.id !== id));
    deps.saveSettings();
    return deps.getSettings().customizationPresets;
  });

  ipcMain.handle("settings:export-customization-preset", async (event: AppearanceIpcEvent, payload: unknown) => {
    const language = deps.getSettings().language;
    if (!fromSettingsWindow(event)) {
      return { ok: false, error: deps.translate(language, "customization.settingsWindowNotFoundError") };
    }
    const preset = normalizeCustomizationPreset(payload, language);
    const safeName = (preset.name || "pet-customization").replace(/[\\/:*?"<>|]/g, "_");
    const result = await deps.showSaveDialog({
      title: deps.translate(language, "customization.exportTitle"),
      defaultPath: `${safeName}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      deps.writeTextFile(result.filePath, JSON.stringify(preset, null, 2));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: deps.describeError(error) || deps.translate(language, "customization.saveFailedError") };
    }
  });

  ipcMain.handle("settings:import-customization-preset", async (event: AppearanceIpcEvent) => {
    const language = deps.getSettings().language;
    if (!fromSettingsWindow(event)) {
      return { ok: false, error: deps.translate(language, "customization.settingsWindowNotFoundError") };
    }
    const result = await deps.showOpenDialog({
      title: deps.translate(language, "customization.importTitle"),
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    try {
      const parsed = JSON.parse(deps.readTextFile(result.filePaths[0]));
      return { ok: true, preset: normalizeCustomizationPreset(parsed, language) };
    } catch {
      return { ok: false, error: deps.translate(language, "customization.invalidFileError") };
    }
  });

  // ── 사용자 이미지(얼굴 ZIP / 바디 PNG) ───────────────────────────────────
  ipcMain.handle("customFace:import", async (event: AppearanceIpcEvent) => {
    const language = deps.getSettings().language;
    if (!fromSettingsWindow(event)) {
      return { ok: false, error: deps.translate(language, "customization.settingsWindowNotFoundError") };
    }
    const result = await deps.showOpenDialog({
      title: deps.translate(language, "customFace.importTitle"),
      properties: ["openFile"],
      filters: [{ name: "ZIP", extensions: ["zip"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const imported = deps.importCustomFaceZip(result.filePaths[0]);
    if (!imported.ok) {
      const errorKey = imported.errorCode === "invalidZip" ? "customFace.invalidZipError" : "customFace.noMatchingFilesError";
      return { ok: false, error: deps.translate(language, errorKey) };
    }
    const textures = deps.readCustomFaceTextures();
    deps.sendToPet("pet:custom-face-textures", textures);
    return { ok: true, keys: imported.keys };
  });

  ipcMain.handle("customFace:get-textures", () => deps.readCustomFaceTextures());

  // 커스텀 바디: 얼굴과 같은 원리지만 표정이 없어서 PNG 한 장만 고른다(zip 아님).
  ipcMain.handle("customBody:import", async (event: AppearanceIpcEvent) => {
    const language = deps.getSettings().language;
    if (!fromSettingsWindow(event)) {
      return { ok: false, error: deps.translate(language, "customization.settingsWindowNotFoundError") };
    }
    const result = await deps.showOpenDialog({
      title: deps.translate(language, "customBody.importTitle"),
      properties: ["openFile"],
      filters: [{ name: "PNG", extensions: ["png"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const imported = deps.importCustomBodyImage(result.filePaths[0]);
    if (!imported.ok) {
      return { ok: false, error: deps.translate(language, "customBody.invalidImageError") };
    }
    deps.sendToPet("pet:custom-body-texture", deps.readCustomBodyTexture());
    return { ok: true };
  });

  ipcMain.handle("customBody:get-texture", () => deps.readCustomBodyTexture());

  // 외형 탭 "기본값으로 초기화" 버튼용(2026-08-08 추가). 이 탭 필드만 반환한다 —
  // 커스터마이징(바디 색상/파츠/얼굴)은 별개 탭이라 여기 포함하지 않는다.
  ipcMain.handle("settings:get-appearance-defaults", () => ({
    petScalePercent: DEFAULT_SETTINGS.petScalePercent,
    tailSpeedPercent: DEFAULT_SETTINGS.tailSpeedPercent,
    shadingEnabled: DEFAULT_SETTINGS.shadingEnabled,
    pixelArtPercent: DEFAULT_SETTINGS.pixelArtPercent,
    paletteEnabled: DEFAULT_SETTINGS.paletteEnabled,
    palettePreset: DEFAULT_SETTINGS.palettePreset,
    paletteSteps: DEFAULT_SETTINGS.paletteSteps,
    paletteCustomStops: DEFAULT_SETTINGS.paletteCustomStops.map((stop) => ({ ...stop })),
    ditherPattern: DEFAULT_SETTINGS.ditherPattern,
    ditherAmount: DEFAULT_SETTINGS.ditherAmount,
    outlineEnabled: DEFAULT_SETTINGS.outlineEnabled,
    outlineColor: DEFAULT_SETTINGS.outlineColor,
    outlineThickness: DEFAULT_SETTINGS.outlineThickness,
    lineWobbleEnabled: DEFAULT_SETTINGS.lineWobbleEnabled,
    lineWobbleFrequency: DEFAULT_SETTINGS.lineWobbleFrequency,
    lineWobbleSpeed: DEFAULT_SETTINGS.lineWobbleSpeed,
    lineWobbleAmount: DEFAULT_SETTINGS.lineWobbleAmount,
    mouseSquishEnabled: DEFAULT_SETTINGS.mouseSquishEnabled,
    keyboardSquishEnabled: DEFAULT_SETTINGS.keyboardSquishEnabled,
    squishStrengthPercent: DEFAULT_SETTINGS.squishStrengthPercent,
    headPettingEnabled: DEFAULT_SETTINGS.headPettingEnabled,
    capsLockAlertEnabled: DEFAULT_SETTINGS.capsLockAlertEnabled,
    dragReactionEnabled: DEFAULT_SETTINGS.dragReactionEnabled,
    sleepEnabled: DEFAULT_SETTINGS.sleepEnabled,
    sleepAfterMinutes: DEFAULT_SETTINGS.sleepAfterMinutes,
    idleRoutineEnabled: DEFAULT_SETTINGS.idleRoutineEnabled,
    idleRoutineMinSeconds: DEFAULT_SETTINGS.idleRoutineMinSeconds,
    idleRoutineMaxSeconds: DEFAULT_SETTINGS.idleRoutineMaxSeconds,
    lighting: JSON.parse(JSON.stringify(DEFAULT_SETTINGS.lighting))
  }));
}

export { registerAppearanceIpcHandlers };
export type { AppearanceIpcDependencies, AppearanceIpcEvent };
