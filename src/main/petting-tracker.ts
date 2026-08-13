// 머리 쓰다듬기 제스처 판정. 머리 위에서 커서를 좌우로 왕복시키면(방향 전환 2회 이상)
// 쓰다듬는 것으로 보고, 마지막 왕복 후 일정 시간이 지나면 해제한다.
//
// "지금 커서가 머리 위인가", "쓰다듬기 설정이 켜져 있는가", "휴식 중인가" 같은 조건은
// main.ts가 판정하고 여기에는 **머리 위에 있는 동안의 DIP x 좌표**만 흘려보낸다.
// 상태 변화 통지(펫 창 IPC)와 쓰다듬기 대화 발동도 콜백으로 넘긴다 —
// alarm-scheduler.ts와 같은 분담이다.

const PETTING_REVERSALS_TO_START = 2;
const PETTING_IDLE_TIMEOUT_MS = 900;
const PETTING_MIN_TRAVEL_PX = 6;
// 쓰다듬기 반응 대화는 그냥 쓰다듬기 반응(고개 숙임)보다 더 지속적인 쓰다듬기에서만
// 걸도록 더 높은 임계값을 둔다.
const PETTING_CHAT_TRIGGER_REVERSALS = 8;

type PettingTrackerCallbacks = {
  onActiveChange: (active: boolean) => void;
  onPettingChat: () => void;
};

function createPettingTracker({ onActiveChange, onPettingChat }: PettingTrackerCallbacks) {
  let active = false;
  let lastX: number | null = null;
  let direction = 0;
  let reversals = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let chatFiredThisSession = false;

  function setActive(next: boolean) {
    if (active === next) return;
    active = next;
    onActiveChange(next);
  }

  function reset() {
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
    lastX = null;
    direction = 0;
    reversals = 0;
    chatFiredThisSession = false;
    setActive(false);
  }

  function track(x: number) {
    if (lastX === null) {
      lastX = x;
      return;
    }
    const dx = x - lastX;
    // 손떨림 수준의 미세 이동은 방향 전환으로 세지 않는다(lastX를 갱신하지 않고 누적시킴).
    if (Math.abs(dx) < PETTING_MIN_TRAVEL_PX) return;
    const nextDirection = dx > 0 ? 1 : -1;
    if (direction !== 0 && nextDirection !== direction) reversals += 1;
    direction = nextDirection;
    lastX = x;

    if (reversals < PETTING_REVERSALS_TO_START) return;
    setActive(true);
    clearTimeout(releaseTimer);
    // 해제 타이머는 lastX를 지우지 않는다 — 커서가 머리 위에 그대로 있다면 다음 왕복이
    // 처음부터가 아니라 이어서 세어지도록 두는 것이 원래 동작이다.
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      reversals = 0;
      direction = 0;
      chatFiredThisSession = false;
      setActive(false);
    }, PETTING_IDLE_TIMEOUT_MS);

    if (!chatFiredThisSession && reversals >= PETTING_CHAT_TRIGGER_REVERSALS) {
      chatFiredThisSession = true;
      onPettingChat();
    }
  }

  return { track, reset };
}

export {
  PETTING_REVERSALS_TO_START,
  PETTING_IDLE_TIMEOUT_MS,
  PETTING_MIN_TRAVEL_PX,
  PETTING_CHAT_TRIGGER_REVERSALS,
  createPettingTracker
};
export type { PettingTrackerCallbacks };
