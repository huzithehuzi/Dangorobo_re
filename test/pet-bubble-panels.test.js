// @ts-check
// 펫 말풍선을 빌려 쓰는 다섯 패널의 배타 규칙. 하나를 열면 나머지 넷이 닫혀야 하는데,
// 예전에는 그 규칙이 다섯 함수에 흩어져 있어 한 군데를 빠뜨리기 쉬웠다.
const test = require("node:test");
const assert = require("node:assert/strict");

const { createPetBubblePanels } = require("../src/main/windows/pet-bubble-panels.js");

/** @typedef {"assistant"|"favorites"|"imageResize"|"translate"|"documentSummary"} PanelName */
/** @type {PanelName[]} */
const PANELS = ["assistant", "favorites", "imageResize", "translate", "documentSummary"];

/**
 * @param {{
 *   settings?: Record<string, unknown>, hasKey?: boolean, restActive?: boolean,
 *   clipboard?: string, launchItems?: unknown[]
 * }} [overrides]
 */
function createHarness(overrides = {}) {
  /** @type {{channel: string, payload: unknown}[]} */
  const sent = [];
  const calls = { sent, shows: 0, applied: 0, hoverResets: 0, chatEnded: 0 };
  const panels = createPetBubblePanels({
    sendToPet: (channel, payload) => sent.push({ channel, payload }),
    showPetWindow: () => { calls.shows += 1; },
    getSettings: () => ({
      assistantEnabled: true,
      favoritesEnabled: true,
      favoritesLayout: "list",
      favoriteGridLabelsHidden: false,
      translatePreferClipboard: true,
      translateTargetLanguage: "en",
      ...overrides.settings
    }),
    hasAssistantKey: () => overrides.hasKey !== false,
    isRestActive: () => overrides.restActive === true,
    applyMouseInteractionState: () => { calls.applied += 1; },
    resetPetHover: () => { calls.hoverResets += 1; },
    endPetChatSession: () => { calls.chatEnded += 1; },
    buildFavoriteLaunchItems: async () => overrides.launchItems ?? [{ id: "a" }],
    readClipboardText: () => overrides.clipboard ?? ""
  });
  return { panels, calls };
}

/**
 * 지금 열려 있는 패널 이름들.
 * @param {ReturnType<typeof createPetBubblePanels>} panels
 */
function openPanels(panels) {
  const map = {
    assistant: panels.isAssistantActive(),
    favorites: panels.isFavoritesActive(),
    imageResize: panels.isImageResizeActive(),
    translate: panels.isTranslateActive(),
    documentSummary: panels.isDocumentSummaryActive()
  };
  return PANELS.filter((name) => map[name]);
}

/**
 * 마지막으로 렌더러에 보낸 payload.
 * @param {{sent: {channel: string, payload: unknown}[]}} calls
 * @returns {any}
 */
function lastPayload(calls) {
  const last = calls.sent.at(-1);
  assert.ok(last, "펫에 보낸 메시지가 있어야 한다");
  return last.payload;
}

/**
 * 패널 하나를 여는 호출. 즐겨찾기만 비동기다.
 * @param {ReturnType<typeof createPetBubblePanels>} panels
 * @param {PanelName} name
 */
async function open(panels, name) {
  if (name === "assistant") return panels.openAssistantQuestion();
  if (name === "favorites") return panels.openFavorites();
  if (name === "imageResize") return panels.openImageResize();
  if (name === "translate") return panels.openTranslate();
  return panels.openDocumentSummary();
}

test("어느 패널을 열어도 나머지 넷은 닫힌다", async () => {
  for (const first of PANELS) {
    for (const second of PANELS) {
      if (first === second) continue;
      const { panels } = createHarness();
      await open(panels, first);
      assert.deepEqual(openPanels(panels), [first], `${first} 먼저`);
      await open(panels, second);
      assert.deepEqual(openPanels(panels), [second], `${first} → ${second}`);
    }
  }
});

test("이미 열린 패널을 다시 열어도 아무 일도 하지 않는다", async () => {
  for (const name of PANELS) {
    const { panels, calls } = createHarness();
    await open(panels, name);
    const sentAfterFirst = calls.sent.length;
    await open(panels, name);
    assert.equal(calls.sent.length, sentAfterFirst, name);
  }
});

test("휴식 알림 중에는 어떤 패널도 열지 않는다", async () => {
  for (const name of PANELS) {
    const { panels } = createHarness({ restActive: true });
    await open(panels, name);
    assert.deepEqual(openPanels(panels), [], name);
  }
});

test("AI가 필요한 세 패널은 키가 없으면 열리지 않는다", async () => {
  /** @type {PanelName[]} */
  const aiPanels = ["assistant", "translate", "documentSummary"];
  for (const name of aiPanels) {
    const noKey = createHarness({ hasKey: false });
    await open(noKey.panels, name);
    assert.deepEqual(openPanels(noKey.panels), [], `${name} 키 없음`);

    const disabled = createHarness({ settings: { assistantEnabled: false } });
    await open(disabled.panels, name);
    assert.deepEqual(openPanels(disabled.panels), [], `${name} 기능 꺼짐`);
  }
});

test("이미지 리사이즈는 AI 설정과 무관하게 열린다", async () => {
  const { panels } = createHarness({ hasKey: false, settings: { assistantEnabled: false } });
  await open(panels, "imageResize");
  assert.deepEqual(openPanels(panels), ["imageResize"]);
});

test("즐겨찾기 기능이 꺼져 있으면 말풍선을 열지 않는다", async () => {
  const { panels } = createHarness({ settings: { favoritesEnabled: false } });
  await panels.openFavorites();
  assert.deepEqual(openPanels(panels), []);
});

test("패널을 닫으면 렌더러에 알리고 마우스 상태를 다시 계산한다", async () => {
  const { panels, calls } = createHarness();
  await open(panels, "translate");
  const before = calls.applied;
  panels.closeTranslate();
  assert.deepEqual(openPanels(panels), []);
  assert.equal(calls.sent.at(-1)?.channel, "pet:close-translate");
  assert.equal(calls.applied, before + 1);
});

test("닫혀 있는 패널을 닫아도 아무 일도 하지 않는다", () => {
  const { panels, calls } = createHarness();
  panels.closeTranslate();
  assert.deepEqual(calls.sent, []);
  assert.equal(calls.applied, 0);
});

test("AI 질문 말풍선을 닫으면 대화 세션도 끝낸다", async () => {
  const { panels, calls } = createHarness();
  await open(panels, "assistant");
  panels.closeAssistant();
  assert.equal(calls.chatEnded, 1);
  // 다른 패널을 닫을 때는 세션을 건드리지 않는다.
  await open(panels, "translate");
  panels.closeTranslate();
  assert.equal(calls.chatEnded, 1);
});

test("번역은 설정에 따라 클립보드를 미리 채운다", async () => {
  const on = createHarness({ clipboard: "  안녕하세요  " });
  await on.panels.openTranslate();
  assert.deepEqual(on.calls.sent.at(-1), {
    channel: "pet:open-translate",
    payload: { initialText: "안녕하세요", target: "en" }
  });

  const off = createHarness({ clipboard: "안녕", settings: { translatePreferClipboard: false } });
  await off.panels.openTranslate();
  assert.equal(lastPayload(off.calls).initialText, "");
});

test("클립보드가 아주 길면 잘라서 보낸다", async () => {
  const long = "가".repeat(9000);
  const translate = createHarness({ clipboard: long });
  await translate.panels.openTranslate();
  assert.equal(lastPayload(translate.calls).initialText.length, 5000);

  const summary = createHarness({ clipboard: long });
  await summary.panels.openDocumentSummary();
  assert.equal(lastPayload(summary.calls).initialText.length, 1500);
});

test("즐겨찾기 목록을 만드는 동안 닫히면 목록을 보내지 않는다", async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = () => resolve(undefined); });
  const { panels, calls } = createHarness();
  const opening = (async () => {
    // 목록 생성이 늦어지는 동안 사용자가 닫는 상황을 만든다.
    const original = panels.openFavorites();
    panels.closeFavorites();
    release();
    await original;
  })();
  await gate;
  await opening;
  assert.deepEqual(calls.sent.map((message) => message.channel), ["favorites:close"]);
});

test("패널을 열면 펫 창을 앞으로 꺼내고 호버 상태를 푼다", async () => {
  const { panels, calls } = createHarness();
  await open(panels, "documentSummary");
  assert.equal(calls.shows, 1);
  assert.equal(calls.hoverResets, 1);
});

test("활성 상태만 바꾸는 진입점은 창을 켤 때만 앞으로 꺼낸다", () => {
  const { panels, calls } = createHarness();
  panels.setAssistantActive(true);
  assert.equal(calls.shows, 1);
  panels.setAssistantActive(false);
  assert.equal(calls.shows, 1);
  // 끄는 경우에도 마우스 통과 상태는 다시 계산해야 한다.
  assert.equal(calls.applied, 2);
});

test("anyActive는 다섯 중 하나라도 떠 있으면 참이다", async () => {
  const { panels } = createHarness();
  assert.equal(panels.anyActive(), false);
  for (const name of PANELS) {
    await open(panels, name);
    assert.equal(panels.anyActive(), true, name);
  }
  panels.closeAssistant();
  panels.closeFavorites();
  panels.closeImageResize();
  panels.closeTranslate();
  panels.closeDocumentSummary();
  assert.equal(panels.anyActive(), false);
});
