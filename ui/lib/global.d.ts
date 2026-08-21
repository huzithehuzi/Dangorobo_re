// React 창들이 쓰는 전역 계약 타입 (2026-08-10).
// - window.desktopPet: preload.ts가 contextBridge로 노출하는 IPC 브리지 중, 전환된 창이
//   실제로 쓰는 부분만 선언한다. 창을 추가로 전환할 때마다 여기에 메서드를 추가한다.
// - window.PetI18n / PetUiMotion: src/shared/의 UMD·전역 스크립트를 side-effect import로
//   로드해 쓰므로 전역 타입으로 선언한다.

/** 질문·답변 기록 항목 (src/main/assistant/assistant-logs.js의 normalizeAssistantLogEntry 산출 형태) */
interface AssistantLogEntry {
  id: string;
  timestamp: string;
  question?: string;
  answer?: string;
  model?: string;
  personality?: string;
  /** 펫이 먼저 건 말 기록이면 "petChat" */
  type?: string;
  petMessage?: string;
}

/** 창 외형 적용에 쓰이는 설정 부분집합 (전체 Settings 타입은 설정창 전환 때 도입) */
interface WindowAppearanceSettings {
  language?: string;
  bubbleTheme?: string;
  bubbleThemeCustomBg?: string;
  bubbleThemeCustomAccent?: string;
  bubbleThemeCustomText?: string;
  uiScalePercent?: number;
  uiFontSizePercent?: number;
  uiFontEnabled?: boolean;
  uiFontPreset?: string;
  /**
   * 외형은 아니지만 창이 스스로 동작을 정할 때 본다 — 플로팅 독은 이 값으로 자기가
   * "커서 파이"인지 판단한다. 이벤트 한 번을 놓쳐도 설정은 언제든 다시 물어볼 수 있다.
   */
  favoritesDisplayMode?: string;
}

interface PetI18nApi {
  SUPPORTED_LANGUAGES: string[];
  DEFAULT_LANGUAGE: string;
  normalizeLanguage(value: unknown): string;
  detectDefaultLanguage(locale: string): string;
  t(language: string, key: string, vars?: Record<string, string | number>): string;
  applyDomTranslations(scope: Document | Element, language: string): void;
}

/** 컨텍스트 메뉴 항목 (main.js가 만들어 보낸다 — label은 이미 번역된 문자열) */
interface ContextMenuItem {
  id?: string;
  type?: "checkbox" | "separator" | "favorite-grid" | string;
  label?: string;
  enabled?: boolean;
  checked?: boolean;
  iconDataUrl?: string | null;
  iconTemplate?: string | null;
  iconColor?: string | null;
  hideLabel?: boolean;
  items?: ContextMenuItem[];
}

/** 체크리스트 항목 (src/main/windows/checklist.js의 normalizeChecklistItem 산출 형태) */
interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** 즐겨찾기 실행 항목 (main의 favorites:list / favorites:items payload) */
interface FavoriteItemPayload {
  id: string;
  name?: string;
  /** 추출·커스텀 아이콘 data URL */
  icon?: string | null;
  iconTemplate?: string | null;
  iconColor?: string | null;
}

interface FavoritesPayload {
  items?: FavoriteItemPayload[];
  layout?: string;
  hideLabels?: boolean;
}

interface FavoriteIconsApi {
  TEMPLATES: Array<{ id: string; labelKey: string }>;
  TEMPLATE_IDS: string[];
  isValidTemplateId(id: unknown): boolean;
  svgMarkup(id: string, color: string): string;
  autoIconMarkup(): string;
}

interface DesktopPetApi {
  getSettings(): Promise<WindowAppearanceSettings>;
  getAssistantLogs(): Promise<AssistantLogEntry[]>;
  deleteAssistantLog(id: string): Promise<boolean>;
  clearAssistantLogs(): Promise<boolean>;
  onSettingsUpdated(callback: (settings: WindowAppearanceSettings) => void): void;
  onAssistantLogAdded(callback: (entry: AssistantLogEntry) => void): void;
  onContextMenuItems(callback: (items: ContextMenuItem[]) => void): void;
  sendContextMenuAction(id: string): void;
  closeContextMenu(): void;
  listFavorites(): Promise<FavoritesPayload>;
  activateFavorite(selection: { type: string; id: string }): Promise<{ ok?: boolean; error?: string } | undefined>;
  closeFavoritesWindow(): void;
  onFavoriteItems(callback: (payload: FavoritesPayload) => void): void;
  hideFavoritesDock(): void;
  setFavoritesDockExpanded(expanded: boolean): void;
  favoritesDockDragStart(): void;
  favoritesDockDragMove(delta: { dx: number; dy: number }): void;
  favoritesDockDragEnd(): void;
  onFavoritesDockExpanded(callback: (payload: { expanded?: boolean; cursorMode?: boolean }) => void): void;
  getChecklist(): Promise<ChecklistItem[]>;
  addChecklistItem(text: string): Promise<ChecklistItem[]>;
  toggleChecklistItem(id: string): Promise<ChecklistItem[]>;
  deleteChecklistItem(id: string): Promise<ChecklistItem[]>;
  clearChecklist(): Promise<ChecklistItem[]>;
  reorderChecklist(orderedIds: string[]): Promise<ChecklistItem[]>;
  closeChecklist(): void;
}

/** 공용 HSV 색 선택기(src/shared/color-picker.js)의 필드 객체 */
interface PetColorPickerField {
  element: HTMLElement;
  getValue(): string;
  setValue(hex: string): void;
  value: string;
  disabled: boolean;
}

interface PetColorPickerApi {
  createField(options: {
    value?: string;
    placeholder?: string;
    title?: string;
    ariaLabel?: string;
    onPreview?: (hex: string) => void;
    onCommit?: (hex: string) => void;
  }): PetColorPickerField;
  normalizeHex(value: unknown): string | null;
  hexToRgb(hex: string): [number, number, number];
  rgbToHex(r: number, g: number, b: number): string;
}

/** 알람 항목 (settings-schema.js normalizeAlarm 산출 형태) */
interface AlarmItem {
  id: string;
  title?: string;
  message?: string;
  type: "interval" | "hourly" | "daily" | "once" | string;
  enabled?: boolean;
  soundFile?: string;
  intervalMinutes?: number;
  hourlyInterval?: number;
  dailyTime?: string;
  daysOfWeek?: number[];
  fireAt?: string;
  weatherBriefingEnabled?: boolean;
}

/** 설정창 즐겨찾기 편집 항목 */
interface FavoriteEditItem {
  id: string;
  name?: string;
  target: string;
  iconTemplate?: string;
  iconColor?: string;
  customIcon?: string;
  customIconDataUrl?: string;
}

interface CustomizationPreset {
  id: string;
  name: string;
  bodyColors?: Array<{ id: string; color: string }>;
  partVariations?: Array<{ id: string; variation: string }>;
  facePattern?: number;
  faceCosmetic?: number;
  faceEyeStyle?: number;
  faceMouthStyle?: number;
  bodyCostume?: number;
  customFaceEnabled?: boolean;
  customBodyEnabled?: boolean;
}

interface LightingEntry {
  color?: string;
  intensity?: number;
  groundColor?: string;
  posX?: number;
  posY?: number;
  posZ?: number;
}

interface MemoryRow {
  id: number;
  category?: string;
  memory_label?: string;
  memory_value?: string;
  importance?: number;
  mention_count?: number;
  is_verified?: boolean;
}

interface OpenLoopRow {
  id: number;
  topic?: string;
  last_mentioned_at?: string;
}

interface OkResult {
  ok?: boolean;
  canceled?: boolean;
  error?: string;
  recoveryIncomplete?: boolean;
}

/** 설정창 전용 preload API (바닐라 settings.js가 쓰던 표면 그대로) */
interface DesktopPetSettingsApi {
  saveSettings(payload: Record<string, unknown>): Promise<OkResult | undefined>;
  getInstalledFonts(): Promise<string[]>;
  getAppearanceDefaults(): Promise<Record<string, unknown> | null>;
  previewBubbleTheme(theme: string, bg: string, accent: string, text: string): void;
  previewBodyColors(bodyColors: Array<{ id: string; color: string }>): void;
  previewPartVariations(partVariations: Array<{ id: string; variation: string }>): void;
  previewFaceCustomization(payload: Record<string, unknown>): void;
  previewLighting(lighting: Record<string, LightingEntry>): void;
  openPetCustomize(): void;
  onBodyColorsChanged(callback: (bodyColors: Array<{ id: string; color: string }>) => void): void;
  pickFavoriteTarget(): Promise<(OkResult & { id?: string; name?: string; target?: string }) | undefined>;
  pickFavoriteIcon(): Promise<(OkResult & { iconPath?: string; iconDataUrl?: string }) | undefined>;
  importCustomFaceZip(): Promise<(OkResult & { keys?: string[] }) | undefined>;
  getCustomFaceTextures(): Promise<Record<string, string>>;
  importCustomBodyImage(): Promise<OkResult | undefined>;
  getCustomBodyTexture(): Promise<string | null>;
  saveCustomizationPreset(preset: Record<string, unknown>): Promise<CustomizationPreset[]>;
  deleteCustomizationPreset(id: string): Promise<CustomizationPreset[]>;
  exportCustomizationPreset(preset: CustomizationPreset): Promise<OkResult | undefined>;
  importCustomizationPreset(): Promise<(OkResult & { preset?: CustomizationPreset }) | undefined>;
  renderPresetThumbnails(presets: CustomizationPreset[]): Promise<Record<string, string>>;
  exportAllSettings(): Promise<OkResult | undefined>;
  importAllSettings(): Promise<(OkResult & Record<string, unknown>) | undefined>;
  openSummaryFolder(): Promise<void>;
  testAlarm(soundFile?: string): void;
  pickAlarmSound(): Promise<(OkResult & { filePath?: string }) | undefined>;
  // 개발자 모드(2026-08-15): 설정창 숨김 탭 전용.
  testWeatherBriefing(): void;
  forceExpression(expressionKey: string | null): void;
  setDebugOverlay(enabled: boolean): void;
  shortcutRecordingStart(): void;
  shortcutRecordingEnd(): void;
  onQueryUnsaved(callback: () => void): void;
  replyUnsavedCheck(isDirty: boolean): void;
  // forgottenCount는 화면 숫자가 아니라 "기억 관리" 탭을 보여줄지 정하는 데 쓴다
  // (잊은 기억을 되살릴 곳이 그 탭뿐인데 기본으로 숨어 있다).
  getMemoryStats(): Promise<{ memoryCount?: number; loopsCount?: number; episodesCount?: number; forgottenCount?: number }>;
  getMemories(category: string): Promise<MemoryRow[]>;
  getForgottenMemories(): Promise<MemoryRow[]>;
  restoreForgottenMemory(id: number): Promise<boolean>;
  verifyMemory(id: number): Promise<unknown>;
  unverifyMemory(id: number): Promise<unknown>;
  deleteMemory(id: number): Promise<unknown>;
  getOpenLoops(): Promise<OpenLoopRow[]>;
  closeOpenLoop(id: number, notes: string): Promise<unknown>;
  importMemories(memories: unknown[]): Promise<number>;
  clearAllMemories(): Promise<boolean>;
}

/** 색을 따로 지정할 수 있는 부위 (src/shared/customization-catalog.js) */
interface PetBodyColorDef {
  id: string;
  labelKey: string;
  /** 저장값이 없거나 올바르지 않을 때와 최초 출하 설정에 쓰는 기본색 */
  defaultColor: string;
}

/** 교체 가능한 파츠. variations는 GLB 안의 오브젝트 이름과 1:1이다. */
interface PetPartVariationDef {
  id: string;
  labelKey: string;
  variations: string[];
  defaultVariation: string;
}

/** 얼굴/몸 무늬 드롭다운 한 줄. count는 "1..count번 텍스처가 있다"는 뜻이다. */
interface PetCustomizationSlotDef {
  key: string;
  labelKey: string;
  count: number;
  allowNone: boolean;
}

interface PetLightingDef {
  id: string;
  labelKey: string;
}

/** 펫 커스터마이징 카탈로그 — main·펫 렌더러·설정창이 공유하는 유일한 기준 */
interface PetCustomizationCatalogApi {
  FACE_PATTERN_COUNT: number;
  FACE_COSMETIC_COUNT: number;
  FACE_EYE_STYLE_COUNT: number;
  FACE_MOUTH_STYLE_COUNT: number;
  BODY_COSTUME_COUNT: number;
  BODY_COLOR_DEFS: PetBodyColorDef[];
  PART_VARIATION_DEFS: PetPartVariationDef[];
  VARIATION_LABEL_KEYS: Record<string, string>;
  FACE_CUSTOMIZATION_DEFS: PetCustomizationSlotDef[];
  BODY_CUSTOMIZATION_DEFS: PetCustomizationSlotDef[];
  LIGHTING_DEFS: PetLightingDef[];
  variationsFor(id: string): string[];
}

/** 사운드 파일 목록 (src/shared/sound-catalog.js). 설정에 저장되는 값은 배열 인덱스 + 1이다. */
interface PetSoundCatalogApi {
  ALARM_SOUNDS: string[];
  TALK_SOUNDS: string[];
  CLICK_SOUNDS: string[];
  ALARM_SOUND_COUNT: number;
  TALK_SOUND_COUNT: number;
  CLICK_SOUND_COUNT: number;
  soundFile(sounds: string[], index: unknown): string;
  byIndex(sounds: string[]): Record<number, string>;
}

interface Window {
  desktopPet: DesktopPetApi & DesktopPetSettingsApi;
  PetI18n: PetI18nApi;
  PetUiMotion?: { markReady(): void };
  FavoriteIcons?: FavoriteIconsApi;
  PetColorPicker: PetColorPickerApi;
  PetCustomizationCatalog: PetCustomizationCatalogApi;
  PetSoundCatalog: PetSoundCatalogApi;
}

// src/shared/의 UMD·전역 스크립트는 side-effect import로만 쓴다(값 import 금지).
declare module "*/shared/i18n.js";
declare module "*/shared/ui-motion.js";
declare module "*/shared/customization-catalog.js";
declare module "*/shared/sound-catalog.js";
