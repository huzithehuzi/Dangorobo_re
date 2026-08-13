// 창 공통 외형 적용 (2026-08-10, 바닐라 창들의 applyXxxAppearance에서 공통 부분을 포팅).
// 말풍선 테마·커스텀 색·UI 배율·글자 크기·폰트를 <html>에 반영하고, 정규화된 언어를 돌려준다.
// 언어에 따른 문구 재렌더는 React 상태(setLanguage)가 담당하므로 여기서는 DOM 번역을 하지 않는다.
//
// 낱개 함수를 함께 내보내는 것은 설정창 때문이다. 다른 창은 저장된 설정을 통째로 한 번
// 입히면 끝이지만, 설정창은 폼 값이 바뀔 때마다 배율·글자 크기·폰트를 각각 따로 반영해야
// 한다. 그래서 예전에는 설정창이 같은 코드를 자기 파일에 복제해 들고 있었다.
//
// 배율·글자 크기의 허용 범위는 main의 `clampUiScalePercent`·`clampUiFontSizePercent`와
// 같아야 한다. 저장된 설정은 이미 그 범위 안이지만 설정창의 저장 전 미리보기는 사용자가
// 방금 친 값을 그대로 받는다 — 범위를 안 지키면 창이 그 배율로 커진 채로 남는데 저장은
// HTML 검증(min/max)에 막혀서 되돌리기 어렵다.
// `test/settings-ui-appearance.test.js`가 이 범위를 main과 대조한다.

const UI_SCALE_MIN_PERCENT = 70;
const UI_SCALE_MAX_PERCENT = 150;
const UI_FONT_SIZE_MIN_PERCENT = 80;
const UI_FONT_SIZE_MAX_PERCENT = 150;

/** 비었거나 숫자가 아니면 100%로 본다 — 폼에서 값을 지우는 중일 수 있다. */
function percentOr100(value: unknown): number {
  return Number(value) || 100;
}

export function applyBubbleTheme(
  theme: string,
  customBg: string,
  customAccent: string,
  customText: string
): void {
  const root = document.documentElement;
  root.dataset.theme = theme || "charcoal";
  if (customBg) root.style.setProperty("--custom-bg", customBg);
  if (customAccent) root.style.setProperty("--custom-accent", customAccent);
  if (customText) root.style.setProperty("--custom-text", customText);
}

export function applyUiScale(percent: unknown): void {
  const safePercent = Math.min(
    UI_SCALE_MAX_PERCENT,
    Math.max(UI_SCALE_MIN_PERCENT, percentOr100(percent))
  );
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom =
    String(safePercent / 100);
}

export function applyUiFontSize(percent: unknown): void {
  const safePercent = Math.min(
    UI_FONT_SIZE_MAX_PERCENT,
    Math.max(UI_FONT_SIZE_MIN_PERCENT, percentOr100(percent))
  );
  document.documentElement.style.setProperty("--ui-font-size-scale", String(safePercent / 100));
}

export function applyUiFont(enabled: boolean, preset: string): void {
  const root = document.documentElement;
  root.style.removeProperty("--ui-font-family");
  if (!enabled) {
    delete root.dataset.uiFont;
    return;
  }
  if (String(preset || "").startsWith("local:")) {
    delete root.dataset.uiFont;
    // 사용자가 고른 실제 폰트 이름이 CSS 문자열 안으로 들어가므로 역슬래시를 먼저,
    // 그다음 따옴표를 이스케이프한다(순서가 바뀌면 이스케이프한 백슬래시가 또 걸린다).
    const family = String(preset).slice(6).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    root.style.setProperty("--ui-font-family", `"${family}", "Segoe UI", "Malgun Gothic", sans-serif`);
    return;
  }
  root.dataset.uiFont = preset || "gulim";
}

export function applyWindowAppearance(
  settings: WindowAppearanceSettings,
  options: { zoom?: boolean } = {}
): string {
  // i18n을 로드하지 않는 창(컨텍스트 메뉴 — 라벨이 main에서 이미 번역돼 온다)에서도
  // 동작해야 하므로 PetI18n 없이는 정규화 없이 넘어간다.
  const language = window.PetI18n?.normalizeLanguage(settings.language) ?? String(settings.language || "en");
  applyBubbleTheme(
    settings.bubbleTheme || "",
    settings.bubbleThemeCustomBg || "",
    settings.bubbleThemeCustomAccent || "",
    settings.bubbleThemeCustomText || ""
  );
  // 크기가 main에서 내용 기반으로 계산되는 창(컨텍스트 메뉴, 플로팅 독)은 zoom을 걸지
  // 않는다 — 바닐라 구현들과 동일한 차이.
  if (options.zoom !== false) applyUiScale(settings.uiScalePercent);
  applyUiFontSize(settings.uiFontSizePercent);
  applyUiFont(settings.uiFontEnabled === true, settings.uiFontPreset || "");
  return language;
}

export {
  UI_SCALE_MIN_PERCENT,
  UI_SCALE_MAX_PERCENT,
  UI_FONT_SIZE_MIN_PERCENT,
  UI_FONT_SIZE_MAX_PERCENT
};
