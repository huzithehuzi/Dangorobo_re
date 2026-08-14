// 알람 발동 → 휴식 알림 큐의 의미론. 방해 금지·휴식 중에는 큐에 쌓아두고(잃지 않는다)
// 해제된 뒤 하나씩 보여준다. 휴식 알림 창 조작(startRestAlert)과 restActive/dndActive
// 상태 소유권은 main.js에 있고, 여기는 큐와 발동 규칙만 소유한다.
// 타이머 관리(다음 발동 시각 계산)는 alarm-scheduler.js — 이 모듈은 그 콜백(onFire)에서
// 불리는 쪽이다.

import type { ScheduledAlarm } from "./alarm-scheduler.js";
const { t } = require("../shared/i18n.js");

// 큐에 들어가는 것이 정식 알람만은 아니다 — 설정창의 "소리 시험"과 QA 캡처가
// 종류(type) 없는 임시 알림을 넣는다. 휴식 알림이 실제로 읽는 필드만 요구한다.
// type·weatherBriefingEnabled는 스케줄링과 무관하지만(그래서 alarm-scheduler.ts의
// ScheduledAlarm에는 없다) resolveAlarmForDisplay가 "날씨로 바꿔치기할 알람인가"를
// 판단하는 데 필요해 여기 둔다.
type RestAlert = {
  id?: string;
  title?: string;
  message?: string;
  soundFile?: string;
  type?: string;
  weatherBriefingEnabled?: boolean;
};
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
  // 발동 직전에 알람을 보여줄 형태로 바꿀 훅(날씨 브리핑 문구 채우기 등). settings.alarms에
  // 저장된 원본은 건드리지 않도록 새 객체를 돌려준다. 없으면(테스트 등) 원본을 그대로 보여준다.
  resolveAlarmForDisplay?: (alarm: RestAlert) => RestAlert | Promise<RestAlert>;
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
    // 대부분의 알람은 즉시(동기) 보여줄 수 있어 이 경로를 그대로 둔다 — resolveAlarmForDisplay가
    // 없으면(단위 테스트 등) 마이크로태스크 한 틱도 안 거친다.
    if (deps.resolveAlarmForDisplay) {
      Promise.resolve(deps.resolveAlarmForDisplay(alarm)).then((resolved) => {
        queue.push(resolved);
        tryShowNext();
      });
      return;
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
