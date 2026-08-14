const test = require("node:test");
const assert = require("node:assert/strict");

const { computeAlarmDelayMs, createAlarmScheduler } = require("../src/main/alarm-scheduler.js");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 요일이 고정된 기준 시각으로 Date.now()를 고정한다 — daily 알람이 요일에 따라 갈라지므로
 * 오늘이 무슨 요일이냐에 따라 결과가 달라지면 안 된다.
 * 2026-08-12는 수요일(getDay() === 3)이다.
 * @param {import("node:test").TestContext} t
 * @param {{ hour?: number, minute?: number }} [clock]
 */
function freezeWednesday(t, clock = {}) {
  const now = new Date(2026, 7, 12, clock.hour ?? 10, clock.minute ?? 0, 0, 0);
  assert.equal(now.getDay(), 3);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  return now;
}

test("once 알람은 지정 시각까지 남은 시간을 준다", (t) => {
  const now = freezeWednesday(t);
  const fireAt = new Date(now.getTime() + 90 * MINUTE_MS);
  assert.equal(computeAlarmDelayMs({ id: "a", type: "once", fireAt: fireAt.toISOString() }), 90 * MINUTE_MS);
});

test("이미 지난 once 알람은 음수가 아니라 0이다", (t) => {
  const now = freezeWednesday(t);
  const fireAt = new Date(now.getTime() - HOUR_MS);
  assert.equal(computeAlarmDelayMs({ id: "a", type: "once", fireAt: fireAt.toISOString() }), 0);
});

test("interval 알람은 분을 ms로 바꾼 고정 간격이다", () => {
  assert.equal(computeAlarmDelayMs({ id: "a", type: "interval", intervalMinutes: 45 }), 45 * MINUTE_MS);
});

test("꺼진 알람은 예약하지 않는다", () => {
  assert.equal(computeAlarmDelayMs({ id: "a", type: "interval", enabled: false, intervalMinutes: 45 }), null);
  assert.equal(computeAlarmDelayMs({ id: "b", type: "daily", enabled: false, dailyTime: "09:00" }), null);
  // enabled를 아예 안 준 경우는 켜진 것으로 본다(기존 알람과의 하위 호환).
  assert.equal(computeAlarmDelayMs({ id: "c", type: "interval", intervalMinutes: 1 }), MINUTE_MS);
});

test("hourly 알람은 등록 시각이 아니라 다음 정각까지를 센다", (t) => {
  freezeWednesday(t, { hour: 10, minute: 17 });
  assert.equal(computeAlarmDelayMs({ id: "a", type: "hourly", hourlyInterval: 1 }), 43 * MINUTE_MS);
  // 간격을 안 준 옛 데이터는 매 정각으로 본다.
  assert.equal(computeAlarmDelayMs({ id: "b", type: "hourly" }), 43 * MINUTE_MS);
});

test("hourly 알람은 지금이 정확히 정각이어도 다음 정각으로 넘어간다", (t) => {
  freezeWednesday(t, { hour: 10, minute: 0 });
  // 0을 주면 발동 직후 같은 시각에 무한 재발동한다.
  assert.equal(computeAlarmDelayMs({ id: "a", type: "hourly", hourlyInterval: 1 }), HOUR_MS);
});

test("hourly 알람의 간격은 시(hour)의 배수 자리에 맞춘다", (t) => {
  freezeWednesday(t, { hour: 10, minute: 30 });
  // 3시간마다면 0·3·6·9·12…시라 10시 30분 다음은 12시다.
  assert.equal(computeAlarmDelayMs({ id: "a", type: "hourly", hourlyInterval: 3 }), 90 * MINUTE_MS);
  // 12시간마다면 0시·12시. 자정을 넘겨야 하는 경우도 같은 규칙이다.
  assert.equal(computeAlarmDelayMs({ id: "b", type: "hourly", hourlyInterval: 12 }), 90 * MINUTE_MS);
});

test("hourly 알람은 다음 배수 시각이 내일이면 자정을 넘겨 잡는다", (t) => {
  freezeWednesday(t, { hour: 13, minute: 0 });
  // 12시간마다면 0시·12시뿐이라 13시 다음은 내일 0시다.
  assert.equal(computeAlarmDelayMs({ id: "a", type: "hourly", hourlyInterval: 12 }), 11 * HOUR_MS);
});

test("꺼진 hourly 알람은 예약하지 않는다", (t) => {
  freezeWednesday(t, { hour: 10, minute: 30 });
  assert.equal(computeAlarmDelayMs({ id: "a", type: "hourly", enabled: false, hourlyInterval: 1 }), null);
});

test("daily 알람은 오늘 아직 안 지났으면 오늘로 잡는다", (t) => {
  freezeWednesday(t, { hour: 10 });
  assert.equal(computeAlarmDelayMs({ id: "a", type: "daily", dailyTime: "14:30" }), 4 * HOUR_MS + 30 * MINUTE_MS);
});

test("daily 알람은 오늘 시각이 지났으면 내일로 넘어간다", (t) => {
  freezeWednesday(t, { hour: 15 });
  assert.equal(computeAlarmDelayMs({ id: "a", type: "daily", dailyTime: "09:00" }), 18 * HOUR_MS);
});

test("daily 알람의 요일 목록이 비어 있으면 매일로 본다", (t) => {
  freezeWednesday(t, { hour: 15 });
  const everyDay = 18 * HOUR_MS;
  assert.equal(computeAlarmDelayMs({ id: "a", type: "daily", dailyTime: "09:00", daysOfWeek: [] }), everyDay);
  assert.equal(computeAlarmDelayMs({ id: "b", type: "daily", dailyTime: "09:00" }), everyDay);
});

test("daily 알람은 지정한 요일 중 가장 가까운 날을 고른다", (t) => {
  freezeWednesday(t, { hour: 15 });
  // 수요일 15시 기준. 금요일(5) 09:00은 이틀 뒤 아침이다.
  assert.equal(
    computeAlarmDelayMs({ id: "a", type: "daily", dailyTime: "09:00", daysOfWeek: [5] }),
    2 * DAY_MS - 6 * HOUR_MS
  );
  // 오늘(수, 3)이 목록에 있어도 09:00은 이미 지났으므로 다음 주 수요일이다.
  assert.equal(
    computeAlarmDelayMs({ id: "b", type: "daily", dailyTime: "09:00", daysOfWeek: [3] }),
    7 * DAY_MS - 6 * HOUR_MS
  );
  // 오늘이 목록에 있고 시각도 안 지났으면 오늘이다.
  assert.equal(computeAlarmDelayMs({ id: "c", type: "daily", dailyTime: "23:00", daysOfWeek: [3] }), 8 * HOUR_MS);
});

test("모르는 종류의 알람은 예약하지 않는다", () => {
  const unknown = /** @type {any} */ ({ id: "a", type: "weekly", dailyTime: "09:00" });
  assert.equal(computeAlarmDelayMs(unknown), null);
});

test("스케줄러는 계산된 지연 뒤에 id로 알린다", (t) => {
  freezeWednesday(t);
  /** @type {string[]} */
  const fired = [];
  const scheduler = createAlarmScheduler((id) => fired.push(id));
  scheduler.schedule({ id: "a", type: "interval", intervalMinutes: 10 });
  t.mock.timers.tick(10 * MINUTE_MS - 1);
  assert.deepEqual(fired, []);
  t.mock.timers.tick(1);
  assert.deepEqual(fired, ["a"]);
});

test("같은 id를 다시 예약하면 이전 타이머를 버린다", (t) => {
  freezeWednesday(t);
  /** @type {string[]} */
  const fired = [];
  const scheduler = createAlarmScheduler((id) => fired.push(id));
  scheduler.schedule({ id: "a", type: "interval", intervalMinutes: 10 });
  scheduler.schedule({ id: "a", type: "interval", intervalMinutes: 30 });
  t.mock.timers.tick(10 * MINUTE_MS);
  assert.deepEqual(fired, []);
  t.mock.timers.tick(20 * MINUTE_MS);
  assert.deepEqual(fired, ["a"]);
});

test("꺼진 알람을 예약하면 이전 타이머만 지우고 새로 걸지 않는다", (t) => {
  freezeWednesday(t);
  /** @type {string[]} */
  const fired = [];
  const scheduler = createAlarmScheduler((id) => fired.push(id));
  scheduler.schedule({ id: "a", type: "interval", intervalMinutes: 10 });
  scheduler.schedule({ id: "a", type: "interval", enabled: false, intervalMinutes: 10 });
  t.mock.timers.tick(DAY_MS);
  assert.deepEqual(fired, []);
  assert.equal(scheduler.getSoonestFireAt(), null);
});

test("clear와 clearAll은 대기 중인 알람을 없앤다", (t) => {
  freezeWednesday(t);
  /** @type {string[]} */
  const fired = [];
  const scheduler = createAlarmScheduler((id) => fired.push(id));
  scheduler.schedule({ id: "a", type: "interval", intervalMinutes: 10 });
  scheduler.schedule({ id: "b", type: "interval", intervalMinutes: 20 });
  scheduler.clear("a");
  t.mock.timers.tick(20 * MINUTE_MS);
  assert.deepEqual(fired, ["b"]);

  scheduler.schedule({ id: "c", type: "interval", intervalMinutes: 5 });
  scheduler.clearAll();
  t.mock.timers.tick(DAY_MS);
  assert.deepEqual(fired, ["b"]);
  assert.equal(scheduler.getSoonestFireAt(), null);
});

test("scheduleAll은 기존 예약을 모두 갈아치운다", (t) => {
  freezeWednesday(t);
  /** @type {string[]} */
  const fired = [];
  const scheduler = createAlarmScheduler((id) => fired.push(id));
  scheduler.schedule({ id: "old", type: "interval", intervalMinutes: 5 });
  scheduler.scheduleAll([
    { id: "a", type: "interval", intervalMinutes: 10 },
    { id: "b", type: "interval", intervalMinutes: 20 }
  ]);
  t.mock.timers.tick(20 * MINUTE_MS);
  assert.deepEqual(fired, ["a", "b"]);
});

test("가장 가까운 발동 시각은 대기 중인 알람 중 최솟값이다", (t) => {
  const now = freezeWednesday(t);
  const scheduler = createAlarmScheduler(() => {});
  assert.equal(scheduler.getSoonestFireAt(), null);
  scheduler.scheduleAll([
    { id: "a", type: "interval", intervalMinutes: 30 },
    { id: "b", type: "interval", intervalMinutes: 10 },
    { id: "c", type: "interval", enabled: false, intervalMinutes: 1 }
  ]);
  assert.equal(scheduler.getSoonestFireAt(), now.getTime() + 10 * MINUTE_MS);
  scheduler.clear("b");
  assert.equal(scheduler.getSoonestFireAt(), now.getTime() + 30 * MINUTE_MS);
});

// 발동 자체로는 장부를 건드리지 않는다 — 발동 뒤 정리(once는 clear, 반복은 재예약)는
// onFire를 받은 쪽의 몫이고 실제로는 alarm-queue.ts의 fireAlarm()이 한다.
test("발동해도 장부는 스스로 비지 않고 호출한 쪽이 정리해야 한다", (t) => {
  const now = freezeWednesday(t);
  /** @type {string[]} */
  const fired = [];
  const scheduler = createAlarmScheduler((id) => fired.push(id));
  scheduler.scheduleAll([
    { id: "a", type: "interval", intervalMinutes: 10 },
    { id: "b", type: "interval", intervalMinutes: 30 }
  ]);
  t.mock.timers.tick(10 * MINUTE_MS);
  assert.deepEqual(fired, ["a"]);
  // 정리하기 전에는 이미 지나간 발동 시각이 그대로 남아 있다.
  assert.equal(scheduler.getSoonestFireAt(), now.getTime() + 10 * MINUTE_MS);
  // once였다면 clear, 반복이었다면 재예약 — 어느 쪽이든 호출한 쪽이 부른다.
  scheduler.clear("a");
  assert.equal(scheduler.getSoonestFireAt(), now.getTime() + 30 * MINUTE_MS);
  scheduler.schedule({ id: "b", type: "interval", intervalMinutes: 30 });
  assert.equal(scheduler.getSoonestFireAt(), now.getTime() + 10 * MINUTE_MS + 30 * MINUTE_MS);
});
