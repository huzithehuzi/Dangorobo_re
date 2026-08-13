// @ts-check
// 설정창(ui/settings)과 main의 설정 스키마가 어긋나지 않게 잡는 정적 가드 (2026-08-10).
//
// 설정 하나를 추가할 때 고쳐야 할 곳이 세 군데다:
//   1) settings-schema.js의 DEFAULT_SETTINGS + normalizeSettings()  ← 이건 이제 한 벌
//   2) ui/settings/store.ts의 draftFromSettings()  — 안 고치면 설정창이 값을 못 읽는다
//   3) ui/settings/store.ts의 buildPayload()       — 안 고치면 저장할 때 값이 유실된다
// 3번을 빠뜨리면 아무 에러 없이 조용히 설정이 사라져서 발견이 늦다. 여기서 소스를
// 문자열로 훑어 키가 빠졌는지 확인한다(설정창은 React/TS라 Node 테스트에서 실행할 수 없다).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getLocale: () => "en-US" } }
});

const { DEFAULT_SETTINGS, normalizeSettings } = require("../src/main/settings-schema.js");

const repoRoot = path.join(__dirname, "..");
const storeSource = fs.readFileSync(path.join(repoRoot, "ui/settings/store.ts"), "utf8");
const appSource = fs.readFileSync(path.join(repoRoot, "ui/settings/App.tsx"), "utf8");
// 외형·커스터마이징 키는 셸이 아니라 이 훅이 읽는다.
const customizationSource = fs.readFileSync(
  path.join(repoRoot, "ui/settings/use-customization-state.ts"), "utf8"
);

/** @param {string} source @param {string} marker @returns {string} */
function sectionFrom(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} 를 찾지 못했다 — 함수 이름이 바뀌었는지 확인할 것`);
  return source.slice(start);
}

// 설정창에 입력 자체가 없어서 payload에 싣지 않는 키. main의 settings:save가
// previousSettings를 fallback으로 넘겨 이전 값을 유지한다(normalizeSettings 참고).
const NOT_IN_PAYLOAD = ["autoStartEnabled", "customizationPresets", "translateTargetLanguage"];

// 설정창이 폼 draft로 읽지 않는 키. autoStartEnabled는 트레이 메뉴에서만 바꾸고,
// translateTargetLanguage는 최근 사용 언어를 자동으로 기억한다(translate:run 핸들러).
const NOT_READ_BY_SETTINGS_WINDOW = ["autoStartEnabled", "translateTargetLanguage"];

test("buildPayload가 DEFAULT_SETTINGS의 모든 키를 담는다", () => {
  const payloadSection = sectionFrom(storeSource, "export function buildPayload");
  const faceSection = sectionFrom(storeSource, "export function faceCustomizationPayload");
  // 얼굴/몸 커스터마이징 키는 faceCustomizationPayload()를 spread해서 들어간다.
  assert.match(payloadSection, /\.\.\.faceCustomizationPayload\(d\)/);
  const searchable = payloadSection + faceSection;

  const missing = Object.keys(DEFAULT_SETTINGS).filter(
    (key) => !new RegExp(`^\\s*${key}:`, "m").test(searchable)
  );
  assert.deepEqual(
    missing.sort(),
    [...NOT_IN_PAYLOAD].sort(),
    "buildPayload()에 없는 키는 저장할 때 유실된다 — store.ts를 함께 고칠 것"
  );
});

test("설정창이 DEFAULT_SETTINGS의 모든 키를 읽는다", () => {
  // 스칼라는 store.ts의 draftFromSettings(), 목록/색 같은 복합 상태는 App.tsx의 applyLoaded()와
  // use-customization-state.ts의 applyFromSettings()가 나눠 읽는다.
  const draftSection = storeSource.slice(
    storeSource.indexOf("export function draftFromSettings"),
    storeSource.indexOf("export interface ComplexState")
  );
  assert.ok(draftSection.length > 0, "draftFromSettings 구간을 찾지 못했다");
  const applySection = sectionFrom(appSource, "const applyLoaded = useCallback");
  const customizationSection = sectionFrom(customizationSource, "const applyFromSettings = useCallback");
  const searchable = draftSection + applySection + customizationSection;

  const missing = Object.keys(DEFAULT_SETTINGS).filter(
    (key) => !new RegExp(`\\.${key}\\b`).test(searchable)
  );
  assert.deepEqual(
    missing.sort(),
    [...NOT_READ_BY_SETTINGS_WINDOW].sort(),
    "설정창이 읽지 않는 키는 저장 시 기본값으로 되돌아갈 수 있다 — store.ts/App.tsx를 함께 고칠 것"
  );
});

test("payload에 없는 키는 실제로 이전 값이 유지된다", () => {
  // 위 목록이 그냥 예외 처리로 남지 않도록, main 쪽 동작으로도 확인한다.
  const previous = {
    ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    autoStartEnabled: true,
    translateTargetLanguage: "ja",
    customizationPresets: [{ id: "keep", name: "유지", settings: {} }]
  };
  const payload = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const key of NOT_IN_PAYLOAD) delete payload[key];

  const saved = /** @type {Record<string, any>} */ (normalizeSettings(payload, { fallback: previous }));
  for (const key of NOT_IN_PAYLOAD) {
    assert.deepEqual(saved[key], previous[key], `${key}가 저장할 때 초기화됐다`);
  }
});

test("설정창의 즐겨찾기 개수 상한이 main과 같다", () => {
  const { FAVORITE_ITEM_LIMIT } = require("../src/main/settings-schema.js");
  const match = storeSource.match(/export const FAVORITE_ITEM_LIMIT = (\d+);/);
  assert.ok(match, "store.ts에서 FAVORITE_ITEM_LIMIT를 찾지 못했다");
  assert.equal(
    Number(match[1]),
    FAVORITE_ITEM_LIMIT,
    "설정창이 main보다 많이 저장하면 잘려나가고, 적게 저장하면 항목이 사라진다"
  );
});
