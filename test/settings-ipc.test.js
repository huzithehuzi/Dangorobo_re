// @ts-check
// 설정 저장·백업 IPC 회귀 테스트.
// 실패 응답 형성(어느 단축키가 점유됐는지, 롤백까지 실패했는지)은 main.ts 안에 있을 때
// 단위 테스트가 없었다 — 실패 경로라 손으로 재현하기도 어려운 자리다.
// Electron 없이 순수 Node로 실행된다: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getLocale: () => "ko-KR" } }
});

const {
  registerSettingsIpcHandlers,
  managedShortcutLabel,
  settingsTransactionFailureResponse
} = require("../src/main/settings-ipc.js");
const { DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");

function baseSettings(overrides = {}) {
  return Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), { language: "ko" }, overrides);
}

function createHarness(overrides = {}) {
  /** @type {Map<string, (...args: any[]) => any>} */
  const listeners = new Map();
  const ipcMain = {
    handle(/** @type {string} */ c, /** @type {any} */ h) { listeners.set(c, h); },
    on(/** @type {string} */ c, /** @type {any} */ h) { listeners.set(c, h); }
  };
  const settingsSender = { window: "settings" };
  const otherSender = { window: "pet" };
  const settings = baseSettings();
  /** @type {Array<{ path: string, text: string }>} */
  const writtenFiles = [];
  /** @type {Array<{ payload: unknown, mode: string }>} */
  const transactions = [];
  /** @type {string[]} */
  const applied = [];
  /** @type {any[][]} */
  const loggedRollbacks = [];

  const deps = {
    getSettings: () => settings,
    translate: (/** @type {string} */ _l, /** @type {string} */ key, /** @type {any} */ vars) => (
      vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`
    ),
    describeError: (/** @type {any} */ e) => (e && e.message) || "",
    isSettingsSender: (/** @type {unknown} */ s) => s === settingsSender,
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    writeTextFile: (/** @type {string} */ path, /** @type {string} */ text) => {
      writtenFiles.push({ path, text });
    },
    readTextFile: () => "{}",
    runSaveTransaction: (/** @type {unknown} */ payload, /** @type {string} */ mode) => {
      transactions.push({ payload, mode });
      return /** @type {any} */ ({ ok: true, settings, assistantKey: "", cleanupFailures: [] });
    },
    applySavedSettings: (/** @type {any} */ _t, /** @type {string} */ mode) => {
      applied.push(mode);
      return /** @type {const} */ ({ ok: /** @type {true} */ (true), applied: mode });
    },
    ...overrides
  };
  registerSettingsIpcHandlers(
    /** @type {any} */ (ipcMain),
    deps,
    (/** @type {any[]} */ failures) => { loggedRollbacks.push(failures); }
  );
  return {
    settings, settingsSender, otherSender, writtenFiles, transactions, applied, loggedRollbacks,
    send: (/** @type {string} */ channel, /** @type {unknown} */ sender, /** @type {any} */ payload) => {
      const listener = listeners.get(channel);
      assert.ok(listener, `등록되지 않은 채널: ${channel}`);
      return listener({ sender }, payload);
    },
    channels: () => [...listeners.keys()]
  };
}

test("등록하는 채널 목록이 분리 전 main.ts와 같다", () => {
  assert.deepEqual(
    createHarness().channels().sort(),
    ["settings:export-all", "settings:import-all", "settings:save"].sort()
  );
});

test("세 채널 모두 설정창이 아닌 sender를 거부한다", async () => {
  for (const channel of ["settings:export-all", "settings:import-all", "settings:save"]) {
    const harness = createHarness();
    const result = await harness.send(channel, harness.otherSender, {});
    assert.deepEqual(result, { ok: false, error: "t:customization.settingsWindowNotFoundError" }, channel);
    assert.deepEqual(harness.transactions, [], `${channel}이 거부 후에도 트랜잭션을 돌렸다`);
    assert.deepEqual(harness.writtenFiles, [], `${channel}이 거부 후에도 파일을 썼다`);
  }
});

test("내보내기는 현재 설정을 JSON으로 쓴다", async () => {
  const harness = createHarness({
    showSaveDialog: async (/** @type {any} */ options) => ({ canceled: false, filePath: options.defaultPath })
  });
  const result = await harness.send("settings:export-all", harness.settingsSender, undefined);
  assert.deepEqual(result, { ok: true });
  assert.equal(harness.writtenFiles[0].path, "pet-settings-backup.json");
  const written = JSON.parse(harness.writtenFiles[0].text);
  assert.equal(written.language, "ko");
  assert.ok(!("assistantApiKey" in written), "API 키가 백업에 들어갔다");
});

test("내보내기 쓰기 실패는 오류 문구로 바꾼다", async () => {
  const harness = createHarness({
    showSaveDialog: async () => ({ canceled: false, filePath: "out.json" }),
    writeTextFile: () => { throw new Error("디스크 가득 참"); }
  });
  const result = await harness.send("settings:export-all", harness.settingsSender, undefined);
  assert.deepEqual(result, { ok: false, error: "디스크 가득 참" });
});

test("깨진 백업 파일은 트랜잭션을 돌리지 않는다", async () => {
  const harness = createHarness({
    showOpenDialog: async () => ({ canceled: false, filePaths: ["backup.json"] }),
    readTextFile: () => "{깨진 JSON"
  });
  const result = await harness.send("settings:import-all", harness.settingsSender, undefined);
  assert.deepEqual(result, { ok: false, error: "t:settingsBackup.invalidFileError" });
  assert.deepEqual(harness.transactions, []);
});

test("설정 형태가 아닌 JSON도 가져오기를 거부한다", async () => {
  const harness = createHarness({
    showOpenDialog: async () => ({ canceled: false, filePaths: ["backup.json"] }),
    readTextFile: () => "[1, 2, 3]"
  });
  const result = await harness.send("settings:import-all", harness.settingsSender, undefined);
  assert.deepEqual(result, { ok: false, error: "t:settingsBackup.invalidFileError" });
  assert.deepEqual(harness.transactions, []);
});

test("저장과 가져오기는 같은 트랜잭션을 서로 다른 mode로 부른다", async () => {
  const save = createHarness();
  await save.send("settings:save", save.settingsSender, { petScalePercent: 120 });
  assert.deepEqual(save.transactions, [{ payload: { petScalePercent: 120 }, mode: "save" }]);
  assert.deepEqual(save.applied, ["save"]);

  const load = createHarness({
    showOpenDialog: async () => ({ canceled: false, filePaths: ["backup.json"] }),
    readTextFile: () => JSON.stringify({ petScalePercent: 80 })
  });
  await load.send("settings:import-all", load.settingsSender, undefined);
  assert.equal(load.transactions[0].mode, "import");
  assert.deepEqual(load.applied, ["import"]);
});

test("대화상자를 취소하면 트랜잭션도 파일 쓰기도 없다", async () => {
  const harness = createHarness();
  for (const channel of ["settings:export-all", "settings:import-all"]) {
    assert.deepEqual(
      await harness.send(channel, harness.settingsSender, undefined),
      { ok: false, canceled: true },
      channel
    );
  }
  assert.deepEqual(harness.transactions, []);
  assert.deepEqual(harness.writtenFiles, []);
});

test("트랜잭션이 실패하면 설정을 반영하지 않는다", async () => {
  const harness = createHarness({
    runSaveTransaction: () => ({
      ok: false, reason: "persistence", error: new Error("디스크 오류"), rollbackFailures: []
    })
  });
  const result = await harness.send("settings:save", harness.settingsSender, {});
  assert.deepEqual(result, { ok: false, error: "디스크 오류" });
  assert.deepEqual(harness.applied, [], "실패했는데 설정을 반영했다");
});

test("롤백까지 실패하면 recoveryIncomplete를 붙이고 기록한다", async () => {
  const failures = [{ step: "settings", error: new Error("되돌리기 실패") }];
  const harness = createHarness({
    runSaveTransaction: () => ({
      ok: false, reason: "persistence", error: new Error("디스크 오류"), rollbackFailures: failures
    })
  });
  const result = await harness.send("settings:save", harness.settingsSender, {});
  assert.equal(result.recoveryIncomplete, true);
  assert.deepEqual(harness.loggedRollbacks, [failures]);
});

test("롤백이 성공했으면 recoveryIncomplete를 붙이지 않는다", async () => {
  const harness = createHarness({
    runSaveTransaction: () => ({
      ok: false, reason: "normalize", error: new Error("잘못된 값"), rollbackFailures: []
    })
  });
  const result = await harness.send("settings:save", harness.settingsSender, {});
  assert.ok(!("recoveryIncomplete" in result));
  assert.deepEqual(harness.loggedRollbacks, []);
});

test("단축키 충돌은 트랜잭션이 준 문구를 그대로 쓴다", () => {
  const response = settingsTransactionFailureResponse(
    /** @type {any} */ ({
      ok: false, reason: "shortcutConflict", error: "같은 조합을 두 기능에 지정했습니다", rollbackFailures: []
    }),
    { translate: (/** @type {string} */ _l, /** @type {string} */ k) => `t:${k}`, describeError: String },
    () => {}
  );
  assert.deepEqual(response, { ok: false, error: "같은 조합을 두 기능에 지정했습니다" });
});

test("OS가 단축키를 점유하면 어느 기능인지 라벨로 알려준다", () => {
  const settings = baseSettings({ translateShortcut: "CommandOrControl+Shift+T" });
  const response = settingsTransactionFailureResponse(
    /** @type {any} */ ({
      ok: false, reason: "shortcutOccupied", failedShortcut: "translate", settings, rollbackFailures: []
    }),
    {
      translate: (/** @type {string} */ _l, /** @type {string} */ k, /** @type {any} */ v) => `t:${k}:${v.shortcut}`,
      describeError: String
    },
    () => {}
  );
  assert.equal(response.error, "t:shortcuts.occupiedError:Ctrl + Shift + T");
});

test("단축키 id마다 그 기능의 라벨을 고른다", () => {
  const settings = baseSettings({
    assistantShortcut: "CommandOrControl+Shift+A",
    favoritesShortcut: "CommandOrControl+Shift+F",
    imageResizeShortcut: "CommandOrControl+Shift+I",
    checklistShortcut: "CommandOrControl+Shift+K",
    translateShortcut: "CommandOrControl+Shift+T",
    documentSummaryShortcut: "CommandOrControl+Shift+D"
  });
  const labels = ["assistant", "favorites", "imageResize", "checklist", "translate", "documentSummary"]
    .map((id) => managedShortcutLabel(id, settings));
  assert.deepEqual(labels, ["Ctrl + Shift + A", "Ctrl + Shift + F", "Ctrl + Shift + I", "Ctrl + Shift + K", "Ctrl + Shift + T", "Ctrl + Shift + D"]);
  assert.equal(new Set(labels).size, labels.length, "id마다 다른 라벨이 나와야 한다");
});
