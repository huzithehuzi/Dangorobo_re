// 입력 스퀴시와 그 뒤에 남는 젤리 출렁임의 재생 상태.
//
// 진행 시간 세 개(스퀴시·출렁임·드래그 재트리거 간격)를 이 모듈이 소유한다. 애니메이션 루프
// 분해의 선행 작업이며, 앞서 옮긴 깜박임·꼬리와 달리 발동 지점(키·마우스 입력, 드래그)과
// 소비 지점(몸통 변형)이 갈라져 있어서 그 둘을 한 소유자로 모으는 것이 요점이다.
//
// 스퀴시는 대기열을 만들지 않는다 — 마지막 입력에서 짧게 다시 시작한다.

import * as THREE from "three";
import { squishCurve } from "./motion-curves.js";

const SQUISH_DURATION = 0.16;
/* 스퀴시 뒤에 남는 젤리 출렁임(2026-08-08). 본 스퀴시는 0.16초에 끝나는 "눌렸다 튀어오름"
   하나뿐이라 세로로만 눌리는 느낌이었다. 그 뒤로 가로가 감쇠 진동하면서 몇 번 더 출렁이게
   해서 말랑한 느낌을 준다. 진동은 X와 Z를 서로 반대로 밀어(가로로 넓어지면 앞뒤로 얇아짐)
   부피가 대충 유지되게 하고, Y는 아주 살짝만 반대로 준다 — 발 앵커 보정(pet.position.y)이
   scaleY 변화를 그대로 상쇄하므로 발이 뜨거나 파묻히지 않는다.
   주파수가 상수라 `Math.sin(t * 상수)`를 그대로 써도 위상 점프 문제가 없다(AGENTS.md 참고).

   ⚠ 값을 조정할 땐 **주파수와 꼬리 진폭**을 먼저 볼 것. 처음엔 7.4Hz·0.46초로 넣었는데
   "끝나는 타이밍이 부들댄다"는 피드백을 받았고, 원인이 둘이었다:
     1. 7.4Hz면 60Hz 화면에서 한 주기가 8프레임뿐이라 "출렁"이 아니라 "진동"으로 읽힌다.
        한 주기에 최소 12프레임은 줘야(=5Hz 아래) 부드러운 슬로시로 보인다.
     2. 지수 감쇠만으로는 꼬리가 길게 남는다. 0.3초 뒤에도 0.3~0.9%씩 계속 흔들리는데,
        이 크기는 "움직임"이 아니라 외곽선·픽셀 아트에서 실루엣이 지글거리는 떨림으로 보인다.
   그래서 주파수를 낮추고, 지수 감쇠 위에 **끝을 정확히 0으로 만드는 페이드 봉투**를 덧씌웠다
   (`WOBBLE_FADE_START` 이후 smoothstep으로 0까지). 봉투가 없으면 duration에서 값이 0으로
   툭 끊기는 것도 미세한 팝으로 보인다. */
const WOBBLE_DURATION = 0.34;
const WOBBLE_FREQUENCY = 4.6;   // Hz — 60Hz에서 한 주기 ≈ 13프레임
const WOBBLE_DECAY = 7.5;       // 클수록 빨리 잦아든다
const WOBBLE_GAIN_X = 0.4;      // 스퀴시 강도 대비 가로 진폭(주파수를 낮춘 만큼 첫 마루가 늦게 와서 조금 올림)
const WOBBLE_FADE_START = 0.55; // 이 비율(진행도) 이후로는 꼬리를 눌러 0으로 수렴시킨다
// 들어올리는 동안 스퀴시를 반복 재생해 정적으로 보이지 않게 한다(한 번의 스퀴시
// 자체는 SQUISH_DURATION만에 끝나므로, 그보다 살짝 긴 간격으로 계속 재트리거한다).
const DRAG_SQUISH_INTERVAL = 0.3;

function createSquishMotion() {
  // 시작값은 "이미 다 재생됐다"는 뜻이다 — 창을 켜자마자 스퀴시가 돌지 않게 한다.
  let squishElapsed = SQUISH_DURATION;
  let wobbleElapsed = WOBBLE_DURATION;
  let dragTimer = 0;

  /** 스퀴시와 출렁임을 처음부터 다시 재생한다. */
  function trigger() {
    squishElapsed = 0;
    wobbleElapsed = 0;
  }

  /** 재생을 끝난 상태로 만든다(스퀴시를 양쪽 다 끈 설정에서 쓴다). */
  function stop() {
    squishElapsed = SQUISH_DURATION;
    wobbleElapsed = WOBBLE_DURATION;
  }

  /**
   * 드래그 중이면 일정 간격으로 스퀴시를 다시 트리거한다.
   * 몸통 변형을 진행하기 **전에** 불러야 트리거된 프레임에서 바로 재생이 시작된다.
   */
  function advanceDragPulse(delta: number, dragReacting: boolean) {
    if (dragReacting) {
      dragTimer -= delta;
      if (dragTimer <= 0) {
        trigger();
        dragTimer = DRAG_SQUISH_INTERVAL;
      }
    } else {
      dragTimer = 0;
    }
  }

  /** 한 프레임 진행하고 몸통에 적용할 세로 스퀴시·가로 출렁임 양을 돌려준다. */
  function advance(delta: number, strengthPercent: number) {
    let squishAmount = 0;
    if (squishElapsed < SQUISH_DURATION) {
      squishElapsed = Math.min(SQUISH_DURATION, squishElapsed + delta);
      const progress = squishElapsed / SQUISH_DURATION;
      squishAmount = (strengthPercent / 100) * squishCurve(progress);
    }

    let wobbleAmount = 0;
    if (wobbleElapsed < WOBBLE_DURATION) {
      wobbleElapsed = Math.min(WOBBLE_DURATION, wobbleElapsed + delta);
      const progress = wobbleElapsed / WOBBLE_DURATION;
      // 지수 감쇠만으로는 꼬리가 길게 남아 떨림으로 보인다 — 끝을 정확히 0으로 만드는 봉투를 덧씌운다.
      const fade = 1 - THREE.MathUtils.smoothstep(progress, WOBBLE_FADE_START, 1);
      wobbleAmount =
        (strengthPercent / 100) *
        WOBBLE_GAIN_X *
        Math.sin(wobbleElapsed * WOBBLE_FREQUENCY * Math.PI * 2) *
        Math.exp(-wobbleElapsed * WOBBLE_DECAY) *
        fade;
    }

    return { squishAmount, wobbleAmount };
  }

  return {
    trigger,
    stop,
    advanceDragPulse,
    advance,
    getSquishElapsed: () => squishElapsed,
    getWobbleElapsed: () => wobbleElapsed,
    getDragTimer: () => dragTimer
  };
}

export {
  createSquishMotion,
  SQUISH_DURATION,
  WOBBLE_DURATION,
  WOBBLE_FREQUENCY,
  WOBBLE_DECAY,
  WOBBLE_GAIN_X,
  WOBBLE_FADE_START,
  DRAG_SQUISH_INTERVAL
};
