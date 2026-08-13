// 말풍선 테마 카탈로그 — 테마 id와 설정창 라벨 키.
//
// 테마 하나는 세 곳이 맞아떨어져야 동작한다:
//   1) settings-schema.ts의 normalizeBubbleTheme() — 목록에 없으면 저장 시 기본값으로 되돌린다
//   2) 설정창 드롭다운 — 여기 없으면 사용자가 고를 수 없다
//   3) CSS 변수 블록 — src/shared/theme-vars.css(창 공용)와 src/pet/styles.css(펫 말풍선)
// 예전에는 1·2가 각자 목록을 들고 있어서, 테마를 추가하고 한쪽만 고치면 "고를 수는 있는데
// 저장하면 되돌아가는" 상태가 됐다. 여기 배열이 1·2의 유일한 기준이고, 3은 CSS라 코드로
// 합칠 수 없어서 test/sound-theme-catalog.test.js가 블록 존재 여부를 대신 확인한다.
//
// 기본 테마(DEFAULT_SETTINGS.bubbleTheme = "charcoal")는 :root의 기본 변수를 그대로 쓰므로
// 자기 이름의 CSS 블록이 없다. "custom"은 사용자가 고른 색을 인라인으로 덮어쓰는 테마다.
const BUBBLE_THEMES = [
  { id: "charcoal", labelKey: "settings.ui.themeCharcoal" },
  { id: "rose", labelKey: "settings.ui.themeRose" },
  { id: "ocean", labelKey: "settings.ui.themeOcean" },
  { id: "forest", labelKey: "settings.ui.themeForest" },
  { id: "amber", labelKey: "settings.ui.themeAmber" },
  { id: "custom", labelKey: "settings.ui.themeCustom" }
] as const;

type BubbleThemeId = typeof BUBBLE_THEMES[number]["id"];

const BUBBLE_THEME_IDS: BubbleThemeId[] = BUBBLE_THEMES.map((theme) => theme.id);

// DEFAULT_SETTINGS.bubbleTheme의 근거. 창 쪽 코드에도 `settings.bubbleTheme || "charcoal"`
// 형태의 방어적 폴백이 몇 군데 있는데(설정이 IPC로 도착하기 전에 그리는 순간용),
// 기본 테마를 바꾼다면 그쪽도 같이 확인할 것 — test/sound-theme-catalog.test.js가 대조한다.
const DEFAULT_BUBBLE_THEME: BubbleThemeId = "charcoal";

function isBubbleTheme(value: unknown): value is BubbleThemeId {
  return typeof value === "string"
    && BUBBLE_THEME_IDS.some((themeId) => themeId === value);
}

export {
  BUBBLE_THEMES,
  BUBBLE_THEME_IDS,
  DEFAULT_BUBBLE_THEME,
  isBubbleTheme
};
export type { BubbleThemeId };
