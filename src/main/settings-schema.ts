// main.js에서 분리한 설정 스키마: 기본값, 정규화/클램프 함수들.
// 여기 있는 함수들은 대부분 순수 함수(들어온 값 + DEFAULT_SETTINGS만 보고 값을 정함)라
// main.js의 실행 중 상태(petWindow, settings 등)를 전혀 몰라도 된다.
// 예외: normalizeFavoriteItems/normalizeCustomizationPreset(s)/normalizeAlarm(s)는
// 기본 이름/제목 문구를 만들 때 i18n이 필요해서, 호출 쪽에서 `language`를 인자로
// 넘겨받는다(원래는 main.js의 모듈 전역 `settings.language`를 클로저로 읽었는데,
// 그 값을 그대로 호출부에서 넘기도록 바꿔서 동작은 완전히 동일하다).
import * as path from "node:path";
import { app } from "electron";
import {
  DEFAULT_BUBBLE_THEME,
  isBubbleTheme
} from "../shared/theme-catalog.js";

type Language = "ko" | "en" | "ja";
type I18nModule = {
  t: (language: string, key: string, vars?: Record<string, unknown>) => string;
  detectDefaultLanguage: (osLocale: unknown) => Language;
  SUPPORTED_LANGUAGES: Language[];
};
type FavoriteIconsModule = {
  isValidTemplateId: (value: unknown) => value is string;
};
type BodyColorDefinition = { id: string; labelKey: string; defaultColor: string };
type PartVariationDefinition = {
  id: string;
  labelKey: string;
  variations: string[];
  defaultVariation: string;
};
type LightingDefinition = { id: string; labelKey: string };
type CustomizationCatalogModule = {
  FACE_PATTERN_COUNT: number;
  FACE_COSMETIC_COUNT: number;
  FACE_EYE_STYLE_COUNT: number;
  FACE_MOUTH_STYLE_COUNT: number;
  BODY_COSTUME_COUNT: number;
  BODY_COLOR_DEFS: BodyColorDefinition[];
  PART_VARIATION_DEFS: PartVariationDefinition[];
  LIGHTING_DEFS: LightingDefinition[];
};
type SoundCatalogModule = {
  ALARM_SOUND_COUNT: number;
  TALK_SOUND_COUNT: number;
  CLICK_SOUND_COUNT: number;
};
const { t, detectDefaultLanguage, SUPPORTED_LANGUAGES } = require("../shared/i18n.js") as I18nModule;
const FavoriteIcons = require("../shared/favorite-icons.js") as FavoriteIconsModule;

// 즐겨찾기 최대 개수. 2026-08-07에 8 → 12로 올렸다. 이 숫자를 더 올리려면 코드 상수만으로는
// 안 되고 세 UI의 기하학을 같이 봐야 한다:
//   - 파이 메뉴: 인접 항목 간격이 `2 * 반지름 * sin(π/n)`이라 개수가 늘면 반지름이 커진다.
//     `favorites-dock.js`의 `RING_RADIUS_BY_COUNT`와 `favorites-layout.js`의
//     `FAVORITES_DOCK_EXPANDED`(창 반폭 ≥ 반지름 + 26)를 함께 맞출 것. 13개부터는
//     창이 320px를 넘어간다.
//   - 펫 말풍선 목록: `styles.css`의 `.favorites-list { max-height }`. 항목 하나가 약 41px(35+간격 6).
//   - 그리드는 4열이라 여유 있음.
const FAVORITE_ITEM_LIMIT = 12;

// 무늬 개수·부위·파츠 목록은 펫 렌더러·설정창과 **반드시 같아야 하므로**
// src/shared/customization-catalog.js 한 곳에서 가져온다(예전엔 세 곳에 복사돼 있었다).
const {
  FACE_PATTERN_COUNT,
  FACE_COSMETIC_COUNT,
  FACE_EYE_STYLE_COUNT,
  FACE_MOUTH_STYLE_COUNT,
  BODY_COSTUME_COUNT,
  BODY_COLOR_DEFS,
  PART_VARIATION_DEFS,
  LIGHTING_DEFS
} = require("../shared/customization-catalog.js") as CustomizationCatalogModule;

// 사운드 개수는 실제 파일 목록에서 나온다(renderer·설정창과 공유).
const {
  ALARM_SOUND_COUNT,
  TALK_SOUND_COUNT: ANIMALESE_SOUND_STYLE_COUNT,
  CLICK_SOUND_COUNT
} = require("../shared/sound-catalog.js") as SoundCatalogModule;

// 저장되는 알람 한 개. 종류(type)에 따라 들어 있는 필드가 달라 유니온으로 적는다.
// src/main/alarm-scheduler.js의 ScheduledAlarm은 이 중 자기가 읽는 필드만 요구하므로
// 이 값을 그대로 넘길 수 있다.
type AlarmCommon = { id: string; title: string; message: string; soundFile: string };
type OnceAlarm = AlarmCommon & { type: "once"; fireAt: string };
type IntervalAlarm = AlarmCommon & {
  type: "interval";
  intervalMinutes: number;
  enabled: boolean;
};
type DailyAlarm = AlarmCommon & {
  type: "daily";
  dailyTime: string;
  enabled: boolean;
  daysOfWeek: number[];
  // 켜면 발동 시각에 message를 오늘·내일 날씨 문장으로 바꿔치기한다(weather-service.ts).
  // 저장되는 message 자체는 건드리지 않는다 — main.ts가 발동 직전에만 사본에 얹는다.
  weatherBriefingEnabled: boolean;
};
// 정시 알람. interval과 달리 등록 시각이 아니라 시계의 정각(분·초 0)에 맞춰 울린다.
type HourlyAlarm = AlarmCommon & {
  type: "hourly";
  hourlyInterval: number;
  enabled: boolean;
};
type NormalizedAlarm = OnceAlarm | IntervalAlarm | DailyAlarm | HourlyAlarm;

// 저장되는 즐겨찾기 한 개.
type FavoriteItem = {
  id: string;
  name: string;
  target: string;
  iconTemplate: string;
  iconColor: string;
  customIcon: string;
};

const DEFAULT_SETTINGS = {
  // 실제 기본값은 최초 실행 시 OS 로케일로 감지해 채운다(loadSettings() 참고).
  // 여기 값은 그 감지 결과가 없을 때 쓰는 최종 폴백일 뿐이다.
  language: "en",
  alarms: [] as NormalizedAlarm[],
  petScalePercent: 60,
  tailSpeedPercent: 200,
  shadingEnabled: true,
  pixelArtPercent: 0,
  paletteEnabled: true,
  palettePreset: "auto",
  paletteSteps: 6,
  /* "사용자 지정" 팔레트를 골랐을 때만 쓰인다. 기본 프리셋이 "auto"라서 이 값이 있어도
     기존 사용자의 화면은 그대로다. 어두운 남색 → 자주 → 크림색으로, 그라디언트 맵이
     무슨 효과인지 한눈에 보이는 조합을 기본값으로 뒀다. */
  paletteCustomStops: [
    { position: 0, color: "#1b1b2a" },
    { position: 0.5, color: "#a0567a" },
    { position: 1, color: "#ffe6c4" }
  ],
  // 배포 전 마지막 조정(2026-08-09)으로 새 설치 기본값을 베이어 2×2/35%로 켜뒀다 — 레트로
  // 인상을 기본값으로 삼기로 한 결정. 기존 사용자는 저장된 설정 파일을 그대로 읽으므로
  // 영향 없다(이 리터럴은 pet-settings.json이 아예 없는 브랜드 뉴 설치에만 쓰인다).
  ditherPattern: "bayer2",
  ditherAmount: 35,
  outlineEnabled: true,
  outlineColor: "#000000",
  outlineThickness: 4,
  lineWobbleEnabled: false,
  lineWobbleFrequency: 6,
  lineWobbleSpeed: 1.5,
  lineWobbleAmount: 1.5,
  mouseSquishEnabled: true,
  keyboardSquishEnabled: true,
  squishStrengthPercent: 9,
  keyboardClickEnabled: false,
  keyboardClickSound: 2,
  keyboardClickVolume: 60,
  keyboardClickMinPitch: 90,
  keyboardClickMaxPitch: 110,
  mouseClickEnabled: false,
  mouseClickSound: 1,
  mouseClickVolume: 60,
  mouseClickMinPitch: 90,
  mouseClickMaxPitch: 110,
  headPettingEnabled: true,
  capsLockAlertEnabled: true,
  sleepEnabled: true,
  sleepAfterMinutes: 5,
  dragReactionEnabled: true,
  idleRoutineEnabled: true,
  idleRoutineMinSeconds: 18,
  idleRoutineMaxSeconds: 42,
  // 전체화면 게임 중 펫이 창 뒤로 가라앉아 z-order를 흐트러뜨리던 사례가 있어(2026-08-15
  // 수정) 새 설치 기본값을 켬으로 바꿨다(2026-08-18). 기존 사용자는 저장된 값을 그대로
  // 따르므로(normalizeSettings의 `=== true` 검사) 이 변경의 영향을 받지 않는다.
  fullscreenDndEnabled: true,
  petDragMode: "always",
  bubbleTheme: DEFAULT_BUBBLE_THEME,
  bubbleThemeCustomBg: "#20232b",
  bubbleThemeCustomAccent: "#d75566",
  // 커스텀 테마 글씨색(2026-08-07 추가). 보조 글씨색 2단은 CSS에서 이 색을 배경 쪽으로
  // 섞어 만든다 — theme-vars.css 참고. 기본값은 기존 고정 글씨색과 같아서 이 값을
  // 건드리지 않은 사용자는 화면이 바뀌지 않는다.
  bubbleThemeCustomText: "#f7f7f9",
  uiScalePercent: 100,
  uiFontSizePercent: 100,
  uiFontEnabled: false,
  uiFontPreset: "gulim",
  soundEnabled: true,
  autoStartEnabled: false,
  // 새 버전 알림(설치본만 동작한다 — portable은 업데이트 채널이 없다). 기존 사용자는 지금까지
  // 자동으로 알림을 받아 왔으므로 기본값을 켠 상태로 둔다.
  updateNotifyEnabled: true,
  // 도시 이름 텍스트. Open-Meteo 지오코딩·예보 조회에 쓴다(API 키 불필요). 비어 있으면
  // 날씨 브리핑·트레이 "현재 날씨" 모두 위치 미설정 메시지로 대체된다.
  weatherCity: "",
  trayMenuItems: {
    showHidePet: true,
    moveMode: true,
    alarmCountdown: true,
    qaLogs: true,
    checklist: true,
    assistant: true,
    favorites: true,
    autoStart: true,
    weather: true
  },
  assistantEnabled: false,
  animaleseEnabled: false,
  animaleseIntervalMs: 45,
  animalesePitchPercent: 8,
  animalesePetChatEnabled: false,
  animaleseSoundStyle: 1,
  alarmSound: 1,
  assistantGeminiModel: "gemini-3.1-flash-lite",
  assistantShortcut: "CommandOrControl+Shift+A",
  assistantShortcutEnabled: true,
  assistantPersonality: "friend",
  assistantCustomPersonality: "",
  assistantMemoryEnabled: false,
  assistantMemoryTurns: 10,
  memoryTabVisible: false,
  assistantUserNickname: "",
  assistantPetNickname: "",
  petChatEnabled: false,
  petChatMinMinutes: 3,
  petChatMaxMinutes: 20,
  pettingChatEnabled: false,
  favoritesEnabled: false,
  favoritesShortcut: "CommandOrControl+Shift+F",
  favoritesShortcutEnabled: true,
  favoritesTrayItemsEnabled: false,
  // 즐겨찾기를 어디에 띄울지: 펫 말풍선(기존) / 독립 창 / 상시 플로팅 독 /
  // 마우스 위치 파이 메뉴. 기본값은 기존 사용자의 동작을 바꾸지 않도록 "bubble".
  favoritesDisplayMode: "bubble",
  favoritesLayout: "list",
  favoriteGridLabelsHidden: false,
  favoriteItems: [] as FavoriteItem[],
  // 최초 실행 시 기본 커스터마이징은 "미로" 프리셋(아래 customizationPresets 참고)이다.
  facePattern: 3,
  faceCosmetic: 1,
  faceEyeStyle: 1,
  faceMouthStyle: 1,
  customFaceEnabled: false,
  // 위 주석("최초 실행 시 기본 커스터마이징은 미로 프리셋")대로 미로 프리셋의 값과 맞춘다.
  // 이 top-level 기본값은 브랜드 뉴 설치(저장된 pet-settings.json이 아예 없는 경우)에만
  // 쓰이고, 기존 사용자는 normalizeBodyCostumeIndex()의 별도 폴백(0)을 타므로 이 값을
  // 바꿔도 기존 사용자의 외형은 그대로다.
  bodyCostume: 1,
  customBodyEnabled: false,
  bodyColors: BODY_COLOR_DEFS.map((def) => ({ id: def.id, color: def.defaultColor })),
  partVariations: [
    { id: "ears", variation: "cat" },
    { id: "tail", variation: "cat" },
    { id: "headgear", variation: "choker" }
  ],
  // 기본 커스터마이징 프리셋 3종(2026-08-06 추가) — 체리/미로/로로.
  customizationPresets: [
    {
      id: "preset-mshkbc2v-el126r",
      name: "체리",
      bodyColors: [
        { id: "head", color: "#ff9a9e" },
        { id: "body", color: "#ff9a9e" },
        { id: "ears", color: "#ff9a9e" },
        { id: "tail", color: "#c67174" },
        { id: "headgear", color: "#5c5759" },
        { id: "hand", color: "#ff9a9e" },
        { id: "eye", color: "#351f20" },
        { id: "mouth", color: "#351f20" },
        { id: "facePattern", color: "#ffe0e0" },
        { id: "faceCosmetic", color: "#dd9797" },
        { id: "bodyCostume", color: "#ffe0e0" }
      ],
      partVariations: [
        { id: "ears", variation: "bunny" },
        { id: "tail", variation: "antenna" },
        { id: "headgear", variation: "ribbon" }
      ],
      facePattern: 4,
      faceCosmetic: 2,
      faceEyeStyle: 2,
      faceMouthStyle: 1,
      customFaceEnabled: false,
      bodyCostume: 5,
      customBodyEnabled: false,
      // 빈 문자열은 "이 프리셋은 외곽선 색을 바꾸지 않는다"는 뜻이다.
      outlineColor: ""
    },
    {
      id: "preset-mshk2m8q-l3kylw",
      name: "미로",
      bodyColors: [
        { id: "head", color: "#ffcd42" },
        { id: "body", color: "#ffcd42" },
        { id: "ears", color: "#ffcd42" },
        { id: "tail", color: "#e1b12d" },
        { id: "headgear", color: "#39a5c0" },
        { id: "hand", color: "#39a5c0" },
        { id: "eye", color: "#39fbfe" },
        { id: "mouth", color: "#39fbfe" },
        { id: "facePattern", color: "#262222" },
        { id: "faceCosmetic", color: "#ff8e52" },
        { id: "bodyCostume", color: "#262222" }
      ],
      partVariations: [
        { id: "ears", variation: "cat" },
        { id: "tail", variation: "cat" },
        { id: "headgear", variation: "choker" }
      ],
      facePattern: 3,
      faceCosmetic: 1,
      faceEyeStyle: 1,
      faceMouthStyle: 1,
      customFaceEnabled: false,
      bodyCostume: 1,
      customBodyEnabled: false,
      // 빈 문자열은 "이 프리셋은 외곽선 색을 바꾸지 않는다"는 뜻이다.
      outlineColor: ""
    },
    {
      id: "preset-mshkdmil-8b7aoj",
      name: "로로",
      bodyColors: [
        { id: "head", color: "#d0d6d7" },
        { id: "body", color: "#d0d6d7" },
        { id: "ears", color: "#97da9a" },
        { id: "tail", color: "#6eb271" },
        { id: "headgear", color: "#346a35" },
        { id: "hand", color: "#88bf8a" },
        { id: "eye", color: "#1b3131" },
        { id: "mouth", color: "#1b3131" },
        { id: "facePattern", color: "#84d788" },
        { id: "faceCosmetic", color: "#feac4d" },
        { id: "bodyCostume", color: "#62a976" }
      ],
      partVariations: [
        { id: "ears", variation: "bear" },
        { id: "tail", variation: "round" },
        { id: "headgear", variation: "glassesround" }
      ],
      facePattern: 4,
      faceCosmetic: 1,
      faceEyeStyle: 2,
      faceMouthStyle: 2,
      customFaceEnabled: false,
      bodyCostume: 4,
      customBodyEnabled: false,
      // 빈 문자열은 "이 프리셋은 외곽선 색을 바꾸지 않는다"는 뜻이다.
      outlineColor: ""
    }
  ],
  lighting: {
    ambient: {
      color: "#b087a5",
      groundColor: "#688592",
      intensity: 5.1
    },
    keyLight: {
      color: "#ffdd94",
      intensity: 5.7,
      posX: -1.1,
      posY: 2.6,
      posZ: 5
    },
    rimLight: {
      color: "#b3f6ff",
      intensity: 8,
      posX: 0.6,
      posY: 3,
      posZ: -2
    }
  },
  imageResizeShortcut: "CommandOrControl+Shift+R",
  imageResizeShortcutEnabled: true,
  checklistShortcut: "CommandOrControl+Shift+T",
  checklistShortcutEnabled: true,
  translateShortcut: "CommandOrControl+Shift+E",
  translateShortcutEnabled: true,
  translateTargetLanguage: "en",
  translatePreferClipboard: true,
  documentSummaryShortcut: "CommandOrControl+Shift+D",
  documentSummaryShortcutEnabled: true,
  documentSummaryTheme: "app",
  imageResizeFilter: "nearest",
  imageResizeScale: 2,
  mediaPlayer: {
    enabled: false,
    scale: 100,
    nodEnabled: true,
    verticalOffset: 8,
    opacity: 100
  }
};

// 설정 계약 타입.
// 설정 106키의 타입 원본은 DEFAULT_SETTINGS 리터럴 하나다 — typeof로 파생시키므로
// 키를 추가/변경하면 타입이 저절로 따라오고, 별도 타입 선언과 어긋날 일이 없다.
// 다른 파일에서 `/** @type {import("./settings-schema.js").Settings} */`로 쓴다.
type Settings = typeof DEFAULT_SETTINGS;

function clampScale(value: unknown) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_SETTINGS.petScalePercent;
  return Math.min(130, Math.max(30, Math.round(percent)));
}

function clampTailSpeed(value: unknown) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_SETTINGS.tailSpeedPercent;
  return Math.min(350, Math.max(25, Math.round(percent)));
}

function clampPixelArtPercent(value: unknown) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_SETTINGS.pixelArtPercent;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function normalizePalettePreset(value: unknown) {
  const allowed = new Set(["auto", "warm", "cool", "monochrome", "gameboy", "custom"]);
  const preset = value as string;
  return allowed.has(preset) ? preset : DEFAULT_SETTINGS.palettePreset;
}

/* 디더링. 팔레트 계단화가 만드는 색 경계를 패턴으로 흩뿌려 레트로 느낌을 준다.
   팔레트 제한이 켜져 있을 때만 의미가 있다(계단화 자체에 끼어드는 효과라서). */
const DITHER_PATTERNS = ["none", "bayer2", "bayer4", "bayer8", "checker", "lines", "verticalLines", "noise"];

function normalizeDitherPattern(value: unknown) {
  const pattern = value as string;
  return DITHER_PATTERNS.includes(pattern) ? pattern : DEFAULT_SETTINGS.ditherPattern;
}

function clampDitherAmount(value: unknown) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_SETTINGS.ditherAmount;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/* 사용자 지정 팔레트(그라디언트 맵)의 정지점. 밝기 0~1을 이 그라디언트 위의 위치로 보고
   그 자리의 색으로 통째로 치환한다 — 자세한 동작은 docs/DEVELOPMENT.md의 렌더링 계약 참고.
   정지점이 2개 미만이면 그라디언트가 성립하지 않으므로 기본값으로 되돌린다. */
const PALETTE_CUSTOM_STOP_MIN = 2;
const PALETTE_CUSTOM_STOP_MAX = 8;

function normalizePaletteCustomStops(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_SETTINGS.paletteCustomStops.map((stop) => ({ ...stop }));
  const stops = [];
  for (const entryValue of value as unknown[]) {
    const entry = entryValue as Record<string, unknown> | null | undefined;
    const color = String(entry?.color ?? "").trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) continue;
    const position = Number(entry?.position);
    if (!Number.isFinite(position)) continue;
    stops.push({
      position: Math.min(1, Math.max(0, Math.round(position * 1000) / 1000)),
      color: color.toLowerCase()
    });
    if (stops.length >= PALETTE_CUSTOM_STOP_MAX) break;
  }
  if (stops.length < PALETTE_CUSTOM_STOP_MIN) {
    return DEFAULT_SETTINGS.paletteCustomStops.map((stop) => ({ ...stop }));
  }
  // 렌더러가 순서를 가정하고 보간하므로 여기서 정렬해 둔다.
  stops.sort((a, b) => a.position - b.position);
  return stops;
}

function clampPaletteSteps(value: unknown) {
  const steps = Number(value);
  if (!Number.isFinite(steps)) return DEFAULT_SETTINGS.paletteSteps;
  return Math.min(32, Math.max(2, Math.round(steps)));
}

function normalizeOutlineColor(value: unknown) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_SETTINGS.outlineColor;
}

// 프리셋에 담기는 외곽선 색은 "없으면 지금 색을 그대로 둔다"는 뜻의 빈 문자열을 허용한다 —
// 이 기능(2026-08-20) 전에 저장된 프리셋을 적용할 때 외곽선 색이 기본값으로 튀지 않게 한다.
function normalizeOptionalOutlineColor(value: unknown) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "";
}

function clampOutlineThickness(value: unknown) {
  const thickness = Number(value);
  if (!Number.isFinite(thickness)) return DEFAULT_SETTINGS.outlineThickness;
  return Math.min(8, Math.max(1, Math.round(thickness)));
}

function clampLineWobbleFrequency(value: unknown) {
  const frequency = Number(value);
  if (!Number.isFinite(frequency)) return DEFAULT_SETTINGS.lineWobbleFrequency;
  return Math.min(30, Math.max(1, Math.round(frequency)));
}

function clampLineWobbleSpeed(value: unknown) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return DEFAULT_SETTINGS.lineWobbleSpeed;
  return Math.min(10, Math.max(0.1, Math.round(speed * 10) / 10));
}

function clampLineWobbleAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return DEFAULT_SETTINGS.lineWobbleAmount;
  return Math.min(6, Math.max(0, Math.round(amount * 10) / 10));
}

function clampSquishStrength(value: unknown) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_SETTINGS.squishStrengthPercent;
  return Math.min(35, Math.max(5, Math.round(percent)));
}

function clampAnimaleseInterval(value: unknown) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return DEFAULT_SETTINGS.animaleseIntervalMs;
  return Math.min(150, Math.max(20, Math.round(milliseconds / 5) * 5));
}

function clampPetChatMinutes(value: unknown, fallback: number) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return fallback;
  return Math.min(720, Math.max(1, Math.round(minutes)));
}

function clampAssistantMemoryTurns(value: unknown) {
  const turns = Number(value);
  if (!Number.isFinite(turns)) return DEFAULT_SETTINGS.assistantMemoryTurns;
  return Math.min(20, Math.max(1, Math.round(turns)));
}

function clampAnimalesePitch(value: unknown) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_SETTINGS.animalesePitchPercent;
  return Math.min(30, Math.max(0, Math.round(percent)));
}

function clampClickVolume(value: unknown, fallback: number) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return fallback;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function clampClickPitch(value: unknown, fallback: number) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return fallback;
  return Math.min(200, Math.max(50, Math.round(percent)));
}

// click1~6 중 어떤 파일을 쓸지 — 예전엔 매번 무작위였는데, 사용자 요청으로
// 키보드/마우스 각각 고정된 사운드 하나를 고르는 방식으로 바꿨다(2026-08-02).
function clampClickSound(value: unknown, fallback: number) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 1 && index <= CLICK_SOUND_COUNT ? index : fallback;
}

function normalizeUiFontPreset(value: unknown) {
  const allowedFonts = new Set(["malgun", "gulim", "batang", "gungsuh", "monospace"]);
  const preset = value as string;
  if (allowedFonts.has(preset)) return preset;
  const selection = String(value ?? "");
  if (!selection.startsWith("local:")) return DEFAULT_SETTINGS.uiFontPreset;
  const family = selection.slice(6).trim();
  if (!family || family.length > 120 || /[\u0000-\u001f\u007f]/.test(family)) {
    return DEFAULT_SETTINGS.uiFontPreset;
  }
  return `local:${family}`;
}

function normalizeBubbleTheme(value: unknown) {
  return isBubbleTheme(value) ? value : DEFAULT_SETTINGS.bubbleTheme;
}

function normalizeHexColor(value: unknown, fallback: string) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function clampUiScalePercent(value: unknown) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_SETTINGS.uiScalePercent;
  return Math.min(150, Math.max(70, Math.round(percent / 5) * 5));
}

function clampUiFontSizePercent(value: unknown) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_SETTINGS.uiFontSizePercent;
  return Math.min(150, Math.max(80, Math.round(percent / 5) * 5));
}

function normalizeText(value: unknown, fallback: string, maxLength: number) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizeOptionalLine(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeAssistantModel(value: unknown, fallback: string) {
  const model = String(value ?? "").trim();
  return /^[a-zA-Z0-9._:-]{1,80}$/.test(model) ? model : fallback;
}

// 예전엔 각 단축키마다 미리 정해둔 몇 개 조합(Set)만 허용했는데, 사용자가 원하는 아무
// 조합이나 직접 눌러서 등록할 수 있게 해달라는 요청으로 구조적 검증 방식으로 바꿨다
// (2026-08-02). renderer 쪽(settings.js)에서 실제 키 입력을 캡처해 이 형식의 문자열을
// 만들어 보낸다 — 여기서는 "보조키 1개 이상 + 실제 키 1개" 구조만 검증한다(보조키 없이
// 등록하면 그 키 하나만으로 전역 단축키가 잡혀 평소 타이핑을 방해하게 되므로 반드시
// 보조키를 요구한다).
const ACCELERATOR_MODIFIER_TOKENS = new Set(["CommandOrControl", "Control", "Cmd", "Alt", "Shift", "Super", "AltGr"]);
const ACCELERATOR_KEY_PATTERN = /^([A-Za-z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Return|Backspace|Delete|Up|Down|Left|Right|Escape|Home|End|PageUp|PageDown|[,./;'[\]\\=-])$/;
// 마우스 측면 버튼(뒤로가기/앞으로가기, uiohook 기준 버튼4/5) — Electron globalShortcut은
// 마우스 버튼을 지원하지 않아 이 값들은 main.js에서 전역 훅(uIOhook) mousedown으로 직접
// 매칭한다(2026-08-08). 타이핑을 방해할 위험이 없으므로 키보드 단축키와 달리 보조키 없이
// 단독으로 등록할 수 있다.
const MOUSE_BUTTON_TOKENS = new Set(["Mouse4", "Mouse5"]);

// 첫 줄에서 문자열이 아니면 걸러내므로 술어가 사실이다.
function isValidGlobalAccelerator(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const parts = value.split("+");
  const keyPart = parts[parts.length - 1];
  const modifierParts = parts.slice(0, -1);
  if (!modifierParts.every((part) => ACCELERATOR_MODIFIER_TOKENS.has(part))) return false;
  if (ACCELERATOR_MODIFIER_TOKENS.has(keyPart)) return false;
  if (MOUSE_BUTTON_TOKENS.has(keyPart)) return true;
  if (modifierParts.length === 0) return false;
  return ACCELERATOR_KEY_PATTERN.test(keyPart);
}

// 첫 줄에서 문자열이 아니면 걸러내므로 술어가 사실이다.
function isMouseShortcut(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const parts = value.split("+");
  return MOUSE_BUTTON_TOKENS.has(parts[parts.length - 1]);
}

function normalizeGlobalShortcut(value: unknown, fallback: string) {
  return isValidGlobalAccelerator(value) ? value : fallback;
}

// 어떤 기능의 단축키든 화면에 보여줄 때는 다 같은 방식으로 포맷한다("CommandOrControl+Shift+A" → "Ctrl + Shift + A").
function formatShortcutLabel(value: unknown) {
  return String(value).replace("CommandOrControl", "Ctrl").replaceAll("+", " + ");
}

function normalizeAssistantShortcut(value: unknown) {
  return normalizeGlobalShortcut(value, DEFAULT_SETTINGS.assistantShortcut);
}

function assistantShortcutLabel(value: unknown) {
  return normalizeAssistantShortcut(value)
    .replace("CommandOrControl", "Ctrl")
    .replaceAll("+", " + ");
}

function normalizeFavoritesShortcut(value: unknown) {
  return normalizeGlobalShortcut(value, DEFAULT_SETTINGS.favoritesShortcut);
}

function favoritesShortcutLabel(value: unknown) {
  return normalizeFavoritesShortcut(value)
    .replace("CommandOrControl", "Ctrl")
    .replaceAll("+", " + ");
}

function normalizeImageResizeShortcut(value: unknown) {
  return normalizeGlobalShortcut(value, DEFAULT_SETTINGS.imageResizeShortcut);
}

function imageResizeShortcutLabel(value: unknown) {
  return normalizeImageResizeShortcut(value)
    .replace("CommandOrControl", "Ctrl")
    .replaceAll("+", " + ");
}

// 클립보드 번역: 대상 언어 목록(코드 → 프롬프트에 넣을 언어 이름).
// 언어를 추가하려면 여기와 ui/settings/ / renderer.ts의 드롭다운을 함께 맞출 것.
const TRANSLATE_LANGUAGES = {
  ko: "한국어",
  en: "영어(English)",
  ja: "일본어(日本語)",
  "zh-CN": "중국어 간체(简体中文)",
  es: "스페인어(Español)",
  fr: "프랑스어(Français)",
  de: "독일어(Deutsch)"
};

function normalizeTranslateLanguage(value: unknown): keyof typeof TRANSLATE_LANGUAGES {
  const language = value as string;
  return Object.prototype.hasOwnProperty.call(TRANSLATE_LANGUAGES, language)
    ? language as keyof typeof TRANSLATE_LANGUAGES
    : DEFAULT_SETTINGS.translateTargetLanguage as keyof typeof TRANSLATE_LANGUAGES;
}

function normalizeTranslateShortcut(value: unknown) {
  return normalizeGlobalShortcut(value, DEFAULT_SETTINGS.translateShortcut);
}

function translateShortcutLabel(value: unknown) {
  return normalizeTranslateShortcut(value)
    .replace("CommandOrControl", "Ctrl")
    .replaceAll("+", " + ");
}

function normalizeDocumentSummaryShortcut(value: unknown) {
  return normalizeGlobalShortcut(value, DEFAULT_SETTINGS.documentSummaryShortcut);
}

function documentSummaryShortcutLabel(value: unknown) {
  return normalizeDocumentSummaryShortcut(value)
    .replace("CommandOrControl", "Ctrl")
    .replaceAll("+", " + ");
}

function normalizeDocumentSummaryTheme(value: unknown) {
  const theme = value as string;
  return new Set(["light", "dark", "app"]).has(theme)
    ? theme
    : DEFAULT_SETTINGS.documentSummaryTheme;
}

function normalizeChecklistShortcut(value: unknown) {
  return normalizeGlobalShortcut(value, DEFAULT_SETTINGS.checklistShortcut);
}

function checklistShortcutLabel(value: unknown) {
  return normalizeChecklistShortcut(value)
    .replace("CommandOrControl", "Ctrl")
    .replaceAll("+", " + ");
}

function normalizeImageResizeFilter(value: unknown) {
  return value === "bilinear" ? "bilinear" : "nearest";
}

function normalizeImageResizeScale(value: unknown) {
  const allowed = new Set([0.5, 2, 3, 4]);
  const n = Number(value);
  return allowed.has(n) ? n : DEFAULT_SETTINGS.imageResizeScale;
}

// language: 기본 표시 이름을 만들 때만 쓴다(원래 main.js 모듈 전역 settings.language를
// 클로저로 읽던 걸 명시적 인자로 바꾼 것 — 호출부에서 그 시점의 settings.language를
// 그대로 넘기면 동작이 완전히 같다).
function normalizeFavoriteIconPath(value: unknown) {
  const iconPath = path.normalize(String(value ?? "").trim()).slice(0, 1024);
  const extension = path.extname(iconPath).toLowerCase();
  const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".ico", ".bmp", ".webp"]);
  return iconPath && path.isAbsolute(iconPath) && allowedExtensions.has(extension) ? iconPath : "";
}

function normalizeFavoriteItems(value: unknown, language: string): FavoriteItem[] {
  if (!Array.isArray(value)) return [];
  const allowedExtensions = new Set([".exe", ".lnk", ".url", ".appref-ms", ".bat", ".cmd", ".com"]);
  const seenTargets = new Set<string>();
  const items: FavoriteItem[] = [];
  for (const candidateValue of value as unknown[]) {
    const candidate = candidateValue as Record<string, unknown> | null | undefined;
    if (items.length >= FAVORITE_ITEM_LIMIT) break;
    const target = path.normalize(String(candidate?.target ?? "").trim()).slice(0, 1024);
    const extension = path.extname(target).toLowerCase();
    if (!target || !path.isAbsolute(target) || !allowedExtensions.has(extension)) continue;
    const targetKey = target.toLocaleLowerCase();
    if (seenTargets.has(targetKey)) continue;
    seenTargets.add(targetKey);
    const fallbackName = path.basename(target, extension) || t(language, "favorites.defaultName");
    const idValue = String(candidate?.id ?? "").trim();
    const iconTemplate = FavoriteIcons.isValidTemplateId(candidate?.iconTemplate)
      ? candidate!.iconTemplate as string
      : "";
    const customIcon = normalizeFavoriteIconPath(candidate?.customIcon);
    items.push({
      id: /^[a-zA-Z0-9_-]{1,64}$/.test(idValue) ? idValue : `favorite-${items.length + 1}`,
      name: normalizeText(candidate?.name, fallbackName, 32),
      target,
      // 내장 아이콘 템플릿을 고르면 실행 파일에서 실제 아이콘을 추출하지 않고 이 값을
      // 쓴다(속도도 빠르고, 아이콘 추출이 잘 안 되는 프로그램의 우회 수단도 된다).
      iconTemplate: customIcon ? "" : iconTemplate,
      iconColor: !customIcon && iconTemplate ? normalizeHexColor(candidate?.iconColor, "#ffffff") : "",
      customIcon
    });
  }
  return items;
}

function normalizeAssistantPersonality(value: unknown) {
  const allowed = new Set(["friend", "polite", "concise", "playful", "custom"]);
  const personality = value as string;
  return allowed.has(personality) ? personality : DEFAULT_SETTINGS.assistantPersonality;
}

function normalizeFacePatternIndex(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= FACE_PATTERN_COUNT ? n : 0;
}

function normalizeFaceCosmeticIndex(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= FACE_COSMETIC_COUNT ? n : 0;
}

function normalizeBodyCostumeIndex(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= BODY_COSTUME_COUNT ? n : 0;
}

function normalizeFaceEyeStyleIndex(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= FACE_EYE_STYLE_COUNT ? n : DEFAULT_SETTINGS.faceEyeStyle;
}

function clampSleepMinutes(value: unknown) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return DEFAULT_SETTINGS.sleepAfterMinutes;
  return Math.min(120, Math.max(1, Math.round(minutes)));
}

function clampIdleRoutineSeconds(value: unknown, fallback = DEFAULT_SETTINGS.idleRoutineMinSeconds) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return fallback;
  return Math.min(300, Math.max(5, Math.round(seconds)));
}

function normalizePetDragMode(value: unknown) {
  return value === "toggle" ? "toggle" : DEFAULT_SETTINGS.petDragMode;
}

// 저장된 값이 없거나 지원하지 않는 언어면 OS 로케일로 감지한 언어를 기본값으로 쓴다
// (사용자가 한 번이라도 언어를 고르면 그 뒤로는 이 값이 그대로 저장·유지된다).
function normalizeSettingsLanguage(value: unknown) {
  const language = value as Language;
  if (SUPPORTED_LANGUAGES.includes(language)) return language;
  return detectDefaultLanguage(app.getLocale());
}

function normalizeAnimaleseSoundStyle(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= ANIMALESE_SOUND_STYLE_COUNT ? n : DEFAULT_SETTINGS.animaleseSoundStyle;
}

function normalizeAlarmSound(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= ALARM_SOUND_COUNT ? n : DEFAULT_SETTINGS.alarmSound;
}

function normalizeFaceMouthStyleIndex(value: unknown) {
  const n = Number(value);
  // 0은 "입 없음"이라는 유효한 선택지이므로, 값이 아예 없을 때만 기본값(입 있음)으로 되돌린다.
  return Number.isInteger(n) && n >= 0 && n <= FACE_MOUTH_STYLE_COUNT ? n : DEFAULT_SETTINGS.faceMouthStyle;
}

function normalizeBodyColors(value: unknown) {
  const stored = Array.isArray(value) ? value as unknown[] : [];
  return BODY_COLOR_DEFS.map((def) => {
    const entry = stored.find((candidateValue) => {
      const candidate = candidateValue as Record<string, unknown> | null | undefined;
      return candidate?.id === def.id;
    }) as Record<string, unknown> | null | undefined;
    const color = String(entry?.color ?? "").trim();
    return {
      id: def.id,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : def.defaultColor
    };
  });
}

function normalizePartVariations(value: unknown) {
  const stored = Array.isArray(value) ? value as unknown[] : [];
  return PART_VARIATION_DEFS.map((def) => {
    const entry = stored.find((candidateValue) => {
      const candidate = candidateValue as Record<string, unknown> | null | undefined;
      return candidate?.id === def.id;
    }) as Record<string, unknown> | null | undefined;
    const variation = String(entry?.variation ?? "").trim();
    return {
      id: def.id,
      variation: variation && /^[a-zA-Z0-9_-]+$/.test(variation) ? variation : def.defaultVariation
    };
  });
}

function generatePresetId() {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCustomizationPreset(value: unknown, language: string) {
  const preset = value as Record<string, unknown> | null | undefined;
  return {
    id: typeof preset?.id === "string" && preset.id ? preset.id : generatePresetId(),
    name: String(preset?.name || "").trim().slice(0, 40) || t(language, "customization.defaultPresetName"),
    bodyColors: normalizeBodyColors(preset?.bodyColors),
    partVariations: normalizePartVariations(preset?.partVariations),
    facePattern: normalizeFacePatternIndex(preset?.facePattern),
    faceCosmetic: normalizeFaceCosmeticIndex(preset?.faceCosmetic),
    faceEyeStyle: normalizeFaceEyeStyleIndex(preset?.faceEyeStyle),
    faceMouthStyle: normalizeFaceMouthStyleIndex(preset?.faceMouthStyle),
    customFaceEnabled: preset?.customFaceEnabled === true,
    bodyCostume: normalizeBodyCostumeIndex(preset?.bodyCostume),
    customBodyEnabled: preset?.customBodyEnabled === true,
    outlineColor: normalizeOptionalOutlineColor(preset?.outlineColor)
  };
}

function normalizeCustomizationPresets(value: unknown, language: string) {
  const list = Array.isArray(value) ? value as unknown[] : [];
  return list.slice(0, 50).map((entry) => normalizeCustomizationPreset(entry, language));
}

// 최초 실행 시 내장되는 기본 프리셋 3종의 이름은 언어별로 번역해서 채운다(2026-08-06).
// DEFAULT_SETTINGS.customizationPresets의 name은 한글 원본이자 최종 폴백일 뿐이고,
// 실제로 최초 실행 시 쓰이는 건 이 함수가 반환하는 언어별 이름이 적용된 사본이다.
const DEFAULT_PRESET_NAME_KEYS: Record<string, string> = {
  "preset-mshkbc2v-el126r": "customization.builtinPreset.cherry",
  "preset-mshk2m8q-l3kylw": "customization.builtinPreset.miro",
  "preset-mshkdmil-8b7aoj": "customization.builtinPreset.loro"
};

function getDefaultCustomizationPresets(language: string) {
  return DEFAULT_SETTINGS.customizationPresets.map((preset) => {
    const nameKey = DEFAULT_PRESET_NAME_KEYS[preset.id];
    return nameKey ? { ...preset, name: t(language, nameKey) } : preset;
  });
}

// 저장된 JSON을 훑어 모양을 맞추는 함수라 unknown으로 받고 아래에서 필드마다 검사·클램프한다.
function normalizeLighting(value: unknown) {
  const validateColor = (color: unknown) => {
    const c = String(color ?? "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : "#ffffff";
  };
  const clamp = (val: unknown, min: number, max: number) =>
    Math.max(min, Math.min(max, Number(val) || 0));
  const clampIntensity = (intensity: unknown) => clamp(intensity, 0, 10);
  const clampPosition = (pos: unknown) => clamp(pos, -10, 10);

  if (!value || typeof value !== "object") return DEFAULT_SETTINGS.lighting;
  const lighting = value as Record<string, Record<string, unknown> | null | undefined>;

  return {
    ambient: {
      color: validateColor(lighting.ambient?.color),
      groundColor: validateColor(lighting.ambient?.groundColor),
      intensity: clampIntensity(lighting.ambient?.intensity)
    },
    keyLight: {
      color: validateColor(lighting.keyLight?.color),
      intensity: clampIntensity(lighting.keyLight?.intensity),
      posX: clampPosition(lighting.keyLight?.posX),
      posY: clampPosition(lighting.keyLight?.posY),
      posZ: clampPosition(lighting.keyLight?.posZ)
    },
    rimLight: {
      color: validateColor(lighting.rimLight?.color),
      intensity: clampIntensity(lighting.rimLight?.intensity),
      posX: clampPosition(lighting.rimLight?.posX),
      posY: clampPosition(lighting.rimLight?.posY),
      posZ: clampPosition(lighting.rimLight?.posZ)
    }
  };
}

// 저장된 JSON을 훑어 모양을 맞추는 함수라 unknown으로 받고 아래에서 필드마다 검사·클램프한다.
function normalizeMediaPlayer(value: unknown) {
  const clamp = (
    val: unknown,
    min: number,
    max: number,
    fallback: number
  ) => {
    const n = Number(val);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS.mediaPlayer };
  const mediaPlayer = value as Record<string, unknown>;
  return {
    enabled: mediaPlayer.enabled === true,
    scale: Math.round(clamp(mediaPlayer.scale, 50, 150, DEFAULT_SETTINGS.mediaPlayer.scale)),
    nodEnabled: mediaPlayer.nodEnabled !== false,
    verticalOffset: Math.round(clamp(mediaPlayer.verticalOffset, -20, 80, DEFAULT_SETTINGS.mediaPlayer.verticalOffset)),
    opacity: Math.round(clamp(mediaPlayer.opacity, 20, 100, DEFAULT_SETTINGS.mediaPlayer.opacity))
  };
}

const ALARM_TYPES = ["interval", "hourly", "daily", "once"];
// 정시 알람의 "몇 시간마다". 상한이 12인 것은 그 위(24)가 daily와 같아지기 때문이다.
const HOURLY_INTERVAL_MIN = 1;
const HOURLY_INTERVAL_MAX = 12;

// 즐겨찾기 아이콘 경로 검증(normalizeFavoriteIconPath)과 같은 패턴 — 파일을
// userData로 복사하지 않고 원본 절대 경로를 그대로 저장, 확장자만 화이트리스트로 제한.
function normalizeAlarmSoundFilePath(value: unknown) {
  const soundPath = path.normalize(String(value ?? "").trim()).slice(0, 1024);
  const extension = path.extname(soundPath).toLowerCase();
  const allowedExtensions = new Set([".mp3", ".wav"]);
  return soundPath && path.isAbsolute(soundPath) && allowedExtensions.has(extension) ? soundPath : "";
}

// 종류마다 들어 있는 필드가 다르다(once는 fireAt만, daily는 dailyTime/daysOfWeek만).
// 예전에는 공통 부분을 만든 뒤 분기에서 필드를 덧붙였는데, 그러면 "어떤 종류에 어떤
// 필드가 있는지"가 타입에 남지 않는다. 종류별로 완성된 객체를 돌려주도록 바꿨다 —
// 키 순서와 각 필드의 계산식은 그대로다.
function normalizeAlarm(entryValue: unknown, language: string): NormalizedAlarm | null {
  const entry = entryValue as Record<string, unknown> | null | undefined;
  if (!entry || typeof entry !== "object") return null;
  const typeValue = entry.type as string;
  const type = ALARM_TYPES.includes(typeValue) ? typeValue : null;
  if (!type) return null;
  const id = /^[a-zA-Z0-9_-]+$/.test(String(entry.id || "")) ? String(entry.id) : `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const title = normalizeText(entry.title, t(language, "alarm.defaultTitle"), 40);
  const message = normalizeText(entry.message, t(language, "alarm.defaultMessage"), 80);
  const soundFile = normalizeAlarmSoundFilePath(entry.soundFile);

  if (type === "interval") {
    const minutes = Number(entry.intervalMinutes);
    return {
      id,
      title,
      message,
      type: "interval",
      soundFile,
      intervalMinutes: Number.isFinite(minutes) ? Math.min(1440, Math.max(1, Math.round(minutes))) : 60,
      enabled: entry.enabled !== false
    };
  }
  if (type === "hourly") {
    const hours = Number(entry.hourlyInterval);
    return {
      id,
      title,
      message,
      type: "hourly",
      soundFile,
      hourlyInterval: Number.isFinite(hours)
        ? Math.min(HOURLY_INTERVAL_MAX, Math.max(HOURLY_INTERVAL_MIN, Math.round(hours)))
        : 1,
      enabled: entry.enabled !== false
    };
  }
  if (type === "daily") {
    const days = Array.isArray(entry.daysOfWeek)
      ? [...new Set((entry.daysOfWeek as unknown[]).map(Number).filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
      : [];
    return {
      id,
      title,
      message,
      type: "daily",
      soundFile,
      dailyTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(entry.dailyTime || "")) ? entry.dailyTime as string : "15:00",
      enabled: entry.enabled !== false,
      daysOfWeek: days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6],
      weatherBriefingEnabled: entry.weatherBriefingEnabled === true
    };
  }
  const fireAt = new Date(entry.fireAt as string | number | Date);
  return {
    id,
    title,
    message,
    type: "once",
    soundFile,
    fireAt: Number.isFinite(fireAt.getTime()) ? fireAt.toISOString() : new Date(Date.now() + 30 * 60000).toISOString()
  };
}

function normalizeAlarms(value: unknown, language: string): NormalizedAlarm[] {
  const stored = Array.isArray(value) ? value as unknown[] : [];
  // filter(Boolean)은 null을 걸러도 타입이 안 좁혀져 Settings.alarms가 (Alarm|null)[]로 남는다.
  return stored.map((entry) => normalizeAlarm(entry, language)).filter((alarm) => alarm !== null).slice(0, 30);
}

// 저장된 JSON을 훑어 모양을 맞추는 함수라 unknown으로 받는다 — 키마다 기본값과 대조한다.
// Object.fromEntries의 결과 타입은 { [k: string]: boolean }라 키 이름이 사라진다.
// 키 목록은 DEFAULT_SETTINGS.trayMenuItems에서 그대로 돌기 때문에 실제로는 같은 모양이다.
function normalizeTrayMenuItems(value: unknown): typeof DEFAULT_SETTINGS.trayMenuItems {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS.trayMenuItems).map(([key, defaultValue]) => [
      key,
      source[key] === undefined ? defaultValue : source[key] === true
    ])
  ) as typeof DEFAULT_SETTINGS.trayMenuItems;
}

const FAVORITES_DISPLAY_MODES = new Set(["bubble", "window", "dock", "cursor"]);

function normalizeFavoritesDisplayMode(value: unknown) {
  const mode = value as string;
  return FAVORITES_DISPLAY_MODES.has(mode) ? mode : DEFAULT_SETTINGS.favoritesDisplayMode;
}

function normalizeFavoritesLayout(value: unknown) {
  return value === "grid" ? "grid" : DEFAULT_SETTINGS.favoritesLayout;
}

function normalizeFavoriteGridLabelsHidden(value: unknown) {
  return value === true;
}

// 예전 버전이 저장한 설정 파일을 지금 스키마로 옮긴다. **저장된 값에만** 적용한다
// (loadSettings / settings:import-all). 설정창이 보내는 payload는 항상 지금 스키마라
// 적용하지 않는다 — 예전 키가 우연히 섞여 들어와 값이 바뀌는 일이 없도록.
function migrateLegacySettings(stored: unknown): Record<string, unknown> {
  const migrated = { ...(stored as Record<string, unknown>) };
  // pixelArtEnabled(on/off) → pixelArtPercent(0~100). 켜져 있었으면 80%로 옮긴다.
  if (migrated.pixelArtPercent === undefined || migrated.pixelArtPercent === null) {
    migrated.pixelArtPercent = migrated.pixelArtEnabled === true ? 80 : 0;
  }
  // 폐기된 모델 id는 기본 모델로 되돌린다(설정창에 더 이상 선택지가 없어서,
  // 그대로 두면 사용자가 스스로 고칠 방법이 없다).
  if (migrated.assistantGeminiModel === "gemini-3.6-flash") {
    migrated.assistantGeminiModel = DEFAULT_SETTINGS.assistantGeminiModel;
  }
  return migrated;
}

// 임의의 입력(저장 파일 / 설정창 payload)을 신뢰할 수 있는 settings 객체로 정규화한다.
// **설정 키 106개의 유일한 기준이다.** 예전에는 main.js의 loadSettings()와 settings:save
// 핸들러가 거의 같은 목록을 각자 들고 있어서, 설정을 하나 추가할 때 한쪽만 고치면 그
// 설정이 조용히 유실됐다(설정창 store.ts의 draftFromSettings/buildPayload와 같은 함정).
//
// options
//   fallback — 값이 undefined인 키에 쓸 "기존 설정". **넘기지 않으면 그 규칙 자체가 없고**
//     모든 키가 입력값만 보고 정해진다(파일 로드/백업 복원). 설정창 저장은 이전 설정을
//     넘겨서, 설정창에 입력이 없는 4개 키(language·autoStartEnabled·customizationPresets·
//     translateTargetLanguage)가 저장할 때마다 기본값으로 되돌아가지 않게 한다.
//   assistantKeyConfigured — false면 API 키가 없다는 뜻이라 assistantEnabled를 강제로 끈다.
//
// 알람 제목·즐겨찾기 이름·프리셋 이름의 **기본 문구**는 이 함수가 정한 language로 만든다
// (사용자가 직접 넣은 값이 비어 있을 때만 쓰인다).
// fallback에서 실제로 읽는 건 이 4개 키뿐이라 온전한 Settings일 필요는 없다.
// 네 키 모두 fallback에 없으면 fallback을 안 준 것과 같은 규칙으로 정해진다.
// 단 language를 뺀 셋은 **정규화 없이 그대로 통과**한다 — fallback으로는 직전 정규화
// 결과를 넘긴다는 전제다(main.js가 그렇게 쓴다).
type NormalizeSettingsFallback = {
  language?: string;
  autoStartEnabled?: boolean;
  customizationPresets?: unknown;
  translateTargetLanguage?: string;
};

type NormalizeSettingsOptions = {
  fallback?: NormalizeSettingsFallback;
  assistantKeyConfigured?: boolean;
};

function normalizeSettings(sourceValue: unknown, options: NormalizeSettingsOptions = {}): Settings {
  const source = sourceValue as Record<string, unknown>;
  const fallback = options.fallback;
  const assistantKeyConfigured = options.assistantKeyConfigured !== false;
  // `fallback.X !== undefined`를 함께 본다: fallback을 줬는데 그 키가 비어 있으면
  // 예전에는 결과 키가 undefined가 됐다(설정 하나가 통째로 사라진 값이 된다).
  // 그럴 땐 fallback이 없는 것과 똑같이 평소 규칙을 쓴다. 값이 있는 경우의 동작은 그대로다.
  const language = fallback && source.language === undefined && fallback.language !== undefined
    ? fallback.language
    : normalizeSettingsLanguage(source.language);
  return {
    language,
    alarms: normalizeAlarms(source.alarms, language),
    petScalePercent: clampScale(source.petScalePercent),
    tailSpeedPercent: clampTailSpeed(source.tailSpeedPercent),
    shadingEnabled: source.shadingEnabled !== false,
    pixelArtPercent: clampPixelArtPercent(source.pixelArtPercent),
    paletteEnabled: source.paletteEnabled === true,
    palettePreset: normalizePalettePreset(source.palettePreset),
    paletteSteps: clampPaletteSteps(source.paletteSteps),
    paletteCustomStops: normalizePaletteCustomStops(source.paletteCustomStops),
    ditherPattern: normalizeDitherPattern(source.ditherPattern),
    ditherAmount: clampDitherAmount(source.ditherAmount),
    outlineEnabled: source.outlineEnabled === true,
    outlineColor: normalizeOutlineColor(source.outlineColor),
    outlineThickness: clampOutlineThickness(source.outlineThickness),
    lineWobbleEnabled: source.lineWobbleEnabled === true,
    lineWobbleFrequency: clampLineWobbleFrequency(source.lineWobbleFrequency),
    lineWobbleSpeed: clampLineWobbleSpeed(source.lineWobbleSpeed),
    lineWobbleAmount: clampLineWobbleAmount(source.lineWobbleAmount),
    mouseSquishEnabled: source.mouseSquishEnabled !== false,
    keyboardSquishEnabled: source.keyboardSquishEnabled !== false,
    squishStrengthPercent: clampSquishStrength(source.squishStrengthPercent),
    keyboardClickEnabled: source.keyboardClickEnabled === true,
    keyboardClickSound: clampClickSound(source.keyboardClickSound, DEFAULT_SETTINGS.keyboardClickSound),
    keyboardClickVolume: clampClickVolume(source.keyboardClickVolume, DEFAULT_SETTINGS.keyboardClickVolume),
    keyboardClickMinPitch: Math.min(
      clampClickPitch(source.keyboardClickMinPitch, DEFAULT_SETTINGS.keyboardClickMinPitch),
      clampClickPitch(source.keyboardClickMaxPitch, DEFAULT_SETTINGS.keyboardClickMaxPitch)
    ),
    keyboardClickMaxPitch: Math.max(
      clampClickPitch(source.keyboardClickMinPitch, DEFAULT_SETTINGS.keyboardClickMinPitch),
      clampClickPitch(source.keyboardClickMaxPitch, DEFAULT_SETTINGS.keyboardClickMaxPitch)
    ),
    mouseClickEnabled: source.mouseClickEnabled === true,
    mouseClickSound: clampClickSound(source.mouseClickSound, DEFAULT_SETTINGS.mouseClickSound),
    mouseClickVolume: clampClickVolume(source.mouseClickVolume, DEFAULT_SETTINGS.mouseClickVolume),
    mouseClickMinPitch: Math.min(
      clampClickPitch(source.mouseClickMinPitch, DEFAULT_SETTINGS.mouseClickMinPitch),
      clampClickPitch(source.mouseClickMaxPitch, DEFAULT_SETTINGS.mouseClickMaxPitch)
    ),
    mouseClickMaxPitch: Math.max(
      clampClickPitch(source.mouseClickMinPitch, DEFAULT_SETTINGS.mouseClickMinPitch),
      clampClickPitch(source.mouseClickMaxPitch, DEFAULT_SETTINGS.mouseClickMaxPitch)
    ),
    headPettingEnabled: source.headPettingEnabled !== false,
    capsLockAlertEnabled: source.capsLockAlertEnabled !== false,
    sleepEnabled: source.sleepEnabled !== false,
    sleepAfterMinutes: clampSleepMinutes(source.sleepAfterMinutes),
    dragReactionEnabled: source.dragReactionEnabled !== false,
    idleRoutineEnabled: source.idleRoutineEnabled !== false,
    idleRoutineMinSeconds: Math.min(
      clampIdleRoutineSeconds(source.idleRoutineMinSeconds, DEFAULT_SETTINGS.idleRoutineMinSeconds),
      clampIdleRoutineSeconds(source.idleRoutineMaxSeconds, DEFAULT_SETTINGS.idleRoutineMaxSeconds)
    ),
    idleRoutineMaxSeconds: Math.max(
      clampIdleRoutineSeconds(source.idleRoutineMinSeconds, DEFAULT_SETTINGS.idleRoutineMinSeconds),
      clampIdleRoutineSeconds(source.idleRoutineMaxSeconds, DEFAULT_SETTINGS.idleRoutineMaxSeconds)
    ),
    fullscreenDndEnabled: source.fullscreenDndEnabled === true,
    petDragMode: normalizePetDragMode(source.petDragMode),
    bubbleTheme: normalizeBubbleTheme(source.bubbleTheme),
    bubbleThemeCustomBg: normalizeHexColor(source.bubbleThemeCustomBg, DEFAULT_SETTINGS.bubbleThemeCustomBg),
    bubbleThemeCustomAccent: normalizeHexColor(source.bubbleThemeCustomAccent, DEFAULT_SETTINGS.bubbleThemeCustomAccent),
    bubbleThemeCustomText: normalizeHexColor(source.bubbleThemeCustomText, DEFAULT_SETTINGS.bubbleThemeCustomText),
    uiScalePercent: clampUiScalePercent(source.uiScalePercent),
    uiFontSizePercent: clampUiFontSizePercent(source.uiFontSizePercent),
    uiFontEnabled: source.uiFontEnabled === true,
    uiFontPreset: normalizeUiFontPreset(source.uiFontPreset),
    soundEnabled: source.soundEnabled !== false,
    // 설정창에 입력이 없는 키 — fallback을 준 호출(설정창 저장)에서는 이전 값을 유지한다.
    autoStartEnabled: fallback && source.autoStartEnabled === undefined && fallback.autoStartEnabled !== undefined
      ? fallback.autoStartEnabled
      : source.autoStartEnabled === true,
    updateNotifyEnabled: source.updateNotifyEnabled !== false,
    weatherCity: normalizeOptionalLine(source.weatherCity, 60),
    trayMenuItems: normalizeTrayMenuItems(source.trayMenuItems),
    assistantEnabled: source.assistantEnabled === true && assistantKeyConfigured,
    animaleseEnabled: source.animaleseEnabled === true,
    animaleseIntervalMs: clampAnimaleseInterval(source.animaleseIntervalMs),
    animalesePitchPercent: clampAnimalesePitch(source.animalesePitchPercent),
    animalesePetChatEnabled: source.animalesePetChatEnabled === true,
    animaleseSoundStyle: normalizeAnimaleseSoundStyle(source.animaleseSoundStyle),
    alarmSound: normalizeAlarmSound(source.alarmSound),
    assistantGeminiModel: normalizeAssistantModel(
      source.assistantGeminiModel,
      DEFAULT_SETTINGS.assistantGeminiModel
    ),
    assistantShortcut: normalizeAssistantShortcut(source.assistantShortcut),
    assistantShortcutEnabled: source.assistantShortcutEnabled !== false,
    assistantPersonality: normalizeAssistantPersonality(source.assistantPersonality),
    assistantCustomPersonality: normalizeOptionalLine(source.assistantCustomPersonality, 300),
    assistantMemoryEnabled: source.assistantMemoryEnabled === true,
    assistantMemoryTurns: clampAssistantMemoryTurns(source.assistantMemoryTurns),
    memoryTabVisible: source.memoryTabVisible === true,
    assistantUserNickname: normalizeOptionalLine(source.assistantUserNickname, 40),
    assistantPetNickname: normalizeOptionalLine(source.assistantPetNickname, 40),
    petChatEnabled: source.petChatEnabled === true,
    petChatMinMinutes: Math.min(
      clampPetChatMinutes(source.petChatMinMinutes, DEFAULT_SETTINGS.petChatMinMinutes),
      clampPetChatMinutes(source.petChatMaxMinutes, DEFAULT_SETTINGS.petChatMaxMinutes)
    ),
    petChatMaxMinutes: Math.max(
      clampPetChatMinutes(source.petChatMinMinutes, DEFAULT_SETTINGS.petChatMinMinutes),
      clampPetChatMinutes(source.petChatMaxMinutes, DEFAULT_SETTINGS.petChatMaxMinutes)
    ),
    pettingChatEnabled: source.pettingChatEnabled === true,
    favoritesEnabled: source.favoritesEnabled === true,
    favoritesShortcut: normalizeFavoritesShortcut(source.favoritesShortcut),
    favoritesShortcutEnabled: source.favoritesShortcutEnabled !== false,
    favoritesTrayItemsEnabled: source.favoritesTrayItemsEnabled === true,
    favoritesDisplayMode: normalizeFavoritesDisplayMode(source.favoritesDisplayMode),
    favoritesLayout: normalizeFavoritesLayout(source.favoritesLayout),
    favoriteGridLabelsHidden: normalizeFavoriteGridLabelsHidden(source.favoriteGridLabelsHidden),
    favoriteItems: normalizeFavoriteItems(source.favoriteItems, language),
    facePattern: normalizeFacePatternIndex(source.facePattern),
    faceCosmetic: normalizeFaceCosmeticIndex(source.faceCosmetic),
    faceEyeStyle: normalizeFaceEyeStyleIndex(source.faceEyeStyle),
    faceMouthStyle: normalizeFaceMouthStyleIndex(source.faceMouthStyle),
    customFaceEnabled: source.customFaceEnabled === true,
    bodyCostume: normalizeBodyCostumeIndex(source.bodyCostume),
    customBodyEnabled: source.customBodyEnabled === true,
    bodyColors: normalizeBodyColors(source.bodyColors),
    partVariations: normalizePartVariations(source.partVariations),
    // 프리셋은 커스터마이징 탭의 저장/취소와 무관하게 별도 IPC(즉시 저장)로 관리된다.
    // 설정창 payload에는 없으므로, 저장 버튼을 누를 때마다 목록이 날아가지 않도록
    // fallback이 있으면 기존 목록을 그대로 유지한다.
    customizationPresets: fallback && source.customizationPresets === undefined && fallback.customizationPresets !== undefined
      ? fallback.customizationPresets as Settings["customizationPresets"]
      : normalizeCustomizationPresets(source.customizationPresets, language),
    lighting: normalizeLighting(source.lighting),
    imageResizeShortcut: normalizeImageResizeShortcut(source.imageResizeShortcut),
    imageResizeShortcutEnabled: source.imageResizeShortcutEnabled !== false,
    checklistShortcut: normalizeChecklistShortcut(source.checklistShortcut),
    checklistShortcutEnabled: source.checklistShortcutEnabled !== false,
    translateShortcut: normalizeTranslateShortcut(source.translateShortcut),
    translateShortcutEnabled: source.translateShortcutEnabled !== false,
    // 설정창에는 이 값을 고르는 입력이 없다(최근 사용 언어를 자동으로 기억하는 방식,
    // translate:run 핸들러 참고) — fallback이 있으면 이전 값을 그대로 유지한다.
    translateTargetLanguage: fallback && source.translateTargetLanguage === undefined && fallback.translateTargetLanguage !== undefined
      ? fallback.translateTargetLanguage
      : normalizeTranslateLanguage(source.translateTargetLanguage),
    translatePreferClipboard: source.translatePreferClipboard !== false,
    documentSummaryShortcut: normalizeDocumentSummaryShortcut(source.documentSummaryShortcut),
    documentSummaryShortcutEnabled: source.documentSummaryShortcutEnabled !== false,
    documentSummaryTheme: normalizeDocumentSummaryTheme(source.documentSummaryTheme),
    imageResizeFilter: normalizeImageResizeFilter(source.imageResizeFilter),
    imageResizeScale: normalizeImageResizeScale(source.imageResizeScale),
    mediaPlayer: normalizeMediaPlayer(source.mediaPlayer)
  };
}

export {
  FAVORITE_ITEM_LIMIT,
  FACE_PATTERN_COUNT,
  FACE_COSMETIC_COUNT,
  FACE_EYE_STYLE_COUNT,
  FACE_MOUTH_STYLE_COUNT,
  BODY_COSTUME_COUNT,
  ANIMALESE_SOUND_STYLE_COUNT,
  ALARM_SOUND_COUNT,
  BODY_COLOR_DEFS,
  PART_VARIATION_DEFS,
  LIGHTING_DEFS,
  DEFAULT_SETTINGS,
  TRANSLATE_LANGUAGES,
  clampScale,
  clampTailSpeed,
  clampPixelArtPercent,
  normalizePalettePreset,
  clampPaletteSteps,
  normalizePaletteCustomStops,
  DITHER_PATTERNS,
  normalizeDitherPattern,
  clampDitherAmount,
  normalizeOutlineColor,
  normalizeOptionalOutlineColor,
  clampOutlineThickness,
  clampLineWobbleFrequency,
  clampLineWobbleSpeed,
  clampLineWobbleAmount,
  clampSquishStrength,
  clampAnimaleseInterval,
  clampAssistantMemoryTurns,
  clampPetChatMinutes,
  clampAnimalesePitch,
  clampClickVolume,
  clampClickPitch,
  clampClickSound,
  clampIdleRoutineSeconds,
  normalizeUiFontPreset,
  normalizeBubbleTheme,
  normalizeHexColor,
  clampUiScalePercent,
  clampUiFontSizePercent,
  normalizeText,
  normalizeOptionalLine,
  normalizeAssistantModel,
  isValidGlobalAccelerator,
  isMouseShortcut,
  normalizeGlobalShortcut,
  formatShortcutLabel,
  normalizeAssistantShortcut,
  assistantShortcutLabel,
  normalizeFavoritesShortcut,
  favoritesShortcutLabel,
  normalizeImageResizeShortcut,
  imageResizeShortcutLabel,
  normalizeTranslateLanguage,
  normalizeTranslateShortcut,
  translateShortcutLabel,
  normalizeDocumentSummaryShortcut,
  documentSummaryShortcutLabel,
  normalizeDocumentSummaryTheme,
  normalizeChecklistShortcut,
  checklistShortcutLabel,
  normalizeImageResizeFilter,
  normalizeImageResizeScale,
  normalizeFavoriteItems,
  normalizeFavoritesDisplayMode,
  normalizeAssistantPersonality,
  normalizeFacePatternIndex,
  normalizeFaceCosmeticIndex,
  normalizeBodyCostumeIndex,
  normalizeFaceEyeStyleIndex,
  clampSleepMinutes,
  normalizePetDragMode,
  normalizeSettingsLanguage,
  normalizeAnimaleseSoundStyle,
  normalizeAlarmSound,
  normalizeFaceMouthStyleIndex,
  normalizeBodyColors,
  normalizePartVariations,
  generatePresetId,
  normalizeCustomizationPreset,
  normalizeCustomizationPresets,
  getDefaultCustomizationPresets,
  normalizeLighting,
  normalizeMediaPlayer,
  normalizeAlarm,
  normalizeAlarms,
  normalizeAlarmSoundFilePath,
  normalizeTrayMenuItems,
  normalizeFavoritesLayout,
  normalizeFavoriteGridLabelsHidden,
  migrateLegacySettings,
  normalizeSettings
};

export type {
  AlarmCommon,
  DailyAlarm,
  FavoriteItem,
  HourlyAlarm,
  IntervalAlarm,
  NormalizedAlarm,
  NormalizeSettingsFallback,
  NormalizeSettingsOptions,
  OnceAlarm,
  Settings
};
