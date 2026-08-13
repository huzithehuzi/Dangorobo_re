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
  const context = currentDateTimeContext(now);

  assert.match(context, /^현재 PC 기준 날짜·시각: /);
  assert.ok(context.includes("오후 1시 04분 05초"));
  assert.ok(context.includes(
    `현재 PC 시간대: ${timeZone} (${formatUtcOffset(-now.getTimezoneOffset())})`
  ));
  assert.ok(context.includes(`UTC 기준 시각: ${now.toISOString()}`));
});

test("문자열 시각을 받아들이고 유효하지 않은 시각은 거부한다", () => {
  const isoText = "2026-08-11T04:04:05.123Z";

  assert.ok(currentDateTimeContext(isoText).includes(`UTC 기준 시각: ${isoText}`));
  assert.throws(
    () => currentDateTimeContext(new Date(Number.NaN)),
    { name: "TypeError", message: "A valid date is required." }
  );
});
