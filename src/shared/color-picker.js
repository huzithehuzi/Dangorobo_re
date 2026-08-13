/* 공용 색 선택기 — 펫 주변 커스터마이징 모드와 설정창이 같은 피커를 쓴다(2026-08-08 신설).
   i18n.js / favorite-icons.js / ui-motion.js와 같은 평범한 비모듈 스크립트다.

   원래 이 HSV 피커는 renderer.js 안에만 있었다. 네이티브 `<input type="color">`의 색
   대화상자가 펫 창(always-on-top + setFocusable/setIgnoreMouseEvents)에서 포커스를 잃고
   곧바로 닫혀버려서 직접 그린 것이다(AGENTS.md의 "네이티브 팝업 금지" 참고). 설정창은
   평범한 창이라 네이티브 피커가 동작하긴 했지만, 그래서 **같은 앱 안에 색 고르는 UI가
   두 종류**가 됐고 hex 입력 규칙도 서로 달랐다(설정창은 `#` 없으면 인식 못 함).
   "색상 조정 관련 기능들 일관성이 없음 ... 펫 주변에서 만든 걸로 통일하자"(2026-08-08)에
   따라 이 파일로 빼서 양쪽이 공유한다.

   ── 설정창에서 팝오버가 아니라 **인라인 확장**인 이유 ──
   설정창은 `document.documentElement.style.zoom`으로 UI 배율을 준다. zoom이 걸린 문서에서
   `getBoundingClientRect()`는 배율이 곱해진 값을 주는데, 그 값을 같은 문서 안 요소의
   `left/top`에 그대로 넣으면 배율이 한 번 더 곱해져서 어긋난다. 띄우는 위치를 배율로
   나눠 보정할 수도 있지만, 행 바로 아래에 펼치는 방식이면 그 계산 자체가 필요 없고
   화면 밖으로 나갈 일도 없다. 펫 창은 zoom을 안 쓰고 카드 옆에 붙여야 해서 지금처럼
   renderer.js가 위치를 직접 잡는다(패널만 이 모듈에서 만들어 넣는다). */
(function (global) {
  "use strict";

  // ── 색 변환 ────────────────────────────────────────────────────────────
  // 튜플로 돌려준다 — rgbToHsv(...hexToRgb(hex))처럼 그대로 펼쳐 넘기는 자리가 있다.
  /**
   * @param {unknown} hex
   * @returns {[number, number, number]}
   */
  function hexToRgb(hex) {
    const value = String(hex || "").replace("#", "");
    return /** @type {[number, number, number]} */ (
      [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) || 0)
    );
  }

  /**
   * @param {number} r
   * @param {number} g
   * @param {number} b
   */
  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
  }

  /**
   * @param {number} r
   * @param {number} g
   * @param {number} b
   */
  function rgbToHsv(r, g, b) {
    const red = r / 255, green = g / 255, blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;
    if (delta) {
      if (max === red) hue = ((green - blue) / delta) % 6;
      else if (max === green) hue = (blue - red) / delta + 2;
      else hue = (red - green) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    return { h: hue, s: max ? delta / max : 0, v: max };
  }

  /**
   * @param {number} h
   * @param {number} s
   * @param {number} v
   */
  function hsvToHex(h, s, v) {
    const chroma = v * s;
    const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
    const match = v - chroma;
    const sector = Math.floor(h / 60) % 6;
    const [r, g, b] = [
      [chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
      [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary]
    ][sector];
    return rgbToHex((r + match) * 255, (g + match) * 255, (b + match) * 255);
  }

  /* `#`은 있어도 되고 없어도 된다 — 이게 이 통일 작업의 핵심 요구사항 중 하나였다.
     인식 못 하면 null을 돌려주고, 호출부는 입력칸을 이전 값으로 되돌린다. */
  /**
   * @param {unknown} value
   * @returns {string | null}
   */
  function normalizeHex(value) {
    const text = String(value == null ? "" : value).trim().replace(/^#/, "");
    return /^[0-9a-fA-F]{6}$/.test(text) ? `#${text.toLowerCase()}` : null;
  }

  // ── 패널(채도·명도 영역 + 색조 슬라이더 + hex 칸) ──────────────────────
  /* onPreview: 드래그 중 매 프레임. onCommit: 손을 뗄 때/hex 확정 시 1회.
     이 둘을 나눠 두는 게 중요하다 — 드래그 중에 커밋하면 main이 pet-settings.json을
     초당 수십 번 쓴다(펫 창 피커에서 원래 지키던 규칙을 그대로 옮겼다). */
  /**
   * @typedef {{ onPreview?: (hex: string) => void, onCommit?: (hex: string) => void }} PanelOptions
   * @param {PanelOptions} [options]
   */
  function createPanel(options) {
    const onPreview = options?.onPreview || function () {};
    const onCommit = options?.onCommit || function () {};

    const element = document.createElement("div");
    element.className = "pcp-panel";

    const svArea = document.createElement("div");
    svArea.className = "pcp-sv";
    const svHandle = document.createElement("span");
    svHandle.className = "pcp-handle";
    svArea.append(svHandle);

    const hueArea = document.createElement("div");
    hueArea.className = "pcp-hue";
    const hueHandle = document.createElement("span");
    hueHandle.className = "pcp-handle";
    hueArea.append(hueHandle);

    const foot = document.createElement("div");
    foot.className = "pcp-foot";
    const preview = document.createElement("span");
    preview.className = "pcp-preview";
    const hexInput = document.createElement("input");
    hexInput.className = "pcp-hex";
    hexInput.type = "text";
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;
    foot.append(preview, hexInput);

    element.append(svArea, hueArea, foot);

    /* 색조는 회색(채도 0)에서 hex만 보고는 복원할 수 없으므로 상태로 따로 들고 있는다.
       이게 없으면 검정을 고른 뒤 명도를 올릴 때 색조가 0(빨강)으로 튄다. */
    const state = { h: 0, s: 0, v: 0 };

    function render() {
      const hex = hsvToHex(state.h, state.s, state.v);
      svArea.style.background = [
        "linear-gradient(to top, #000, rgba(0,0,0,0))",
        "linear-gradient(to right, #fff, rgba(255,255,255,0))",
        hsvToHex(state.h, 1, 1)
      ].join(", ");
      svHandle.style.left = `${state.s * 100}%`;
      svHandle.style.top = `${(1 - state.v) * 100}%`;
      svHandle.style.background = hex;
      hueHandle.style.left = `${(state.h / 360) * 100}%`;
      hueHandle.style.background = hsvToHex(state.h, 1, 1);
      preview.style.background = hex;
      if (document.activeElement !== hexInput) hexInput.value = hex.toUpperCase();
      return hex;
    }

    /** @param {unknown} hex */
    function setColor(hex) {
      const normalized = normalizeHex(hex) || "#ffffff";
      const hsv = rgbToHsv(...hexToRgb(normalized));
      // 무채색이면 색조 슬라이더 위치를 유지한다(위 state 주석 참고).
      if (hsv.s > 0) state.h = hsv.h;
      state.s = hsv.s;
      state.v = hsv.v;
      render();
    }

    /**
     * @param {HTMLElement} area
     * @param {(x: number, y: number) => void} onPick
     */
    function bindDrag(area, onPick) {
      const pickAt = (/** @type {PointerEvent} */ event) => {
        const rect = area.getBoundingClientRect();
        onPick(
          Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
        );
      };
      /* 드래그 상태는 자체 플래그로 들고 있는다. hasPointerCapture만 믿으면 캡처 확보가
         실패했을 때(합성 이벤트 등) 드래그가 통째로 죽는다. 캡처는 커서가 영역을 벗어나도
         이벤트를 계속 받기 위한 보조 수단으로만 쓴다. */
      let dragging = false;
      area.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        dragging = true;
        try { area.setPointerCapture(event.pointerId); } catch { /* 캡처 없이도 동작한다 */ }
        pickAt(event);
        onPreview(render());
      });
      area.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        pickAt(event);
        onPreview(render());
      });
      const finish = (/** @type {PointerEvent} */ event) => {
        if (!dragging) return;
        dragging = false;
        try { area.releasePointerCapture(event.pointerId); } catch { /* 이미 풀렸을 수 있다 */ }
        pickAt(event);
        onCommit(render());
      };
      area.addEventListener("pointerup", finish);
      area.addEventListener("pointercancel", finish);
    }

    bindDrag(svArea, (x, y) => { state.s = x; state.v = 1 - y; });
    bindDrag(hueArea, (x) => { state.h = x * 360; });

    hexInput.addEventListener("change", () => {
      const hex = normalizeHex(hexInput.value);
      // 인식 못 하는 값이면 아무것도 바꾸지 않고 원래 색으로 되돌려 보여준다.
      if (!hex) { render(); return; }
      setColor(hex);
      onCommit(hex);
    });
    hexInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); hexInput.blur(); }
    });

    render();
    return {
      element,
      setColor,
      getColor: () => hsvToHex(state.h, state.s, state.v)
    };
  }

  // ── 설정창용 필드(스와치 버튼 + hex 칸 + 눌러서 펼치는 패널) ────────────
  /* 한 번에 하나만 열려 있게 한다. 여러 개가 동시에 펼쳐지면 폼이 크게 밀려 어디를
     보고 있었는지 잃어버린다. */
  /** @type {{ root: HTMLElement, close: () => void } | null} */
  let openField = null;

  function closeOpenField() {
    if (!openField) return;
    openField.close();
    openField = null;
  }

  document.addEventListener("mousedown", (event) => {
    if (!openField) return;
    if (openField.root.contains(/** @type {Node | null} */ (event.target))) return;
    closeOpenField();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeOpenField();
  });

  /* value: 초기 색. onPreview/onCommit은 패널과 같은 의미.
     반환값의 getValue()/setValue()/setDisabled()로 바깥에서 읽고 쓴다 —
     예전에 `input[type=color]`의 `.value`를 직접 읽던 자리를 이걸로 바꾼다. */
  /**
   * @typedef {PanelOptions & {
   *   value?: unknown, title?: string, ariaLabel?: string, placeholder?: string
   * }} FieldOptions
   * @param {FieldOptions} [options]
   */
  function createField(options) {
    const onPreview = options?.onPreview || function () {};
    const onCommit = options?.onCommit || function () {};

    const root = document.createElement("span");
    root.className = "pcp-field";

    const controls = document.createElement("span");
    controls.className = "pcp-field-controls";

    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "pcp-swatch";
    if (options?.title) swatch.title = options.title;
    if (options?.ariaLabel) swatch.setAttribute("aria-label", options.ariaLabel);

    const hexInput = document.createElement("input");
    hexInput.type = "text";
    hexInput.className = "pcp-field-hex";
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;
    hexInput.placeholder = options?.placeholder || "#ffffff";

    controls.append(swatch, hexInput);
    root.append(controls);

    let current = normalizeHex(options?.value) || "#ffffff";
    /** @type {ReturnType<typeof createPanel> | null} */
    let panel = null;

    function paint() {
      swatch.style.background = current;
      /* 루트에도 현재 색을 남긴다 — 호출부가 필드 객체를 들고 있지 않고 DOM에서 카드를
         찾아 되읽는 경우가 있어서(즐겨찾기 항목: `card.querySelector(...)`), 그쪽에서
         `.dataset.color`로 읽을 수 있어야 한다. */
      root.dataset.color = current;
      swatch.dataset.color = current;
      if (document.activeElement !== hexInput) hexInput.value = current.toUpperCase();
    }

    function close() {
      root.classList.remove("pcp-open");
      if (panel) panel.element.hidden = true;
    }

    function open() {
      if (!panel) {
        panel = createPanel({
          onPreview: (hex) => { current = hex; paint(); onPreview(hex); },
          onCommit: (hex) => { current = hex; paint(); onCommit(hex); }
        });
        root.append(panel.element);
      }
      panel.setColor(current);
      panel.element.hidden = false;
      root.classList.add("pcp-open");
      if (openField && openField.root !== root) closeOpenField();
      openField = { root, close };
    }

    swatch.addEventListener("click", () => {
      if (swatch.disabled) return;
      if (root.classList.contains("pcp-open")) { closeOpenField(); return; }
      open();
    });

    hexInput.addEventListener("change", () => {
      const hex = normalizeHex(hexInput.value);
      // 인식 못 하는 값이면 되돌린다(에러를 띄우지 않고 조용히 원래 값으로).
      if (!hex) { paint(); return; }
      current = hex;
      paint();
      if (panel) panel.setColor(current);
      onCommit(current);
    });
    hexInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); hexInput.blur(); }
    });

    paint();

    const field = {
      element: root,
      getValue: () => current,
      /** @param {unknown} hex */
      setValue(hex) {
        current = normalizeHex(hex) || current;
        paint();
        if (panel) panel.setColor(current);
      },
      /** @param {unknown} disabled */
      setDisabled(disabled) {
        swatch.disabled = disabled === true;
        hexInput.disabled = disabled === true;
        root.classList.toggle("pcp-disabled", disabled === true);
        if (disabled === true && openField && openField.root === root) closeOpenField();
      }
    };

    /* `.value`/`.disabled`를 접근자로 노출한다. 이 필드는 `<input type="color">`를 대체하는
       자리라, 호출부에 이미 `x.value = ...` / `x.disabled = ...`가 수십 군데 흩어져 있다.
       그걸 전부 고치는 것보다 같은 모양을 유지하는 쪽이 변경 범위도 작고 실수도 적다. */
    Object.defineProperty(field, "value", {
      get: () => current,
      set(hex) { field.setValue(hex); }
    });
    Object.defineProperty(field, "disabled", {
      get: () => swatch.disabled,
      set(disabled) { field.setDisabled(disabled); }
    });

    return field;
  }

  // 전역에 이름을 심는 자리라 window의 정적 타입에는 이 속성이 없다.
  /** @type {any} */ (global).PetColorPicker = {
    hexToRgb,
    rgbToHex,
    rgbToHsv,
    hsvToHex,
    normalizeHex,
    createPanel,
    createField,
    closeOpenField
  };
})(window);
