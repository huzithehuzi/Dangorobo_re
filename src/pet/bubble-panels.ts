// 답변 말풍선을 잠깐 빌려 쓰는 세 패널 — 클립보드 번역, 문서 요약, 이미지 리사이즈.
// 셋 다 같은 수명주기를 탄다: 열면 활성 플래그를 세우고 말풍선 안에 폼을 그린 뒤,
// 닫을 때 원래 답변 말풍선 구조(텍스트 + 닫기 버튼)를 되돌려 놓는다. 되돌리지 않으면
// 다음 AI 답변이 폼 잔해 위에 그려진다.
//
// 활성 플래그는 이 모듈 밖에서 Escape 처리만 보므로 여기서 들고 있는다.

type PanelElements = {
  bubble: HTMLElement;
  answerText: HTMLElement;
  answerClose: HTMLElement;
};

type TranslateLanguageOption = { value: string; label: string };

type BubblePanelDependencies = {
  elements: PanelElements;
  updateBubblePosition: (bubble: HTMLElement) => void;
  translate: (key: string, vars?: Record<string, unknown>) => string;
  escapeHtml: (value: unknown) => string;
  translateLanguageOptions: () => TranslateLanguageOption[];
  getImageResizeDefaults: () => { scale: number; filter: string };
};

type PanelHost = {
  isActive: () => boolean;
  activate: () => void;
  /** 창을 닫으라고 main에 알리지 않고 UI만 접는다(main이 닫으라고 보낸 경우). */
  hide: () => void;
  /** 사용자가 닫은 경우 — UI를 접고 main에도 알린다. */
  close: () => void;
  render: (html: string) => void;
  showStatus: (text: string, color: string) => void;
  query: <TElement extends HTMLElement>(selector: string) => TElement;
};

const STATUS_COLOR_ERROR = "#ff6b6b";
const STATUS_COLOR_SUCCESS = "#90ee90";
const STATUS_COLOR_MUTED = "var(--bubble-subtext)";
const AUTO_CLOSE_DELAY_MS = 2500;

function createBubblePanels(deps: BubblePanelDependencies) {
  const { bubble, answerText, answerClose } = deps.elements;
  const tt = deps.translate;

  function restoreAnswerBubble(): void {
    bubble.replaceChildren(answerText, answerClose);
  }

  /**
   * 패널 하나의 수명주기. resultClasses는 결과 화면에서 추가로 붙였다가 닫을 때 같이
   * 걷어내야 하는 클래스다 — 안 걷으면 다음에 열 때 결과 스타일이 폼에 남는다.
   */
  function createHost(notifyClose: () => void, resultClasses: string[]): PanelHost {
    let active = false;
    const host: PanelHost = {
      isActive: () => active,
      activate: () => {
        active = true;
        bubble.classList.add("image-resize-panel");
      },
      hide: () => {
        if (!active) return;
        active = false;
        bubble.hidden = true;
        bubble.classList.remove("image-resize-panel", ...resultClasses);
        restoreAnswerBubble();
      },
      close: () => {
        if (!active) return;
        host.hide();
        notifyClose();
      },
      render: (html: string) => {
        bubble.innerHTML = html;
      },
      showStatus: (text: string, color: string) => {
        bubble.classList.remove("image-resize-panel");
        // 문구에 번역·리사이즈 실패 사유가 그대로 들어와 HTML로 해석되면 안 되므로
        // 문자열을 이어붙이지 않고 노드를 만들어 textContent로 넣는다.
        const status = document.createElement("div");
        status.className = "image-resize-status";
        status.style.marginTop = "0";
        status.style.color = color;
        status.textContent = text;
        bubble.replaceChildren(status);
        bubble.hidden = false;
        deps.updateBubblePosition(bubble);
      },
      query: <TElement extends HTMLElement>(selector: string) => (
        bubble.querySelector<TElement>(selector)!
      )
    };
    return host;
  }

  // ── 클립보드 번역 ────────────────────────────────────────────────────────
  const translatePanel = createHost(
    () => window.desktopPet.closeTranslate(),
    ["translate-result-panel"]
  );
  window.desktopPet.onTranslateClose(translatePanel.hide);
  window.desktopPet.onOpenTranslate((payload) => {
    translatePanel.activate();
    const options = deps.translateLanguageOptions()
      .map(({ value, label }) => `<option value="${value}">${label}</option>`)
      .join("");
    translatePanel.render(`
    <label for="translate-text">${tt("translate.textLabel")}</label>
    <textarea id="translate-text" maxlength="5000" rows="4"></textarea>
    <label for="translate-target">${tt("translate.targetLanguageLabel")}</label>
    <select id="translate-target">${options}</select>
    <div class="image-resize-actions">
      <button type="button" class="secondary-button" id="translate-cancel">${tt("common.close")}</button>
      <button type="button" id="translate-confirm">${tt("translate.runButton")}</button>
    </div>
  `);
    bubble.hidden = false;

    const textInput = translatePanel.query<HTMLTextAreaElement>("#translate-text");
    const targetSelect = translatePanel.query<HTMLSelectElement>("#translate-target");
    const confirmBtn = translatePanel.query<HTMLButtonElement>("#translate-confirm");
    const cancelBtn = translatePanel.query<HTMLButtonElement>("#translate-cancel");

    targetSelect.value = payload.target || "en";
    // "클립보드 내용 자동 입력" 설정이 켜져 있으면 main이 미리 클립보드 내용을 채워서 보내고,
    // 꺼져 있으면 빈 채로 열려서 사용자가 직접 입력한다 — 둘 다 여기서 그대로 편집 가능하다.
    textInput.value = payload.initialText || "";
    deps.updateBubblePosition(bubble);
    textInput.focus();

    // 번역 결과는 곧바로 클립보드에 넣지 않고 먼저 보여준다 — 확인 후 사용자가
    // 직접 "복사"를 눌러야 클립보드가 바뀐다(원치 않는 번역으로 클립보드를
    // 덮어쓰는 사고 방지).
    const showResult = (translated: string, languageLabel: string) => {
      bubble.classList.remove("image-resize-panel");
      bubble.classList.add("translate-result-panel");
      translatePanel.render(`
      <div class="translate-result-label">${tt("translate.resultLabel", { languageLabel })}</div>
      <div class="translate-result-text" id="translate-result-text"></div>
      <div class="image-resize-actions">
        <button type="button" class="secondary-button" id="translate-close">${tt("common.close")}</button>
        <button type="button" id="translate-copy">${tt("common.copy")}</button>
      </div>
    `);
      // 사용자 입력 텍스트라 innerHTML이 아니라 textContent로 안전하게 표시한다.
      translatePanel.query("#translate-result-text").textContent = translated;
      bubble.hidden = false;
      deps.updateBubblePosition(bubble);

      translatePanel.query("#translate-close").addEventListener("click", () => {
        bubble.classList.remove("translate-result-panel");
        translatePanel.close();
      });
      translatePanel.query("#translate-copy").addEventListener("click", (event) => {
        window.desktopPet.copyTranslatedText(translated);
        const button = event.currentTarget as HTMLButtonElement;
        button.textContent = tt("common.copied");
        button.disabled = true;
      });
    };

    cancelBtn.addEventListener("click", () => translatePanel.close());
    confirmBtn.addEventListener("click", async () => {
      const target = targetSelect.value;
      const text = textInput.value;
      translatePanel.showStatus(tt("translate.translatingStatus"), STATUS_COLOR_MUTED);
      try {
        const result = await window.desktopPet.runTranslate(target, text);
        if (result.ok) {
          showResult(result.translated, result.languageLabel);
        } else {
          translatePanel.showStatus(`✗ ${result.error}`, STATUS_COLOR_ERROR);
          setTimeout(translatePanel.close, AUTO_CLOSE_DELAY_MS);
        }
      } catch (error) {
        translatePanel.showStatus(`✗ ${String(error)}`, STATUS_COLOR_ERROR);
        setTimeout(translatePanel.close, AUTO_CLOSE_DELAY_MS);
      }
    });
  });

  // ── 문서 요약 ────────────────────────────────────────────────────────────
  const summaryPanel = createHost(
    () => window.desktopPet.closeDocumentSummary(),
    ["document-summary-result-panel"]
  );
  window.desktopPet.onDocumentSummaryClose(summaryPanel.hide);
  window.desktopPet.onOpenDocumentSummary((payload) => {
    summaryPanel.activate();
    summaryPanel.render(`
    <label for="document-summary-text">${tt("documentSummary.textLabel")}</label>
    <textarea id="document-summary-text" maxlength="1500" rows="7"></textarea>
    <span class="document-summary-limit" id="document-summary-limit"></span>
    <label for="document-summary-extra-request">${tt("documentSummary.extraRequestLabel")}</label>
    <textarea id="document-summary-extra-request" rows="3" placeholder="${deps.escapeHtml(tt("documentSummary.extraRequestPlaceholder"))}"></textarea>
    <div class="image-resize-actions">
      <button type="button" class="secondary-button" id="document-summary-cancel">${tt("common.close")}</button>
      <button type="button" id="document-summary-run">${tt("documentSummary.runButton")}</button>
    </div>
  `);
    const textInput = summaryPanel.query<HTMLTextAreaElement>("#document-summary-text");
    const extraRequestInput = summaryPanel.query<HTMLTextAreaElement>("#document-summary-extra-request");
    const limit = summaryPanel.query("#document-summary-limit");
    const updateLimit = () => {
      limit.textContent = tt("documentSummary.characterCount", { count: textInput.value.length });
    };
    textInput.value = payload?.initialText || "";
    extraRequestInput.value = payload?.extraRequest || "";
    updateLimit();
    textInput.addEventListener("input", updateLimit);
    summaryPanel.query("#document-summary-cancel").addEventListener("click", summaryPanel.close);
    summaryPanel.query("#document-summary-run").addEventListener("click", async () => {
      const runButton = summaryPanel.query<HTMLButtonElement>("#document-summary-run");
      runButton.disabled = true;
      runButton.textContent = tt("documentSummary.runningStatus");
      const result = await window.desktopPet.runDocumentSummary({
        text: textInput.value,
        extraRequest: extraRequestInput.value
      });
      if (!result.ok) {
        runButton.disabled = false;
        runButton.textContent = tt("documentSummary.runButton");
        limit.textContent = `✗ ${result.error}`;
        return;
      }
      bubble.classList.remove("image-resize-panel");
      bubble.classList.add("document-summary-result-panel");
      summaryPanel.render(`
      <div class="document-summary-result-icon">✨</div>
      <strong>${tt("documentSummary.completeTitle")}</strong>
      <span>${tt("documentSummary.completeNote", { fileName: result.fileName })}</span>
      <div class="image-resize-actions">
        <button type="button" class="secondary-button" id="document-summary-close">${tt("common.close")}</button>
        <button type="button" id="document-summary-open">${tt("documentSummary.openButton")}</button>
      </div>
    `);
      summaryPanel.query("#document-summary-close").addEventListener("click", summaryPanel.close);
      summaryPanel.query("#document-summary-open").addEventListener("click", async (event) => {
        const openResult = await window.desktopPet.openDocumentSummary(result.filePath);
        if (openResult.ok) (event.currentTarget as HTMLElement).textContent = tt("documentSummary.openedButton");
      });
      deps.updateBubblePosition(bubble);
    });
    bubble.hidden = false;
    deps.updateBubblePosition(bubble);
    textInput.focus();
  });

  // ── 이미지 리사이즈 ──────────────────────────────────────────────────────
  const imageResizePanel = createHost(() => window.desktopPet.closeImageResize(), []);
  window.desktopPet.onImageResizeClose(imageResizePanel.hide);
  window.desktopPet.onOpenImageResize(async () => {
    const defaults = deps.getImageResizeDefaults();
    imageResizePanel.activate();
    imageResizePanel.render(`
    <label for="resize-scale">${tt("imageResize.scaleLabel")}</label>
    <select id="resize-scale">
      <option value="0.5">${tt("imageResize.scaleOption", { value: "0.5" })}</option>
      <option value="2">${tt("imageResize.scaleOption", { value: "2" })}</option>
      <option value="3">${tt("imageResize.scaleOption", { value: "3" })}</option>
      <option value="4">${tt("imageResize.scaleOption", { value: "4" })}</option>
    </select>
    <label for="resize-filter">${tt("imageResize.filterLabel")}</label>
    <select id="resize-filter">
      <option value="nearest">${tt("imageResize.filterNearest")}</option>
      <option value="bilinear">${tt("imageResize.filterBilinear")}</option>
    </select>
    <div class="image-resize-actions">
      <button type="button" class="secondary-button" id="resize-cancel">${tt("common.close")}</button>
      <button type="button" id="resize-confirm">${tt("imageResize.runButton")}</button>
    </div>
  `);
    bubble.hidden = false;
    deps.updateBubblePosition(bubble);

    const scaleSelect = imageResizePanel.query<HTMLSelectElement>("#resize-scale");
    const filterSelect = imageResizePanel.query<HTMLSelectElement>("#resize-filter");
    const confirmBtn = imageResizePanel.query<HTMLButtonElement>("#resize-confirm");
    const cancelBtn = imageResizePanel.query<HTMLButtonElement>("#resize-cancel");

    scaleSelect.value = String(defaults.scale);
    filterSelect.value = defaults.filter;

    cancelBtn.addEventListener("click", () => imageResizePanel.close());
    confirmBtn.addEventListener("click", async () => {
      const selectedScale = parseFloat(scaleSelect.value);
      const selectedFilter = filterSelect.value;
      imageResizePanel.showStatus(tt("common.processingStatus"), STATUS_COLOR_MUTED);
      try {
        const result = await window.desktopPet.resizeImage(selectedScale, selectedFilter);
        imageResizePanel.showStatus(
          result.ok ? `✓ ${result.message}` : `✗ ${result.error}`,
          result.ok ? STATUS_COLOR_SUCCESS : STATUS_COLOR_ERROR
        );
        setTimeout(imageResizePanel.close, AUTO_CLOSE_DELAY_MS);
      } catch (error) {
        imageResizePanel.showStatus(`✗ ${String(error)}`, STATUS_COLOR_ERROR);
        setTimeout(imageResizePanel.close, AUTO_CLOSE_DELAY_MS);
      }
    });
  });

  return {
    /** Escape 처리용. 열려 있던 패널을 닫았으면 true. */
    closeActivePanel(): boolean {
      for (const panel of [imageResizePanel, translatePanel, summaryPanel]) {
        if (panel.isActive()) {
          panel.close();
          return true;
        }
      }
      return false;
    }
  };
}

export { createBubblePanels };
export type { BubblePanelDependencies };
