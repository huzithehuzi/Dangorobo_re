// 이 모듈이 실제로 읽는 필드만 적는다. 알람 객체는 settings-schema.js의 normalizeAlarm()이
// 만들고 title/message/soundFile 같은 필드도 함께 들고 다니는데, 그건 알람이 울린 뒤
// main.js가 볼 몫이라 여기서는 모른다.
// 종류에 따라 들어 있는 필드가 다르므로(once는 fireAt만, daily는 dailyTime/daysOfWeek만)
// type으로 갈라지는 유니온으로 적는다 — 아래 분기가 그대로 좁혀진다.
type OnceAlarm = { id: string; type: "once"; fireAt: string };
type IntervalAlarm = { id: string; type: "interval"; enabled?: boolean; intervalMinutes: number };
type DailyAlarm = { id: string; type: "daily"; enabled?: boolean; dailyTime: string; daysOfWeek?: number[] };
type HourlyAlarm = { id: string; type: "hourly"; enabled?: boolean; hourlyInterval?: number };
type ScheduledAlarm = OnceAlarm | IntervalAlarm | DailyAlarm | HourlyAlarm;

// 알람 하나가 다음에 울릴 때까지 남은 시간(ms)을 계산한다. 순수 함수 — Date.now() 외에
// 다른 공유 상태를 참조하지 않는다.
// null이면 예약하지 않는다(꺼져 있거나 종류를 모르는 알람).
function computeAlarmDelayMs(alarm: ScheduledAlarm): number | null {
  if (alarm.type === "once") {
    return Math.max(0, new Date(alarm.fireAt).getTime() - Date.now());
  }
  if (alarm.type === "interval") {
    if (alarm.enabled === false) return null;
    return alarm.intervalMinutes * 60 * 1000;
  }
  if (alarm.type === "hourly") {
    if (alarm.enabled === false) return null;
    // 등록 시각이 아니라 시계의 정각에 맞춘다 — interval 알람과 다른 점이 이것뿐이다.
    const every = Math.min(12, Math.max(1, Math.round(Number(alarm.hourlyInterval)) || 1));
    const now = new Date();
    // offset을 1부터 시작해 "지금이 정확히 정각"일 때 지연 0으로 즉시 재발동하는 것을 막는다.
    // 시(hour)만 더해 Date에 넘기면 월말·서머타임 넘김을 표준 정규화가 처리한다.
    for (let offset = 1; offset <= 24; offset++) {
      const candidate = new Date(
        now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + offset, 0, 0, 0
      );
      if (candidate.getHours() % every === 0) return candidate.getTime() - now.getTime();
    }
    return null;
  }
  if (alarm.type === "daily") {
    if (alarm.enabled === false) return null;
    const [hour, minute] = alarm.dailyTime.split(":").map(Number);
    // daysOfWeek 없거나 비어있으면(과거 알람과의 하위 호환) 매일로 취급.
    // Date#getDay() 기준(0=일 ~ 6=토)이라 하루씩 앞으로 훑으며 요일이 맞고 아직 안 지난
    // 시각을 처음 만나는 날로 잡는다 — 최대 7일 뒤까지 훑으면 반드시 하나는 걸린다.
    const days = Array.isArray(alarm.daysOfWeek) && alarm.daysOfWeek.length > 0 ? alarm.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
    const now = new Date();
    for (let offset = 0; offset < 8; offset++) {
      const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, minute, 0, 0);
      if (candidate.getTime() > now.getTime() && days.includes(candidate.getDay())) {
        return candidate.getTime() - now.getTime();
      }
    }
    return null;
  }
  return null;
}

// 타이머(setTimeout)와 "다음 발동 시각" 장부만 관리한다. 알람이 울렸을 때 실제로 무엇을
// 하는지(큐에 넣기, 반복 알람 재등록, once 알람 삭제, 트레이 갱신 등)는 onFire(id) 콜백을
// 호출한 쪽(main.js)의 책임이다 — settings/tray/알림 큐 같은 공유 상태를 이 모듈이 몰라도
// 되게 하기 위함.
function createAlarmScheduler(onFire: (id: string) => void) {
  const alarmTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const nextAlarmFireAt = new Map<string, number>();

  function clear(id: string) {
    const timer = alarmTimers.get(id);
    if (timer) clearTimeout(timer);
    alarmTimers.delete(id);
    nextAlarmFireAt.delete(id);
  }

  function clearAll() {
    for (const id of [...alarmTimers.keys()]) clear(id);
  }

  function schedule(alarm: ScheduledAlarm) {
    clear(alarm.id);
    const delay = computeAlarmDelayMs(alarm);
    if (delay == null) return;
    nextAlarmFireAt.set(alarm.id, Date.now() + delay);
    const timer = setTimeout(() => onFire(alarm.id), delay);
    alarmTimers.set(alarm.id, timer);
  }

  function scheduleAll(alarms: ScheduledAlarm[]) {
    clearAll();
    for (const alarm of alarms) schedule(alarm);
  }

  // 대기 중인 알람이 하나도 없으면 null.
  function getSoonestFireAt() {
    if (nextAlarmFireAt.size === 0) return null;
    return Math.min(...nextAlarmFireAt.values());
  }

  return { schedule, scheduleAll, clear, clearAll, getSoonestFireAt };
}

export { computeAlarmDelayMs, createAlarmScheduler };
export type { ScheduledAlarm };
