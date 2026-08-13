import { contextBridge, ipcRenderer } from "electron";

/*
 * 이 파일은 렌더러가 쓸 창구를 IPC 채널로 그대로 넘겨주는 얇은 다리다. 넘어가는 값을
 * 여기서 해석하거나 검증하지 않는다 — 그건 main의 각 ipcMain 핸들러가 한다.
 * 그래서 페이로드 인자는 전부 unknown으로 적었다. "여기서는 모른다"가 사실이고,
 * unknown이면 실수로 이 파일 안에서 값을 들여다보는 코드를 쓸 수 없다.
 *
 * 채널별 실제 페이로드 타입은 main.js의 핸들러 쪽 계약이라, main.js를 정리할 때
 * 거기서부터 좁혀 오는 게 맞다.
 */
type BridgeCallback = (...args: unknown[]) => void;

contextBridge.exposeInMainWorld("desktopPet", {
  getCursor: () => ipcRenderer.invoke("pet:get-cursor"),
  getWindowBounds: () => ipcRenderer.invoke("pet:get-window-bounds"),
  getMode: () => ipcRenderer.invoke("pet:get-mode"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  getInstalledFonts: () => ipcRenderer.invoke("fonts:list-installed"),
  getAssistantLogs: () => ipcRenderer.invoke("assistant-logs:get"),
  deleteAssistantLog: (id: unknown) => ipcRenderer.invoke("assistant-logs:delete", id),
  clearAssistantLogs: () => ipcRenderer.invoke("assistant-logs:clear"),
  pickFavoriteTarget: () => ipcRenderer.invoke("favorites:pick-target"),
  pickFavoriteIcon: () => ipcRenderer.invoke("favorites:pick-icon"),
  activateFavorite: (selection: unknown) => ipcRenderer.invoke("favorites:activate", selection),
  previewBubbleTheme: (
    theme: unknown,
    customBg: unknown,
    customAccent: unknown,
    customText: unknown
  ) => ipcRenderer.send("settings:preview-bubble-theme", { theme, customBg, customAccent, customText }),
  previewFaceCustomization: (faceCustomization: unknown) => ipcRenderer.send("settings:preview-face-customization", faceCustomization),
  shortcutRecordingStart: () => ipcRenderer.send("settings:shortcut-recording-start"),
  shortcutRecordingEnd: () => ipcRenderer.send("settings:shortcut-recording-end"),
  importCustomFaceZip: () => ipcRenderer.invoke("customFace:import"),
  getCustomFaceTextures: () => ipcRenderer.invoke("customFace:get-textures"),
  getAppearanceDefaults: () => ipcRenderer.invoke("settings:get-appearance-defaults"),
  onCustomFaceTexturesUpdated: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:custom-face-textures", (_event, textures) => callback(textures));
  },
  importCustomBodyImage: () => ipcRenderer.invoke("customBody:import"),
  getCustomBodyTexture: () => ipcRenderer.invoke("customBody:get-texture"),
  onCustomBodyTextureUpdated: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:custom-body-texture", (_event, dataUrl) => callback(dataUrl));
  },
  previewBodyColors: (bodyColors: unknown) => ipcRenderer.send("settings:preview-body-colors", bodyColors),
  previewPartVariations: (partVariations: unknown) => ipcRenderer.send("settings:preview-part-variations", partVariations),
  previewLighting: (lighting: unknown) => ipcRenderer.send("settings:preview-lighting", lighting),
  // 펫 주변 커스터마이징 모드 (2026-08-06)
  openPetCustomize: () => ipcRenderer.send("settings:open-pet-customize"),
  onBodyColorsChanged: (callback: BridgeCallback) => {
    ipcRenderer.on("settings:body-colors-changed", (_event, bodyColors) => callback(bodyColors));
  },
  setCustomizeColor: (id: unknown, color: unknown) => ipcRenderer.send("pet:customize-set-color", { id, color }),
  exitCustomizeMode: () => ipcRenderer.send("pet:customize-exit"),
  cancelCustomizeMode: () => ipcRenderer.send("pet:customize-cancel"),
  onCustomizeMode: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:customize-mode", (_event, payload) => callback(payload));
  },
  testAlarm: (soundFile: unknown) => ipcRenderer.send("settings:test-alarm", soundFile),
  pickAlarmSound: () => ipcRenderer.invoke("alarm:pick-sound"),
  // 커스터마이징 프리셋 썸네일: 설정창이 요청 → main이 펫 창에 위임 → 펫 창이 결과 반환
  renderPresetThumbnails: (presets: unknown) => ipcRenderer.invoke("preset:render-thumbnails", presets),
  onRenderPresetThumbnails: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:render-preset-thumbnails", (_event, payload) => callback(payload));
  },
  sendPresetThumbnails: (payload: unknown) => ipcRenderer.send("pet:preset-thumbnails-result", payload),
  saveCustomizationPreset: (preset: unknown) => ipcRenderer.invoke("settings:save-customization-preset", preset),
  deleteCustomizationPreset: (id: unknown) => ipcRenderer.invoke("settings:delete-customization-preset", id),
  exportCustomizationPreset: (preset: unknown) => ipcRenderer.invoke("settings:export-customization-preset", preset),
  importCustomizationPreset: () => ipcRenderer.invoke("settings:import-customization-preset"),
  exportAllSettings: () => ipcRenderer.invoke("settings:export-all"),
  importAllSettings: () => ipcRenderer.invoke("settings:import-all"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("settings:save", settings),
  replyUnsavedCheck: (isDirty: unknown) => ipcRenderer.send("settings:unsaved-reply", isDirty),
  onQueryUnsaved: (callback: BridgeCallback) => {
    ipcRenderer.on("settings:query-unsaved", (_event) => callback());
  },
  confirmRest: () => ipcRenderer.send("pet:rest-confirm"),
  reportVisualTop: (value: unknown) => ipcRenderer.send("pet:report-visual-top", value),
  reportMediaPlayerRect: (rect: unknown) => ipcRenderer.send("pet:report-media-rect", rect),
  askAssistant: (question: unknown) => ipcRenderer.invoke("assistant:ask", question),
  closeAssistant: () => ipcRenderer.send("assistant:close"),
  petChatReply: (reply: unknown) => ipcRenderer.invoke("pet-chat:reply", reply),
  callPetChatNow: () => ipcRenderer.invoke("pet-chat:call-now"),
  closePetChat: () => ipcRenderer.send("pet-chat:close"),
  closeFavorites: () => ipcRenderer.send("favorites:close"),
  resizeImage: (scale: unknown, filter: unknown) => ipcRenderer.invoke("image:resize", scale, filter),
  closeImageResize: () => ipcRenderer.send("image-resize:close"),
  onImageResizeClose: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:close-image-resize", (_event) => callback());
  },
  sendMediaCommand: (action: unknown) => ipcRenderer.send("media:command", action),
  onMediaUpdate: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:media-update", (_event, data) => callback(data));
  },
  quit: () => ipcRenderer.send("pet:quit"),
  onInteractionMode: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:interaction-mode", (_event, state) => callback(state));
  },
  onTypingIntensity: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:typing-intensity", (_event, intensity) => callback(intensity));
  },
  onSquishPulse: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:squish-pulse", (_event, source) => callback(source));
  },
  onClickSound: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:click-sound", (_event, source) => callback(source));
  },
  onPetting: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:petting", (_event, state) => callback(state));
  },
  onCelebrate: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:celebrate", (_event) => callback());
  },
  onCapsLock: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:caps-lock", (_event, state) => callback(state));
  },
  onIdle: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:idle", (_event, state) => callback(state));
  },
  onDragState: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:drag-state", (_event, state) => callback(state));
  },
  getChecklist: () => ipcRenderer.invoke("checklist:get"),
  addChecklistItem: (text: unknown) => ipcRenderer.invoke("checklist:add", text),
  toggleChecklistItem: (id: unknown) => ipcRenderer.invoke("checklist:toggle", id),
  deleteChecklistItem: (id: unknown) => ipcRenderer.invoke("checklist:delete", id),
  clearChecklist: () => ipcRenderer.invoke("checklist:clear"),
  reorderChecklist: (orderedIds: unknown) => ipcRenderer.invoke("checklist:reorder", orderedIds),
  closeChecklist: () => ipcRenderer.send("checklist:close"),
  onSettingsUpdated: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:settings-updated", (_event, settings) => callback(settings));
  },
  onRestStart: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:rest-start", (_event, payload) => callback(payload));
  },
  onRestEnd: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:rest-end", (_event) => callback());
  },
  onAssistantQuestionOpen: (callback: BridgeCallback) => {
    ipcRenderer.on("assistant:question-open", (_event) => callback());
  },
  onAssistantClose: (callback: BridgeCallback) => {
    ipcRenderer.on("assistant:close", (_event) => callback());
  },
  onPetChatOpen: (callback: BridgeCallback) => {
    ipcRenderer.on("pet-chat:open", (_event, payload) => callback(payload));
  },
  onFavoritesOpen: (callback: BridgeCallback) => {
    ipcRenderer.on("favorites:open", (_event, payload) => callback(payload));
  },
  onFavoritesClose: (callback: BridgeCallback) => {
    ipcRenderer.on("favorites:close", (_event) => callback());
  },
  // 즐겨찾기 독립 창 / 플로팅 독 (2026-08-06)
  listFavorites: () => ipcRenderer.invoke("favorites:list"),
  closeFavoritesWindow: () => ipcRenderer.send("favoritesWindow:close"),
  hideFavoritesDock: () => ipcRenderer.send("favoritesDock:hide"),
  setFavoritesDockExpanded: (expanded: unknown) => ipcRenderer.send("favoritesDock:set-expanded", expanded),
  favoritesDockDragStart: () => ipcRenderer.send("favoritesDock:drag-start"),
  favoritesDockDragMove: (delta: unknown) => ipcRenderer.send("favoritesDock:drag-move", delta),
  favoritesDockDragEnd: () => ipcRenderer.send("favoritesDock:drag-end"),
  onFavoriteItems: (callback: BridgeCallback) => {
    ipcRenderer.on("favorites:items", (_event, payload) => callback(payload));
  },
  onFavoritesDockExpanded: (callback: BridgeCallback) => {
    ipcRenderer.on("favoritesDock:expanded", (_event, payload) => callback(payload));
  },
  onAssistantLogAdded: (callback: BridgeCallback) => {
    ipcRenderer.on("assistant-log:added", (_event, entry) => callback(entry));
  },
  onOpenImageResize: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:open-image-resize", (_event) => callback());
  },
  runTranslate: (targetLanguage: unknown, text: unknown) => ipcRenderer.invoke("translate:run", targetLanguage, text),
  copyTranslatedText: (text: unknown) => ipcRenderer.send("translate:copy", text),
  closeTranslate: () => ipcRenderer.send("translate:close"),
  runDocumentSummary: (payload: unknown) => ipcRenderer.invoke("document-summary:run", payload),
  openDocumentSummary: (filePath: unknown) => ipcRenderer.invoke("document-summary:open", filePath),
  closeDocumentSummary: () => ipcRenderer.send("document-summary:close"),
  onOpenTranslate: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:open-translate", (_event, payload) => callback(payload));
  },
  onTranslateClose: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:close-translate", (_event) => callback());
  },
  onOpenDocumentSummary: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:open-document-summary", (_event, payload) => callback(payload));
  },
  onDocumentSummaryClose: (callback: BridgeCallback) => {
    ipcRenderer.on("pet:close-document-summary", (_event) => callback());
  },
  onContextMenuItems: (callback: BridgeCallback) => {
    ipcRenderer.on("context-menu:items", (_event, items) => callback(items));
  },
  sendContextMenuAction: (id: unknown) => ipcRenderer.send("context-menu:action", id),
  closeContextMenu: () => ipcRenderer.send("context-menu:close"),
  openSummaryFolder: () => ipcRenderer.invoke("summary:open-folder"),
  // Memory Management
  getMemoryStats: () => ipcRenderer.invoke("memory:get-stats"),
  getMemories: (category: unknown) => ipcRenderer.invoke("memory:get-all", category),
  getOpenLoops: () => ipcRenderer.invoke("memory:get-open-loops"),
  verifyMemory: (id: unknown) => ipcRenderer.invoke("memory:verify", id),
  unverifyMemory: (id: unknown) => ipcRenderer.invoke("memory:unverify", id),
  deleteMemory: (id: unknown) => ipcRenderer.invoke("memory:delete", id),
  closeOpenLoop: (id: unknown, notes: unknown) => ipcRenderer.invoke("memory:close-loop", id, notes),
  clearAllMemories: () => ipcRenderer.invoke("memory:clear-all"),
  importMemories: (memories: unknown) => ipcRenderer.invoke("memory:import", memories)
});
