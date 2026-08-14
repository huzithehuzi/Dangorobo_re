// 설정창 상태 정의 (2026-08-10, 바닐라 settings.js 포팅).
// - fromSettings(): main의 settings → 폼 draft. 폴백 값은 바닐라 applyLoadedSettings()와 1:1.
// - buildPayload(): draft → settings:save payload. 키 구성은 바닐라 submit 핸들러와 1:1 —
//   키를 빠뜨리면 저장할 때 그 설정이 유실되므로, 바꿀 때는 반드시 양쪽을 함께 본다.
// 숫자 입력은 input.value 의미 그대로 문자열로 들고 있다가 저장 시 Number()로 바꾼다(바닐라 동일).

// 커스터마이징·사운드 카탈로그는 펫 렌더러·main의 설정 정규화와 값이 어긋나면 안 되므로
// 공용 UMD 모듈에서 가져온다. main.tsx도 읽지만, 여기서 다시 side-effect import 해야
// store.ts보다 먼저 실행되는 게 보장된다. 테마 카탈로그는 일반 TS 모듈로 직접 import한다.
import "../../src/shared/customization-catalog.js";
import "../../src/shared/sound-catalog.js";
import { BUBBLE_THEMES } from "../../src/shared/theme-catalog.js";

const catalog = window.PetCustomizationCatalog;

/** 사운드 드롭다운에 쓸 번호 목록(1부터). 개수의 근거는 실제 파일 목록이다. */
export const ALARM_SOUND_OPTIONS = window.PetSoundCatalog.ALARM_SOUNDS.map((_file, i) => i + 1);
export const TALK_SOUND_OPTIONS = window.PetSoundCatalog.TALK_SOUNDS.map((_file, i) => i + 1);
export const CLICK_SOUND_OPTIONS = window.PetSoundCatalog.CLICK_SOUNDS.map((_file, i) => i + 1);
export { BUBBLE_THEMES };

export const FAVORITE_ITEM_LIMIT = 12;
export const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"];

export const BODY_COLOR_DEFS = catalog.BODY_COLOR_DEFS;
export const PART_VARIATION_DEFS = catalog.PART_VARIATION_DEFS;
export const VARIATION_LABEL_KEYS = catalog.VARIATION_LABEL_KEYS;
export const LIGHTING_DEFS = catalog.LIGHTING_DEFS;
export const FACE_CUSTOMIZATION_DEFS = catalog.FACE_CUSTOMIZATION_DEFS;
export const BODY_CUSTOMIZATION_DEFS = catalog.BODY_CUSTOMIZATION_DEFS;

export type FaceCustomizationKey = "facePattern" | "faceCosmetic" | "faceEyeStyle" | "faceMouthStyle" | "bodyCostume";

export interface GradientStop {
  position: number;
  color: string;
}

export interface LightingState {
  [id: string]: {
    color: string;
    intensity: number;
    groundColor?: string;
    posX?: number;
    posY?: number;
    posZ?: number;
  };
}

/** 폼 스칼라 상태 — 숫자 입력은 문자열(input.value), 체크박스는 boolean, 셀렉트는 문자열 */
export interface Draft {
  language: string;
  weatherCity: string;
  soundEnabled: boolean;
  petScalePercent: string;
  tailSpeedPercent: string;
  shadingEnabled: boolean;
  uiFontEnabled: boolean;
  uiFontPreset: string;
  uiFontSizePercent: string;
  pixelArtPercent: string;
  paletteEnabled: boolean;
  palettePreset: string;
  paletteSteps: string;
  ditherPattern: string;
  ditherAmount: string;
  outlineEnabled: boolean;
  outlineColor: string;
  outlineThickness: string;
  lineWobbleEnabled: boolean;
  lineWobbleFrequency: string;
  lineWobbleSpeed: string;
  lineWobbleAmount: string;
  mouseSquishEnabled: boolean;
  squishStrengthPercent: string;
  keyboardSquishEnabled: boolean;
  keyboardClickEnabled: boolean;
  keyboardClickSound: string;
  keyboardClickVolume: string;
  keyboardClickMinPitch: string;
  keyboardClickMaxPitch: string;
  mouseClickEnabled: boolean;
  mouseClickSound: string;
  mouseClickVolume: string;
  mouseClickMinPitch: string;
  mouseClickMaxPitch: string;
  headPettingEnabled: boolean;
  capsLockAlertEnabled: boolean;
  dragReactionEnabled: boolean;
  sleepEnabled: boolean;
  sleepAfterMinutes: string;
  idleRoutineEnabled: boolean;
  idleRoutineMinSeconds: string;
  idleRoutineMaxSeconds: string;
  fullscreenDndEnabled: boolean;
  petDragMode: string;
  bubbleTheme: string;
  bubbleThemeCustomBg: string;
  bubbleThemeCustomAccent: string;
  bubbleThemeCustomText: string;
  uiScalePercent: string;
  assistantEnabled: boolean;
  animaleseEnabled: boolean;
  animaleseIntervalMs: string;
  animalesePitchPercent: string;
  animalesePetChatEnabled: boolean;
  animaleseSoundStyle: string;
  alarmSound: string;
  assistantApiKey: string;
  assistantClearApiKey: boolean;
  assistantGeminiModel: string;
  assistantShortcut: string;
  assistantShortcutEnabled: boolean;
  assistantPersonality: string;
  assistantCustomPersonality: string;
  assistantMemoryEnabled: boolean;
  assistantMemoryTurns: string;
  memoryTabVisible: boolean;
  assistantUserNickname: string;
  assistantPetNickname: string;
  petChatEnabled: boolean;
  petChatMinMinutes: string;
  petChatMaxMinutes: string;
  pettingChatEnabled: boolean;
  trayMenuItems: Record<string, boolean>;
  favoritesEnabled: boolean;
  favoritesTrayItemsEnabled: boolean;
  favoritesDisplayMode: string;
  favoritesLayoutGrid: boolean;
  favoriteGridLabelsHidden: boolean;
  favoritesShortcut: string;
  favoritesShortcutEnabled: boolean;
  imageResizeShortcut: string;
  imageResizeShortcutEnabled: boolean;
  checklistShortcut: string;
  checklistShortcutEnabled: boolean;
  translateShortcut: string;
  translateShortcutEnabled: boolean;
  documentSummaryShortcut: string;
  documentSummaryShortcutEnabled: boolean;
  documentSummaryTheme: string;
  translatePreferClipboard: boolean;
  imageResizeFilter: string;
  imageResizeScale: string;
  mediaPlayerEnabled: boolean;
  mediaPlayerScale: string;
  mediaPlayerNodEnabled: boolean;
  mediaPlayerOffset: string;
  mediaPlayerOpacity: string;
  facePattern: string;
  faceCosmetic: string;
  faceEyeStyle: string;
  faceMouthStyle: string;
  bodyCostume: string;
  customFaceEnabled: boolean;
  customBodyEnabled: boolean;
}

const TRAY_MENU_KEYS = ["showHidePet", "moveMode", "alarmCountdown", "qaLogs", "checklist", "assistant", "favorites", "autoStart", "weather"];

type AnySettings = Record<string, unknown>;

function str(value: unknown, fallback: string): string {
  return value === undefined || value === null ? fallback : String(value);
}

export function normalizeGradientStops(stops: unknown): GradientStop[] {
  const normalized = (Array.isArray(stops) ? stops : [])
    .filter((stop) => window.PetColorPicker.normalizeHex(stop?.color) && Number.isFinite(Number(stop?.position)))
    .map((stop) => ({
      position: Math.min(1, Math.max(0, Number(stop.position))),
      color: window.PetColorPicker.normalizeHex(stop.color) as string
    }))
    .sort((a, b) => a.position - b.position);
  return normalized.length >= 2
    ? normalized
    : [{ position: 0, color: "#1b1b2a" }, { position: 0.5, color: "#a0567a" }, { position: 1, color: "#ffe6c4" }];
}

export function normalizeBodyColors(bodyColors: unknown): Array<{ id: string; color: string }> {
  const entries = Array.isArray(bodyColors) ? bodyColors : [];
  return BODY_COLOR_DEFS.map((def) => {
    const entry = entries.find((candidate) => candidate?.id === def.id) || {};
    return { id: def.id, color: (entry as { color?: string }).color || def.defaultColor };
  });
}

export function normalizePartVariations(partVariations: unknown): Array<{ id: string; variation: string }> {
  const entries = Array.isArray(partVariations) ? partVariations : [];
  return PART_VARIATION_DEFS.map((def) => {
    const entry = entries.find((candidate) => candidate?.id === def.id) || {};
    return { id: def.id, variation: (entry as { variation?: string }).variation || def.defaultVariation };
  });
}

export function normalizeLightingState(lighting: unknown): LightingState {
  const entries: Record<string, LightingEntry> = {};
  if (Array.isArray(lighting)) {
    for (const entry of lighting) {
      if (entry && typeof entry === "object" && "id" in entry) entries[(entry as { id: string }).id] = entry as LightingEntry;
    }
  } else if (lighting && typeof lighting === "object") {
    Object.assign(entries, lighting as Record<string, LightingEntry>);
  }
  const result: LightingState = {};
  for (const def of LIGHTING_DEFS) {
    const entry = entries[def.id] || {};
    const color = entry.color || (def.id === "ambient" ? "#fff4e8" : def.id === "keyLight" ? "#ffd8ba" : "#7694ff");
    const intensity = entry.intensity ?? (def.id === "ambient" ? 2.25 : def.id === "keyLight" ? 2.5 : 1.25);
    if (def.id === "ambient") {
      result[def.id] = { color, intensity, groundColor: entry.groundColor || "#30384e" };
    } else {
      result[def.id] = {
        color,
        intensity,
        posX: entry.posX ?? (def.id === "keyLight" ? -3 : 4),
        posY: entry.posY ?? (def.id === "keyLight" ? 5 : 3),
        posZ: entry.posZ ?? (def.id === "keyLight" ? 5 : -2)
      };
    }
  }
  return result;
}

/** main의 settings → 폼 draft. 폴백은 바닐라 applyLoadedSettings()와 동일하게 유지한다. */
export function draftFromSettings(s: AnySettings): Draft {
  const trayMenuItems = (s.trayMenuItems || {}) as Record<string, unknown>;
  const mediaPlayer = (s.mediaPlayer || {}) as Record<string, unknown>;
  const keyConfigured = s.assistantKeyConfigured === true;
  return {
    language: window.PetI18n.normalizeLanguage(s.language),
    weatherCity: str(s.weatherCity, ""),
    soundEnabled: Boolean(s.soundEnabled),
    petScalePercent: str(s.petScalePercent, ""),
    tailSpeedPercent: str(s.tailSpeedPercent, ""),
    shadingEnabled: Boolean(s.shadingEnabled),
    uiFontEnabled: s.uiFontEnabled === true,
    uiFontPreset: str(s.uiFontPreset, "gulim") || "gulim",
    uiFontSizePercent: str(s.uiFontSizePercent ?? 100, "100"),
    pixelArtPercent: str(s.pixelArtPercent, ""),
    paletteEnabled: s.paletteEnabled === true,
    palettePreset: str(s.palettePreset, "auto") || "auto",
    paletteSteps: str(s.paletteSteps ?? 12, "12"),
    ditherPattern: str(s.ditherPattern, "none") || "none",
    ditherAmount: str(s.ditherAmount ?? 100, "100"),
    outlineEnabled: s.outlineEnabled === true,
    outlineColor: str(s.outlineColor, "#000000") || "#000000",
    outlineThickness: str(s.outlineThickness ?? 2, "2"),
    lineWobbleEnabled: s.lineWobbleEnabled === true,
    lineWobbleFrequency: str(s.lineWobbleFrequency ?? 6, "6"),
    lineWobbleSpeed: str(s.lineWobbleSpeed ?? 1.5, "1.5"),
    lineWobbleAmount: str(s.lineWobbleAmount ?? 1.5, "1.5"),
    mouseSquishEnabled: Boolean(s.mouseSquishEnabled),
    squishStrengthPercent: str(s.squishStrengthPercent, ""),
    keyboardSquishEnabled: Boolean(s.keyboardSquishEnabled),
    keyboardClickEnabled: s.keyboardClickEnabled === true,
    keyboardClickSound: str(s.keyboardClickSound ?? 2, "2"),
    keyboardClickVolume: str(s.keyboardClickVolume ?? 60, "60"),
    keyboardClickMinPitch: str(s.keyboardClickMinPitch ?? 90, "90"),
    keyboardClickMaxPitch: str(s.keyboardClickMaxPitch ?? 110, "110"),
    mouseClickEnabled: s.mouseClickEnabled === true,
    mouseClickSound: str(s.mouseClickSound ?? 1, "1"),
    mouseClickVolume: str(s.mouseClickVolume ?? 60, "60"),
    mouseClickMinPitch: str(s.mouseClickMinPitch ?? 90, "90"),
    mouseClickMaxPitch: str(s.mouseClickMaxPitch ?? 110, "110"),
    headPettingEnabled: s.headPettingEnabled !== false,
    capsLockAlertEnabled: s.capsLockAlertEnabled !== false,
    dragReactionEnabled: s.dragReactionEnabled !== false,
    sleepEnabled: s.sleepEnabled !== false,
    sleepAfterMinutes: str(s.sleepAfterMinutes ?? 5, "5"),
    idleRoutineEnabled: s.idleRoutineEnabled !== false,
    idleRoutineMinSeconds: str(s.idleRoutineMinSeconds ?? 18, "18"),
    idleRoutineMaxSeconds: str(s.idleRoutineMaxSeconds ?? 42, "42"),
    fullscreenDndEnabled: s.fullscreenDndEnabled === true,
    petDragMode: s.petDragMode === "toggle" ? "toggle" : "always",
    bubbleTheme: str(s.bubbleTheme, "charcoal") || "charcoal",
    bubbleThemeCustomBg: str(s.bubbleThemeCustomBg, "#20232b") || "#20232b",
    bubbleThemeCustomAccent: str(s.bubbleThemeCustomAccent, "#d75566") || "#d75566",
    bubbleThemeCustomText: str(s.bubbleThemeCustomText, "#f7f7f9") || "#f7f7f9",
    uiScalePercent: str(s.uiScalePercent ?? 100, "100"),
    assistantEnabled: s.assistantEnabled === true && keyConfigured,
    animaleseEnabled: s.animaleseEnabled === true,
    animaleseIntervalMs: str(s.animaleseIntervalMs ?? 45, "45"),
    animalesePitchPercent: str(s.animalesePitchPercent ?? 8, "8"),
    animalesePetChatEnabled: s.animalesePetChatEnabled === true,
    animaleseSoundStyle: str(s.animaleseSoundStyle ?? 1, "1"),
    alarmSound: str(s.alarmSound ?? 1, "1"),
    assistantApiKey: "",
    assistantClearApiKey: false,
    assistantGeminiModel: str(s.assistantGeminiModel, "gemini-3.1-flash-lite") || "gemini-3.1-flash-lite",
    assistantShortcut: str(s.assistantShortcut, "CommandOrControl+Shift+A") || "CommandOrControl+Shift+A",
    assistantShortcutEnabled: s.assistantShortcutEnabled !== false,
    assistantPersonality: str(s.assistantPersonality, "friend") || "friend",
    assistantCustomPersonality: str(s.assistantCustomPersonality, ""),
    assistantMemoryEnabled: s.assistantMemoryEnabled === true,
    assistantMemoryTurns: str(s.assistantMemoryTurns ?? 3, "3"),
    memoryTabVisible: s.memoryTabVisible === true,
    assistantUserNickname: str(s.assistantUserNickname, ""),
    assistantPetNickname: str(s.assistantPetNickname, ""),
    petChatEnabled: s.petChatEnabled === true,
    petChatMinMinutes: str(s.petChatMinMinutes ?? 3, "3"),
    petChatMaxMinutes: str(s.petChatMaxMinutes ?? 20, "20"),
    pettingChatEnabled: s.pettingChatEnabled === true,
    trayMenuItems: Object.fromEntries(TRAY_MENU_KEYS.map((key) => [key, trayMenuItems[key] !== false])),
    favoritesEnabled: s.favoritesEnabled === true,
    favoritesTrayItemsEnabled: s.favoritesTrayItemsEnabled === true,
    favoritesDisplayMode: str(s.favoritesDisplayMode, "bubble") || "bubble",
    favoritesLayoutGrid: s.favoritesLayout === "grid",
    favoriteGridLabelsHidden: s.favoriteGridLabelsHidden === true,
    favoritesShortcut: str(s.favoritesShortcut, "CommandOrControl+Shift+F") || "CommandOrControl+Shift+F",
    favoritesShortcutEnabled: s.favoritesShortcutEnabled !== false,
    imageResizeShortcut: str(s.imageResizeShortcut, "CommandOrControl+Shift+R") || "CommandOrControl+Shift+R",
    imageResizeShortcutEnabled: s.imageResizeShortcutEnabled !== false,
    checklistShortcut: str(s.checklistShortcut, "CommandOrControl+Shift+T") || "CommandOrControl+Shift+T",
    checklistShortcutEnabled: s.checklistShortcutEnabled !== false,
    translateShortcut: str(s.translateShortcut, "CommandOrControl+Shift+E") || "CommandOrControl+Shift+E",
    translateShortcutEnabled: s.translateShortcutEnabled !== false,
    documentSummaryShortcut: str(s.documentSummaryShortcut, "CommandOrControl+Shift+D") || "CommandOrControl+Shift+D",
    documentSummaryShortcutEnabled: s.documentSummaryShortcutEnabled !== false,
    documentSummaryTheme: str(s.documentSummaryTheme, "app") || "app",
    translatePreferClipboard: s.translatePreferClipboard !== false,
    imageResizeFilter: str(s.imageResizeFilter, "nearest") || "nearest",
    imageResizeScale: str(s.imageResizeScale || 2, "2"),
    mediaPlayerEnabled: mediaPlayer.enabled === true,
    mediaPlayerScale: str(mediaPlayer.scale ?? 100, "100"),
    mediaPlayerNodEnabled: mediaPlayer.nodEnabled !== false,
    mediaPlayerOffset: str(mediaPlayer.verticalOffset ?? 8, "8"),
    mediaPlayerOpacity: str(mediaPlayer.opacity ?? 100, "100"),
    facePattern: str(s.facePattern ?? 0, "0"),
    faceCosmetic: str(s.faceCosmetic ?? 0, "0"),
    faceEyeStyle: str(s.faceEyeStyle ?? 1, "1"),
    faceMouthStyle: str(s.faceMouthStyle ?? 0, "0"),
    bodyCostume: str(s.bodyCostume ?? 0, "0"),
    customFaceEnabled: s.customFaceEnabled === true,
    customBodyEnabled: s.customBodyEnabled === true
  };
}

export interface ComplexState {
  alarms: AlarmItem[];
  favoriteItems: FavoriteEditItem[];
  paletteStops: GradientStop[];
  lighting: LightingState;
  bodyColors: Array<{ id: string; color: string }>;
  partVariations: Array<{ id: string; variation: string }>;
}

/** 커스터마이징 미리보기/프리셋 공용 payload (바닐라 collectFaceCustomization과 동일) */
export function faceCustomizationPayload(d: Draft): Record<string, unknown> {
  return {
    facePattern: Number(d.facePattern || 0),
    faceCosmetic: Number(d.faceCosmetic || 0),
    faceEyeStyle: Number(d.faceEyeStyle || 0),
    faceMouthStyle: Number(d.faceMouthStyle || 0),
    bodyCostume: Number(d.bodyCostume || 0),
    customFaceEnabled: d.customFaceEnabled === true,
    customBodyEnabled: d.customBodyEnabled === true
  };
}

/** settings:save payload — 바닐라 submit 핸들러의 객체 리터럴과 키 단위로 1:1 대응 */
export function buildPayload(d: Draft, c: ComplexState, defaultFavoriteName: string): Record<string, unknown> {
  return {
    language: d.language,
    weatherCity: d.weatherCity,
    alarms: c.alarms,
    soundEnabled: d.soundEnabled,
    petScalePercent: Number(d.petScalePercent),
    tailSpeedPercent: Number(d.tailSpeedPercent),
    shadingEnabled: d.shadingEnabled,
    uiFontEnabled: d.uiFontEnabled,
    uiFontPreset: d.uiFontPreset,
    pixelArtPercent: Number(d.pixelArtPercent),
    paletteEnabled: d.paletteEnabled,
    palettePreset: d.palettePreset,
    paletteSteps: Number(d.paletteSteps),
    paletteCustomStops: c.paletteStops.map((stop) => ({ ...stop })),
    ditherPattern: d.ditherPattern,
    ditherAmount: Number(d.ditherAmount),
    outlineEnabled: d.outlineEnabled,
    outlineColor: d.outlineColor,
    outlineThickness: Number(d.outlineThickness),
    lineWobbleEnabled: d.lineWobbleEnabled,
    lineWobbleFrequency: Number(d.lineWobbleFrequency),
    lineWobbleSpeed: Number(d.lineWobbleSpeed),
    lineWobbleAmount: Number(d.lineWobbleAmount),
    mouseSquishEnabled: d.mouseSquishEnabled,
    squishStrengthPercent: Number(d.squishStrengthPercent),
    keyboardSquishEnabled: d.keyboardSquishEnabled,
    keyboardClickEnabled: d.keyboardClickEnabled,
    keyboardClickSound: Number(d.keyboardClickSound),
    keyboardClickVolume: Number(d.keyboardClickVolume),
    keyboardClickMinPitch: Number(d.keyboardClickMinPitch),
    keyboardClickMaxPitch: Number(d.keyboardClickMaxPitch),
    mouseClickEnabled: d.mouseClickEnabled,
    mouseClickSound: Number(d.mouseClickSound),
    mouseClickVolume: Number(d.mouseClickVolume),
    mouseClickMinPitch: Number(d.mouseClickMinPitch),
    mouseClickMaxPitch: Number(d.mouseClickMaxPitch),
    headPettingEnabled: d.headPettingEnabled,
    capsLockAlertEnabled: d.capsLockAlertEnabled,
    dragReactionEnabled: d.dragReactionEnabled,
    sleepEnabled: d.sleepEnabled,
    sleepAfterMinutes: Number(d.sleepAfterMinutes),
    idleRoutineEnabled: d.idleRoutineEnabled,
    idleRoutineMinSeconds: Number(d.idleRoutineMinSeconds),
    idleRoutineMaxSeconds: Number(d.idleRoutineMaxSeconds),
    fullscreenDndEnabled: d.fullscreenDndEnabled,
    petDragMode: d.petDragMode,
    bubbleTheme: d.bubbleTheme,
    bubbleThemeCustomBg: d.bubbleThemeCustomBg,
    bubbleThemeCustomAccent: d.bubbleThemeCustomAccent,
    bubbleThemeCustomText: d.bubbleThemeCustomText,
    uiScalePercent: Number(d.uiScalePercent),
    uiFontSizePercent: Number(d.uiFontSizePercent),
    assistantEnabled: d.assistantEnabled,
    animaleseEnabled: d.animaleseEnabled,
    animaleseIntervalMs: Number(d.animaleseIntervalMs),
    animalesePitchPercent: Number(d.animalesePitchPercent),
    animalesePetChatEnabled: d.animalesePetChatEnabled,
    animaleseSoundStyle: Number(d.animaleseSoundStyle),
    alarmSound: Number(d.alarmSound),
    assistantApiKey: d.assistantApiKey,
    assistantClearApiKey: d.assistantClearApiKey,
    assistantGeminiModel: d.assistantGeminiModel,
    assistantShortcut: d.assistantShortcut,
    assistantShortcutEnabled: d.assistantShortcutEnabled,
    assistantPersonality: d.assistantPersonality,
    assistantCustomPersonality: d.assistantCustomPersonality,
    assistantMemoryEnabled: d.assistantMemoryEnabled,
    assistantMemoryTurns: Number(d.assistantMemoryTurns),
    memoryTabVisible: d.memoryTabVisible,
    assistantUserNickname: d.assistantUserNickname,
    assistantPetNickname: d.assistantPetNickname,
    petChatEnabled: d.petChatEnabled,
    petChatMinMinutes: Number(d.petChatMinMinutes),
    petChatMaxMinutes: Number(d.petChatMaxMinutes),
    pettingChatEnabled: d.pettingChatEnabled,
    trayMenuItems: { ...d.trayMenuItems },
    favoritesEnabled: d.favoritesEnabled,
    favoritesTrayItemsEnabled: d.favoritesTrayItemsEnabled,
    favoritesDisplayMode: d.favoritesDisplayMode,
    favoritesLayout: d.favoritesLayoutGrid ? "grid" : "list",
    favoriteGridLabelsHidden: d.favoriteGridLabelsHidden,
    favoritesShortcut: d.favoritesShortcut,
    favoritesShortcutEnabled: d.favoritesShortcutEnabled,
    imageResizeShortcut: d.imageResizeShortcut,
    imageResizeShortcutEnabled: d.imageResizeShortcutEnabled,
    checklistShortcut: d.checklistShortcut,
    checklistShortcutEnabled: d.checklistShortcutEnabled,
    translateShortcut: d.translateShortcut,
    translateShortcutEnabled: d.translateShortcutEnabled,
    documentSummaryShortcut: d.documentSummaryShortcut,
    documentSummaryShortcutEnabled: d.documentSummaryShortcutEnabled,
    documentSummaryTheme: d.documentSummaryTheme,
    translatePreferClipboard: d.translatePreferClipboard,
    imageResizeFilter: d.imageResizeFilter,
    imageResizeScale: Number(d.imageResizeScale),
    mediaPlayer: {
      enabled: d.mediaPlayerEnabled,
      scale: Number(d.mediaPlayerScale),
      nodEnabled: d.mediaPlayerNodEnabled,
      verticalOffset: Number(d.mediaPlayerOffset),
      opacity: Number(d.mediaPlayerOpacity)
    },
    favoriteItems: c.favoriteItems.slice(0, FAVORITE_ITEM_LIMIT).map((item) => ({
      id: item.id,
      name: String(item.name || defaultFavoriteName).trim().slice(0, 32),
      target: item.target,
      iconTemplate: item.customIcon ? "" : item.iconTemplate || "",
      iconColor: !item.customIcon && item.iconTemplate ? item.iconColor || "#ffffff" : "",
      customIcon: item.customIcon || ""
    })),
    ...faceCustomizationPayload(d),
    bodyColors: c.bodyColors.map((entry) => ({ ...entry })),
    partVariations: c.partVariations.map((entry) => ({ ...entry })),
    lighting: JSON.parse(JSON.stringify(c.lighting))
  };
}
