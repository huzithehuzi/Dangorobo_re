// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { t } = require("../src/shared/i18n.js");

const {
  assistantKeyPlan,
  executeSettingsSaveTransaction,
  sanitizeSettingsImportPayload
} = require("../src/main/settings-save-transaction.js");

/** @typedef {{ language: string, name: string, assistantEnabled: boolean }} TestSettings */
/** @typedef {import("../src/main/settings-save-transaction.js").SettingsSaveTransactionOptions<TestSettings>} TransactionOptions */

function makeFixture() {
  const previousSettings = /** @type {TestSettings} */ ({
    language: "ko",
    name: "previous",
    assistantEnabled: false
  });
  const nextSettings = { language: "ja", name: "candidate", assistantEnabled: true };
  /** @type {string[]} */
  const events = [];
  /** @type {{ key: string, language: string }[]} */
  const persistedKeys = [];
  /** @type {TestSettings[]} */
  const persistedSettings = [];
  /** @type {{ settings: TestSettings, keyConfigured: boolean }[]} */
  const restored = [];
  const options = /** @type {TransactionOptions} */ ({
    previousSettings,
    previousAssistantKey: "",
    nextSettings,
    normalizeSettings: (/** @type {any} */ source, /** @type {{ assistantKeyConfigured: boolean }} */ normalizeOptions) => {
      events.push(`normalize:${normalizeOptions.assistantKeyConfigured}`);
      return /** @type {TestSettings} */ ({
        language: source.language,
        name: source.name,
        assistantEnabled: source.assistantEnabled === true && normalizeOptions.assistantKeyConfigured
      });
    },
    shortcutConflictError: (/** @type {TestSettings} */ _settings, /** @type {boolean} */ keyConfigured) => {
      events.push(`conflict:${keyConfigured}`);
      return null;
    },
    applyShortcuts: (/** @type {TestSettings} */ _settings, /** @type {boolean} */ keyConfigured) => {
      events.push(`apply:${keyConfigured}`);
      return { ok: true };
    },
    restoreShortcuts: (/** @type {TestSettings} */ settings, /** @type {boolean} */ keyConfigured) => {
      events.push(`restore:${keyConfigured}`);
      restored.push({ settings, keyConfigured });
    },
    persistAssistantKey: (/** @type {string} */ key, /** @type {string} */ language) => {
      events.push(`key:${key}`);
      persistedKeys.push({ key, language });
    },
    persistSettings: (/** @type {TestSettings} */ settings) => {
      events.push(`settings:${settings.name}`);
      persistedSettings.push(settings);
    }
  });
  return {
    previousSettings,
    nextSettings,
    events,
    persistedKeys,
    persistedSettings,
    restored,
    options
  };
}

test("API 키 계획은 공백 입력을 무시하고 명시적 삭제를 새 입력보다 우선한다", () => {
  assert.deepEqual(assistantKeyPlan({}, "old-key"), {
    value: "old-key",
    shouldPersist: false
  });
  assert.deepEqual(assistantKeyPlan({ assistantApiKey: "   " }, "old-key"), {
    value: "old-key",
    shouldPersist: false
  });
  assert.deepEqual(assistantKeyPlan({
    assistantApiKey: " new-key ",
    assistantClearApiKey: true
  }, "old-key"), {
    value: "",
    shouldPersist: true
  });
  const longKey = "x".repeat(400);
  assert.deepEqual(assistantKeyPlan({ assistantApiKey: longKey }, "old-key"), {
    value: "x".repeat(300),
    shouldPersist: true
  });
});

test("설정 백업 payload는 객체만 허용하고 API 키 필드를 제거한다", () => {
  assert.equal(sanitizeSettingsImportPayload(null), null);
  assert.equal(sanitizeSettingsImportPayload([]), null);
  assert.equal(sanitizeSettingsImportPayload({ assistantApiKey: "secret" }), null);
  assert.deepEqual(sanitizeSettingsImportPayload({
    language: "ko",
    assistantApiKey: "secret",
    assistantClearApiKey: true
  }), { language: "ko" });
});

test("성공할 때 후보 키로 정규화·단축키 검증·영구 저장한 뒤 commit 결과를 반환한다", () => {
  const fixture = makeFixture();
  fixture.options.nextSettings = {
    ...fixture.nextSettings,
    assistantApiKey: " new-key "
  };

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.assistantKey, "new-key");
  assert.equal(result.settings.assistantEnabled, true);
  assert.deepEqual(fixture.events, [
    "normalize:true",
    "conflict:true",
    "apply:true",
    "key:new-key",
    "settings:candidate"
  ]);
  assert.deepEqual(fixture.persistedKeys, [{ key: "new-key", language: "ja" }]);
  assert.deepEqual(fixture.persistedSettings, [result.settings]);
  assert.deepEqual(fixture.restored, []);
});

test("단축키 내부 충돌은 API 키와 설정·OS 단축키를 전혀 변경하지 않는다", () => {
  const fixture = makeFixture();
  fixture.options.nextSettings = {
    ...fixture.nextSettings,
    assistantApiKey: "new-key"
  };
  fixture.options.shortcutConflictError = () => "conflict";

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "shortcutConflict");
  assert.deepEqual(fixture.events, ["normalize:true"]);
  assert.deepEqual(fixture.persistedKeys, []);
  assert.deepEqual(fixture.persistedSettings, []);
  assert.deepEqual(fixture.restored, []);
});

test("후보 단축키 등록 실패 시 새 API 키를 저장하지 않고 이전 키 상태로 단축키를 복원한다", () => {
  const fixture = makeFixture();
  fixture.options.nextSettings = {
    ...fixture.nextSettings,
    assistantApiKey: "new-key"
  };
  fixture.options.applyShortcuts = (_settings, keyConfigured) => {
    fixture.events.push(`apply:${keyConfigured}`);
    return { ok: false, failedShortcut: "assistant" };
  };

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "shortcutOccupied");
  assert.deepEqual(fixture.events, [
    "normalize:true",
    "conflict:true",
    "apply:true",
    "restore:false"
  ]);
  assert.deepEqual(fixture.persistedKeys, []);
  assert.deepEqual(fixture.persistedSettings, []);
  assert.deepEqual(fixture.restored, [{
    settings: fixture.previousSettings,
    keyConfigured: false
  }]);
});

test("API 키 저장 실패 시 이전 키를 보상 저장하고 후보 단축키를 되돌린다", () => {
  const fixture = makeFixture();
  fixture.options.previousAssistantKey = "old-key";
  fixture.options.nextSettings = {
    ...fixture.nextSettings,
    assistantApiKey: "new-key"
  };
  fixture.options.persistAssistantKey = (key, language) => {
    fixture.events.push(`key:${key}`);
    fixture.persistedKeys.push({ key, language });
    if (key === "new-key") throw new Error("secure storage failed");
  };

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "persistence");
  assert.deepEqual(fixture.persistedKeys, [
    { key: "new-key", language: "ja" },
    { key: "old-key", language: "ko" }
  ]);
  assert.deepEqual(fixture.persistedSettings, []);
  assert.deepEqual(fixture.restored, [{
    settings: fixture.previousSettings,
    keyConfigured: true
  }]);
});

test("설정 파일 저장 실패 시 API 키·설정 파일·단축키를 모두 이전 상태로 보상한다", () => {
  const fixture = makeFixture();
  fixture.options.previousAssistantKey = "old-key";
  fixture.options.nextSettings = {
    ...fixture.nextSettings,
    assistantApiKey: "new-key"
  };
  fixture.options.persistSettings = (settings) => {
    fixture.events.push(`settings:${settings.name}`);
    fixture.persistedSettings.push(settings);
    if (settings.name === "candidate") throw new Error("settings write failed");
  };

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "persistence");
  assert.deepEqual(fixture.persistedKeys, [
    { key: "new-key", language: "ja" },
    { key: "old-key", language: "ko" }
  ]);
  assert.deepEqual(
    fixture.persistedSettings.map((settings) => settings.name),
    ["candidate", "previous"]
  );
  assert.deepEqual(fixture.restored, [{
    settings: fixture.previousSettings,
    keyConfigured: true
  }]);
});

test("보상 작업 자체의 실패는 원래 저장 실패와 함께 보고한다", () => {
  const fixture = makeFixture();
  fixture.options.previousAssistantKey = "old-key";
  fixture.options.nextSettings = {
    ...fixture.nextSettings,
    assistantApiKey: "new-key"
  };
  fixture.options.persistAssistantKey = (key) => {
    throw new Error(key === "new-key" ? "write failed" : "key rollback failed");
  };
  fixture.options.restoreShortcuts = () => {
    throw new Error("shortcut rollback failed");
  };

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "persistence");
  assert.deepEqual(result.rollbackFailures.map((failure) => failure.stage), [
    "assistantKey",
    "shortcuts"
  ]);
});

test("설정 백업 저장 실패는 API 키를 건드리지 않고 이전 설정과 단축키를 복원한다", () => {
  const fixture = makeFixture();
  fixture.options.previousAssistantKey = "old-key";
  fixture.options.nextSettings = sanitizeSettingsImportPayload(fixture.nextSettings);
  fixture.options.persistSettings = (settings) => {
    fixture.events.push(`settings:${settings.name}`);
    fixture.persistedSettings.push(settings);
    if (settings.name === "candidate") throw new Error("import write failed");
  };

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "persistence");
  assert.deepEqual(fixture.persistedKeys, []);
  assert.deepEqual(fixture.persistedSettings.map((value) => value.name), ["candidate", "previous"]);
  assert.deepEqual(fixture.restored, [{
    settings: fixture.previousSettings,
    keyConfigured: true
  }]);
});

test("롤백 실패 응답은 설정 UI 두 경로에서 복구 미완료 경고로 표시된다", () => {
  const repoRoot = path.join(__dirname, "..");
  // 응답을 만드는 쪽은 settings-ipc.ts, 표시하는 쪽은 설정창 두 경로다.
  const ipcSource = fs.readFileSync(path.join(repoRoot, "src/main/settings-ipc.ts"), "utf8");
  const appSource = fs.readFileSync(path.join(repoRoot, "ui/settings/App.tsx"), "utf8");
  const appTabSource = fs.readFileSync(path.join(repoRoot, "ui/settings/tabs-app.tsx"), "utf8");
  const globalTypesSource = fs.readFileSync(path.join(repoRoot, "ui/lib/global.d.ts"), "utf8");

  assert.match(ipcSource, /recoveryIncomplete \? \{ recoveryIncomplete: true \} : \{\}/);
  assert.match(appSource, /result\.recoveryIncomplete[\s\S]*settings\.footer\.recoveryIncomplete/);
  assert.match(appTabSource, /result\.recoveryIncomplete[\s\S]*settings\.footer\.recoveryIncomplete/);
  assert.match(globalTypesSource, /recoveryIncomplete\?: boolean;/);

  for (const language of ["ko", "en", "ja"]) {
    const warning = t(language, "settings.footer.recoveryIncomplete");
    assert.match(warning, /재시작|restart|再起動/i);
    assert.match(warning, /단축키|shortcut|ショートカット/i);
  }
});

test("영구 저장 수명주기는 쓰기 전에 준비하고 성공 뒤 저널을 완료한다", () => {
  const fixture = makeFixture();
  fixture.options.previousAssistantKey = "old-key";
  fixture.options.nextSettings = {
    ...fixture.nextSettings,
    assistantApiKey: "new-key"
  };
  fixture.options.preparePersistence = (settings, key, keyWillPersist) => {
    fixture.events.push(`journal:prepare:${settings.name}:${key}:${keyWillPersist}`);
  };
  fixture.options.markPersistenceRollback = () => fixture.events.push("journal:rollback");
  fixture.options.completePersistence = () => fixture.events.push("journal:complete");
  fixture.options.cancelPersistence = () => fixture.events.push("journal:cancel");

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.cleanupFailures, []);
  assert.deepEqual(fixture.events, [
    "normalize:true",
    "conflict:true",
    "apply:true",
    "journal:prepare:candidate:new-key:true",
    "key:new-key",
    "settings:candidate",
    "journal:complete"
  ]);
});

test("영구 저장 실패는 저널을 rollback으로 표시한 뒤 디스크 복원 후 취소한다", () => {
  const fixture = makeFixture();
  fixture.options.previousAssistantKey = "old-key";
  fixture.options.nextSettings = {
    ...fixture.nextSettings,
    assistantApiKey: "new-key"
  };
  fixture.options.preparePersistence = () => fixture.events.push("journal:prepare");
  fixture.options.markPersistenceRollback = () => fixture.events.push("journal:rollback");
  fixture.options.completePersistence = () => fixture.events.push("journal:complete");
  fixture.options.cancelPersistence = () => fixture.events.push("journal:cancel");
  fixture.options.persistSettings = (settings) => {
    fixture.events.push(`settings:${settings.name}`);
    if (settings.name === "candidate") throw new Error("write failed");
  };

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "persistence");
  assert.deepEqual(result.rollbackFailures, []);
  assert.deepEqual(fixture.events, [
    "normalize:true",
    "conflict:true",
    "apply:true",
    "journal:prepare",
    "key:new-key",
    "settings:candidate",
    "journal:rollback",
    "key:old-key",
    "settings:previous",
    "restore:true",
    "journal:cancel"
  ]);
});

test("디스크 rollback이 실패하면 저널을 남기고 복구 미완료로 보고한다", () => {
  const fixture = makeFixture();
  fixture.options.previousAssistantKey = "old-key";
  fixture.options.nextSettings = {
    ...fixture.nextSettings,
    assistantApiKey: "new-key"
  };
  fixture.options.preparePersistence = () => fixture.events.push("journal:prepare");
  fixture.options.markPersistenceRollback = () => fixture.events.push("journal:rollback");
  fixture.options.cancelPersistence = () => fixture.events.push("journal:cancel");
  fixture.options.persistAssistantKey = (key) => {
    fixture.events.push(`key:${key}`);
    if (key === "old-key") throw new Error("key rollback failed");
  };
  fixture.options.persistSettings = () => {
    throw new Error("settings write failed");
  };

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.rollbackFailures.map(failure => failure.stage), [
    "assistantKey",
    "settings"
  ]);
  assert.ok(!fixture.events.includes("journal:cancel"));
});

test("저장은 끝났지만 저널 정리 실패 시 성공 상태와 정리 오류를 함께 반환한다", () => {
  const fixture = makeFixture();
  fixture.options.preparePersistence = () => fixture.events.push("journal:prepare");
  fixture.options.completePersistence = () => {
    throw new Error("journal cleanup failed");
  };

  const result = executeSettingsSaveTransaction(fixture.options);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.cleanupFailures.map(failure => failure.stage), ["journal"]);
});
