/* 공용 UI 모션 드라이버 — ui-motion.css의 짝. 창 7개가 공용으로 쓴다(2026-08-08 신설).
   i18n.js / favorite-icons.js와 같은 평범한 비모듈 스크립트다(창마다 모듈/비모듈이 섞여
   있어서 어디서든 <script src>로 넣을 수 있는 형태여야 한다).

   CSS만으로 안 되는 세 가지만 여기서 한다:
     1. 커서 좌표를 CSS 변수(--ui-glow-x/y)로 넘기기
     2. 누른 자리에서 파문을 그릴 임시 요소 만들기
     3. 손을 뗀 요소에 젤리 출렁임 클래스를 붙였다 떼기(연타할 때 다시 재생되게)
     4. 목록이 다시 그려질 때 자식에 스태거 인덱스(--ui-i) 붙이기
   나머지(호버 떠오름·진입 애니메이션·포커스 링)는 전부 CSS 쪽에 있다.

   설계 원칙: **기존 요소의 스타일을 건드리지 않는다.** 파문은 버튼 안이 아니라 body 아래
   임시 호스트에 그리고, 하이라이트는 ::after라서 기존 마크업과 겹치지 않는다. 그래야
   창마다 제각각인 transform/position/overflow 규칙과 충돌하지 않는다(AGENTS.md 참고). */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  function motionOff() {
    return !!(reduceMotion && reduceMotion.matches);
  }

  /* 커서 하이라이트·파문을 받을 대상. 대부분의 창에서 상호작용 요소는 <button>이라
     이것만으로 거의 전부 덮인다. 카드형 행 몇 개만 따로 적는다.
     색을 보여주는 버튼만 제외한다 — 버튼 배경이 곧 "지금 고른 색"이라, 그 위에 강조색
     광택이나 파문을 씌우면 사용자가 보는 색 자체가 달라져 보인다.
     `.pcp-swatch`(색 선택 스와치)와 `.gradient-stop`(그라디언트 정지점)이 그렇다. */
  var GLOW_SELECTOR =
    "button:not(.pcp-swatch):not(.gradient-stop), .settings-tab, .favorite-item, .checklist-item, .log-entry, .memory-card";

  /* 스태거를 걸 목록 컨테이너. 여기 없는 목록은 그냥 예전처럼 한 번에 나타난다.
     (컨테이너는 전부 HTML에 정적으로 있고 내용만 JS가 채우므로 로드 시 한 번 찾으면 된다.) */
  var STAGGER_CONTAINERS = [
    "#favorite-items",
    "#alarm-items",
    "#customization-preset-list",
    "#memory-list",
    "#loops-list",
    "#log-list",
    "#checklist",
    "#favorites-list",
    ".favorites-list",
  ];

  // ── 1. 커서 추종 하이라이트 ────────────────────────────────────────────
  /** @type {HTMLElement | null} */
  var glowTarget = null;

  /* GLOW_SELECTOR로 걸린 요소는 대부분 <button>이지만 카드형 <div>도 있어서, disabled는
     있을 수도 없을 수도 있다. 그 자리만 좁혀서 읽는다. */
  /** @param {Element | null} element */
  function isDisabled(element) {
    return !!element && /** @type {HTMLButtonElement} */ (element).disabled;
  }

  function clearGlow() {
    if (!glowTarget) return;
    glowTarget.classList.remove("ui-glow-on");
    glowTarget = null;
  }

  /** @param {PointerEvent} event */
  function onPointerMove(event) {
    if (motionOff() || event.pointerType === "touch") return;
    var origin = /** @type {Element | null} */ (event.target);
    var target = /** @type {HTMLElement | null} */ (origin && origin.closest ? origin.closest(GLOW_SELECTOR) : null);
    if (isDisabled(target)) target = null;
    if (target !== glowTarget) {
      clearGlow();
      if (target) {
        target.classList.add("ui-glow", "ui-glow-on");
        glowTarget = target;
      }
    }
    if (!glowTarget) return;
    var rect = glowTarget.getBoundingClientRect();
    glowTarget.style.setProperty("--ui-glow-x", (event.clientX - rect.left).toFixed(1) + "px");
    glowTarget.style.setProperty("--ui-glow-y", (event.clientY - rect.top).toFixed(1) + "px");
  }

  // ── 2. 누름 파문 ───────────────────────────────────────────────────────
  /* 파문과 젤리가 같은 대상을 봐야 한다 — 하나만 걸리면 한쪽 효과만 도는 버튼이 생긴다. */
  /**
   * @param {PointerEvent} event
   * @returns {HTMLElement | null}
   */
  function pressTarget(event) {
    if (motionOff() || event.button !== 0) return null;
    var origin = /** @type {Element | null} */ (event.target);
    var target = /** @type {HTMLElement | null} */ (origin && origin.closest ? origin.closest(GLOW_SELECTOR) : null);
    return !target || isDisabled(target) ? null : target;
  }

  /** @param {PointerEvent} event */
  function spawnRipple(event) {
    var target = pressTarget(event);
    if (!target) return;
    var rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    /* 버튼과 정확히 같은 자리·같은 모서리 반경의 호스트를 띄우고 그 안에서만 그린다.
       버튼 자체에 overflow:hidden을 주면 `.settings-tab.active::before`(버튼 바깥에 있는
       왼쪽 강조 바)가 잘리므로 이렇게 우회한다. */
    var host = document.createElement("div");
    host.className = "ui-ripple-host";
    host.style.left = rect.left + "px";
    host.style.top = rect.top + "px";
    host.style.width = rect.width + "px";
    host.style.height = rect.height + "px";
    host.style.borderRadius = window.getComputedStyle(target).borderRadius;

    // 누른 지점에서 가장 먼 모서리까지 덮을 크기(그래야 버튼 전체를 훑고 지나간다).
    var offsetX = event.clientX - rect.left;
    var offsetY = event.clientY - rect.top;
    var reach = Math.max(offsetX, rect.width - offsetX) ** 2 + Math.max(offsetY, rect.height - offsetY) ** 2;
    var size = Math.ceil(Math.sqrt(reach) * 2);

    var ripple = document.createElement("span");
    ripple.className = "ui-ripple";
    ripple.style.setProperty("--ui-ripple-size", size + "px");
    ripple.style.left = offsetX + "px";
    ripple.style.top = offsetY + "px";
    host.appendChild(ripple);
    document.body.appendChild(host);

    var done = function () {
      if (host.parentNode) host.parentNode.removeChild(host);
    };
    ripple.addEventListener("animationend", done, { once: true });
    // animationend가 안 오는 경우(창이 숨겨져 애니메이션이 안 도는 등)를 대비한 안전망.
    window.setTimeout(done, 900);
  }

  // ── 3. 젤리 출렁임 ─────────────────────────────────────────────────────
  /* 실제 출렁임은 ui-motion.css의 @keyframes ui-jelly-wobble이 그린다(독립 `scale` 속성을
     써서 버튼의 transform 위치를 건드리지 않는다 — 그쪽 주석 참고). 여기서는 클래스만
     붙였다 뗀다.

     ⚠ **누를 때가 아니라 놓을 때 재생한다.** pointerdown에 걸면 짧게 톡 누른 경우
     `:active` 축소가 풀리는 움직임과 겹쳐 출렁임이 잘린 것처럼 보인다("꾹 눌러야 다
     재생된다", 2026-08-21 피드백). 누르는 동안의 반응은 :active 축소와 파문이 맡는다.

     누른 요소를 기억해 두고 **같은 요소에서 손을 뗐을 때만** 재생한다 — 누른 뒤 버튼
     밖으로 끌고 나가 떼면 클릭이 취소된 것이므로 출렁여서는 안 된다. */
  var JELLY_CLASS = "ui-jelly";
  var JELLY_ANIMATION = "ui-jelly-wobble";
  /** @type {HTMLElement | null} */
  var pressedTarget = null;

  /** @param {PointerEvent} event */
  function rememberPress(event) {
    pressedTarget = pressTarget(event);
  }

  function forgetPress() {
    pressedTarget = null;
  }

  /** @param {PointerEvent} event */
  function jellyRelease(event) {
    var released = pressedTarget;
    pressedTarget = null;
    if (!released || motionOff()) return;
    var target = released;
    /* 뗀 자리가 누른 요소 안이어야 한다. pointerup의 target은 버튼 안쪽 자식일 수 있으므로
       요소 동일성이 아니라 포함 관계로 본다. */
    var origin = /** @type {Element | null} */ (event.target);
    if (!origin || !target.contains(origin)) return;

    /* 연타할 때 다시 재생되려면 클래스를 뗀 뒤 리플로를 강제해야 한다(스태거와 같은 이유). */
    target.classList.remove(JELLY_CLASS);
    void target.offsetWidth;
    target.classList.add(JELLY_CLASS);

    /** @param {AnimationEvent} [animationEvent] */
    var done = function (animationEvent) {
      /* 버튼 안쪽 요소의 애니메이션이 올려보낸 animationend에 반응하면 출렁임이 중간에
         끊긴다. 이름으로 우리 것만 받는다. */
      if (animationEvent && animationEvent.animationName !== JELLY_ANIMATION) return;
      target.removeEventListener("animationend", /** @type {EventListener} */ (done));
      target.classList.remove(JELLY_CLASS);
    };
    target.addEventListener("animationend", /** @type {EventListener} */ (done));
    // animationend가 안 오는 경우(창이 숨겨져 애니메이션이 안 도는 등)를 대비한 안전망.
    window.setTimeout(function () { done(); }, 1200);
  }

  // ── 4. 목록 스태거 ─────────────────────────────────────────────────────
  /* 목록이 통째로 다시 그려질 때만 걸고 싶다(항목 하나 추가/삭제에 전체가 다시 튀면
     산만하다). 그래서 "한 번에 2개 이상 추가된 경우"에만 인덱스를 붙인다. */
  /** @param {Element} container */
  function staggerChildren(container) {
    var children = container.children;
    for (var i = 0; i < children.length; i += 1) {
      var child = /** @type {HTMLElement} */ (children[i]);
      child.style.setProperty("--ui-i", String(i));
      // 클래스를 뗐다 다시 붙여야 애니메이션이 재생된다.
      child.classList.remove("ui-stagger-item");
      void child.offsetWidth;
      child.classList.add("ui-stagger-item");
    }
  }

  function watchStagger() {
    if (typeof MutationObserver !== "function") return;
    var observer = new MutationObserver(function (records) {
      if (motionOff()) return;
      /** @type {Element[]} */
      var containers = [];
      for (var i = 0; i < records.length; i += 1) {
        var record = records[i];
        if (record.addedNodes.length < 2) continue;
        var observed = /** @type {Element} */ (record.target);
        if (containers.indexOf(observed) === -1) containers.push(observed);
      }
      for (var j = 0; j < containers.length; j += 1) staggerChildren(containers[j]);
    });
    for (var k = 0; k < STAGGER_CONTAINERS.length; k += 1) {
      var nodes = document.querySelectorAll(STAGGER_CONTAINERS[k]);
      for (var n = 0; n < nodes.length; n += 1) {
        observer.observe(nodes[n], { childList: true });
      }
    }
  }

  // ── 4. 창 진입 애니메이션 ──────────────────────────────────────────────
  function playWindowEnter() {
    if (motionOff()) return;
    /* 펫 창은 제외한다 — 여기서 body > *는 3D 캔버스를 품은 #pet-stage 하나뿐이라,
       "창이 열렸다"가 아니라 "펫이 통째로 흔들린다"로 보인다. 펫 말풍선은 이미
       styles.css의 bubble-in으로 자기 등장 애니메이션을 갖고 있다. */
    if (document.getElementById("pet-canvas")) return;
    var root = document.documentElement;
    root.classList.add("ui-window-enter");
    window.setTimeout(function () {
      root.classList.remove("ui-window-enter");
    }, 600);
  }

  // ── 5. 테마 적용 전 깜빡임 방지 ────────────────────────────────────────
  /* `<html data-ui-await-theme>`인 창은 ui-motion.css가 본문을 숨겨두고, 각 창 JS가
     테마를 적용한 직후 markReady()를 불러 연다. 진입 애니메이션도 그 시점에 재생해야
     "숨어 있는 동안 애니메이션만 끝나는" 일이 없다. */
  var readyMarked = false;

  function markReady() {
    if (readyMarked) return;
    readyMarked = true;
    document.documentElement.setAttribute("data-ui-ready", "");
    playWindowEnter();
  }

  function awaitsTheme() {
    return document.documentElement.hasAttribute("data-ui-await-theme");
  }

  function start() {
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerdown", spawnRipple, { passive: true });
    document.addEventListener("pointerdown", rememberPress, { passive: true });
    document.addEventListener("pointerup", jellyRelease, { passive: true });
    /* 버튼 밖에서 떼거나 시스템이 포인터를 회수하면 누름 기록만 버린다 — 그 경우
       pointerup이 아예 안 오거나 다른 요소에서 오므로 출렁임도 돌지 않는다. */
    document.addEventListener("pointercancel", forgetPress, { passive: true });
    document.addEventListener("pointerleave", clearGlow);
    // 버튼이 사라지거나(목록 재렌더) 창이 포커스를 잃으면 하이라이트가 남지 않게 한다.
    window.addEventListener("blur", clearGlow);
    watchStagger();
    if (awaitsTheme()) {
      /* 안전망: 창 JS가 markReady()를 못 부르는 상황(getSettings() IPC 실패·예외)에서도
         빈 창이 남지 않게 강제로 연다. 정상 경로에서는 이 타이머가 도는 것보다 훨씬
         먼저 markReady()가 불린다. */
      window.setTimeout(markReady, 1200);
    } else {
      markReady();
    }
  }

  /* start()가 아니라 여기(최상위)에서 내보낸다 — 창 JS는 ui-motion.js보다 **먼저** 로드되고
     그 안의 Promise 콜백이 DOMContentLoaded보다 앞서 돌 수 있어서, start() 안에서 내보내면
     markReady()가 아직 없을 수 있다. */
  // 전역에 이름을 심는 자리라 window의 정적 타입에는 이 속성이 없다.
  /** @type {any} */ (window).PetUiMotion = { markReady: markReady };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
