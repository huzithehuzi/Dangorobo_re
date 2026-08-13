// 꼬리의 흔들림 위상·각도·굽힘 누적.
//
// 누적 상태 세 개(phase·angle·bendAmount)를 이 모듈이 소유한다. 애니메이션 루프 분해의
// 선행 작업이며, 계산과 씬 적용을 갈라 둔 것이기도 하다 — 여기서는 목표 각도·곡률을 정하고
// 따라가기만 하고, `tailPivot.rotation.z` 대입과 정점 굽힘은 렌더러가 한다.
//
// 상태에 따라 속도가 바뀌는 주기 운동이므로 절대 elapsed에 속도를 곱하지 않고
// `phase += delta * angularSpeed`로 누적한다. 곱하는 방식은 속도가 바뀌는 순간 위상이
// 튀어서 꼬리가 순간이동한 것처럼 보인다.

import * as THREE from "three";

const TAIL_REST_ANGLE = -0.34;
const TAIL_BEND_STRENGTH = 2.6;

type TailRoutineMotion = { kind: string; amount: number } | null | undefined;
type TailAnswerMotion = { tailAmplitude?: number; tailSpeed?: number } | null | undefined;

type TailMotionInputs = {
  typingIntensity: number;
  /** 설정의 꼬리 속도 배율. */
  speedMultiplier: number;
  answerMotion: TailAnswerMotion;
  routineMotion: TailRoutineMotion;
};

function createTailMotion() {
  let phase = 0;
  let angle = TAIL_REST_ANGLE;
  let bendAmount = 0;

  /** 한 프레임 진행하고 씬에 적용할 각도·굽힘을 돌려준다. */
  function advance(delta: number, inputs: TailMotionInputs) {
    const { typingIntensity, speedMultiplier, answerMotion, routineMotion } = inputs;
    let desiredTailAngle = TAIL_REST_ANGLE;
    let desiredTailBend = 0;
    // 정지 상태로 돌아갈 때(또는 저역치)의 기본 추종 속도. 흔들리는 동안에는
    // 아래에서 각속도에 비례해 올려 잡는다.
    let tailFollowRate = 9;
    if (typingIntensity > 0) {
      const angularSpeed = (1.45 + typingIntensity * 3.05) * speedMultiplier;
      const amplitude = 0.2 + typingIntensity * 0.43;
      phase += delta * angularSpeed;
      desiredTailAngle = TAIL_REST_ANGLE + Math.sin(phase) * amplitude;
      // 각도의 위상보다 90도 앞선 코사인 값으로 "채찍처럼 끝이 따라오는" 곡률을 만든다.
      desiredTailBend = Math.cos(phase) * amplitude * TAIL_BEND_STRENGTH;
      // 추종 속도(9)가 고정이라 꼬리 속도(각속도)가 그보다 빨라지면 저역통과
      // 필터처럼 진폭이 깎여서 "빠르게 흔들수록 오히려 덜 휜다"는 문제가 있었다.
      // 각속도에 비례해 추종 속도를 같이 올려 항상 목표 각도·곡률을 따라잡게 한다.
      tailFollowRate = Math.max(9, angularSpeed * 5);
    } else if ((answerMotion?.tailAmplitude ?? 0) > 0) {
      const angularSpeed = (answerMotion?.tailSpeed ?? 0) * speedMultiplier;
      const amplitude = answerMotion?.tailAmplitude ?? 0;
      phase += delta * angularSpeed;
      desiredTailAngle = TAIL_REST_ANGLE + Math.sin(phase) * amplitude;
      desiredTailBend = Math.cos(phase) * amplitude * TAIL_BEND_STRENGTH;
      tailFollowRate = Math.max(8, angularSpeed * 4);
    } else if (routineMotion?.kind === "perkup") {
      const angularSpeed = 4.2 * speedMultiplier;
      const amplitude = 0.28;
      phase += delta * angularSpeed;
      desiredTailAngle = TAIL_REST_ANGLE + Math.sin(phase) * amplitude * routineMotion.amount;
      desiredTailBend = Math.cos(phase) * amplitude * TAIL_BEND_STRENGTH * routineMotion.amount;
      tailFollowRate = 14;
    } else if (routineMotion?.kind === "stretch") {
      desiredTailAngle = TAIL_REST_ANGLE - 0.3 * routineMotion.amount;
      desiredTailBend = -0.38 * routineMotion.amount;
      tailFollowRate = 8;
    } else if (routineMotion?.kind === "wave") {
      const angularSpeed = 3.8 * speedMultiplier;
      const amplitude = 0.24;
      phase += delta * angularSpeed;
      desiredTailAngle = TAIL_REST_ANGLE + Math.sin(phase) * amplitude * routineMotion.amount;
      desiredTailBend = Math.cos(phase) * amplitude * TAIL_BEND_STRENGTH * routineMotion.amount;
      tailFollowRate = 12;
    } else if (routineMotion?.kind === "shakeOff") {
      const angularSpeed = 9.5 * speedMultiplier;
      const amplitude = 0.28;
      phase += delta * angularSpeed;
      desiredTailAngle = TAIL_REST_ANGLE + Math.sin(phase) * amplitude * routineMotion.amount;
      desiredTailBend = Math.cos(phase) * amplitude * TAIL_BEND_STRENGTH * routineMotion.amount;
      tailFollowRate = 16;
    }
    const tailEase = 1 - Math.exp(-delta * tailFollowRate);
    angle = THREE.MathUtils.lerp(angle, desiredTailAngle, tailEase);
    bendAmount = THREE.MathUtils.lerp(bendAmount, desiredTailBend, tailEase);
    return { angle, bend: bendAmount };
  }

  return {
    advance,
    getPhase: () => phase,
    getAngle: () => angle,
    getBend: () => bendAmount
  };
}

export { createTailMotion, TAIL_REST_ANGLE, TAIL_BEND_STRENGTH };
export type { TailMotionInputs, TailRoutineMotion, TailAnswerMotion };
