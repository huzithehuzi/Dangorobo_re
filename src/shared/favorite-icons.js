// 즐겨찾기 항목에 붙일 수 있는 내장 아이콘 템플릿(단색, 사용자가 고른 색으로 물들임).
// 프로그램에서 직접 추출한 아이콘 대신 쓰는 용도라, main.js(Node)와 렌더러(브라우저
// <script>) 양쪽에서 같은 목록/모양을 참조해야 해서 i18n.js와 같은 UMD 스타일로 내보낸다.
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (typeof root !== "undefined") {
    // 전역에 이름을 심는 UMD 관용구라 root의 정적 타입(window/globalThis)에는 이 속성이 없다.
    /** @type {any} */ (root).FavoriteIcons = mod;
  }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {
  // 면(채워진 도형) 스타일 — 처음엔 세부 표현(게임 버튼, 문서 줄 등)을 배경색과
  // 맞춘 사각형/원으로 "구멍"처럼 겹쳐서 그렸는데, 즐겨찾기 창(펫 말풍선)과 설정창의
  // 배경색이 서로 달라서(게다가 말풍선 테마도 5가지+커스텀이라 색이 제각각) 그
  // "구멍"이 실제 배경과 거의 항상 안 맞아 얼룩덜룩하게 보였다. 이번엔 특정 배경색을
  // 흉내내는 대신, `mix-blend-mode: destination-out`으로 진짜 구멍(완전 투명)을
  // 뚫는다 — 무엇이 뒤에 있든(어떤 테마·어떤 화면이든) 항상 정확하게 비쳐 보인다.
  const TEMPLATES = [
    { id: "star", labelKey: "favoriteIcon.star", inner: '<polygon points="12 2 14.9 8.6 22 9.3 16.5 14 18.2 21 12 17.3 5.8 21 7.5 14 2 9.3 9.1 8.6" fill="currentColor"/>' },
    { id: "heart", labelKey: "favoriteIcon.heart", inner: '<path d="M12 20.25c-.4 0-.8-.15-1.1-.44C7.14 16.42 3 12.28 3 8.5 3 5.8 5.1 3.75 7.75 3.75c1.42 0 2.77.66 3.65 1.7l.6.7.6-.7c.88-1.04 2.23-1.7 3.65-1.7C18.9 3.75 21 5.8 21 8.5c0 3.78-4.14 7.92-7.9 11.31-.3.29-.7.44-1.1.44z" fill="currentColor"/>' },
    { id: "game", labelKey: "favoriteIcon.game", inner: '<rect x="3" y="8" width="18" height="9" rx="4" fill="currentColor"/><g style="mix-blend-mode:destination-out" fill="#fff"><rect x="7" y="10.5" width="2" height="5"/><rect x="5.5" y="12" width="5" height="2"/><circle cx="15.5" cy="11.5" r="1.1"/><circle cx="18" cy="14" r="1.1"/></g>' },
    { id: "chat", labelKey: "favoriteIcon.chat", inner: '<rect x="3" y="4" width="18" height="12" rx="2" fill="currentColor"/><polygon points="6 16 10 16 6 20" fill="currentColor"/>' },
    { id: "music", labelKey: "favoriteIcon.music", inner: '<circle cx="8" cy="18" r="3" fill="currentColor"/><rect x="10" y="4" width="2" height="14" fill="currentColor"/><rect x="10" y="4" width="8" height="2" fill="currentColor"/>' },
    { id: "folder", labelKey: "favoriteIcon.folder", inner: '<path d="M3 6h6l2 2h10v11H3Z" fill="currentColor"/>' },
    { id: "document", labelKey: "favoriteIcon.document", inner: '<rect x="6" y="3" width="12" height="18" rx="1" fill="currentColor"/><g style="mix-blend-mode:destination-out" fill="#fff"><rect x="8" y="7" width="8" height="1.5"/><rect x="8" y="11" width="8" height="1.5"/><rect x="8" y="15" width="5" height="1.5"/></g>' },
    { id: "image", labelKey: "favoriteIcon.image", inner: '<rect x="3" y="4" width="18" height="16" rx="2" fill="currentColor"/><g style="mix-blend-mode:destination-out" fill="#fff"><circle cx="8.5" cy="9.5" r="2"/><polygon points="3 17 9 11 13 15 16 12 21 17 21 20 3 20"/></g>' },
    { id: "video", labelKey: "favoriteIcon.video", inner: '<rect x="3" y="6" width="13" height="12" rx="2" fill="currentColor"/><polygon points="16 10 21 7 21 17 16 14" fill="currentColor"/>' },
    { id: "code", labelKey: "favoriteIcon.code", inner: '<polygon points="9 6 3 12 9 18" fill="currentColor"/><polygon points="15 6 21 12 15 18" fill="currentColor"/>' },
    { id: "globe", labelKey: "favoriteIcon.globe", inner: '<circle cx="12" cy="12" r="9" fill="currentColor"/><g style="mix-blend-mode:destination-out" fill="#fff"><rect x="2.5" y="11.25" width="19" height="1.5"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="#fff" stroke-width="1.4"/></g>' },
    { id: "gear", labelKey: "favoriteIcon.gear", inner: '<circle cx="12" cy="12" r="9" fill="currentColor"/><g style="mix-blend-mode:destination-out" fill="#fff"><circle cx="12" cy="12" r="3.6"/></g><g fill="currentColor"><rect x="10.6" y="1" width="2.8" height="4"/><rect x="10.6" y="19" width="2.8" height="4"/><rect x="1" y="10.6" width="4" height="2.8"/><rect x="19" y="10.6" width="4" height="2.8"/></g>' },
    { id: "mail", labelKey: "favoriteIcon.mail", inner: '<rect x="3" y="5" width="18" height="14" rx="2" fill="currentColor"/><g style="mix-blend-mode:destination-out" fill="#fff"><polygon points="4 6.5 12 13 20 6.5 20 7.5 12 14.5 4 7.5"/></g>' },
    { id: "camera", labelKey: "favoriteIcon.camera", inner: '<rect x="3" y="7" width="18" height="13" rx="2" fill="currentColor"/><rect x="8" y="4" width="8" height="3" rx="1" fill="currentColor"/><g style="mix-blend-mode:destination-out" fill="#fff"><circle cx="12" cy="13.5" r="3.5"/></g>' },
    { id: "bookmark", labelKey: "favoriteIcon.bookmark", inner: '<path d="M6 3h12v18l-6-4-6 4Z" fill="currentColor"/>' },
    { id: "clock", labelKey: "favoriteIcon.clock", inner: '<circle cx="12" cy="12" r="9" fill="currentColor"/><g style="mix-blend-mode:destination-out" fill="#fff"><rect x="11" y="6" width="2" height="7"/><rect x="12" y="11" width="6" height="2"/></g>' },
    { id: "cloud", labelKey: "favoriteIcon.cloud", inner: '<circle cx="8" cy="14" r="4" fill="currentColor"/><circle cx="13" cy="10" r="5" fill="currentColor"/><circle cx="17.5" cy="14" r="3.5" fill="currentColor"/><rect x="6" y="13" width="13.5" height="7" rx="3.5" fill="currentColor"/>' },
    { id: "terminal", labelKey: "favoriteIcon.terminal", inner: '<rect x="3" y="4" width="18" height="16" rx="2" fill="currentColor"/><g style="mix-blend-mode:destination-out" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 8.5 11 12 7 15.5"/><line x1="12" y1="15.5" x2="17" y2="15.5"/></g>' }
  ];
  const TEMPLATE_IDS = new Set(TEMPLATES.map((tpl) => tpl.id));
  const TEMPLATE_BY_ID = new Map(TEMPLATES.map((tpl) => [tpl.id, tpl]));
  // "자동"(프로그램에서 직접 추출) 선택지 전용 아이콘 — 짧은 한국어 라벨("자동")을
  // 좁은 정사각 버튼에 텍스트로 넣으면 두 글자가 줄바꿈돼 보기 흉해서, 다른 템플릿과
  // 같은 크기의 반짝임(스파클) 아이콘으로 통일하고 실제 설명은 title 툴팁으로 뺐다.
  const AUTO_ICON_INNER = '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6Z" fill="currentColor"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z" fill="currentColor"/>';

  function autoIconMarkup() {
    return `<svg viewBox="0 0 24 24">${AUTO_ICON_INNER}</svg>`;
  }

  /** @param {unknown} id */
  function isValidTemplateId(id) {
    return typeof id === "string" && TEMPLATE_IDS.has(id);
  }

  // color: 아이콘을 물들일 hex 색상(#rrggbb) 또는 CSS currentColor. 각 도형이 자기
  // fill="currentColor"를 직접 들고 있으므로, 래퍼 svg는 CSS color만 정해주면 된다.
  // 메뉴처럼 테마 강조색을 따라야 하는 UI에서는 currentColor를 넘겨 부모 색을 그대로 쓴다.
  /**
   * @param {string} id
   * @param {string | undefined} color
   */
  function svgMarkup(id, color) {
    const template = TEMPLATE_BY_ID.get(id);
    if (!template) return "";
    const requestedColor = String(color || "");
    const safeColor = requestedColor === "currentColor" || /^#[0-9a-fA-F]{6}$/.test(requestedColor)
      ? requestedColor
      : "#ffffff";
    return `<svg viewBox="0 0 24 24" style="color: ${safeColor}">${template.inner}</svg>`;
  }

  return { TEMPLATES, TEMPLATE_IDS, isValidTemplateId, svgMarkup, autoIconMarkup };
});
