// 펫 창의 전역은 preload의 contextBridge와 index.html에서 먼저 읽는 공용 스크립트가 만든다.
// 렌더러가 실제로 사용하는 표면만 선언해, 노출 API가 바뀌면 펫 타입 검사에서 바로 잡는다.

type PetLanguage = "ko" | "en" | "ja";
type PetTranslateLanguage = "ko" | "en" | "ja" | "zh-CN" | "es" | "fr" | "de";
type PetInputSource = "keyboard" | "mouse";
type PetMediaCommand = "previous" | "play" | "pause" | "next";
type PetRendererSettings = import("../src/main/settings-schema.js").Settings & {
  assistantKeyConfigured: boolean;
};
type PetBodyColor = PetRendererSettings["bodyColors"][number];
type PetCustomizationPreset = PetRendererSettings["customizationPresets"][number];

interface PetPoint {
  x: number;
  y: number;
}

interface PetWindowBounds extends PetPoint {
  width: number;
  height: number;
}

interface PetRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PetPresetThumbnailRequest {
  requestId: number;
  presets: PetCustomizationPreset[];
}

interface PetPresetThumbnailResult {
  requestId: number;
  thumbnails: Record<string, string>;
}

interface PetCustomizeModePayload {
  active: boolean;
  bodyColors?: PetBodyColor[];
}

interface PetInteractionMode {
  clickThrough: boolean;
}

interface PetTranslateOpenPayload {
  initialText: string;
  target: PetTranslateLanguage;
}

type PetTranslateResult =
  | { ok: true; translated: string; languageLabel: string }
  | { ok: false; error: string };

interface PetDocumentSummaryOpenPayload {
  initialText: string;
  extraRequest?: string;
}

interface PetDocumentSummaryRequest {
  text: string;
  extraRequest: string;
}

type PetDocumentSummaryResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; error: string };

type PetOpenDocumentResult =
  | { ok: true }
  | { ok: false; error?: string };

type PetImageResizeResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

interface PetMediaUpdate {
  status: string;
}

interface PetWeatherLine {
  icon: string;
  text: string;
}

interface PetRestStartPayload {
  title: string;
  message: string;
  soundDataUrl: string | null;
  weatherLines?: PetWeatherLine[] | null;
}

type PetAssistantResult =
  | { ok: true; answer: string; expression: string }
  | { ok: false; error: string };

type PetActionResult =
  | { ok: true }
  | { ok: false; error: string };

interface PetChatOpenPayload {
  message: string;
  expression: string | null;
}

interface PetFavoriteLaunchItem {
  id: string;
  name: string;
  icon?: string | null;
  iconTemplate?: string | null;
  iconColor?: string | null;
}

interface PetFavoritesOpenPayload {
  items: PetFavoriteLaunchItem[];
  layout?: "list" | "grid";
  hideLabels?: boolean;
}

interface PetFavoriteSelection {
  type: "item";
  id: string;
}

interface PetDesktopApi {
  getCursor(): Promise<PetPoint>;
  getWindowBounds(): Promise<PetWindowBounds | null>;
  getMode(): Promise<PetInteractionMode>;
  getSettings(): Promise<PetRendererSettings>;
  getCustomFaceTextures(): Promise<Record<string, string>>;
  onCustomFaceTexturesUpdated(callback: (textures: Record<string, string>) => void): void;
  getCustomBodyTexture(): Promise<string | null>;
  onCustomBodyTextureUpdated(callback: (dataUrl: string | null) => void): void;
  reportVisualTop(value: number): void;
  onRenderPresetThumbnails(callback: (payload: PetPresetThumbnailRequest) => void): void;
  sendPresetThumbnails(payload: PetPresetThumbnailResult): void;
  reportMediaPlayerRect(rect: PetRectangle | null): void;
  setCustomizeColor(id: string, color: string): void;
  exitCustomizeMode(): void;
  cancelCustomizeMode(): void;
  onCustomizeMode(callback: (payload: PetCustomizeModePayload) => void): void;
  onClickSound(callback: (source: PetInputSource) => void): void;
  onSettingsUpdated(callback: (settings: PetRendererSettings) => void): void;
  onInteractionMode(callback: (state: PetInteractionMode) => void): void;
  onTypingIntensity(callback: (intensity: number) => void): void;
  onSquishPulse(callback: (source: PetInputSource) => void): void;
  onPetting(callback: (state: { active: boolean }) => void): void;
  onCelebrate(callback: () => void): void;
  onCapsLock(callback: (state: { active: boolean }) => void): void;
  onIdle(callback: (state: { idle: boolean }) => void): void;
  onDragState(callback: (state: { dragging: boolean }) => void): void;
  closeTranslate(): void;
  onTranslateClose(callback: () => void): void;
  onOpenTranslate(callback: (payload: PetTranslateOpenPayload) => void): void;
  copyTranslatedText(text: string): void;
  runTranslate(targetLanguage: string, text: string): Promise<PetTranslateResult>;
  closeDocumentSummary(): void;
  onDocumentSummaryClose(callback: () => void): void;
  onOpenDocumentSummary(callback: (payload: PetDocumentSummaryOpenPayload) => void): void;
  runDocumentSummary(payload: PetDocumentSummaryRequest): Promise<PetDocumentSummaryResult>;
  openDocumentSummary(filePath: string): Promise<PetOpenDocumentResult>;
  closeImageResize(): void;
  onImageResizeClose(callback: () => void): void;
  onOpenImageResize(callback: () => void): void;
  resizeImage(scale: number, filter: string): Promise<PetImageResizeResult>;
  sendMediaCommand(action: PetMediaCommand): void;
  onMediaUpdate(callback: (data: PetMediaUpdate) => void): void;
  onRestStart(callback: (payload: PetRestStartPayload) => void): void;
  onRestEnd(callback: () => void): void;
  closePetChat(): void;
  closeAssistant(): void;
  askAssistant(question: string): Promise<PetAssistantResult>;
  callPetChatNow(): Promise<PetActionResult>;
  petChatReply(reply: string): Promise<PetAssistantResult>;
  closeFavorites(): void;
  activateFavorite(selection: PetFavoriteSelection): Promise<PetActionResult>;
  onFavoritesOpen(callback: (payload: PetFavoritesOpenPayload) => void): void;
  onFavoritesClose(callback: () => void): void;
  onAssistantQuestionOpen(callback: () => void): void;
  onAssistantClose(callback: () => void): void;
  onPetChatOpen(callback: (payload: PetChatOpenPayload) => void): void;
  confirmRest(): void;
}

interface PetFavoriteIconsApi {
  svgMarkup(id: string, color?: string | null): string;
}

interface PetBodyColorDefinition {
  id: string;
  labelKey: string;
  defaultColor: string;
}

interface PetPartVariationDefinition {
  id: string;
  labelKey: string;
  variations: string[];
  defaultVariation: string;
}

interface PetCustomizationCatalogApi {
  FACE_PATTERN_COUNT: number;
  FACE_COSMETIC_COUNT: number;
  FACE_EYE_STYLE_COUNT: number;
  FACE_MOUTH_STYLE_COUNT: number;
  BODY_COSTUME_COUNT: number;
  BODY_COLOR_DEFS: PetBodyColorDefinition[];
  PART_VARIATION_DEFS: PetPartVariationDefinition[];
  variationsFor(id: string): string[];
}

interface PetSoundCatalogApi {
  ALARM_SOUNDS: string[];
  TALK_SOUNDS: string[];
  CLICK_SOUNDS: string[];
  byIndex(sounds: string[]): Record<number, string>;
}

interface PetI18nApi {
  DEFAULT_LANGUAGE: PetLanguage;
  normalizeLanguage(value: unknown): PetLanguage;
  t(language: string, key: string, vars?: Record<string, unknown>): string;
  applyDomTranslations(root: ParentNode | null | undefined, language: string): void;
}

interface PetColorPickerPanel {
  element: HTMLElement;
  setColor(hex: unknown): void;
  getColor(): string;
}

interface PetColorPickerApi {
  hexToRgb(hex: unknown): [number, number, number];
  createPanel(options?: {
    onPreview?: (hex: string) => void;
    onCommit?: (hex: string) => void;
  }): PetColorPickerPanel;
}

interface PetUiMotionApi {
  markReady(): void;
}

interface Window {
  desktopPet: PetDesktopApi;
  FavoriteIcons: PetFavoriteIconsApi;
  PetCustomizationCatalog: PetCustomizationCatalogApi;
  PetSoundCatalog: PetSoundCatalogApi;
  PetI18n: PetI18nApi;
  PetColorPicker: PetColorPickerApi;
  PetUiMotion: PetUiMotionApi;
  webkitAudioContext?: typeof AudioContext;
}
