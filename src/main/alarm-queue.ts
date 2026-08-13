// 알람 발동 → 휴식 알림 큐의 의미론. 방해 금지·휴식 중에는 큐에 쌓아두고(잃지 않는다)
// 해제된 뒤 하나씩 보여준다. 휴식 알림 창 조작(startRestAlert)과 restActive/dndActive
// 상태 소유권은 main.js에 있고, 여기는 큐와 발동 규칙만 소유한다.
// 타이머 관리(다음 발동 시각 계산)는 alarm-scheduler.js — 이 모듈은 그 콜백(onFire)에서
// 불리는 쪽이다.

import type { ScheduledAlarm } from "./alarm-scheduler.js";
const { t } = require("../shared/i18n.js");

// 큐에 들어가는 것이 정식 알람만은 아니다 — 설정창의 "소리 시험"과 QA 캡처가
// 종류(type) 없는 임시 알림을 넣는다. 휴식 알림이 실제로 읽는 필드만 요구한다.
type RestAlert = { id?: string; title?: string; message?: string; soundFile?: string };
type AlarmQueueAlarm = ScheduledAlarm & RestAlert;

type AlarmQueueDeps = {
  scheduler: {
    schedule: (alarm: ScheduledAlarm) => void;
    clear: (id: string) => void;
    getSoonestFireAt: () => number | null;
  };
  getSettings: () => { language: string; alarms: AlarmQueueAlarm[] };
  saveSettings: () => void;
  isRestActive: () => boolean;
  isDndActive: () => boolean;
  showAlert: (alarm: RestAlert) => void;
};

function createAlarmQueue(deps: AlarmQueueDeps) {
  let queue: RestAlert[] = [];

  // 발동한 알람의 뒤처리: once 알람은 목록에서 지우고 저장, 반복 알람은 다음 발동을 예약.
  function fireAlarm(id: string) {
    const settings = deps.getSettings();
    const alarm = settings.alarms.find((entry) => entry.id === id);
    if (!alarm) return;
    if (alarm.type === "once") {
      settings.alarms = settings.alarms.filter((entry) => entry.id !== id);
      deps.scheduler.clear(id);
      deps.saveSettings();
    } else {
      deps.scheduler.schedule(alarm);
    }
    queue.push(alarm);
    tryShowNext();
  }

  function tryShowNext() {
    // 방해 금지(전체화면) 중이면 큐에 그대로 두고 해제된 뒤에 보여준다(알람을 잃지 않는다).
    if (deps.isDndActive() || deps.isRestActive() || queue.length === 0) return;
    const alarm = queue.shift();
    if (!alarm) return;
    deps.showAlert(alarm);
  }

  function enqueue(alarm: RestAlert) {
    queue.push(alarm);
    tryShowNext();
  }

  function countdownText() {
    const lang = deps.getSettings().language;
    if (deps.isRestActive()) return t(lang, "restAlert.waitingConfirm");
    const soonest = deps.scheduler.getSoonestFireAt();
    if (soonest == null) return t(lang, "common.none");
    const remainingMinutes = Math.max(0, Math.ceil((soonest - Date.now()) / 60000));
    return t(lang, "menu.remainingMinutes", { minutes: remainingMinutes });
  }

  return {
    fireAlarm,
    tryShowNext,
    enqueue,
    countdownText,
    pendingCount: () => queue.length
  };
}

export { createAlarmQueue };
export type { RestAlert };
