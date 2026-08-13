// 펫 말풍선을 빌려 쓰는 다섯 패널의 열림 상태 — AI 질문, 즐겨찾기 목록, 이미지 리사이즈,
// 클립보드 번역, 문서 요약.
//
// 다섯은 서로 배타적이다. 하나를 열면 나머지 넷을 닫는다. 그 규칙이 다섯 함수에 흩어져
// 있으면 새 패널을 추가할 때 한 군데를 빠뜨리기 쉬워서, 열림 플래그를 이 모듈이 소유하고
// closeOthers() 한 곳에서 처리한다. main.js는 getter로 읽기만 한다.
//
// 펫 창을 앞으로 꺼내는 일(ensurePetVisible/show/focus)과 마우스 통과 상태 재계산은
// main.js가 소유한 창·플래그를 건드리므로 콜백으로 받는다.

type PanelKind = "assistant" | "favorites" | "imageResize" | "translate" | "documentSummary";

type FavoriteLaunchPayload = {
  items: unknown[];
  layout: unknown;
  hideLabels: boolean;
};

type PetBubblePanelDependencies = {
  sendToPet: (channel: string, payload?: unknown) => void;
  showPetWindow: () => void;
  getSettings: () => {
    assistantEnabled?: boolean;
    favoritesEnabled?: boolean;
    favoritesLayout?: unknown;
    favoriteGridLabelsHidden?: boolean;
    translatePreferClipboard?: boolean;
    translateTargetLanguage?: unknown;
  };
  hasAssistantKey: () => boolean;
  isRestActive: () => boolean;
  /** 마우스 통과·포커스 상태를 다시 계산한다. 열림 플래그가 바뀔 때마다 부른다. */
  applyMouseInteractionState: () => void;
  /** 패널이 열리면 호버로 잡아둔 상태를 푼다 — 창이 이미 상시 마우스를 받게 되므로. */
  resetPetHover: () => void;
  /** AI 질문 말풍선을 닫을 때 대화 세션도 끝낸다. */
  endPetChatSession: () => void;
  buildFavoriteLaunchItems: () => Promise<unknown[]>;
  readClipboardText: () => string;
};

const DOCUMENT_SUMMARY_CLIPBOARD_LIMIT = 1500;
const TRANSLATE_CLIPBOARD_LIMIT = 5000;

function createPetBubblePanels(deps: PetBubblePanelDependencies) {
  const active: Record<PanelKind, boolean> = {
    assistant: false,
    favorites: false,
    imageResize: false,
    translate: false,
    documentSummary: false
  };

  /** 닫을 때 렌더러에 보내는 채널. 즐겨찾기·AI는 여는 쪽과 채널 이름 규칙이 다르다. */
  const closeChannel: Record<PanelKind, string> = {
    assistant: "assistant:close",
    favorites: "favorites:close",
    imageResize: "pet:close-image-resize",
    translate: "pet:close-translate",
    documentSummary: "pet:close-document-summary"
  };

  function close(kind: PanelKind): void {
    if (!active[kind]) return;
    active[kind] = false;
    deps.sendToPet(closeChannel[kind]);
    deps.applyMouseInteractionState();
    if (kind === "assistant") deps.endPetChatSession();
  }

  function closeOthers(kind: PanelKind): void {
    for (const other of Object.keys(active) as PanelKind[]) {
      if (other !== kind) close(other);
    }
  }

  /** 패널을 여는 공통 준비 — 플래그를 세우고 창을 앞으로 꺼낸다. */
  function beginPanel(kind: PanelKind): void {
    active[kind] = true;
    deps.resetPetHover();
    deps.applyMouseInteractionState();
    deps.showPetWindow();
  }

  // AI 질문·즐겨찾기는 IPC 쪽에서도 "활성 상태만" 바꿔야 하는 자리가 있어 따로 노출한다.
  function setAssistantActive(enabled: boolean): void {
    active.assistant = enabled;
    deps.resetPetHover();
    deps.applyMouseInteractionState();
    if (enabled) deps.showPetWindow();
  }

  function setFavoritesActive(enabled: boolean): void {
    active.favorites = enabled;
    deps.resetPetHover();
    deps.applyMouseInteractionState();
    if (enabled) deps.showPetWindow();
  }

  function assistantReady(): boolean {
    return deps.getSettings().assistantEnabled === true && deps.hasAssistantKey();
  }

  function openAssistantQuestion(): void {
    if (active.assistant || !assistantReady() || deps.isRestActive()) return;
    closeOthers("assistant");
    setAssistantActive(true);
    deps.sendToPet("assistant:question-open");
  }

  function openDocumentSummary(): void {
    if (active.documentSummary || deps.isRestActive() || !assistantReady()) return;
    closeOthers("documentSummary");
    beginPanel("documentSummary");
    deps.sendToPet("pet:open-document-summary", {
      initialText: deps.readClipboardText().trim().slice(0, DOCUMENT_SUMMARY_CLIPBOARD_LIMIT)
    });
  }

  function openTranslate(): void {
    if (active.translate || deps.isRestActive() || !assistantReady()) return;
    closeOthers("translate");
    // 번역할 텍스트는 입력칸에 직접 편집 가능하게 넣어준다(2026-08-02, 사용자 요청).
    // "클립보드 내용 자동 입력" 설정이 켜져 있으면 클립보드 내용을 미리 채워주고,
    // 꺼져 있으면 빈 칸으로 열어서 사용자가 번역할 내용을 직접 입력하게 한다.
    const settings = deps.getSettings();
    const initialText = settings.translatePreferClipboard
      ? deps.readClipboardText().trim().slice(0, TRANSLATE_CLIPBOARD_LIMIT)
      : "";
    beginPanel("translate");
    deps.sendToPet("pet:open-translate", {
      initialText,
      target: settings.translateTargetLanguage
    });
  }

  function openImageResize(): void {
    if (active.imageResize || deps.isRestActive()) return;
    closeOthers("imageResize");
    beginPanel("imageResize");
    deps.sendToPet("pet:open-image-resize");
  }

  async function openFavorites(): Promise<void> {
    if (active.favorites || deps.getSettings().favoritesEnabled !== true || deps.isRestActive()) return;
    closeOthers("favorites");
    setFavoritesActive(true);
    const items = await deps.buildFavoriteLaunchItems();
    // 목록을 만드는 동안(아이콘 추출은 PowerShell을 거칠 수 있다) 사용자가 닫았을 수 있다.
    if (!active.favorites) return;
    const settings = deps.getSettings();
    const payload: FavoriteLaunchPayload = {
      items,
      layout: settings.favoritesLayout,
      hideLabels: settings.favoriteGridLabelsHidden === true
    };
    deps.sendToPet("favorites:open", payload);
  }

  return {
    isAssistantActive: () => active.assistant,
    isFavoritesActive: () => active.favorites,
    isImageResizeActive: () => active.imageResize,
    isTranslateActive: () => active.translate,
    isDocumentSummaryActive: () => active.documentSummary,
    /** 다섯 중 하나라도 떠 있는지. 마우스 통과 계산이 이 조합을 쓴다. */
    anyActive: () => Object.values(active).some(Boolean),
    setAssistantActive,
    setFavoritesActive,
    closeAssistant: () => close("assistant"),
    closeFavorites: () => close("favorites"),
    closeImageResize: () => close("imageResize"),
    closeTranslate: () => close("translate"),
    closeDocumentSummary: () => close("documentSummary"),
    openAssistantQuestion,
    openDocumentSummary,
    openTranslate,
    openImageResize,
    openFavorites
  };
}

export { createPetBubblePanels };
export type { PetBubblePanelDependencies, PanelKind };
