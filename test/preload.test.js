// @ts-check
"use strict";

const assert = require("node:assert/strict");
const { Module } = require("node:module");
const test = require("node:test");

/** @typedef {(...args: unknown[]) => unknown} ApiMethod */
/** @typedef {(event: unknown, ...args: unknown[]) => void} IpcListener */
/** @typedef {{ kind: "invoke" | "send", channel: string, args: unknown[] }} IpcCall */
/** @typedef {{
 *   invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
 *   send: (channel: string, ...args: unknown[]) => void,
 *   on: (channel: string, listener: IpcListener) => MockIpcRenderer
 * }} MockIpcRenderer */

const INVOKE_CHANNELS = Object.freeze({
  getCursor: "pet:get-cursor",
  getWindowBounds: "pet:get-window-bounds",
  getMode: "pet:get-mode",
  getSettings: "settings:get",
  getInstalledFonts: "fonts:list-installed",
  getAssistantLogs: "assistant-logs:get",
  deleteAssistantLog: "assistant-logs:delete",
  clearAssistantLogs: "assistant-logs:clear",
  pickFavoriteTarget: "favorites:pick-target",
  pickFavoriteIcon: "favorites:pick-icon",
  activateFavorite: "favorites:activate",
  importCustomFaceZip: "customFace:import",
  getCustomFaceTextures: "customFace:get-textures",
  getAppearanceDefaults: "settings:get-appearance-defaults",
  importCustomBodyImage: "customBody:import",
  getCustomBodyTexture: "customBody:get-texture",
  pickAlarmSound: "alarm:pick-sound",
  renderPresetThumbnails: "preset:render-thumbnails",
  saveCustomizationPreset: "settings:save-customization-preset",
  deleteCustomizationPreset: "settings:delete-customization-preset",
  exportCustomizationPreset: "settings:export-customization-preset",
  importCustomizationPreset: "settings:import-customization-preset",
  exportAllSettings: "settings:export-all",
  importAllSettings: "settings:import-all",
  saveSettings: "settings:save",
  askAssistant: "assistant:ask",
  petChatReply: "pet-chat:reply",
  callPetChatNow: "pet-chat:call-now",
  resizeImage: "image:resize",
  getChecklist: "checklist:get",
  addChecklistItem: "checklist:add",
  toggleChecklistItem: "checklist:toggle",
  deleteChecklistItem: "checklist:delete",
  clearChecklist: "checklist:clear",
  reorderChecklist: "checklist:reorder",
  listFavorites: "favorites:list",
  runTranslate: "translate:run",
  runDocumentSummary: "document-summary:run",
  openDocumentSummary: "document-summary:open",
  openSummaryFolder: "summary:open-folder",
  getMemoryStats: "memory:get-stats",
  getMemories: "memory:get-all",
  getOpenLoops: "memory:get-open-loops",
  verifyMemory: "memory:verify",
  unverifyMemory: "memory:unverify",
  deleteMemory: "memory:delete",
  closeOpenLoop: "memory:close-loop",
  clearAllMemories: "memory:clear-all",
  importMemories: "memory:import"
});

const SEND_CHANNELS = Object.freeze({
  previewBubbleTheme: "settings:preview-bubble-theme",
  previewFaceCustomization: "settings:preview-face-customization",
  shortcutRecordingStart: "settings:shortcut-recording-start",
  shortcutRecordingEnd: "settings:shortcut-recording-end",
  previewBodyColors: "settings:preview-body-colors",
  previewPartVariations: "settings:preview-part-variations",
  previewLighting: "settings:preview-lighting",
  openPetCustomize: "settings:open-pet-customize",
  setCustomizeColor: "pet:customize-set-color",
  exitCustomizeMode: "pet:customize-exit",
  cancelCustomizeMode: "pet:customize-cancel",
  testAlarm: "settings:test-alarm",
  testWeatherBriefing: "settings:dev-test-weather-briefing",
  forceExpression: "settings:dev-force-expression",
  setDebugOverlay: "settings:dev-set-debug-overlay",
  sendPresetThumbnails: "pet:preset-thumbnails-result",
  replyUnsavedCheck: "settings:unsaved-reply",
  confirmRest: "pet:rest-confirm",
  reportVisualTop: "pet:report-visual-top",
  reportMediaPlayerRect: "pet:report-media-rect",
  closeAssistant: "assistant:close",
  closePetChat: "pet-chat:close",
  closeFavorites: "favorites:close",
  closeImageResize: "image-resize:close",
  sendMediaCommand: "media:command",
  quit: "pet:quit",
  closeChecklist: "checklist:close",
  closeFavoritesWindow: "favoritesWindow:close",
  hideFavoritesDock: "favoritesDock:hide",
  setFavoritesDockExpanded: "favoritesDock:set-expanded",
  favoritesDockDragStart: "favoritesDock:drag-start",
  favoritesDockDragMove: "favoritesDock:drag-move",
  favoritesDockDragEnd: "favoritesDock:drag-end",
  copyTranslatedText: "translate:copy",
  closeTranslate: "translate:close",
  closeDocumentSummary: "document-summary:close",
  sendContextMenuAction: "context-menu:action",
  closeContextMenu: "context-menu:close"
});

const EVENT_CHANNELS = Object.freeze({
  onCustomFaceTexturesUpdated: { channel: "pet:custom-face-textures", forwardsPayload: true },
  onCustomBodyTextureUpdated: { channel: "pet:custom-body-texture", forwardsPayload: true },
  onBodyColorsChanged: { channel: "settings:body-colors-changed", forwardsPayload: true },
  onCustomizeMode: { channel: "pet:customize-mode", forwardsPayload: true },
  onRenderPresetThumbnails: { channel: "pet:render-preset-thumbnails", forwardsPayload: true },
  onQueryUnsaved: { channel: "settings:query-unsaved", forwardsPayload: false },
  onImageResizeClose: { channel: "pet:close-image-resize", forwardsPayload: false },
  onMediaUpdate: { channel: "pet:media-update", forwardsPayload: true },
  onInteractionMode: { channel: "pet:interaction-mode", forwardsPayload: true },
  onTypingIntensity: { channel: "pet:typing-intensity", forwardsPayload: true },
  onSquishPulse: { channel: "pet:squish-pulse", forwardsPayload: true },
  onClickSound: { channel: "pet:click-sound", forwardsPayload: true },
  onPetting: { channel: "pet:petting", forwardsPayload: true },
  onCelebrate: { channel: "pet:celebrate", forwardsPayload: false },
  onCapsLock: { channel: "pet:caps-lock", forwardsPayload: true },
  onIdle: { channel: "pet:idle", forwardsPayload: true },
  onDragState: { channel: "pet:drag-state", forwardsPayload: true },
  onSettingsUpdated: { channel: "pet:settings-updated", forwardsPayload: true },
  onRestStart: { channel: "pet:rest-start", forwardsPayload: true },
  onRestEnd: { channel: "pet:rest-end", forwardsPayload: false },
  onForceExpression: { channel: "pet:dev-force-expression", forwardsPayload: true },
  onDebugOverlay: { channel: "pet:dev-debug-overlay", forwardsPayload: true },
  onAssistantQuestionOpen: { channel: "assistant:question-open", forwardsPayload: false },
  onAssistantClose: { channel: "assistant:close", forwardsPayload: false },
  onPetChatOpen: { channel: "pet-chat:open", forwardsPayload: true },
  onFavoritesOpen: { channel: "favorites:open", forwardsPayload: true },
  onFavoritesClose: { channel: "favorites:close", forwardsPayload: false },
  onFavoriteItems: { channel: "favorites:items", forwardsPayload: true },
  onFavoritesDockExpanded: { channel: "favoritesDock:expanded", forwardsPayload: true },
  onAssistantLogAdded: { channel: "assistant-log:added", forwardsPayload: true },
  onOpenImageResize: { channel: "pet:open-image-resize", forwardsPayload: false },
  onOpenTranslate: { channel: "pet:open-translate", forwardsPayload: true },
  onTranslateClose: { channel: "pet:close-translate", forwardsPayload: false },
  onOpenDocumentSummary: { channel: "pet:open-document-summary", forwardsPayload: true },
  onDocumentSummaryClose: { channel: "pet:close-document-summary", forwardsPayload: false },
  onContextMenuItems: { channel: "context-menu:items", forwardsPayload: true }
});

/**
 * @param {Record<string, ApiMethod>} api
 * @param {string} methodName
 * @returns {ApiMethod}
 */
function requireApiMethod(api, methodName)
{
  const method = api[methodName];
  assert.equal(typeof method, "function", `${methodName} API가 누락됐습니다.`);
  return method;
}

/**
 * @param {string} methodName
 * @param {unknown[]} args
 * @returns {unknown[]}
 */
function expectedSentArgs(methodName, args)
{
  if (methodName === "previewBubbleTheme")
  {
    return [{ theme: args[0], customBg: args[1], customAccent: args[2], customText: args[3] }];
  }
  if (methodName === "setCustomizeColor")
  {
    return [{ id: args[0], color: args[1] }];
  }
  return args;
}

test("preload 브리지는 공개 API와 IPC 채널을 유지하고 Electron 이벤트를 노출하지 않는다", (context) =>
{
  const electronPath = require.resolve("electron");
  const preloadPath = require.resolve("../src/preload.js");
  const previousElectronModule = require.cache[electronPath];
  const previousPreloadModule = require.cache[preloadPath];
  /** @type {IpcCall[]} */
  const calls = [];
  /** @type {Map<string, IpcListener>} */
  const listeners = new Map();
  /** @type {Record<string, ApiMethod> | undefined} */
  let exposedApi;
  let exposedKey = "";

  /** @type {MockIpcRenderer} */
  const ipcRenderer = {
    invoke(channel, ...args)
    {
      calls.push({ kind: "invoke", channel, args });
      return Promise.resolve({ channel, args });
    },
    send(channel, ...args)
    {
      calls.push({ kind: "send", channel, args });
    },
    on(channel, listener)
    {
      listeners.set(channel, listener);
      return ipcRenderer;
    }
  };
  const mockElectronModule = new Module(electronPath);
  mockElectronModule.filename = electronPath;
  mockElectronModule.loaded = true;
  mockElectronModule.exports = {
    contextBridge: {
      exposeInMainWorld(/** @type {string} */ key, /** @type {unknown} */ api)
      {
        assert.ok(api && typeof api === "object");
        exposedKey = key;
        exposedApi = /** @type {Record<string, ApiMethod>} */ (api);
      }
    },
    ipcRenderer
  };

  context.after(() =>
  {
    delete require.cache[preloadPath];
    if (previousPreloadModule) require.cache[preloadPath] = previousPreloadModule;
    if (previousElectronModule) require.cache[electronPath] = previousElectronModule;
    else delete require.cache[electronPath];
  });

  require.cache[electronPath] = mockElectronModule;
  delete require.cache[preloadPath];
  require(preloadPath);

  assert.equal(exposedKey, "desktopPet");
  assert.ok(exposedApi);
  const api = exposedApi;
  const expectedMethods = [
    ...Object.keys(INVOKE_CHANNELS),
    ...Object.keys(SEND_CHANNELS),
    ...Object.keys(EVENT_CHANNELS)
  ].sort();
  assert.deepEqual(Object.keys(api).sort(), expectedMethods);

  for (const [methodName, channel] of Object.entries(INVOKE_CHANNELS))
  {
    calls.length = 0;
    const method = requireApiMethod(api, methodName);
    const args = Array.from({ length: method.length }, (_value, index) => ({ methodName, index }));
    method(...args);
    assert.deepEqual(calls, [{ kind: "invoke", channel, args }]);
  }

  for (const [methodName, channel] of Object.entries(SEND_CHANNELS))
  {
    calls.length = 0;
    const method = requireApiMethod(api, methodName);
    const args = Array.from({ length: method.length }, (_value, index) => ({ methodName, index }));
    method(...args);
    assert.deepEqual(calls, [{ kind: "send", channel, args: expectedSentArgs(methodName, args) }]);
  }

  for (const [methodName, contract] of Object.entries(EVENT_CHANNELS))
  {
    /** @type {unknown[] | undefined} */
    let callbackArgs;
    /** @param {unknown[]} args */
    const callback = (...args) =>
    {
      callbackArgs = args;
    };
    requireApiMethod(api, methodName)(callback);
    const listener = listeners.get(contract.channel);
    assert.ok(listener, `${contract.channel} listener가 등록되지 않았습니다.`);
    const event = { sender: "renderer에 노출되면 안 되는 Electron 이벤트" };
    const payload = { methodName };
    listener(event, payload);
    assert.deepEqual(callbackArgs, contract.forwardsPayload ? [payload] : []);
  }
});
