// 즐겨찾기 아이콘 공용 컴포넌트 (2026-08-10).
// 규칙은 바닐라 창들과 동일: 추출·커스텀 이미지(iconDataUrl)가 있으면 그걸 먼저 쓰고,
// 없을 때만 내장 템플릿(src/shared/favorite-icons.js의 svgMarkup)을 그린다.
// svg/img 크기는 부모가 className으로 정한다([&_svg]:..., img는 아래 고정 규칙).

const DEFAULT_TEMPLATE_ID = "star";

interface FavoriteIconProps {
  iconDataUrl?: string | null;
  iconTemplate?: string | null;
  iconColor?: string | null;
  className?: string;
}

export function FavoriteIcon({ iconDataUrl, iconTemplate, iconColor, className }: FavoriteIconProps) {
  if (iconDataUrl) {
    return (
      <span className={className}>
        <img src={iconDataUrl} alt="" className="w-full h-full block object-contain" />
      </span>
    );
  }
  const templateId = window.FavoriteIcons?.isValidTemplateId(iconTemplate)
    ? (iconTemplate as string)
    : DEFAULT_TEMPLATE_ID;
  // svgMarkup은 XSS 관점에서 안전하다: SVG 본문은 내장 템플릿 테이블의 고정 문자열이고,
  // color 인자는 "currentColor" 또는 정확한 #rrggbb만 통과시키며 그 외는 #ffffff로 폴백한다.
  const markup = window.FavoriteIcons?.svgMarkup(templateId, iconColor || "currentColor") || "";
  return <span className={className} dangerouslySetInnerHTML={{ __html: markup }} />;
}
