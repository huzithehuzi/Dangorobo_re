// @ts-check
// 즐겨찾기 IPC 회귀 테스트.
// 항목 실행은 펫 말풍선·독립 창·플로팅 독 세 곳에서 들어오고 실행 뒤 처리가 서로 다르다.
// main.ts에서 분리하면서 그 분기와 보낸 창 검사가 흐려지기 쉬웠던 부분을 고정한다.
// Electron 없이 순수 Node로 실행된다: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

// settings-schema.js는 지원하지 않는 언어가 들어오면 app.getLocale()로 폴백한다.
const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getLocale: () => "ko-KR" } }
});

const { registerFavoritesIpcHandlers } = require("../src/main/windows/favorites-ipc.js");
const { DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");

const CHANNELS = [
  "favorites:pick-icon",
  "favorites:pick-target",
  "favorites:activate",
  "favorites:list",
  "favorites:close",
  "favoritesWindow:close",
  "favoritesDock:set-expanded",
  "favoritesDock:hide",
  "favoritesDock:drag-start",
  "favoritesDock:drag-move",
  "favoritesDock:drag-end"
];
const DOCK_ONLY_CHANNELS = [
  "favoritesDock:set-expanded",
  "favoritesDock:hide",
  "favoritesDock:drag-start",
  "favoritesDock:drag-move",
  "favoritesDock:drag-end"
];

function createHarness(overrides = {}) {
  /** @type {Map<string, (...args: any[]) => any>} */
  const listeners = new Map();
  const ipcMain = {
    handle(/** @type {string} */ channel, /** @type {any} */ handler) { listeners.set(channel, handler); },
    on(/** @type {string} */ channel, /** @type {any} */ listener) { listeners.set(channel, listener); }
  };
  const settingsSender = { window: "settings" };
  const favoritesWindowSender = { window: "favoritesWindow" };
  const dockSender = { window: "dock" };
  const petSender = { window: "pet" };

  /** @type {string[]} */
  const calls = [];
  /** @type {Array<[number, number]>} */
  const dockMoves = [];
  const settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), {
    language: "ko",
    favoritesEnabled: true,
    favoritesLayout: "grid",
    favoriteGridLabelsHidden: true
  });

  const deps = {
    getSettings: () => settings,
    translate: (/** @type {string} */ _lang, /** @type {string} */ key) => `t:${key}`,
    isSettingsSender: (/** @type {unknown} */ s) => s === settingsSender,
    isFavoritesPanelSender: (/** @type {unknown} */ s) => s === favoritesWindowSender || s === dockSender,
    isFavoritesWindowSender: (/** @type {unknown} */ s) => s === favoritesWindowSender,
    isFavoritesDockSender: (/** @type {unknown} */ s) => s === dockSender,
    isFavoritesPanelActive: () => false,
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    customIconDataUrl: async () => "data:image/png;base64,AA",
    buildLaunchItems: async () => [{ id: "a", name: "메모장", icon: null, iconTemplate: null, iconColor: null }],
    activateFavoriteItem: async (/** @type {string} */ id) => {
      calls.push(`activate:${id}`);
      return { ok: true };
    },
    setDockExpanded: (/** @type {boolean} */ e) => { calls.push(`dockExpanded:${e}`); },
    closeFavoritesPanel: () => { calls.push("closePanel"); },
    closeFavoritesWindow: () => { calls.push("closeWindow"); },
    closeFavoritesDockWindow: () => { calls.push("closeDock"); },
    beginDockDrag: () => { calls.push("dragStart"); },
    moveDockBy: (/** @type {number} */ dx, /** @type {number} */ dy) => { dockMoves.push([dx, dy]); },
    endDockDrag: () => { calls.push("dragEnd"); },
    ...overrides
  };
  registerFavoritesIpcHandlers(/** @type {any} */ (ipcMain), deps);
  return {
    settings, calls, dockMoves,
    settingsSender, favoritesWindowSender, dockSender, petSender,
    send: (/** @type {string} */ channel, /** @type {unknown} */ sender, /** @type {unknown} */ payload) => {
      const listener = listeners.get(channel);
      assert.ok(listener, `등록되지 않은 채널: ${channel}`);
      return listener({ sender }, payload);
    },
    channels: () => [...listeners.keys()]
  };
}

test("등록하는 채널 목록이 분리 전 main.ts와 같다", () => {
  assert.deepEqual(createHarness().channels().sort(), [...CHANNELS].sort());
});

test("파일 선택 대화상자는 설정창에서만 열 수 있다", async () => {
  for (const channel of ["favorites:pick-icon", "favorites:pick-target"]) {
    const harness = createHarness({
      showOpenDialog: async () => {
        throw new Error("거부됐어야 하는데 대화상자가 열렸다");
      }
    });
    const result = await harness.send(channel, harness.dockSender, undefined);
    assert.deepEqual(result, { ok: false, error: "t:favorites.settingsOnlyError" }, channel);
  }
});

test("아이콘을 못 읽으면 실패로 돌려준다", async () => {
  const harness = createHarness({
    showOpenDialog: async () => ({ canceled: false, filePaths: ["icon.png"] }),
    customIconDataUrl: async () => null
  });
  const result = await harness.send("favorites:pick-icon", harness.settingsSender, undefined);
  assert.deepEqual(result, { ok: false, error: "t:favorites.unsupportedIconError" });
});

test("대상 선택은 확장자를 뺀 파일 이름을 기본 이름으로 쓴다", async () => {
  const harness = createHarness({
    showOpenDialog: async () => ({ canceled: false, filePaths: ["C:\\Program Files\\메모장.exe"] })
  });
  const result = await harness.send("favorites:pick-target", harness.settingsSender, undefined);
  assert.equal(result.ok, true);
  assert.equal(result.name, "메모장");
  assert.match(result.id, /^favorite-\d+$/);
});

test("말풍선이 닫혀 있고 패널도 아니면 실행을 거부한다", async () => {
  const harness = createHarness();
  const result = await harness.send("favorites:activate", harness.petSender, { type: "item", id: "a" });
  assert.deepEqual(result, { ok: false, error: "t:favorites.closedError" });
  assert.deepEqual(harness.calls, []);
});

test("즐겨찾기 기능이 꺼져 있으면 패널에서도 실행을 거부한다", async () => {
  const harness = createHarness();
  harness.settings.favoritesEnabled = false;
  const result = await harness.send("favorites:activate", harness.dockSender, { type: "item", id: "a" });
  assert.deepEqual(result, { ok: false, error: "t:favorites.closedError" });
  assert.deepEqual(harness.calls, []);
});

test("item이 아닌 선택은 실행하지 않는다", async () => {
  const harness = createHarness({ isFavoritesPanelActive: () => true });
  const result = await harness.send("favorites:activate", harness.petSender, { type: "folder", id: "a" });
  assert.deepEqual(result, { ok: false, error: "t:favorites.unknownError" });
  assert.deepEqual(harness.calls, []);
});

test("독에서 실행하면 파이 메뉴를 접고, 독립 창에서는 아무것도 닫지 않는다", async () => {
  const dock = createHarness();
  await dock.send("favorites:activate", dock.dockSender, { type: "item", id: "a" });
  assert.deepEqual(dock.calls, ["activate:a", "dockExpanded:false"]);

  const window = createHarness();
  await window.send("favorites:activate", window.favoritesWindowSender, { type: "item", id: "a" });
  assert.deepEqual(window.calls, ["activate:a"], "독립 창은 연달아 실행할 수 있어야 한다");
});

test("말풍선에서 실행하면 말풍선을 닫는다", async () => {
  const harness = createHarness({ isFavoritesPanelActive: () => true });
  await harness.send("favorites:activate", harness.petSender, { type: "item", id: "a" });
  assert.deepEqual(harness.calls, ["activate:a", "closePanel"]);
});

test("실행에 실패하면 어떤 창도 닫지 않는다", async () => {
  const harness = createHarness({
    activateFavoriteItem: async () => ({ ok: false, error: "t:favorites.launchError" })
  });
  const result = await harness.send("favorites:activate", harness.dockSender, { type: "item", id: "a" });
  assert.equal(result.ok, false);
  assert.deepEqual(harness.calls, []);
});

test("목록 요청은 패널이 아니면 빈 목록을 준다", async () => {
  const harness = createHarness();
  assert.deepEqual(
    await harness.send("favorites:list", harness.settingsSender, undefined),
    { items: [], layout: "list", hideLabels: false }
  );
});

test("패널의 목록 요청은 현재 배치 설정을 함께 준다", async () => {
  const harness = createHarness();
  const result = await harness.send("favorites:list", harness.dockSender, undefined);
  assert.equal(result.layout, "grid");
  assert.equal(result.hideLabels, true);
  assert.equal(result.items.length, 1);
});

test("독 전용 채널은 다른 창이 보내면 무시한다", () => {
  for (const channel of DOCK_ONLY_CHANNELS) {
    const harness = createHarness();
    harness.send(channel, harness.favoritesWindowSender, { dx: 5, dy: 5 });
    assert.deepEqual(harness.calls, [], `${channel}이 독립 창 요청에 반응했다`);
    assert.deepEqual(harness.dockMoves, [], `${channel}이 독립 창 요청에 반응했다`);
  }
});

test("독립 창 닫기는 독이 보내면 무시한다", () => {
  const harness = createHarness();
  harness.send("favoritesWindow:close", harness.dockSender, undefined);
  assert.deepEqual(harness.calls, []);
  harness.send("favoritesWindow:close", harness.favoritesWindowSender, undefined);
  assert.deepEqual(harness.calls, ["closeWindow"]);
});

test("펼침 토글은 true만 펼침으로 본다", () => {
  const harness = createHarness();
  harness.send("favoritesDock:set-expanded", harness.dockSender, "true");
  harness.send("favoritesDock:set-expanded", harness.dockSender, true);
  assert.deepEqual(harness.calls, ["dockExpanded:false", "dockExpanded:true"]);
});

test("드래그 델타가 유한한 수가 아니면 창을 옮기지 않는다", () => {
  const harness = createHarness();
  for (const delta of [undefined, {}, { dx: 1 }, { dx: "a", dy: 2 }, { dx: NaN, dy: 0 }, { dx: Infinity, dy: 0 }]) {
    harness.send("favoritesDock:drag-move", harness.dockSender, delta);
  }
  assert.deepEqual(harness.dockMoves, [], "잘못된 델타가 통과하면 독이 화면 밖으로 튄다");
  harness.send("favoritesDock:drag-move", harness.dockSender, { dx: -12.5, dy: 30 });
  assert.deepEqual(harness.dockMoves, [[-12.5, 30]]);
});

test("말풍선 닫기는 보낸 창을 가리지 않는다", () => {
  const harness = createHarness();
  harness.send("favorites:close", harness.petSender, undefined);
  assert.deepEqual(harness.calls, ["closePanel"]);
});
