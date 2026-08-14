const test = require("node:test");
const assert = require("node:assert/strict");

const { createAlarmQueue } = require("../src/main/alarm-queue.js");

/**
 * @param {{
 *   alarms?: Array<Record<string, unknown>>,
 *   restActive?: boolean,
 *   dndActive?: boolean,
 *   soonestFireAt?: number | null,
 *   resolveAlarmForDisplay?: (alarm: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>
 * }} [options]
 */
function createHarness(options = {}) {
  const state = {
    settings: /** @type {any} */ ({ language: "ko", alarms: options.alarms || [] }),
    restActive: options.restActive === true,
    dndActive: options.dndActive === true
  };
  /** @type {Array<Record<string, unknown>>} */
  const shown = [];
  const calls = {
    /** @type {string[]} */
    schedule: [],
    /** @type {string[]} */
    clear: [],
    saveSettings: 0,
    shown
  };
  const queue = createAlarmQueue({
    scheduler: {
      schedule: (alarm) => calls.schedule.push(String(alarm.id)),
      clear: (id) => calls.clear.push(id),
      getSoonestFireAt: () => (options.soonestFireAt !== undefined ? options.soonestFireAt : null)
    },
    getSettings: () => state.settings,
    saveSettings: () => {
      calls.saveSettings += 1;
    },
    isRestActive: () => state.restActive,
    isDndActive: () => state.dndActive,
    showAlert: (alarm) => calls.shown.push(/** @type {Record<string, unknown>} */ (alarm)),
    resolveAlarmForDisplay: options.resolveAlarmForDisplay
  });
  return { queue, calls, state };
}

const ONCE_ALARM = { id: "a1", type: "once", fireAt: "2026-08-10T09:00", title: "한 번" };
const INTERVAL_ALARM = { id: "a2", type: "interval", intervalMinutes: 30, title: "반복" };
const HOURLY_ALARM = { id: "a3", type: "hourly", hourlyInterval: 1, title: "정시" };

test("정시 알람은 발동해도 지우지 않고 다음 정각을 다시 예약한다", () => {
  const { queue, calls, state } = createHarness({ alarms: [HOURLY_ALARM] });
  queue.fireAlarm("a3");

  assert.deepEqual(state.settings.alarms, [HOURLY_ALARM]);
  assert.deepEqual(calls.schedule, ["a3"]);
  assert.deepEqual(calls.clear, []);
  assert.equal(calls.saveSettings, 0);
  assert.deepEqual(calls.shown, [HOURLY_ALARM]);
});

test("once 알람 발동은 목록에서 지우고 저장한 뒤 보여준다", () => {
  const { queue, calls, state } = createHarness({ alarms: [ONCE_ALARM, INTERVAL_ALARM] });
  queue.fireAlarm("a1");

  assert.deepEqual(state.settings.alarms, [INTERVAL_ALARM]);
  assert.deepEqual(calls.clear, ["a1"]);
  assert.equal(calls.saveSettings, 1);
  assert.deepEqual(calls.schedule, []);
  assert.deepEqual(calls.shown, [ONCE_ALARM]);
});

test("반복 알람 발동은 다음 발동을 예약하고 목록을 지우지 않는다", () => {
  const { queue, calls, state } = createHarness({ alarms: [INTERVAL_ALARM] });
  queue.fireAlarm("a2");

  assert.deepEqual(state.settings.alarms, [INTERVAL_ALARM]);
  assert.deepEqual(calls.schedule, ["a2"]);
  assert.equal(calls.saveSettings, 0);
  assert.deepEqual(calls.shown, [INTERVAL_ALARM]);
});

test("없는 id는 아무것도 하지 않는다", () => {
  const { queue, calls } = createHarness({ alarms: [ONCE_ALARM] });
  queue.fireAlarm("모름");
  assert.deepEqual(calls.shown, []);
  assert.equal(queue.pendingCount(), 0);
});

test("방해 금지·휴식 중에는 큐에 쌓아두고 해제 후 FIFO로 하나씩 보여준다", () => {
  const { queue, calls, state } = createHarness({ dndActive: true, alarms: [] });
  queue.enqueue({ id: "t1", title: "첫째" });
  queue.enqueue({ id: "t2", title: "둘째" });
  assert.equal(calls.shown.length, 0);
  assert.equal(queue.pendingCount(), 2);

  state.dndActive = false;
  queue.tryShowNext();
  // 한 번 호출에 하나만 보여준다 — 다음 것은 휴식 확인 후 tryShowNext에서 나온다.
  assert.deepEqual(calls.shown.map((alarm) => alarm.id), ["t1"]);
  assert.equal(queue.pendingCount(), 1);
  queue.tryShowNext();
  assert.deepEqual(calls.shown.map((alarm) => alarm.id), ["t1", "t2"]);
});

test("휴식 중에도 마찬가지로 밀어둔다", () => {
  const { queue, calls, state } = createHarness({ restActive: true });
  queue.enqueue({ id: "t1" });
  assert.deepEqual(calls.shown, []);
  state.restActive = false;
  queue.tryShowNext();
  assert.equal(calls.shown.length, 1);
});

test("resolveAlarmForDisplay가 있으면 그 결과로(원본 대신) 보여준다", async () => {
  const DAILY_WEATHER_ALARM = { id: "a4", type: "daily", title: "출근", message: "원본", weatherBriefingEnabled: true };
  const { queue, calls, state } = createHarness({
    alarms: [DAILY_WEATHER_ALARM],
    resolveAlarmForDisplay: async (alarm) => ({ ...alarm, message: "날씨로 바뀐 문구" })
  });
  queue.fireAlarm("a4");
  // resolveAlarmForDisplay가 비동기라 fireAlarm 직후엔 아직 안 보인다 — 원본이 새는지도 함께 확인.
  assert.deepEqual(calls.shown, []);
  await Promise.resolve().then(() => Promise.resolve());
  assert.deepEqual(calls.shown, [{ ...DAILY_WEATHER_ALARM, message: "날씨로 바뀐 문구" }]);
  assert.equal(state.settings.alarms[0].message, "원본");
});

test("카운트다운 문구: 휴식 중 → 확인 대기, 예약 없음 → 없음, 예약 있음 → 남은 분", () => {
  const resting = createHarness({ restActive: true });
  assert.equal(resting.queue.countdownText(), "확인 대기 중");

  const none = createHarness({ soonestFireAt: null });
  assert.equal(none.queue.countdownText(), "없음");

  const soon = createHarness({ soonestFireAt: Date.now() + 5 * 60000 + 30000 });
  assert.equal(soon.queue.countdownText(), "6분 남음");

  const past = createHarness({ soonestFireAt: Date.now() - 60000 });
  assert.equal(past.queue.countdownText(), "0분 남음");
});
