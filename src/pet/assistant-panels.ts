// AI 질문·답변, 펫이 먼저 거는 대화, 즐겨찾기 말풍선의 상태와 배선.
//
// 셋을 한 모듈에 두는 이유는 서로 배타적인 하나의 상태 기계이기 때문이다 — 즐겨찾기를 열면
// 질문창이 닫히고, 질문창을 열면 즐겨찾기가 닫히며, Escape는 그때 열려 있는 쪽을 닫는다.
// 그래서 활성 플래그 다섯 개를 renderer가 아니라 여기서 들고 있고, 밖에서 필요한 것만
// getter로 내보낸다. 렌더러는 이 플래그를 쓰지 않고 읽기만 한다.
//
// 모드 카드의 표시 여부는 restActive·clickThrough까지 함께 봐야 정해지므로 여기서 직접
// 계산하지 않고 syncModeCard 콜백에 맡긴다.

type PanelElements = {
  modeCard: HTMLElement;
  assistantQuestionBubble: HTMLElement;
  assistantAnswerBubble: HTMLElement;
  assistantAnswerText: HTMLElement;
  assistantAnswerClose: HTMLElement;
  assistantQuestion: HTMLTextAreaElement;
  assistantStatus: HTMLElement;
  assistantSubmit: HTMLButtonElement;
  assistantCancel: HTMLButtonElement;
  petChatBubble: HTMLElement;
  petChatMessage: HTMLElement;
  petChatReply: HTMLTextAreaElement;
  petChatStatus: HTMLElement;
  petChatSubmit: HTMLButtonElement;
  petChatClose: HTMLButtonElement;
  petChatCallNowButton: HTMLButtonElement;
  favoritesBubble: HTMLElement;
  favoritesStatus: HTMLElement;
  favoritesList: HTMLElement;
  favoritesClose: HTMLElement;
};

type AssistantPanelDependencies = {
  elements: PanelElements;
  translate: (key: string, vars?: Record<string, unknown>) => string;
  updateVisibleBubblePositions: () => void;
  /** restActive·clickThrough까지 반영해 모드 카드를 다시 계산한다. */
  syncModeCard: () => void;
  /** Escape로 닫을 말풍선 패널(번역·문서요약·리사이즈)이 열려 있으면 닫는다. */
  closeActiveBubblePanel: () => boolean;
  prepareAnimalese: () => Promise<AudioBuffer | null | undefined>;
  playAnimaleseCharacter: (character: string, index: number, buffer: AudioBuffer | null | undefined) => void;
  isAnimaleseEnabled: () => boolean;
  isAnimalesePetChatEnabled: () => boolean;
  animaleseIntervalMs: () => number;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function createAssistantPanels(deps: AssistantPanelDependencies) {
  const el = deps.elements;
  const tt = deps.translate;

  // 질문창·펫대화·즐겨찾기 중 무엇이 열려 있는지. 애니메이션 루프와 모드 카드가 읽는다.
  let assistantActive = false;
  let favoritesActive = false;
  // 지금 열린 대화가 "펫이 먼저 건 말"인지 — 닫을 때 main에 알릴 채널이 갈린다.
  let petChatOriginActive = false;
  // 한 글자씩 드러내는 연출이 이전 답변과 겹치지 않도록 요청마다 올리는 번호.
  let answerRevealToken = 0;
  // 표정이 바뀌면(휴식 알림/AI 답변) 그 표정을 유지하는 동안 눈 깜박임은 재생하지 않는다.
  // 텍스처 자체가 아니라 표정 키("happy" 등)만 들고 있다가, 매 프레임 현재 선택된
  // 눈/입 스타일에 맞는 텍스처를 골라 적용한다(눈·입 스타일이 바뀌어도 즉시 반영됨).
  let answerExpressionKey: string | null = null;

  function afterBubbleChange(): void {
    requestAnimationFrame(deps.updateVisibleBubblePositions);
  }

  async function revealTextEffect(targetElement: HTMLElement, answer: string, useAnimalese: boolean) {
    const token = ++answerRevealToken;
    const characters = Array.from(String(answer || ""));
    targetElement.textContent = "";
    let soundBuffer: AudioBuffer | null | undefined;
    if (useAnimalese) {
      try {
        soundBuffer = await deps.prepareAnimalese();
      } catch (error) {
        console.warn("Animalese sound could not load:", error);
      }
    }

    if (!useAnimalese) {
      targetElement.textContent = characters.join("");
      afterBubbleChange();
      return;
    }

    const baseDelay = deps.animaleseIntervalMs();
    let visibleText = "";
    for (let index = 0; index < characters.length; index += 1) {
      if (token !== answerRevealToken || !assistantActive) return;
      const character = characters[index];
      visibleText += character;
      targetElement.textContent = visibleText;
      targetElement.scrollTop = targetElement.scrollHeight;
      deps.playAnimaleseCharacter(character, index, soundBuffer);
      afterBubbleChange();
      const delay = character === "\n"
        ? Math.max(110, baseDelay * 3)
        : /[.!?。！？]/u.test(character)
          ? Math.max(90, baseDelay * 2.2)
          : /[,，:;…]/u.test(character)
            ? Math.max(55, baseDelay * 1.5)
            : /\s/u.test(character)
              ? Math.max(12, baseDelay * 0.7)
              : baseDelay;
      await wait(delay);
    }
  }

  async function revealAssistantAnswer(answer: string) {
    return revealTextEffect(el.assistantAnswerText, answer, deps.isAnimaleseEnabled());
  }

  function closeAssistantUi(notifyMain = true) {
    answerRevealToken += 1;
    assistantActive = false;
    el.assistantQuestionBubble.hidden = true;
    el.assistantAnswerBubble.hidden = true;
    el.petChatBubble.hidden = true;
    el.assistantSubmit.disabled = false;
    answerExpressionKey = null;
    deps.syncModeCard();
    if (notifyMain) {
      if (petChatOriginActive) window.desktopPet.closePetChat();
      else window.desktopPet.closeAssistant();
    }
    petChatOriginActive = false;
  }

  async function submitAssistantQuestion() {
    const question = el.assistantQuestion.value.trim();
    if (!question) {
      el.assistantStatus.textContent = tt("assistant.enterQuestionPrompt");
      return;
    }
    const requestToken = ++answerRevealToken;
    el.assistantSubmit.disabled = true;
    el.assistantCancel.disabled = true;
    el.assistantStatus.textContent = tt("assistant.thinkingStatus");
    if (deps.isAnimaleseEnabled()) deps.prepareAnimalese().catch(() => {});
    const result = await window.desktopPet.askAssistant(question);
    if (requestToken !== answerRevealToken || !assistantActive) return;
    el.assistantSubmit.disabled = false;
    el.assistantCancel.disabled = false;
    if (!result?.ok) {
      el.assistantStatus.textContent = result?.error || tt("assistant.noAnswerError");
      afterBubbleChange();
      return;
    }
    el.assistantQuestionBubble.hidden = true;
    el.assistantAnswerBubble.hidden = false;
    answerExpressionKey = result.expression || null;
    afterBubbleChange();
    await revealAssistantAnswer(result.answer);
  }

  // "부르기" 버튼 — 랜덤 주기를 기다리지 않고 "펫이 먼저 말 걸기"를 바로 실행한다.
  // 성공하면 main이 곧바로 "pet-chat:open"을 보내서 기존 onPetChatOpen 핸들러가
  // 알아서 이 질문창을 펫이 먼저 건 말풍선으로 바꿔준다 — 여기서는 로딩 상태 표시와
  // 실패 시 에러 문구만 처리하면 된다.
  async function callPetChatNow() {
    el.assistantSubmit.disabled = true;
    el.petChatCallNowButton.disabled = true;
    el.assistantCancel.disabled = true;
    el.assistantStatus.textContent = tt("petChat.callingNowStatus");
    const result = await window.desktopPet.callPetChatNow();
    if (!assistantActive) return;
    el.assistantSubmit.disabled = false;
    el.petChatCallNowButton.disabled = false;
    el.assistantCancel.disabled = false;
    if (!result?.ok) {
      el.assistantStatus.textContent = result?.error || tt("assistant.noAnswerError");
      afterBubbleChange();
    }
  }

  async function submitPetChatReply() {
    const reply = el.petChatReply.value.trim();
    if (!reply) {
      closeAssistantUi();
      return;
    }
    const requestToken = ++answerRevealToken;
    el.petChatSubmit.disabled = true;
    el.petChatClose.disabled = true;
    el.petChatStatus.textContent = tt("assistant.thinkingStatus");
    if (deps.isAnimaleseEnabled()) deps.prepareAnimalese().catch(() => {});
    const result = await window.desktopPet.petChatReply(reply);
    if (requestToken !== answerRevealToken || !assistantActive) return;
    el.petChatSubmit.disabled = false;
    el.petChatClose.disabled = false;
    if (!result?.ok) {
      el.petChatStatus.textContent = result?.error || tt("assistant.noAnswerError");
      afterBubbleChange();
      return;
    }
    el.petChatBubble.hidden = true;
    el.assistantAnswerBubble.hidden = false;
    answerExpressionKey = result.expression || null;
    afterBubbleChange();
    await revealAssistantAnswer(result.answer);
  }

  function closeFavoritesUi(notifyMain = true) {
    favoritesActive = false;
    el.favoritesBubble.hidden = true;
    deps.syncModeCard();
    if (notifyMain) window.desktopPet.closeFavorites();
  }

  function favoriteButton(
    label: string,
    selection: PetFavoriteSelection,
    iconDataUrl: string | null | undefined,
    iconTemplate: string | null | undefined,
    iconColor: string | null | undefined,
    labelsHidden: boolean = false
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "favorite-launch-button";
    button.title = label;
    if (iconTemplate) {
      const iconWrap = document.createElement("span");
      iconWrap.className = "favorite-launch-icon favorite-launch-icon-template";
      iconWrap.innerHTML = window.FavoriteIcons.svgMarkup(iconTemplate, iconColor);
      button.append(iconWrap);
    } else if (iconDataUrl) {
      const icon = document.createElement("img");
      icon.className = "favorite-launch-icon";
      icon.src = iconDataUrl;
      icon.alt = "";
      button.append(icon);
    }
    if (!labelsHidden) button.append(document.createTextNode(label));
    button.addEventListener("click", async () => {
      el.favoritesStatus.textContent = tt("favorites.openingLabel", { label });
      const result = await window.desktopPet.activateFavorite(selection);
      if (!result?.ok) {
        el.favoritesStatus.textContent = result?.error || tt("favorites.runFailedError");
        afterBubbleChange();
      }
    });
    return button;
  }

  window.desktopPet.onFavoritesOpen((payload) => {
    favoritesActive = true;
    assistantActive = false;
    petChatOriginActive = false;
    el.assistantQuestionBubble.hidden = true;
    el.assistantAnswerBubble.hidden = true;
    el.petChatBubble.hidden = true;
    el.modeCard.hidden = true;
    el.favoritesStatus.textContent = tt("favorites.selectPrompt");
    el.favoritesList.classList.toggle("favorites-list-grid", payload?.layout === "grid");
    el.favoritesList.classList.toggle("favorites-list-labels-hidden", payload?.layout === "grid" && payload?.hideLabels === true);
    el.favoritesList.replaceChildren();
    for (const item of payload?.items || []) {
      el.favoritesList.append(favoriteButton(item.name, { type: "item", id: item.id }, item.icon, item.iconTemplate, item.iconColor, payload?.layout === "grid" && payload?.hideLabels === true));
    }
    el.favoritesBubble.hidden = false;
    afterBubbleChange();
  });
  window.desktopPet.onFavoritesClose(() => closeFavoritesUi(false));
  el.favoritesClose.addEventListener("click", () => closeFavoritesUi());

  el.assistantSubmit.addEventListener("click", submitAssistantQuestion);
  el.petChatCallNowButton.addEventListener("click", callPetChatNow);
  el.assistantCancel.addEventListener("click", () => closeAssistantUi());
  el.assistantAnswerClose.addEventListener("click", () => closeAssistantUi());
  el.assistantQuestion.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      submitAssistantQuestion();
    }
  });
  el.petChatSubmit.addEventListener("click", submitPetChatReply);
  el.petChatClose.addEventListener("click", () => closeAssistantUi());
  el.petChatReply.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      submitPetChatReply();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (assistantActive) closeAssistantUi();
    else if (favoritesActive) closeFavoritesUi();
    else deps.closeActiveBubblePanel();
  });

  window.desktopPet.onAssistantQuestionOpen(() => {
    answerRevealToken += 1;
    assistantActive = true;
    petChatOriginActive = false;
    el.assistantAnswerBubble.hidden = true;
    el.petChatBubble.hidden = true;
    el.assistantQuestionBubble.hidden = false;
    el.assistantQuestion.value = "";
    answerExpressionKey = null;
    el.assistantStatus.textContent = tt("assistant.ctrlEnterHint");
    el.modeCard.hidden = true;
    el.favoritesBubble.hidden = true;
    favoritesActive = false;
    requestAnimationFrame(() => {
      deps.updateVisibleBubblePositions();
      el.assistantQuestion.focus();
    });
  });
  window.desktopPet.onAssistantClose(() => closeAssistantUi(false));
  window.desktopPet.onPetChatOpen((payload) => {
    assistantActive = true;
    petChatOriginActive = true;
    el.assistantQuestionBubble.hidden = true;
    el.assistantAnswerBubble.hidden = true;
    el.petChatReply.value = "";
    el.petChatStatus.textContent = tt("petChat.replyOrCloseHint");
    answerExpressionKey = payload?.expression || null;
    el.petChatBubble.hidden = false;
    el.modeCard.hidden = true;
    el.favoritesBubble.hidden = true;
    favoritesActive = false;
    if (deps.isAnimaleseEnabled() && deps.isAnimalesePetChatEnabled()) {
      revealTextEffect(el.petChatMessage, payload?.message, true);
    } else {
      answerRevealToken += 1;
      el.petChatMessage.textContent = payload?.message || "";
    }
    requestAnimationFrame(() => {
      deps.updateVisibleBubblePositions();
      el.petChatReply.focus();
    });
  });

  return {
    isAssistantActive: () => assistantActive,
    isFavoritesActive: () => favoritesActive,
    /** 답변 말풍선이 떠 있는 동안 애니메이션 루프가 고르는 표정 키. */
    answerExpressionKey: () => answerExpressionKey
  };
}

export { createAssistantPanels };
export type { AssistantPanelDependencies, PanelElements };
