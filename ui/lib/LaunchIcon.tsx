// 즐겨찾기 실행 항목 아이콘 (독립 창·플로팅 독 공용, 2026-08-10).
// 말풍선(renderer.js의 favoriteButton)과 같은 3단계 규칙:
// 내장 템플릿 → 추출된 이미지 → 둘 다 없으면 이름 첫 글자 배지.
// (컨텍스트 메뉴의 FavoriteIcon과 우선순위가 다르다 — 그쪽은 이미지 우선.)

interface LaunchIconProps {
  item: FavoriteItemPayload;
  /** 아이콘 정사각 크기 클래스 (예: "w-5 h-5") — 세 형태 모두에 적용된다 */
  sizeClassName: string;
  /** 첫 글자 배지의 글자 크기 클래스 */
  fallbackTextClassName?: string;
}

export function LaunchIcon({ item, sizeClassName, fallbackTextClassName = "text-[11px]" }: LaunchIconProps) {
  if (item.iconTemplate && window.FavoriteIcons) {
    // svgMarkup은 XSS 관점에서 안전하다: SVG 본문은 내장 템플릿 고정 문자열, color는
    // "currentColor"/#rrggbb만 통과(그 외 #ffffff 폴백).
    const markup = window.FavoriteIcons.svgMarkup(item.iconTemplate, item.iconColor || "#ffffff");
    return (
      <span
        className={`flex-none flex items-center justify-center [&_svg]:w-full [&_svg]:h-full ${sizeClassName}`}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    );
  }
  if (item.icon) {
    return <img src={item.icon} alt="" className={`flex-none object-contain ${sizeClassName}`} />;
  }
  return (
    <span
      className={`flex-none flex items-center justify-center rounded-md text-white bg-[color-mix(in_srgb,var(--accent)_70%,transparent)] font-bold ${fallbackTextClassName} ${sizeClassName}`}
    >
      {(item.name || "?").trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
