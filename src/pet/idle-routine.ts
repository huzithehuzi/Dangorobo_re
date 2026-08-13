// 랜덤 유휴 행동의 예약·추첨·감쇠 상태 기계. renderer.ts에서 떼어냈다.
//
// "지금 유휴 행동을 해도 되는 상태인가"(휴식/AI/쓰다듬기/미디어 재생 등)는 렌더러가
// 판정해 `allowed`로 넘기고, 여기서는 언제 무엇을 얼마나 세게 재생할지만 정한다 —
// petting-tracker.ts와 같은 분담이다. 시각 결과가 난수와 시간에 달려 있어 캡처로는
// 고정할 수 없으므로 `random`을 주입 지점으로 열어 둔다.
//
// import 지정자에 `.js`를 붙이는 이유는 src/pet/tsconfig.build.json 주석 참고(noResolve 단일 파일 변환).
import { idleRoutineEase } from "./motion-curves.js";

// doze는 너무 자주 나오면 졸린 펫처럼 보인다는 피드백(2026-08-06)에 따라
// weight를 낮춰 뽑힐 확률만 줄인다(가중치 없는 항목은 1로 취급).
const IDLE_ROUTINES: readonly IdleRoutineDefinition[] = [
  { kind: "lookAround", duration: 2600 },
  { kind: "stretch", duration: 2400 },
  { kind: "perkup", duration: 1600 },
  { kind: "wave", duration: 2200 },
  { kind: "doze", duration: 2600, weight: 0.5 },
  { kind: "sniffAround", duration: 2200 },
  { kind: "pawLick", duration: 2400 },
  { kind: "shakeOff", duration: 1800 }
];

// 직전에 나온 행동은 가중치를 이만큼으로 깎아서 연속으로 같은 게 나올 확률을 낮춘다.
// 0(완전 배제)으로 하면 "절대 연속으로 안 나온다"는 규칙성이 생겨 오히려 패턴이 읽히므로
// 배제가 아니라 약화다(2026-08-07 추가 — 예전엔 무기억 추출이라 stretch가 두 번 연속
// 나올 확률이 22%였다).
const IDLE_ROUTINE_REPEAT_WEIGHT_FACTOR = 0.25;

// 루틴 도중 방해받았을 때(쓰다듬기·드래그·말풍선 등) 포즈를 한 프레임에 지우면 팔이
// 순간이동한다. 이 시간에 걸쳐 감쇠시킨 뒤 버린다.
const IDLE_ROUTINE_INTERRUPT_FADE_SECONDS = 0.18;

// 첫 행동은 설정된 간격이 아니라 이 범위에서 잡는다 — 창을 띄우자마자 펫이 혼자 움직이면
// 사용자가 방금 한 조작에 대한 반응으로 오해한다.
const IDLE_ROUTINE_FIRST_GAP_MIN_MS = 10000;
const IDLE_ROUTINE_FIRST_GAP_SPREAD_MS = 12000;

type IdleRoutineDefinition = { kind: string; duration: number; weight?: number };
type IdleRoutineFrame = { kind: string; progress: number; amount: number };
type IdleRoutineGapRange = { minGapMs: number; maxGapMs: number };
type IdleRoutineDependencies = {
  /** 호출 시점의 설정값을 돌려준다(설정이 바뀌어도 스케줄러를 다시 만들지 않는다). */
  getGapRange: () => IdleRoutineGapRange;
  /** 추첨을 고정해 검증하기 위한 주입 지점이다. */
  random?: () => number;
  /** 표를 바꿔 추첨 규칙만 검증하기 위한 주입 지점이다. */
  routines?: readonly IdleRoutineDefinition[];
};

function createIdleRoutineScheduler({
  getGapRange,
  random = Math.random,
  routines = IDLE_ROUTINES
}: IdleRoutineDependencies) {
  let lastKind: string | null = null;
  let current: { kind: string; duration: number; startedAt: number } | null = null;
  let fade = 1;
  let nextAt = 0;

  function scheduleFirst(now: number) {
    nextAt = now + IDLE_ROUTINE_FIRST_GAP_MIN_MS + random() * IDLE_ROUTINE_FIRST_GAP_SPREAD_MS;
  }

  function schedule(now: number) {
    const { minGapMs, maxGapMs } = getGapRange();
    // 설정이 뒤집힌 값으로 들어와도 음수 간격이 나오지 않게 여기서 한 번 더 정렬한다.
    const minGap = Math.min(minGapMs, maxGapMs);
    const maxGap = Math.max(minGapMs, maxGapMs);
    nextAt = now + minGap + random() * (maxGap - minGap);
  }

  /** 설정이 바뀌면 진행 중이던 행동만 버린다(감쇠 상태와 직전 종류는 그대로 둔다). */
  function cancel() {
    current = null;
  }

  function weightOf(candidate: IdleRoutineDefinition) {
    const base = candidate.weight ?? 1;
    return candidate.kind === lastKind ? base * IDLE_ROUTINE_REPEAT_WEIGHT_FACTOR : base;
  }

  function pick() {
    const totalWeight = routines.reduce((sum, candidate) => sum + weightOf(candidate), 0);
    let roll = random() * totalWeight;
    let routine = routines[routines.length - 1];
    for (const candidate of routines) {
      roll -= weightOf(candidate);
      if (roll < 0) {
        routine = candidate;
        break;
      }
    }
    return routine;
  }

  function frame(routine: { kind: string }, progress: number): IdleRoutineFrame {
    return { kind: routine.kind, progress, amount: idleRoutineEase(progress) * fade };
  }

  function update(now: number, allowed: boolean, delta: number = 0): IdleRoutineFrame | null {
    if (!allowed) {
      schedule(now);
      if (!current) return null;
      // 진행 중이던 루틴은 바로 버리지 않고 짧게 감쇠시켜 보낸다.
      fade -= delta / IDLE_ROUTINE_INTERRUPT_FADE_SECONDS;
      if (fade <= 0) {
        current = null;
        fade = 1;
        return null;
      }
      return frame(current, (now - current.startedAt) / current.duration);
    }

    // 감쇠 도중에 방해가 끝났으면 같은 속도로 되돌린다(뚝 끊기지도, 갑자기 튀지도 않게).
    if (fade < 1) {
      fade = Math.min(1, fade + delta / IDLE_ROUTINE_INTERRUPT_FADE_SECONDS);
    }

    // requestAnimationFrame이 실제로 멈췄다가(디스플레이 꺼짐/PC 절전 등) 다시 돌기
    // 시작하면 nextAt이 멈춰있던 동안 갱신되지 못해 "이미 오래전에 지난" 값으로 남는다.
    // 그대로 두면 깨어난 첫 프레임에 now가 훌쩍 뛰어 있어 곧바로 "지났다"고 판정되어 랜덤
    // 루틴이 즉시 튀어나온다(2026-08-07 버그 리포트 — 자리 비웠다 돌아오면 몸 전체가 갑자기
    // 떤다). maxGap보다 훨씬 더 지나 있으면 정상적인 지연이 아니라고 보고 그냥 다시 스케줄만
    // 미루고 이번 프레임엔 발동시키지 않는다.
    if (!current && now >= nextAt + getGapRange().maxGapMs) {
      schedule(now);
    } else if (!current && now >= nextAt) {
      const routine = pick();
      current = { kind: routine.kind, duration: routine.duration, startedAt: now };
      lastKind = routine.kind;
      fade = 1;
    }

    if (!current) return null;

    const progress = (now - current.startedAt) / current.duration;
    if (progress >= 1) {
      current = null;
      schedule(now);
      return null;
    }

    return frame(current, progress);
  }

  return { scheduleFirst, schedule, cancel, update };
}

export {
  IDLE_ROUTINES,
  IDLE_ROUTINE_REPEAT_WEIGHT_FACTOR,
  IDLE_ROUTINE_INTERRUPT_FADE_SECONDS,
  IDLE_ROUTINE_FIRST_GAP_MIN_MS,
  IDLE_ROUTINE_FIRST_GAP_SPREAD_MS,
  createIdleRoutineScheduler
};
export type { IdleRoutineDefinition, IdleRoutineFrame, IdleRoutineGapRange, IdleRoutineDependencies };
