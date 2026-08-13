// @ts-check
// 외형 미리보기·커스터마이징 모드 IPC 회귀 테스트.
// main.ts에서 분리하면서 두 가지가 흐려지기 쉬웠다: (1) 모든 채널이 보낸 창을 검사하는지,
// (2) 미리보기(저장 안 함)와 펫 편집기(즉시 확정)의 경로가 섞이지 않는지.
// Electron 없이 순수 Node로 실행된다: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

// settings-schema.js는 지원하지 않는 언어가 들어오면 app.getLocale()로 폴백한다.
// 모듈을 읽기 전에 그 한 함수만 쓰는 최소 스텁을 require 캐시에 넣어둔다.
const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getLocale: () => "ko-KR" } }
});

const { registerAppearanceIpcHandlers } = require("../src/main/appearance-ipc.js");
const { BODY_COLOR_DEFS, DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");

const SETTINGS_WINDOW_CHANNELS = [
  "settings:preview-bubble-theme",
  "settings:preview-face-customization",
  "settings:preview-body-colors",
  "settings:preview-part-variations",
  "settings:preview-lighting",
  "settings:open-pet-customize"
];
const PET_WINDOW_CHANNELS = [
  "pet:customize-set-color",
  "pet:customize-exit",
  "pet:customize-cancel"
];
// 보낸 창을 검사하지만 거부해도 값을 돌려주는 채널(위 목록과 검증 방식이 다르다).
const GUARDED_HANDLE_CHANNELS = [
  "preset:render-thumbnails",
  "settings:save-customization-preset",
  "settings:delete-customization-preset",
  "settings:export-customization-preset",
  "settings:import-customization-preset",
  "customFace:import",
  "customBody:import"
];
const UNGUARDED_HANDLE_CHANNELS = [
  "customFace:get-textures",
  "customBody:get-texture",
  "settings:get-appearance-defaults"
];

function createHarness(overrides = {}) {
  /** @type {Map<string, (...args: any[]) => any>} */
  const listeners = new Map();
  const ipcMain = {
    handle(/** @type {string} */ channel, /** @type {any} */ handler) {
      listeners.set(channel, handler);
    },
    on(/** @type {string} */ channel, /** @type {any} */ listener) {
      listeners.set(channel, listener);
    }
  };
  const settingsSender = { window: "settings" };
  const petSender = { window: "pet" };
  /** @type {Array<Partial<any>>} */
  const previews = [];
  /** @type {any[]} */
  const commits = [];
  /** @type {boolean[]} */
  const customizeModes = [];
  let snapshot = /** @type {any} */ (null);
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

  /** @type {Array<{ channel: string, payload: any }>} */
  const petMessages = [];
  /** @type {Array<{ path: string, text: string }>} */
  const writtenFiles = [];
  let saveCalls = 0;

  const deps = {
    getSettings: () => settings,
    isSettingsSender: (/** @type {unknown} */ sender) => sender === settingsSender,
    isPetSender: (/** @type {unknown} */ sender) => sender === petSender,
    translate: (/** @type {string} */ _language, /** @type {string} */ key) => `t:${key}`,
    describeError: (/** @type {any} */ error) => String(error?.message || error),
    applyLivePreview: (/** @type {any} */ patch) => { previews.push(patch); },
    commitCustomizeColors: (/** @type {unknown} */ colors) => { commits.push(colors); },
    setCustomizeMode: (/** @type {boolean} */ enabled) => { customizeModes.push(enabled); },
    getCustomizeColorSnapshot: () => snapshot,
    setCustomizationPresets: (/** @type {any} */ presets) => { settings.customizationPresets = presets; },
    saveSettings: () => { saveCalls += 1; },
    hasPetWindow: () => true,
    sendToPet: (/** @type {string} */ channel, /** @type {any} */ payload) => {
      petMessages.push({ channel, payload });
    },
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    writeTextFile: (/** @type {string} */ path, /** @type {string} */ text) => {
      writtenFiles.push({ path, text });
    },
    readTextFile: () => "{}",
    importCustomFaceZip: () => ({ ok: true, keys: ["happy"] }),
    readCustomFaceTextures: () => ({ happy: "data:image/png;base64,AA" }),
    importCustomBodyImage: () => ({ ok: true }),
    readCustomBodyTexture: () => "data:image/png;base64,BB",
    ...overrides
  };
  registerAppearanceIpcHandlers(/** @type {any} */ (ipcMain), deps);
  return {
    settings,
    settingsSender,
    petSender,
    previews,
    commits,
    customizeModes,
    petMessages,
    writtenFiles,
    saveCalls: () => saveCalls,
    setSnapshot: (/** @type {any} */ value) => { snapshot = value; },
    send: (/** @type {string} */ channel, /** @type {unknown} */ sender, /** @type {unknown} */ payload) => {
      const listener = listeners.get(channel);
      assert.ok(listener, `등록되지 않은 채널: ${channel}`);
      return listener({ sender }, payload);
    },
    channels: () => [...listeners.keys()]
  };
}

test("설정창 전용 채널은 다른 창이 보내면 아무 일도 하지 않는다", () => {
  for (const channel of SETTINGS_WINDOW_CHANNELS) {
    const harness = createHarness();
    harness.send(channel, harness.petSender, {});
    assert.deepEqual(harness.previews, [], `${channel}이 펫 창 요청에 반응했다`);
    assert.deepEqual(harness.customizeModes, [], `${channel}이 펫 창 요청에 반응했다`);
  }
});

test("펫 창 전용 채널은 설정창이 보내면 아무 일도 하지 않는다", () => {
  for (const channel of PET_WINDOW_CHANNELS) {
    const harness = createHarness();
    harness.setSnapshot([{ id: "head", color: "#123456" }]);
    harness.send(channel, harness.settingsSender, { id: "head", color: "#ff0000" });
    assert.deepEqual(harness.commits, [], `${channel}이 설정창 요청에 반응했다`);
    assert.deepEqual(harness.customizeModes, [], `${channel}이 설정창 요청에 반응했다`);
  }
});

test("등록하는 채널 목록이 분리 전 main.ts와 같다", () => {
  const harness = createHarness();
  assert.deepEqual(
    harness.channels().sort(),
    [
      ...SETTINGS_WINDOW_CHANNELS,
      ...PET_WINDOW_CHANNELS,
      ...GUARDED_HANDLE_CHANNELS,
      ...UNGUARDED_HANDLE_CHANNELS,
      "pet:preset-thumbnails-result"
    ].sort()
  );
});

test("값을 돌려주는 채널도 설정창이 아닌 sender는 거부한다", async () => {
  for (const channel of GUARDED_HANDLE_CHANNELS) {
    const harness = createHarness();
    harness.settings.customizationPresets = [{ id: "keep", name: "유지" }];
    const result = await harness.send(channel, harness.petSender, []);
    assert.equal(harness.saveCalls(), 0, `${channel}이 거부 후에도 저장했다`);
    assert.deepEqual(harness.writtenFiles, [], `${channel}이 거부 후에도 파일을 썼다`);
    if (Array.isArray(result)) {
      assert.deepEqual(result, [{ id: "keep", name: "유지" }], `${channel}이 프리셋을 바꿨다`);
    } else if (channel !== "preset:render-thumbnails") {
      assert.equal(result.ok, false, `${channel}이 거부인데 성공을 돌려줬다`);
    }
  }
});

test("프리셋 썸네일 요청은 requestId로 펫 창 응답과 짝을 맞춘다", async () => {
  const harness = createHarness();
  const pending = harness.send("preset:render-thumbnails", harness.settingsSender, [
    { name: "여우", bodyColors: [] }
  ]);
  assert.equal(harness.petMessages.length, 1);
  const { channel, payload } = harness.petMessages[0];
  assert.equal(channel, "pet:render-preset-thumbnails");
  assert.equal(typeof payload.requestId, "number");
  harness.send("pet:preset-thumbnails-result", harness.petSender, {
    requestId: payload.requestId,
    thumbnails: { [payload.presets[0].id]: "data:image/png;base64,CC" }
  });
  const thumbnails = await pending;
  assert.deepEqual(thumbnails, { [payload.presets[0].id]: "data:image/png;base64,CC" });
});

test("짝이 안 맞는 requestId 응답은 요청을 끝내지 않는다", async () => {
  const harness = createHarness();
  const pending = harness.send("preset:render-thumbnails", harness.settingsSender, [{ name: "여우" }]);
  harness.send("pet:preset-thumbnails-result", harness.petSender, { requestId: 9999, thumbnails: { a: "x" } });
  const settled = await Promise.race([pending, Promise.resolve("아직")]);
  assert.equal(settled, "아직");
  // 열어 둔 타이머를 정리해 테스트 러너가 매달리지 않게 한다.
  harness.send("pet:preset-thumbnails-result", harness.petSender, {
    requestId: harness.petMessages[0].payload.requestId,
    thumbnails: {}
  });
  await pending;
});

test("썸네일 결과는 펫 창이 아닌 sender를 무시한다", async () => {
  const harness = createHarness();
  const pending = harness.send("preset:render-thumbnails", harness.settingsSender, [{ name: "여우" }]);
  const requestId = harness.petMessages[0].payload.requestId;
  harness.send("pet:preset-thumbnails-result", harness.settingsSender, { requestId, thumbnails: { a: "x" } });
  const settled = await Promise.race([pending, Promise.resolve("아직")]);
  assert.equal(settled, "아직");
  harness.send("pet:preset-thumbnails-result", harness.petSender, { requestId, thumbnails: {} });
  await pending;
});

test("펫 창이 없으면 썸네일을 요청하지 않고 빈 결과를 준다", async () => {
  const harness = createHarness({ hasPetWindow: () => false });
  const result = await harness.send("preset:render-thumbnails", harness.settingsSender, [{ name: "여우" }]);
  assert.deepEqual(result, {});
  assert.deepEqual(harness.petMessages, []);
});

test("프리셋 저장은 기존 목록 뒤에 id를 새로 발급해 덧붙인다", async () => {
  const harness = createHarness();
  const before = harness.settings.customizationPresets.length;
  const presets = await harness.send("settings:save-customization-preset", harness.settingsSender, { name: "여우" });
  assert.equal(presets.length, before + 1);
  assert.equal(presets[presets.length - 1].name, "여우");
  assert.ok(presets[presets.length - 1].id, "id가 없으면 삭제·썸네일 짝이 깨진다");
  assert.equal(harness.saveCalls(), 1);
});

test("프리셋은 50개를 넘으면 오래된 것부터 잘린다", async () => {
  const harness = createHarness();
  harness.settings.customizationPresets = Array.from({ length: 50 }, (_unused, index) => ({
    id: `p${index}`,
    name: `프리셋${index}`
  }));
  const presets = await harness.send("settings:save-customization-preset", harness.settingsSender, { name: "새것" });
  assert.equal(presets.length, 50);
  assert.equal(presets[0].id, "p1", "가장 오래된 항목이 빠져야 한다");
  assert.equal(presets[49].name, "새것");
});

test("프리셋 삭제는 해당 id만 빼고 저장한다", async () => {
  const harness = createHarness();
  harness.settings.customizationPresets = [{ id: "a", name: "가" }, { id: "b", name: "나" }];
  const presets = await harness.send("settings:delete-customization-preset", harness.settingsSender, "a");
  assert.deepEqual(presets.map((/** @type {any} */ p) => p.id), ["b"]);
  assert.equal(harness.saveCalls(), 1);
});

test("내보내기 파일 이름에서 경로 문자를 제거한다", async () => {
  const harness = createHarness({
    showSaveDialog: async (/** @type {any} */ options) => ({ canceled: false, filePath: options.defaultPath })
  });
  const result = await harness.send("settings:export-customization-preset", harness.settingsSender, {
    name: 'a/b\\c:d*e?f"g<h>i|j'
  });
  assert.equal(result.ok, true);
  assert.equal(harness.writtenFiles.length, 1);
  assert.match(harness.writtenFiles[0].path, /^a_b_c_d_e_f_g_h_i_j\.json$/);
});

test("가져오기가 깨진 JSON이면 오류를 돌려준다", async () => {
  const harness = createHarness({
    showOpenDialog: async () => ({ canceled: false, filePaths: ["preset.json"] }),
    readTextFile: () => "{깨진 JSON"
  });
  const result = await harness.send("settings:import-customization-preset", harness.settingsSender, undefined);
  assert.equal(result.ok, false);
  assert.equal(result.error, "t:customization.invalidFileError");
});

test("커스텀 얼굴 가져오기 실패는 원인별 오류 문구를 고른다", async () => {
  const invalidZip = createHarness({
    showOpenDialog: async () => ({ canceled: false, filePaths: ["face.zip"] }),
    importCustomFaceZip: () => ({ ok: false, errorCode: "invalidZip" })
  });
  assert.equal(
    (await invalidZip.send("customFace:import", invalidZip.settingsSender, undefined)).error,
    "t:customFace.invalidZipError"
  );
  const noMatch = createHarness({
    showOpenDialog: async () => ({ canceled: false, filePaths: ["face.zip"] }),
    importCustomFaceZip: () => ({ ok: false, errorCode: "noMatchingFiles" })
  });
  assert.equal(
    (await noMatch.send("customFace:import", noMatch.settingsSender, undefined)).error,
    "t:customFace.noMatchingFilesError"
  );
});

test("커스텀 이미지 가져오기가 성공하면 펫 창에 새 텍스처를 보낸다", async () => {
  const face = createHarness({ showOpenDialog: async () => ({ canceled: false, filePaths: ["face.zip"] }) });
  await face.send("customFace:import", face.settingsSender, undefined);
  assert.equal(face.petMessages[0].channel, "pet:custom-face-textures");

  const body = createHarness({ showOpenDialog: async () => ({ canceled: false, filePaths: ["body.png"] }) });
  await body.send("customBody:import", body.settingsSender, undefined);
  assert.equal(body.petMessages[0].channel, "pet:custom-body-texture");
});

test("대화상자를 취소하면 아무것도 쓰지 않고 canceled를 돌려준다", async () => {
  const harness = createHarness();
  for (const channel of ["settings:export-customization-preset", "settings:import-customization-preset", "customFace:import", "customBody:import"]) {
    const result = await harness.send(channel, harness.settingsSender, {});
    assert.deepEqual(result, { ok: false, canceled: true }, channel);
  }
  assert.deepEqual(harness.writtenFiles, []);
  assert.deepEqual(harness.petMessages, []);
});

test("외형 기본값은 DEFAULT_SETTINGS를 복사해서 준다", async () => {
  const harness = createHarness();
  const defaults = await harness.send("settings:get-appearance-defaults", harness.settingsSender, undefined);
  assert.equal(defaults.paletteSteps, DEFAULT_SETTINGS.paletteSteps);
  defaults.paletteCustomStops[0].color = "#000000";
  defaults.lighting.keyLight.intensity = 999;
  assert.notEqual(DEFAULT_SETTINGS.paletteCustomStops[0].color, "#000000", "기본값 원본이 오염됐다");
  assert.notEqual(DEFAULT_SETTINGS.lighting.keyLight.intensity, 999, "기본값 원본이 오염됐다");
});

test("말풍선 테마 미리보기는 사용자 지정 색을 현재 설정으로 폴백한다", () => {
  const harness = createHarness();
  harness.settings.bubbleThemeCustomBg = "#010203";
  harness.send("settings:preview-bubble-theme", harness.settingsSender, { theme: "rose" });
  const [patch] = harness.previews;
  assert.equal(patch.bubbleTheme, "rose");
  assert.equal(patch.bubbleThemeCustomBg, "#010203");
});

test("얼굴 미리보기는 켜짐 플래그를 엄격히 boolean으로 정규화한다", () => {
  const harness = createHarness();
  harness.send("settings:preview-face-customization", harness.settingsSender, {
    customFaceEnabled: "true",
    customBodyEnabled: true
  });
  const [patch] = harness.previews;
  assert.equal(patch.customFaceEnabled, false, "문자열 \"true\"는 켜짐이 아니다");
  assert.equal(patch.customBodyEnabled, true);
});

test("미리보기는 저장 경로(commitCustomizeColors)를 타지 않는다", () => {
  const harness = createHarness();
  harness.send("settings:preview-body-colors", harness.settingsSender, [{ id: "head", color: "#abcdef" }]);
  assert.equal(harness.previews.length, 1);
  assert.deepEqual(harness.commits, []);
});

test("펫 편집기의 색 변경은 카탈로그 전체를 채워 즉시 확정한다", () => {
  const harness = createHarness();
  harness.settings.bodyColors = [{ id: BODY_COLOR_DEFS[0].id, color: "#111111" }];
  harness.send("pet:customize-set-color", harness.petSender, {
    id: BODY_COLOR_DEFS[1].id,
    color: "#222222"
  });
  const [committed] = harness.commits;
  assert.equal(committed.length, BODY_COLOR_DEFS.length, "일부 부위가 빠지면 그 색이 유실된다");
  assert.equal(committed[0].color, "#111111", "건드리지 않은 부위는 현재 색을 유지한다");
  assert.equal(committed[1].color, "#222222");
  for (const entry of committed) {
    assert.ok(entry.color, "색이 비면 렌더러가 기본 색으로 떨어진다");
  }
  assert.deepEqual(harness.previews, [], "펫 편집기는 미리보기 경로를 쓰지 않는다");
});

test("카탈로그에 없는 부위 id는 무시한다", () => {
  const harness = createHarness();
  harness.send("pet:customize-set-color", harness.petSender, { id: "없는부위", color: "#222222" });
  assert.deepEqual(harness.commits, []);
});

test("취소는 스냅샷을 되돌린 뒤에 모드를 닫는다", () => {
  const harness = createHarness();
  const snapshot = [{ id: "head", color: "#654321" }];
  harness.setSnapshot(snapshot);
  /** @type {string[]} */
  const order = [];
  const harnessWithOrder = createHarness({
    commitCustomizeColors: (/** @type {unknown} */ colors) => {
      order.push(`commit:${JSON.stringify(colors)}`);
    },
    setCustomizeMode: (/** @type {boolean} */ enabled) => { order.push(`mode:${enabled}`); },
    getCustomizeColorSnapshot: () => snapshot
  });
  harnessWithOrder.send("pet:customize-cancel", harnessWithOrder.petSender, undefined);
  assert.deepEqual(order, [`commit:${JSON.stringify(snapshot)}`, "mode:false"]);
});

test("스냅샷이 없으면 취소는 색을 건드리지 않고 모드만 닫는다", () => {
  const harness = createHarness();
  harness.send("pet:customize-cancel", harness.petSender, undefined);
  assert.deepEqual(harness.commits, []);
  assert.deepEqual(harness.customizeModes, [false]);
});

test("커스터마이징 모드 열기/닫기는 각자의 창에서만 온다", () => {
  const harness = createHarness();
  harness.send("settings:open-pet-customize", harness.settingsSender, undefined);
  harness.send("pet:customize-exit", harness.petSender, undefined);
  assert.deepEqual(harness.customizeModes, [true, false]);
});
