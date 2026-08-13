// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");
const {
  createGlobalShortcutManager,
  canonicalShortcutConflictKey,
  shortcutConflictError
} = require("../src/main/global-shortcut-manager.js");
const { t } = require("../src/shared/i18n.js");

class FakeGlobalShortcut {
  constructor() {
    /** @type {Map<string, () => void>} */
    this.callbacks = new Map();
    /** @type {Set<string>} */
    this.rejected = new Set();
    /** @type {string[]} */
    this.registerCalls = [];
    /** @type {string[]} */
    this.unregisterCalls = [];
  }

  /**
   * @param {string} accelerator
   * @param {() => void} callback
   */
  register(accelerator, callback) {
    this.registerCalls.push(accelerator);
    if (this.rejected.has(accelerator)) return false;
    this.callbacks.set(accelerator, callback);
    return true;
  }

  /** @param {string} accelerator */
  unregister(accelerator) {
    this.unregisterCalls.push(accelerator);
    this.callbacks.delete(accelerator);
  }
}

/**
 * @param {{ settings?: import("../src/main/settings-schema.js").Settings, keyConfigured?: boolean }} [options]
 */
function makeFixture(options = {}) {
  let currentSettings = options.settings || /** @type {import("../src/main/settings-schema.js").Settings} */ ({
    ...DEFAULT_SETTINGS,
    assistantEnabled: true,
    favoritesEnabled: true
  });
  let keyConfigured = options.keyConfigured !== false;
  const globalShortcut = new FakeGlobalShortcut();
  /** @type {string[]} */
  const invoked = [];
  const handler = (/** @type {string} */ name) => () => invoked.push(name);
  const manager = createGlobalShortcutManager({
    globalShortcut,
    getSettings: () => currentSettings,
    isAssistantKeyConfigured: () => keyConfigured,
    handlers: {
      assistant: handler("assistant"),
      favorites: handler("favorites"),
      imageResize: handler("imageResize"),
      checklist: handler("checklist"),
      translate: handler("translate"),
      documentSummary: handler("documentSummary")
    }
  });
  return {
    globalShortcut,
    manager,
    invoked,
    setSettings(/** @type {import("../src/main/settings-schema.js").Settings} */ nextSettings) {
      currentSettings = nextSettings;
    },
    setKeyConfigured(/** @type {boolean} */ configured) {
      keyConfigured = configured;
    }
  };
}

test("활성화된 6개 키보드 단축키를 각각 등록하고 핸들러에 연결한다", () => {
  const fixture = makeFixture();
  const { manager, globalShortcut, invoked } = fixture;

  assert.equal(manager.registerAssistantShortcut(), true);
  assert.equal(manager.registerFavoritesShortcut(), true);
  assert.equal(manager.registerImageResizeShortcut(), true);
  assert.equal(manager.registerChecklistShortcut(), true);
  assert.equal(manager.registerTranslateShortcut(), true);
  assert.equal(manager.registerDocumentSummaryShortcut(), true);
  assert.deepEqual(globalShortcut.registerCalls, [
    DEFAULT_SETTINGS.assistantShortcut,
    DEFAULT_SETTINGS.favoritesShortcut,
    DEFAULT_SETTINGS.imageResizeShortcut,
    DEFAULT_SETTINGS.checklistShortcut,
    DEFAULT_SETTINGS.translateShortcut,
    DEFAULT_SETTINGS.documentSummaryShortcut
  ]);

  for (const accelerator of globalShortcut.registerCalls) {
    globalShortcut.callbacks.get(accelerator)?.();
  }
  assert.deepEqual(invoked, [
    "assistant",
    "favorites",
    "imageResize",
    "checklist",
    "translate",
    "documentSummary"
  ]);
});

test("관리 단축키 전체 해제는 main이 등록한 이동·종료 단축키를 건드리지 않는다", () => {
  const { manager, globalShortcut } = makeFixture();
  const unmanaged = ["CommandOrControl+Shift+P", "CommandOrControl+Shift+Q"];
  for (const accelerator of unmanaged) globalShortcut.register(accelerator, () => {});
  manager.registerAssistantShortcut();
  manager.registerFavoritesShortcut();
  manager.registerImageResizeShortcut();
  manager.registerChecklistShortcut();
  manager.registerTranslateShortcut();
  manager.registerDocumentSummaryShortcut();

  globalShortcut.unregisterCalls.length = 0;
  manager.unregisterManagedShortcuts();

  assert.equal(globalShortcut.unregisterCalls.length, 6);
  assert.deepEqual(new Set(globalShortcut.unregisterCalls), new Set([
    DEFAULT_SETTINGS.assistantShortcut,
    DEFAULT_SETTINGS.favoritesShortcut,
    DEFAULT_SETTINGS.imageResizeShortcut,
    DEFAULT_SETTINGS.checklistShortcut,
    DEFAULT_SETTINGS.translateShortcut,
    DEFAULT_SETTINGS.documentSummaryShortcut
  ]));
  assert.equal(globalShortcut.callbacks.has(unmanaged[0]), true);
  assert.equal(globalShortcut.callbacks.has(unmanaged[1]), true);
});

test("인자 없이 재등록할 때 재할당된 최신 settings를 읽는다", () => {
  const fixture = makeFixture();
  fixture.manager.registerFavoritesShortcut();
  const nextSettings = /** @type {import("../src/main/settings-schema.js").Settings} */ ({
    ...DEFAULT_SETTINGS,
    assistantEnabled: true,
    favoritesEnabled: true,
    favoritesShortcut: "Alt+Shift+9"
  });
  fixture.setSettings(nextSettings);

  assert.equal(fixture.manager.registerFavoritesShortcut(), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.favoritesShortcut), false);
  assert.equal(fixture.globalShortcut.callbacks.has("Alt+Shift+9"), true);

  fixture.setSettings({ ...nextSettings, favoritesEnabled: false });
  assert.equal(fixture.manager.registerFavoritesShortcut(), true);
  assert.equal(fixture.globalShortcut.callbacks.has("Alt+Shift+9"), false);
});

test("API 키 상태도 호출 시점에 읽고 질문·문서 요약 등록을 함께 해제한다", () => {
  const fixture = makeFixture();
  fixture.manager.registerAssistantShortcut();
  fixture.manager.registerDocumentSummaryShortcut();
  fixture.setKeyConfigured(false);

  assert.equal(fixture.manager.registerAssistantShortcut(), true);
  assert.equal(fixture.manager.registerDocumentSummaryShortcut(), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.assistantShortcut), false);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.documentSummaryShortcut), false);
});

test("저장 후보의 API 키 상태를 넘기면 전역 상태를 바꾸기 전에도 질문·문서 요약을 등록한다", () => {
  const fixture = makeFixture({ keyConfigured: false });
  const candidateSettings = /** @type {import("../src/main/settings-schema.js").Settings} */ ({
    ...DEFAULT_SETTINGS,
    assistantEnabled: true
  });

  assert.equal(fixture.manager.registerAssistantShortcut(candidateSettings, true), true);
  assert.equal(fixture.manager.registerDocumentSummaryShortcut(candidateSettings, true), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.assistantShortcut), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.documentSummaryShortcut), true);
});

test("마우스 단축키는 OS에 등록하지 않고 버튼과 보조키가 모두 맞을 때만 실행한다", () => {
  const settings = /** @type {import("../src/main/settings-schema.js").Settings} */ ({
    ...DEFAULT_SETTINGS,
    assistantEnabled: true,
    favoritesEnabled: true,
    assistantShortcut: "CommandOrControl+Alt+Mouse4"
  });
  const { manager, globalShortcut, invoked } = makeFixture({ settings });

  assert.equal(manager.registerAssistantShortcut(), true);
  assert.deepEqual(globalShortcut.registerCalls, []);
  assert.equal(manager.dispatchMouseShortcut({ button: 4, altKey: true }), false);
  assert.equal(manager.dispatchMouseShortcut({ button: 5, ctrlKey: true, altKey: true }), false);
  assert.equal(manager.dispatchMouseShortcut({ button: 4, metaKey: true, altKey: true }), true);
  assert.deepEqual(invoked, ["assistant"]);

  manager.unregisterAssistantShortcut();
  assert.equal(manager.dispatchMouseShortcut({ button: 4, ctrlKey: true, altKey: true }), false);
});

test("등록 실패는 false를 반환하고 복원은 이전 6개 설정만 다시 등록한다", () => {
  const fixture = makeFixture();
  const previousSettings = /** @type {import("../src/main/settings-schema.js").Settings} */ ({
    ...DEFAULT_SETTINGS,
    assistantEnabled: true,
    favoritesEnabled: true
  });
  const occupied = "Alt+Shift+8";
  fixture.globalShortcut.rejected.add(occupied);

  assert.equal(fixture.manager.registerAssistantShortcut({
    ...previousSettings,
    assistantShortcut: occupied
  }), false);
  assert.equal(fixture.globalShortcut.callbacks.has(occupied), false);

  fixture.globalShortcut.register("CommandOrControl+Shift+P", () => {});
  fixture.manager.restoreGlobalShortcuts(previousSettings);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.assistantShortcut), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.favoritesShortcut), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.imageResizeShortcut), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.checklistShortcut), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.translateShortcut), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.documentSummaryShortcut), true);
  assert.equal(fixture.globalShortcut.callbacks.has("CommandOrControl+Shift+P"), true);
});

test("후보 단축키 묶음은 첫 등록 실패 항목을 반환하고 이전 키 상태로 전체 복원할 수 있다", () => {
  const fixture = makeFixture({ keyConfigured: false });
  const previousSettings = /** @type {import("../src/main/settings-schema.js").Settings} */ ({
    ...DEFAULT_SETTINGS,
    assistantEnabled: true,
    favoritesEnabled: true
  });
  const candidateSettings = /** @type {import("../src/main/settings-schema.js").Settings} */ ({
    ...previousSettings,
    translateShortcut: "Alt+Shift+8"
  });
  fixture.globalShortcut.rejected.add(candidateSettings.translateShortcut);

  assert.deepEqual(fixture.manager.applyGlobalShortcuts(candidateSettings, true), {
    ok: false,
    failedShortcut: "translate"
  });
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.assistantShortcut), true);

  assert.equal(fixture.manager.restoreGlobalShortcuts(previousSettings, false), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.assistantShortcut), false);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.documentSummaryShortcut), false);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.favoritesShortcut), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.checklistShortcut), true);
});

test("이전 단축키 하나가 점유돼도 복원은 나머지 항목을 모두 시도하고 실패를 알린다", () => {
  const fixture = makeFixture();
  fixture.globalShortcut.rejected.add(DEFAULT_SETTINGS.checklistShortcut);

  assert.equal(fixture.manager.restoreGlobalShortcuts({
    ...DEFAULT_SETTINGS,
    assistantEnabled: true,
    favoritesEnabled: true
  }), false);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.assistantShortcut), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.checklistShortcut), false);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.translateShortcut), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.documentSummaryShortcut), true);
});

test("꺼진 기능은 성공으로 처리하면서 기존 키보드·마우스 등록을 제거한다", () => {
  const fixture = makeFixture();
  fixture.manager.registerAssistantShortcut();
  fixture.manager.registerFavoritesShortcut({
    ...DEFAULT_SETTINGS,
    favoritesEnabled: true,
    favoritesShortcut: "Mouse5"
  });

  const disabled = /** @type {import("../src/main/settings-schema.js").Settings} */ ({
    ...DEFAULT_SETTINGS,
    assistantEnabled: false,
    favoritesEnabled: false,
    imageResizeShortcutEnabled: false,
    checklistShortcutEnabled: false,
    translateShortcutEnabled: false,
    documentSummaryShortcutEnabled: false
  });
  assert.equal(fixture.manager.registerAssistantShortcut(disabled), true);
  assert.equal(fixture.manager.registerFavoritesShortcut(disabled), true);
  assert.equal(fixture.manager.registerImageResizeShortcut(disabled), true);
  assert.equal(fixture.manager.registerChecklistShortcut(disabled), true);
  assert.equal(fixture.manager.registerTranslateShortcut(disabled), true);
  assert.equal(fixture.manager.registerDocumentSummaryShortcut(disabled), true);
  assert.equal(fixture.globalShortcut.callbacks.has(DEFAULT_SETTINGS.assistantShortcut), false);
  assert.equal(fixture.manager.dispatchMouseShortcut({ button: 5 }), false);
});

// ── 단축키 충돌 검사 (settings:save에서 이동) ────────────────────────────────

/** @param {Partial<import("../src/main/settings-schema.js").Settings>} overrides */
function conflictSettings(overrides) {
  return /** @type {import("../src/main/settings-schema.js").Settings} */ ({
    ...DEFAULT_SETTINGS,
    language: "ko",
    assistantEnabled: true,
    favoritesEnabled: true,
    ...overrides
  });
}

test("Windows 비교 키는 Ctrl 계열 별칭·순서·대소문자를 같은 조합으로 정규화한다", () => {
  const expected = canonicalShortcutConflictKey("CommandOrControl+Alt+Shift+E", "win32");
  for (const accelerator of [
    "shift+alt+control+e",
    "ALT+Ctrl+SHIFT+E",
    "Shift+Cmd+Alt+e",
    "alt+COMMAND+shift+E"
  ]) {
    assert.equal(canonicalShortcutConflictKey(accelerator, "win32"), expected);
  }

  assert.notEqual(
    canonicalShortcutConflictKey("CommandOrControl+Shift+E", "win32"),
    canonicalShortcutConflictKey("CommandOrControl+Alt+E", "win32")
  );
  assert.notEqual(
    canonicalShortcutConflictKey("CommandOrControl+Shift+E", "win32"),
    canonicalShortcutConflictKey("CommandOrControl+Shift+R", "win32")
  );
});

test("macOS 비교 키는 Command 계열과 Control을 구분하고 Super의 Electron 의미를 보존한다", () => {
  const command = canonicalShortcutConflictKey("CommandOrControl+Shift+E", "darwin");
  assert.equal(canonicalShortcutConflictKey("shift+cmd+e", "darwin"), command);
  assert.equal(canonicalShortcutConflictKey("Super+Shift+E", "darwin"), command);
  assert.notEqual(canonicalShortcutConflictKey("Control+Shift+E", "darwin"), command);
  assert.equal(
    canonicalShortcutConflictKey("Option+Shift+E", "darwin"),
    canonicalShortcutConflictKey("Alt+Shift+E", "darwin")
  );
});

test("Linux 비교 키는 CommandOrControl을 Control로 해석하되 지원되지 않는 Cmd와 합치지 않는다", () => {
  const control = canonicalShortcutConflictKey("CommandOrControl+Shift+E", "linux");
  assert.equal(canonicalShortcutConflictKey("Ctrl+Shift+E", "linux"), control);
  assert.notEqual(canonicalShortcutConflictKey("Cmd+Shift+E", "linux"), control);
  assert.notEqual(canonicalShortcutConflictKey("Super+Shift+E", "linux"), control);
  assert.notEqual(
    canonicalShortcutConflictKey("Option+Shift+E", "linux"),
    canonicalShortcutConflictKey("Alt+Shift+E", "linux")
  );
});

test("Mouse4/5 비교 키도 플랫폼별 보조키 별칭·순서를 정규화한다", () => {
  const windowsMouse = canonicalShortcutConflictKey(
    "CommandOrControl+Alt+Mouse4",
    "win32"
  );
  assert.equal(canonicalShortcutConflictKey("alt+CTRL+mouse4", "win32"), windowsMouse);
  assert.equal(canonicalShortcutConflictKey("Cmd+Alt+Mouse4", "win32"), windowsMouse);
  assert.notEqual(canonicalShortcutConflictKey("Ctrl+Mouse4", "win32"), windowsMouse);
  assert.notEqual(canonicalShortcutConflictKey("Ctrl+Alt+Mouse5", "win32"), windowsMouse);

  assert.equal(
    canonicalShortcutConflictKey("CommandOrControl+Mouse4", "darwin"),
    canonicalShortcutConflictKey("Cmd+Mouse4", "darwin")
  );
  assert.notEqual(
    canonicalShortcutConflictKey("CommandOrControl+Mouse4", "darwin"),
    canonicalShortcutConflictKey("Control+Mouse4", "darwin")
  );
});

test("겹치는 단축키가 있으면 두 기능 이름과 조합이 담긴 오류를 준다", () => {
  const error = shortcutConflictError(
    conflictSettings({ checklistShortcut: "CommandOrControl+Shift+E" }),
    true
  );
  assert.ok(error);
  assert.ok(error.includes("Ctrl + Shift + E"));
  assert.ok(error.includes(t("ko", "settings.shortcuts.checklistLabel")));
  assert.ok(error.includes(t("ko", "settings.shortcuts.translateHeading")));
});

test("Windows에서는 별칭·순서·대소문자만 다른 키보드 조합도 충돌한다", () => {
  const error = shortcutConflictError(
    conflictSettings({
      checklistShortcut: "Shift+Cmd+e",
      translateShortcut: "Control+Shift+E"
    }),
    true,
    "win32"
  );
  assert.ok(error);
  assert.ok(error.includes(t("ko", "settings.shortcuts.checklistLabel")));
  assert.ok(error.includes(t("ko", "settings.shortcuts.translateHeading")));
});

test("macOS에서는 CommandOrControl과 Control 조합을 서로 다른 단축키로 유지한다", () => {
  assert.equal(shortcutConflictError(
    conflictSettings({
      checklistShortcut: "CommandOrControl+Shift+E",
      translateShortcut: "Control+Shift+E"
    }),
    true,
    "darwin"
  ), null);
});

test("겹침이 없으면 null", () => {
  assert.equal(shortcutConflictError(conflictSettings({}), true), null);
});

test("꺼진 기능의 단축키는 겹쳐도 무시한다", () => {
  // 질문창 기능 꺼짐 → assistant/documentSummary 둘 다 비교 대상 제외
  const assistantOff = conflictSettings({
    assistantEnabled: false,
    checklistShortcut: DEFAULT_SETTINGS.assistantShortcut,
    translateShortcut: DEFAULT_SETTINGS.documentSummaryShortcut
  });
  assert.equal(shortcutConflictError(assistantOff, true), null);

  // API 키 없음 → assistant만 제외 (documentSummary는 assistantEnabled만 본다)
  const noKey = conflictSettings({ checklistShortcut: DEFAULT_SETTINGS.assistantShortcut });
  assert.equal(shortcutConflictError(noKey, false), null);
  assert.ok(shortcutConflictError(noKey, true));

  // 개별 "사용 안 함" → 그 항목만 제외
  const perToggleOff = conflictSettings({
    translateShortcutEnabled: false,
    checklistShortcut: DEFAULT_SETTINGS.translateShortcut
  });
  assert.equal(shortcutConflictError(perToggleOff, true), null);

  // 즐겨찾기 기능 꺼짐 → favorites 제외
  const favoritesOff = conflictSettings({
    favoritesEnabled: false,
    checklistShortcut: DEFAULT_SETTINGS.favoritesShortcut
  });
  assert.equal(shortcutConflictError(favoritesOff, true), null);
});

test("마우스 단축키끼리도 겹침으로 잡는다", () => {
  const error = shortcutConflictError(
    conflictSettings({ imageResizeShortcut: "Mouse4", translateShortcut: "Mouse4" }),
    true
  );
  assert.ok(error);
});

test("마우스 단축키도 Windows 별칭과 순서가 달라도 충돌하고 실제 차이는 보존한다", () => {
  assert.ok(shortcutConflictError(
    conflictSettings({
      imageResizeShortcut: "Alt+Cmd+Mouse4",
      translateShortcut: "Control+Alt+Mouse4"
    }),
    true,
    "win32"
  ));
  assert.equal(shortcutConflictError(
    conflictSettings({
      imageResizeShortcut: "Ctrl+Alt+Mouse4",
      translateShortcut: "Ctrl+Alt+Mouse5"
    }),
    true,
    "win32"
  ), null);
  assert.equal(shortcutConflictError(
    conflictSettings({
      imageResizeShortcut: "Ctrl+Mouse4",
      translateShortcut: "Ctrl+Alt+Mouse4"
    }),
    true,
    "win32"
  ), null);
});
