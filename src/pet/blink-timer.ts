// 눈 깜박임 타이머.
//
// 상태 세 개(깜박이는 중인지, 남은 깜박임 시간, 다음 깜박임까지의 대기)를 이 모듈이 소유한다.
// 애니메이션 루프 분해의 선행 작업이다 — 루프가 쓰는 누적 상태를 성격별 소유자로 먼저
// 옮겨야, 나중에 루프 자체를 옮길 때 주입할 심벌이 남지 않는다.
//
// 표정이 따로 지정된 상태(휴식 알림·AI 답변·쓰다듬기 등)에서는 깜박임을 쉰다. 그때
// suppress()로 "깜박이는 중"을 꺼 두는 이유는, 표정 지정이 끝난 프레임에 다음 깜박임까지
// 기다리지 않고 곧바로 정상 눈으로 되돌리기 위해서다. 대기 시간(countdown)은 건드리지
// 않으므로 깜박임 리듬 자체는 이어진다.

const BLINK_DURATION = 0.12;
const BLINK_MIN_GAP = 2.5;
const BLINK_MAX_GAP = 5.5;

type BlinkTimerDependencies = {
  /** 다음 깜박임까지의 대기를 고르는 난수. 테스트에서 갈아 끼운다. */
  random?: () => number;
};

function createBlinkTimer(deps: BlinkTimerDependencies = {}) {
  const random = deps.random ?? Math.random;
  const nextGap = () => BLINK_MIN_GAP + random() * (BLINK_MAX_GAP - BLINK_MIN_GAP);

  let active = false;
  let timer = 0;
  let countdown = nextGap();

  /** 표정 지정 상태 — 깜박임을 쉬되 다음 대기는 유지한다. */
  function suppress() {
    active = false;
  }

  /** 한 프레임 진행하고 지금 눈을 감고 있어야 하는지 돌려준다. */
  function advance(delta: number) {
    if (active) {
      timer -= delta;
      if (timer <= 0) {
        active = false;
        countdown = nextGap();
      }
    } else {
      countdown -= delta;
      if (countdown <= 0) {
        active = true;
        timer = BLINK_DURATION;
      }
    }
    return active;
  }

  return {
    suppress,
    advance,
    isActive: () => active
  };
}

export { createBlinkTimer, BLINK_DURATION, BLINK_MIN_GAP, BLINK_MAX_GAP };
export type { BlinkTimerDependencies };
