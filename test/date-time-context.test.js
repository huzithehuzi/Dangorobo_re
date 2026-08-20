"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  currentDateTimeContext,
  formatUtcOffset
} = require("../src/main/assistant/date-time-context.js");

test("UTC 오프셋을 부호와 시·분까지 고정된 형식으로 만든다", () => {
  assert.equal(formatUtcOffset(0), "UTC+00:00");
  assert.equal(formatUtcOffset(330), "UTC+05:30");
  assert.equal(formatUtcOffset(-480), "UTC-08:00");
  assert.equal(formatUtcOffset(-30), "UTC-00:30");
});

test("현재 시각 문맥에 로컬 시각·시간대·UTC를 모두 넣는다", () => {
  const now = new Date(2026, 7, 11, 13, 4, 5, 123);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "시스템 현지 시간대";
  const context = currentDateTimeContext(now, "ko");

  assert.match(context, /^현재 PC 기준 날짜·시각: /);
  assert.ok(context.includes("2026년 8월 11일"));
  assert.ok(context.includes(
    `현재 PC 시간대: ${timeZone} (${formatUtcOffset(-now.getTimezoneOffset())})`
  ));
  assert.ok(context.includes(`UTC 기준 시각: ${now.toISOString()}`));
});

// 이 블록만 한국어로 남아 있으면, 참고할 사용자 언어가 없는 상황(펫이 먼저 말을 거는
// 부르기·쓰다듬기·자동 말걸기)에서 모델이 프롬프트에 섞인 이 한국어를 보고 한국어로 답한다.
test("앱 언어에 따라 라벨과 날짜 형식이 함께 바뀐다", () => {
  const now = new Date(2026, 7, 11, 13, 4, 5, 123);
  const hangul = /[가-힣ㄱ-ㆎ]/;

  const english = currentDateTimeContext(now, "en");
  assert.match(english, /^Current date and time on this PC: /);
  assert.ok(english.includes("August 11, 2026"));
  assert.equal(hangul.test(english), false, "영어 환경 프롬프트에 한글이 남으면 안 된다");

  const japanese = currentDateTimeContext(now, "ja");
  assert.match(japanese, /^現在のPCの日付・時刻: /);
  assert.ok(japanese.includes("2026年8月11日"));
  assert.equal(hangul.test(japanese), false, "일본어 환경 프롬프트에 한글이 남으면 안 된다");
});

test("문자열 시각을 받아들이고 유효하지 않은 시각은 거부한다", () => {
  const isoText = "2026-08-11T04:04:05.123Z";

  assert.ok(currentDateTimeContext(isoText, "ko").includes(`UTC 기준 시각: ${isoText}`));
  assert.throws(
    () => currentDateTimeContext(new Date(Number.NaN)),
    { name: "TypeError", message: "A valid date is required." }
  );
});
