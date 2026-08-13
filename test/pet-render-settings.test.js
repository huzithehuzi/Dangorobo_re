// @ts-check
// 설정에서 파생되는 렌더 값. 클램프와 기본값 규칙이 전부 순수 함수라 Node에서 검증한다.
//
// 특히 "설정이 없을 때의 값"은 기존 사용자의 화면을 바꾸지 않기 위한 계약이다 — 분해 전
// 렌더러의 초기값과 한 글자도 달라지면 안 된다.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPetRenderSettings,
  derivePetRenderSettings,
  BASE_PET_SCALE
} = require("../src/pet/pet-render-settings.js");

/** 분해 전 renderer.ts의 모듈 전역 초기값 그대로. */
const RENDERER_INITIAL_VALUES = {
  petBaseScale: BASE_PET_SCALE,
  tailSpeedMultiplier: 1,
  mouseSquishEnabled: true,
  keyboardSquishEnabled: true,
  squishStrengthPercent: 9,
  animaleseEnabled: false,
  animaleseIntervalMs: 45,
  animalesePetChatEnabled: false,
  capsLockAlertEnabled: true,
  sleepEnabled: true,
  dragReactionEnabled: true,
  idleRoutineEnabled: true,
  idleRoutineMinGapMs: 18000,
  idleRoutineMaxGapMs: 42000,
  mediaNodEnabled: true,
  mediaVerticalOffset: 8
};

test("설정이 없으면 분해 전 렌더러의 초기값과 정확히 같다", () => {
  // null·undefined·빈 객체 셋 다 같은 기본값이어야 한다.
  for (const input of [null, undefined, {}]) {
    assert.deepEqual(
      derivePetRenderSettings(/** @type {any} */ (input)),
      RENDERER_INITIAL_VALUES,
      `입력 ${JSON.stringify(input)}`
    );
  }
});

test("펫 크기와 꼬리 속도는 퍼센트를 배율로 바꾸고 범위를 자른다", () => {
  const at = (/** @type {any} */ value) => derivePetRenderSettings(value);

  assert.equal(at({ petScalePercent: 100 }).petBaseScale, BASE_PET_SCALE);
  assert.equal(at({ petScalePercent: 50 }).petBaseScale, BASE_PET_SCALE * 0.5);
  // 30~130 밖은 잘린다.
  assert.equal(at({ petScalePercent: 5 }).petBaseScale, BASE_PET_SCALE * 0.3);
  assert.equal(at({ petScalePercent: 999 }).petBaseScale, BASE_PET_SCALE * 1.3);

  assert.equal(at({ tailSpeedPercent: 200 }).tailSpeedMultiplier, 2);
  assert.equal(at({ tailSpeedPercent: 1 }).tailSpeedMultiplier, 0.25);
  assert.equal(at({ tailSpeedPercent: 9999 }).tailSpeedMultiplier, 3.5);
});

/**
 * 한 키만 담은 설정으로 파생한 뒤 그 키의 값을 읽는다.
 * @param {string} key @param {unknown} value @returns {unknown}
 */
function deriveOne(key, value) {
  const snapshot = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (derivePetRenderSettings(/** @type {any} */ ({ [key]: value })))
  );
  return snapshot[key];
}

test("기본 켜짐인 항목은 false일 때만 꺼진다", () => {
  const keys = [
    "mouseSquishEnabled", "keyboardSquishEnabled", "capsLockAlertEnabled",
    "sleepEnabled", "dragReactionEnabled", "idleRoutineEnabled"
  ];
  for (const key of keys) {
    assert.equal(deriveOne(key, false), false, key);
    // 값이 없거나 이상해도 켜진 채로 둔다(기존 동작 유지).
    assert.equal(deriveOne(key, undefined), true, key);
    assert.equal(deriveOne(key, 0), true, key);
  }
});

test("기본 꺼짐인 항목은 정확히 true일 때만 켜진다", () => {
  for (const key of ["animaleseEnabled", "animalesePetChatEnabled"]) {
    assert.equal(deriveOne(key, true), true, key);
    assert.equal(deriveOne(key, 1), false, key);
    assert.equal(deriveOne(key, "yes"), false, key);
  }
});

test("스퀴시 세기와 애니메이즈 간격은 각자의 범위로 잘린다", () => {
  const at = (/** @type {any} */ value) => derivePetRenderSettings(value);
  assert.equal(at({ squishStrengthPercent: 20 }).squishStrengthPercent, 20);
  assert.equal(at({ squishStrengthPercent: 1 }).squishStrengthPercent, 5);
  assert.equal(at({ squishStrengthPercent: 999 }).squishStrengthPercent, 35);

  assert.equal(at({ animaleseIntervalMs: 100 }).animaleseIntervalMs, 100);
  assert.equal(at({ animaleseIntervalMs: 1 }).animaleseIntervalMs, 20);
  assert.equal(at({ animaleseIntervalMs: 999 }).animaleseIntervalMs, 150);
});

test("유휴 루틴 간격은 초를 ms로 바꾸고 최소·최대가 뒤집혀도 바로잡는다", () => {
  const normal = derivePetRenderSettings(/** @type {any} */ ({
    idleRoutineMinSeconds: 10,
    idleRoutineMaxSeconds: 30
  }));
  assert.equal(normal.idleRoutineMinGapMs, 10000);
  assert.equal(normal.idleRoutineMaxGapMs, 30000);

  // 저장값이 뒤집혀 있어도 좁은 쪽을 최소로 쓴다.
  const swapped = derivePetRenderSettings(/** @type {any} */ ({
    idleRoutineMinSeconds: 30,
    idleRoutineMaxSeconds: 10
  }));
  assert.equal(swapped.idleRoutineMinGapMs, 10000);
  assert.equal(swapped.idleRoutineMaxGapMs, 30000);

  // 5~300초 밖은 잘린다.
  const clamped = derivePetRenderSettings(/** @type {any} */ ({
    idleRoutineMinSeconds: 1,
    idleRoutineMaxSeconds: 9999
  }));
  assert.equal(clamped.idleRoutineMinGapMs, 5000);
  assert.equal(clamped.idleRoutineMaxGapMs, 300000);
});

test("미디어 플레이어 값은 중첩 객체가 없어도 안전하게 기본값이 된다", () => {
  const at = (/** @type {any} */ value) => derivePetRenderSettings(value);
  assert.equal(at({ mediaPlayer: { nodEnabled: false } }).mediaNodEnabled, false);
  assert.equal(at({ mediaPlayer: {} }).mediaNodEnabled, true);
  assert.equal(at({ mediaPlayer: null }).mediaNodEnabled, true);

  assert.equal(at({ mediaPlayer: { verticalOffset: 30 } }).mediaVerticalOffset, 30);
  assert.equal(at({ mediaPlayer: { verticalOffset: -100 } }).mediaVerticalOffset, -20);
  assert.equal(at({ mediaPlayer: { verticalOffset: 999 } }).mediaVerticalOffset, 80);
  // 0은 유효한 값이므로 기본값 8로 되돌아가면 안 된다.
  assert.equal(at({ mediaPlayer: { verticalOffset: 0 } }).mediaVerticalOffset, 0);
  // 숫자가 아니면 기본값으로 돌아간다.
  assert.equal(at({ mediaPlayer: { verticalOffset: "abc" } }).mediaVerticalOffset, 8);
});

test("apply는 스냅샷을 통째로 갈아 끼우고 getter가 새 값을 준다", () => {
  const settings = createPetRenderSettings();
  assert.equal(settings.sleepEnabled, true);
  assert.equal(settings.squishStrengthPercent, 9);

  const applied = settings.apply(/** @type {any} */ ({ sleepEnabled: false, squishStrengthPercent: 30 }));
  assert.equal(settings.sleepEnabled, false);
  assert.equal(settings.squishStrengthPercent, 30);
  assert.equal(applied.sleepEnabled, false, "적용 결과도 같은 값을 돌려준다");

  // 일부만 담긴 설정을 넣으면 나머지는 기본값으로 되돌아간다(부분 병합이 아니다).
  settings.apply(/** @type {any} */ ({ squishStrengthPercent: 12 }));
  assert.equal(settings.sleepEnabled, true, "이전 적용값이 남지 않는다");
  assert.equal(settings.squishStrengthPercent, 12);
});

test("getter만 내보내고 세터는 없다", () => {
  const settings = createPetRenderSettings();
  const descriptor = Object.getOwnPropertyDescriptor(settings, "sleepEnabled");
  assert.ok(descriptor?.get, "getter로 노출한다");
  assert.equal(descriptor?.set, undefined, "세터를 내보내면 소유권이 갈린다");
});
