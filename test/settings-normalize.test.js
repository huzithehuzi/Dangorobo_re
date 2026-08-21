// @ts-check
// 설정 정규화 회귀 테스트 (2026-08-10).
// normalizeSettings()는 설정 키 106개의 유일한 기준이다. 예전에는 loadSettings()와
// settings:save 핸들러가 거의 같은 목록을 각자 들고 있어서 한쪽만 고치면 그 설정이
// 조용히 유실됐다 — 여기 테스트는 그 이중화가 다시 생기지 않게 잡아준다.
// Electron 없이 순수 Node로 실행된다: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

// settings-schema.js는 지원하지 않는 언어가 들어오면 app.getLocale()로 폴백한다.
// 모듈을 읽기 전에 그 한 함수만 쓰는 최소 스텁을 require 캐시에 넣어둔다.
const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getLocale: () => "en-US" } }
});

const {
  DEFAULT_SETTINGS,
  BODY_COLOR_DEFS,
  PART_VARIATION_DEFS,
  normalizeSettings,
  migrateLegacySettings
} = require("../src/main/settings-schema.js");

/** @returns {Record<string, any>} */
function defaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

/** 키 이름으로 훑어보기 위한 캐스트 — 스키마는 리터럴 타입이라 문자열 인덱싱이 막혀 있다. */
const defaultsByKey = /** @type {Record<string, any>} */ (/** @type {unknown} */ (DEFAULT_SETTINGS));

// 설정창에 입력이 없어서 payload에 실리지 않는 키 — fallback으로 이전 값을 지켜야 한다.
const FALLBACK_KEYS = ["language", "autoStartEnabled", "customizationPresets", "translateTargetLanguage"];

const SHIPPING_BODY_COLORS = [
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
];

test("기본값을 정규화하면 그대로 돌아온다", () => {
  assert.deepEqual(normalizeSettings(defaults()), DEFAULT_SETTINGS);
});

test("몸 색 카탈로그 기본값은 출하 기본값과 같다", () => {
  assert.deepEqual(DEFAULT_SETTINGS.bodyColors, SHIPPING_BODY_COLORS);
  assert.deepEqual(
    BODY_COLOR_DEFS.map((def) => ({ id: def.id, color: def.defaultColor })),
    SHIPPING_BODY_COLORS
  );
});

test("bodyColors가 없거나 손상되면 출하 기본값으로 되돌린다", () => {
  assert.deepEqual(normalizeSettings({}).bodyColors, DEFAULT_SETTINGS.bodyColors);
  assert.deepEqual(
    normalizeSettings({
      bodyColors: BODY_COLOR_DEFS.map((def) => ({ id: def.id, color: "invalid" }))
    }).bodyColors,
    DEFAULT_SETTINGS.bodyColors
  );
});

test("유효한 기존 bodyColors 저장값은 그대로 유지한다", () => {
  const storedColors = BODY_COLOR_DEFS.map((def, index) => ({
    id: def.id,
    color: `#${(index + 1).toString(16).padStart(6, "0")}`
  }));

  assert.notDeepEqual(storedColors, DEFAULT_SETTINGS.bodyColors);
  assert.deepEqual(normalizeSettings({ bodyColors: storedColors }).bodyColors, storedColors);
});

test("키 구성은 입력이 무엇이든 DEFAULT_SETTINGS와 정확히 같다", () => {
  const expected = Object.keys(DEFAULT_SETTINGS);
  assert.deepEqual(Object.keys(normalizeSettings({})), expected);
  assert.deepEqual(Object.keys(normalizeSettings(defaults())), expected);
  assert.deepEqual(
    Object.keys(normalizeSettings({ language: "zz", alarms: "nope", bodyColors: 3, lighting: null })),
    expected
  );
  assert.deepEqual(
    Object.keys(normalizeSettings({}, { fallback: DEFAULT_SETTINGS, assistantKeyConfigured: false })),
    expected
  );
});

// DEFAULT_SETTINGS는 "출하 시 펫 외형"이고, 일부 개별 정규화 함수의 폴백은 "값이 없을 때 쓰는
// 중립값"이라 이 8개 키는 서로 다르다. 의도된 차이지만 눈에 안 띄어서 여기 못박아둔다 —
// 이 목록이 달라지면 어느 쪽이 바뀐 건지 확인할 것.
const NEUTRAL_FALLBACK_KEYS = [
  "paletteEnabled", "outlineEnabled", "facePattern", "faceCosmetic",
  "bodyCostume", "partVariations", "customizationPresets", "fullscreenDndEnabled"
];

test("빈 입력도 모든 키를 채우고, 기본값과 다른 키는 알려진 8개뿐이다", () => {
  const normalized = /** @type {Record<string, any>} */ (normalizeSettings({}));
  const differing = [];
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    assert.notEqual(normalized[key], undefined, `${key}가 비어 있다`);
    if (key === "language") continue; // 지원 언어가 아니면 OS 로케일로 정해진다(스텁: en-US)
    if (JSON.stringify(normalized[key]) !== JSON.stringify(defaultsByKey[key])) differing.push(key);
  }
  assert.deepEqual(differing.sort(), [...NEUTRAL_FALLBACK_KEYS].sort());
});

test("fallback이 없으면 값이 없는 키도 입력만 보고 정해진다", () => {
  const normalized = normalizeSettings({});
  assert.equal(normalized.autoStartEnabled, false);
  assert.deepEqual(normalized.customizationPresets, []);
  assert.equal(normalized.translateTargetLanguage, DEFAULT_SETTINGS.translateTargetLanguage);
});

test("fallback이 있으면 설정창에 입력이 없는 키는 이전 값을 유지한다", () => {
  const previous = {
    ...defaults(),
    language: "ja",
    autoStartEnabled: true,
    translateTargetLanguage: "ko",
    customizationPresets: [{ id: "keep", name: "유지", settings: {} }]
  };
  const payload = defaults();
  for (const key of FALLBACK_KEYS) delete payload[key];

  const normalized = normalizeSettings(payload, { fallback: previous });
  assert.equal(normalized.language, "ja");
  assert.equal(normalized.autoStartEnabled, true);
  assert.equal(normalized.translateTargetLanguage, "ko");
  assert.deepEqual(normalized.customizationPresets, previous.customizationPresets);
});

test("fallback이 있어도 값이 들어오면 들어온 값을 쓴다", () => {
  const previous = { ...defaults(), language: "ja", autoStartEnabled: true, translateTargetLanguage: "ko" };
  const normalized = normalizeSettings(
    { ...defaults(), language: "en", autoStartEnabled: false, translateTargetLanguage: "ja", customizationPresets: [] },
    { fallback: previous }
  );
  assert.equal(normalized.language, "en");
  assert.equal(normalized.autoStartEnabled, false);
  assert.equal(normalized.translateTargetLanguage, "ja");
  assert.deepEqual(normalized.customizationPresets, []);
});

test("API 키가 없으면 assistantEnabled를 강제로 끈다", () => {
  const payload = { ...defaults(), assistantEnabled: true };
  assert.equal(normalizeSettings(payload, { assistantKeyConfigured: false }).assistantEnabled, false);
  assert.equal(normalizeSettings(payload, { assistantKeyConfigured: true }).assistantEnabled, true);
  assert.equal(normalizeSettings(payload).assistantEnabled, true); // 기본값: 게이트하지 않음
});

test("기본 문구는 전역 언어가 아니라 정규화 결과 언어를 따른다", () => {
  const alarm = { id: "a1", type: "daily", dailyTime: "09:00", title: "", message: "", enabled: true };
  const korean = normalizeSettings({ language: "ko", alarms: [alarm] });
  const english = normalizeSettings({ language: "en", alarms: [alarm] });
  const koreanAlarm = korean.alarms[0];
  const englishAlarm = english.alarms[0];
  assert.ok(koreanAlarm, "한국어 알람이 정규화에서 걸러졌다");
  assert.ok(englishAlarm, "영어 알람이 정규화에서 걸러졌다");
  assert.notEqual(koreanAlarm.title, englishAlarm.title);
  assert.ok(String(koreanAlarm.title).length > 0);
});

test("정시 알람은 간격을 1~12시간으로 클램프하고 빠졌으면 1로 채운다", () => {
  const alarms = [
    { id: "a1", type: "hourly", hourlyInterval: 3 },
    { id: "a2", type: "hourly", hourlyInterval: 99 },
    { id: "a3", type: "hourly", hourlyInterval: 0 },
    { id: "a4", type: "hourly" },
    { id: "a5", type: "hourly", hourlyInterval: "이상한 값" },
    { id: "a6", type: "hourly", hourlyInterval: 2.4, enabled: false }
  ];
  // 종류별 유니온이라 필드 접근에 좁히기가 필요하다 — 여기서 보는 것은 정규화 결과의
  // 모양뿐이므로 레코드로 읽는다.
  const normalized = /** @type {Record<string, unknown>[]} */ (
    /** @type {unknown} */ (normalizeSettings({ language: "ko", alarms }).alarms)
  );
  assert.deepEqual(normalized.map((alarm) => alarm.hourlyInterval), [3, 12, 1, 1, 1, 2]);
  // enabled를 안 준 알람은 켜진 것으로 본다(다른 반복 알람과 같은 규칙).
  assert.deepEqual(normalized.map((alarm) => alarm.enabled), [true, true, true, true, true, false]);
  // 다른 종류의 필드는 섞여 들어가지 않는다.
  assert.equal(normalized[0].intervalMinutes, undefined);
  assert.equal(normalized[0].dailyTime, undefined);
});

test("범위 밖 숫자는 클램프하고 min/max가 뒤집히면 바로잡는다", () => {
  const normalized = normalizeSettings({
    petScalePercent: 99999,
    tailSpeedPercent: -1,
    keyboardClickMinPitch: 200,
    keyboardClickMaxPitch: 10,
    idleRoutineMinSeconds: 500,
    idleRoutineMaxSeconds: 1,
    petChatMinMinutes: 99,
    petChatMaxMinutes: 1
  });
  assert.ok(normalized.keyboardClickMinPitch <= normalized.keyboardClickMaxPitch);
  assert.ok(normalized.idleRoutineMinSeconds <= normalized.idleRoutineMaxSeconds);
  assert.ok(normalized.petChatMinMinutes <= normalized.petChatMaxMinutes);
  assert.ok(Number.isFinite(normalized.petScalePercent));
  assert.notEqual(normalized.petScalePercent, 99999);
  assert.ok(normalized.tailSpeedPercent > 0);
});

test("타입이 완전히 틀린 값도 기본값으로 되돌린다", () => {
  const normalized = normalizeSettings({
    alarms: "nope",
    favoriteItems: {},
    bodyColors: 3,
    partVariations: "x",
    lighting: null,
    mediaPlayer: [],
    trayMenuItems: 0,
    customizationPresets: 7
  });
  assert.deepEqual(normalized.alarms, []);
  assert.deepEqual(normalized.favoriteItems, []);
  assert.deepEqual(normalized.customizationPresets, []);
  assert.deepEqual(normalized.bodyColors, DEFAULT_SETTINGS.bodyColors);
  assert.deepEqual(
    normalized.partVariations,
    PART_VARIATION_DEFS.map((def) => ({ id: def.id, variation: def.defaultVariation }))
  );
  assert.deepEqual(normalized.lighting, DEFAULT_SETTINGS.lighting);
  assert.deepEqual(normalized.mediaPlayer, DEFAULT_SETTINGS.mediaPlayer);
  assert.deepEqual(normalized.trayMenuItems, DEFAULT_SETTINGS.trayMenuItems);
});

test("레거시 pixelArtEnabled를 pixelArtPercent로 옮긴다", () => {
  assert.equal(normalizeSettings(migrateLegacySettings({ pixelArtEnabled: true })).pixelArtPercent, 80);
  assert.equal(normalizeSettings(migrateLegacySettings({ pixelArtEnabled: false })).pixelArtPercent, 0);
  // 새 키가 이미 있으면 그쪽이 우선이다.
  assert.equal(
    normalizeSettings(migrateLegacySettings({ pixelArtEnabled: true, pixelArtPercent: 30 })).pixelArtPercent,
    30
  );
});

test("폐기된 모델 id는 기본 모델로 되돌린다", () => {
  const migrated = migrateLegacySettings({ assistantGeminiModel: "gemini-3.6-flash" });
  assert.equal(
    normalizeSettings(migrated).assistantGeminiModel,
    DEFAULT_SETTINGS.assistantGeminiModel
  );
});

test("migrateLegacySettings는 원본 객체를 건드리지 않는다", () => {
  const stored = { pixelArtEnabled: true, assistantGeminiModel: "gemini-3.6-flash" };
  migrateLegacySettings(stored);
  assert.deepEqual(stored, { pixelArtEnabled: true, assistantGeminiModel: "gemini-3.6-flash" });
});

test("저장-로드 왕복: 정규화 결과를 다시 정규화해도 같다", () => {
  const once = normalizeSettings({
    language: "ko",
    petScalePercent: 137,
    paletteEnabled: true,
    alarms: [{ id: "a1", type: "interval", intervalMinutes: 45, title: "물 마시기", message: "" }],
    favoriteItems: [{ id: "f1", name: "메모장", target: "C:/Windows/notepad.exe" }]
  });
  const twice = normalizeSettings(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test("프리셋의 외곽선 색은 정규화되고, 없거나 잘못된 값은 빈 문자열로 남는다", () => {
  const normalized = /** @type {any[]} */ (normalizeSettings({
    customizationPresets: [
      { id: "a", name: "가", outlineColor: "#AABBCC" },
      { id: "b", name: "나", outlineColor: "빨강" },
      { id: "c", name: "다" }
    ]
  }).customizationPresets);
  // 빈 문자열은 "이 프리셋은 외곽선 색을 바꾸지 않는다"는 뜻이라 기본값(#000000)으로 채우지 않는다.
  assert.deepEqual(normalized.map((preset) => preset.outlineColor), ["#aabbcc", "", ""]);
});
