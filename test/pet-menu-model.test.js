// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");
const {
  buildPetMenuItems,
  serializeMenuItems,
  contextMenuHeight
} = require("../src/main/windows/pet-menu-model.js");

/** @typedef {import("../src/main/settings-schema.js").Settings} Settings */
/** @typedef {import("../src/main/windows/pet-menu-model.js").PetMenuItem} PetMenuItem */
/** @typedef {import("../src/main/windows/pet-menu-model.js").PetMenuActions} PetMenuActions */
/** @typedef {import("../src/main/windows/pet-menu-model.js").PetMenuModelOptions} PetMenuModelOptions */

/**
 * @param {Omit<Partial<Settings>, "trayMenuItems"> & {
 *   trayMenuItems?: Partial<Settings["trayMenuItems"]>
 * }} [overrides]
 * @returns {Settings}
 */
function makeSettings(overrides = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    trayMenuItems: {
      ...DEFAULT_SETTINGS.trayMenuItems,
      ...overrides.trayMenuItems
    },
    favoriteItems: overrides.favoriteItems ? [...overrides.favoriteItems] : [...DEFAULT_SETTINGS.favoriteItems]
  };
}

/**
 * @param {string[]} calls
 * @returns {PetMenuActions}
 */
function makeActions(calls) {
  return {
    togglePet: () => calls.push("togglePet"),
    toggleMoveMode: () => calls.push("toggleMoveMode"),
    openSettings: () => calls.push("openSettings"),
    openLogs: () => calls.push("openLogs"),
    toggleChecklist: () => calls.push("toggleChecklist"),
    openAssistant: () => calls.push("openAssistant"),
    openFavorites: () => calls.push("openFavorites"),
    activateFavorite: (id) => calls.push(`activateFavorite:${id}`),
    toggleAutoStart: () => calls.push("toggleAutoStart"),
    quit: () => calls.push("quit")
  };
}

/**
 * @param {Partial<PetMenuModelOptions>} [overrides]
 * @returns {PetMenuModelOptions}
 */
function makeOptions(overrides = {}) {
  /** @type {string[]} */
  const calls = [];
  return {
    settings: makeSettings(),
    countdown: "12분 34초",
    clickThrough: true,
    restActive: false,
    alwaysDragEnabled: false,
    assistantKeyConfigured: false,
    assistantLogCount: 0,
    checklistOpen: false,
    actions: makeActions(calls),
    ...overrides
  };
}

/**
 * @param {PetMenuItem[]} items
 * @param {string} id
 * @returns {PetMenuItem | undefined}
 */
function findItem(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.items) {
      const found = findItem(item.items, id);
      if (found) return found;
    }
  }
  return undefined;
}

test("모든 기능이 켜진 목록의 ID·순서·레이블과 액션 연결을 보존한다", () => {
  /** @type {string[]} */
  const calls = [];
  const settings = makeSettings({
    language: "ko",
    assistantEnabled: true,
    favoritesEnabled: true,
    favoritesTrayItemsEnabled: true,
    autoStartEnabled: true,
    favoriteItems: [
      { id: "alpha", name: "알파", target: "C:\\alpha.exe", iconTemplate: "heart", iconColor: "#112233", customIcon: "" },
      { id: "beta", name: "베타", target: "C:\\beta.exe", iconTemplate: "", iconColor: "#445566", customIcon: "" }
    ]
  });
  const items = buildPetMenuItems(makeOptions({
    settings,
    assistantKeyConfigured: true,
    assistantLogCount: 7,
    actions: makeActions(calls)
  }));

  assert.deepEqual(items.map((item) => item.id), [
    "toggle-pet",
    "toggle-move-mode",
    "sep-1",
    "alarm-countdown",
    "open-settings",
    "open-logs",
    "toggle-checklist",
    "open-assistant",
    "open-favorites",
    "sep-favorites",
    "favorite:alpha",
    "favorite:beta",
    "toggle-autostart",
    "sep-2",
    "quit"
  ]);
  assert.equal(findItem(items, "toggle-pet")?.label, "펫 보이기/숨기기");
  assert.equal(findItem(items, "toggle-move-mode")?.label, "펫 이동 모드 켜기");
  assert.equal(findItem(items, "alarm-countdown")?.label, "다음 알람까지: 12분 34초");
  assert.equal(findItem(items, "open-logs")?.label, "질문·답변 기록… (7)");
  assert.match(findItem(items, "toggle-checklist")?.label || "", /^체크리스트 열기 · /);
  assert.match(findItem(items, "open-assistant")?.label || "", /^펫과의 대화 열기 · /);
  assert.match(findItem(items, "open-favorites")?.label || "", /^즐겨찾기 열기 · /);
  assert.equal(findItem(items, "toggle-autostart")?.checked, true);

  for (const id of [
    "toggle-pet",
    "toggle-move-mode",
    "open-settings",
    "open-logs",
    "toggle-checklist",
    "open-assistant",
    "open-favorites",
    "favorite:alpha",
    "favorite:beta",
    "toggle-autostart",
    "quit"
  ]) {
    findItem(items, id)?.run?.();
  }
  assert.deepEqual(calls, [
    "togglePet",
    "toggleMoveMode",
    "openSettings",
    "openLogs",
    "toggleChecklist",
    "openAssistant",
    "openFavorites",
    "activateFavorite:alpha",
    "activateFavorite:beta",
    "toggleAutoStart",
    "quit"
  ]);
});

test("이동 방식·휴식·체크리스트 상태가 표시와 disabled에 그대로 반영된다", () => {
  const settings = makeSettings({
    language: "ko",
    assistantEnabled: true,
    favoritesEnabled: true
  });
  const resting = buildPetMenuItems(makeOptions({
    settings,
    clickThrough: false,
    restActive: true,
    assistantKeyConfigured: true,
    checklistOpen: true
  }));

  assert.equal(findItem(resting, "toggle-move-mode")?.label, "이동 완료 · 클릭 통과 켜기");
  assert.equal(findItem(resting, "toggle-checklist")?.label?.startsWith("체크리스트 닫기 · "), true);
  for (const id of ["toggle-move-mode", "open-assistant", "open-favorites"]) {
    assert.equal(findItem(resting, id)?.enabled, false);
  }
  assert.equal(findItem(resting, "toggle-pet")?.enabled, undefined);

  const alwaysDrag = buildPetMenuItems(makeOptions({ settings, alwaysDragEnabled: true, assistantKeyConfigured: true }));
  assert.equal(findItem(alwaysDrag, "toggle-move-mode"), undefined);
  assert.equal(alwaysDrag.filter((item) => item.id === "sep-1").length, 1);
});

test("기능별 메뉴 표시 조건과 첫 구분선 조건을 보존한다", () => {
  const allTrayItemsHidden = {
    showHidePet: false,
    moveMode: false,
    alarmCountdown: false,
    qaLogs: false,
    checklist: false,
    assistant: false,
    favorites: false,
    autoStart: false
  };
  const settings = makeSettings({
    assistantEnabled: true,
    favoritesEnabled: true,
    favoritesTrayItemsEnabled: true,
    trayMenuItems: allTrayItemsHidden,
    favoriteItems: [
      { id: "only", name: "", target: "C:\\only.exe", iconTemplate: "", iconColor: "#ffffff", customIcon: "" }
    ]
  });
  const items = buildPetMenuItems(makeOptions({ settings, assistantKeyConfigured: true }));

  assert.deepEqual(items.map((item) => item.id), [
    "open-settings",
    "sep-favorites",
    "favorite:only",
    "sep-2",
    "quit"
  ]);
  assert.equal(findItem(items, "favorite:only")?.label, "Shortcut");

  const noKey = buildPetMenuItems(makeOptions({
    settings: makeSettings({ assistantEnabled: true }),
    assistantKeyConfigured: false
  }));
  assert.equal(findItem(noKey, "open-assistant"), undefined);

  const disabled = buildPetMenuItems(makeOptions({
    settings: makeSettings({ assistantEnabled: false, favoritesEnabled: false }),
    assistantKeyConfigured: true
  }));
  assert.equal(findItem(disabled, "open-assistant"), undefined);
  assert.equal(findItem(disabled, "open-favorites"), undefined);
});

test("trayMenuItems는 기존 정규화 규칙으로 누락 키와 비불리언 값을 처리한다", () => {
  const settings = makeSettings();
  settings.trayMenuItems = /** @type {Settings["trayMenuItems"]} */ (/** @type {unknown} */ ({ showHidePet: 1, moveMode: false }));
  const items = buildPetMenuItems(makeOptions({ settings }));

  assert.equal(findItem(items, "toggle-pet"), undefined);
  assert.equal(findItem(items, "toggle-move-mode"), undefined);
  assert.ok(findItem(items, "alarm-countdown"));
  assert.ok(findItem(items, "open-logs"));
  assert.ok(findItem(items, "toggle-checklist"));
  assert.ok(findItem(items, "toggle-autostart"));
});

test("즐겨찾기 list 모델의 커스텀·템플릿·자동 아이콘 필드를 보존한다", () => {
  const settings = makeSettings({
    language: "ko",
    favoritesEnabled: true,
    favoritesTrayItemsEnabled: true,
    favoritesLayout: "list",
    favoriteItems: [
      { id: "custom", name: "커스텀", target: "C:\\custom.exe", iconTemplate: "star", iconColor: "#111111", customIcon: "C:\\custom.png" },
      { id: "template", name: "템플릿", target: "C:\\template.exe", iconTemplate: "heart", iconColor: "#223344", customIcon: "" },
      { id: "auto", name: "", target: "C:\\auto.exe", iconTemplate: "", iconColor: "#556677", customIcon: "" }
    ]
  });
  const items = buildPetMenuItems(makeOptions({ settings, restActive: true }));

  assert.equal(findItem(items, "favorites-grid"), undefined);
  assert.deepEqual(findItem(items, "favorite:custom"), {
    id: "favorite:custom",
    icon: "favorite",
    iconDataUrl: null,
    target: "C:\\custom.exe",
    customIcon: "C:\\custom.png",
    iconTemplate: null,
    iconColor: null,
    label: "커스텀",
    enabled: false,
    run: findItem(items, "favorite:custom")?.run
  });
  assert.equal(findItem(items, "favorite:template")?.customIcon, null);
  assert.equal(findItem(items, "favorite:template")?.iconTemplate, "heart");
  assert.equal(findItem(items, "favorite:template")?.iconColor, "#223344");
  assert.equal(findItem(items, "favorite:auto")?.customIcon, null);
  assert.equal(findItem(items, "favorite:auto")?.iconTemplate, null);
  assert.equal(findItem(items, "favorite:auto")?.iconColor, null);
  assert.equal(findItem(items, "favorite:auto")?.label, "바로가기");
});

test("즐겨찾기 grid는 같은 자식 모델을 4열 컨테이너에 넣는다", () => {
  const favoriteItems = Array.from({ length: 5 }, (_, index) => ({
    id: `item-${index}`,
    name: `항목 ${index}`,
    target: `C:\\item-${index}.exe`,
    iconTemplate: "",
    iconColor: "#ffffff",
    customIcon: ""
  }));
  const settings = makeSettings({
    favoritesEnabled: true,
    favoritesTrayItemsEnabled: true,
    favoritesLayout: "grid",
    favoriteItems
  });
  const items = buildPetMenuItems(makeOptions({ settings }));
  const grid = findItem(items, "favorites-grid");

  assert.equal(findItem(items, "favorite:item-0"), grid?.items?.[0]);
  assert.deepEqual(grid?.items?.map((item) => item.id), [
    "favorite:item-0",
    "favorite:item-1",
    "favorite:item-2",
    "favorite:item-3",
    "favorite:item-4"
  ]);
});

test("renderer 직렬화는 허용 필드만 재귀적으로 남기고 enabled 기본값을 적용한다", () => {
  const run = () => {};
  const sourceWithPrivateFields = [{
    id: "favorites-grid",
    label: "그리드",
    type: "favorite-grid",
    checked: true,
    icon: "favorite",
    iconTemplate: "folder",
    iconColor: "#123456",
    iconDataUrl: "data:image/png;base64,AA",
    target: "C:\\secret.exe",
    customIcon: "C:\\secret.png",
    run,
    secret: "renderer로 보내면 안 됨",
    items: [{
      id: "favorite:child",
      label: "자식",
      enabled: false,
      target: "C:\\child.exe",
      customIcon: "C:\\child.png",
      run
    }]
  }];
  const source = /** @type {PetMenuItem[]} */ (/** @type {unknown} */ (sourceWithPrivateFields));

  const serialized = serializeMenuItems(source, true);
  assert.deepEqual(serialized, [{
    id: "favorites-grid",
    label: "그리드",
    type: "favorite-grid",
    checked: true,
    icon: "favorite",
    iconTemplate: "folder",
    iconColor: "#123456",
    iconDataUrl: "data:image/png;base64,AA",
    hideLabel: true,
    items: [{
      id: "favorite:child",
      label: "자식",
      type: undefined,
      checked: undefined,
      icon: undefined,
      iconTemplate: undefined,
      iconColor: undefined,
      iconDataUrl: undefined,
      hideLabel: undefined,
      items: undefined,
      enabled: false
    }],
    enabled: true
  }]);
  assert.deepEqual(Object.keys(serialized[0]), [
    "id", "label", "type", "checked", "icon", "iconTemplate", "iconColor",
    "iconDataUrl", "hideLabel", "items", "enabled"
  ]);
  assert.equal(serializeMenuItems(source, false)[0].hideLabel, false);
  assert.equal(source[0].target, "C:\\secret.exe");
  assert.equal(source[0].run, run);
});

test("메뉴 높이는 일반·구분선·4열 grid의 기존 픽셀 공식을 따른다", () => {
  assert.equal(contextMenuHeight([]), 12);
  assert.equal(contextMenuHeight([{ id: "normal" }]), 40);
  assert.equal(contextMenuHeight([{ type: "separator" }]), 23);
  assert.equal(contextMenuHeight([{ type: "favorite-grid", items: [] }]), 22);
  assert.equal(contextMenuHeight([{ type: "favorite-grid", items: Array.from({ length: 4 }, () => ({})) }]), 84);
  assert.equal(contextMenuHeight([{ type: "favorite-grid", items: Array.from({ length: 5 }, () => ({})) }]), 146);
  assert.equal(contextMenuHeight([
    { id: "normal" },
    { type: "separator" },
    { type: "favorite-grid", items: Array.from({ length: 5 }, () => ({})) }
  ]), 185);
});
