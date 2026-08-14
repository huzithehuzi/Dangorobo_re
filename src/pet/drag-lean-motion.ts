// 드래그로 끌려가는 동안 몸통이 가로 관성 때문에 뒤로 기울었다가 진자처럼 몇 번 흔들리는
// 연출. 감쇠가 약한(underdamped) 스프링으로 순간 가로 속도를 목표 기울임 각도로 계속
// 뒤쫓게 하면, 손이 좌우로 움직이는 동안 몸이 그 뒤를 스윙하듯 따라오는 모양이 나온다.
//
// 놓는 순간에는 서서히 0으로 감쇠시키지 않고 즉시 0으로 되돌린다 — "놓으면 바로 복귀"
// 요구사항 때문이며, 스프링 잔여 속도가 남아있으면 놓은 뒤에도 잠깐 흔들려 부자연스럽다.

import * as THREE from "three";

const LEAN_STIFFNESS = 45;      // 클수록 목표 각도를 더 빠르게 뒤쫓는다
const LEAN_DAMPING = 7;         // 임계감쇠(2*sqrt(45)≈13.4)보다 작게 잡아 진자처럼 오버슈트한다
const LEAN_VELOCITY_GAIN = 0.00052; // 가로 속도(px/s) → 목표 각도(rad) 변환 계수(체감상 더 크게 기울도록 상향, 2026-08-15)
const LEAN_MAX_ANGLE = 0.42;    // 최대 기울임(rad), 약 24도(2026-08-15 상향)

function createDragLeanMotion() {
  let leanAngle = 0;
  let leanVelocity = 0;

  /**
   * 한 프레임 진행한다. dragReacting이 꺼지면 다음 호출까지 기다리지 않고 즉시 0으로
   * 되돌린다. dragDeltaX는 이번 프레임 동안 누적된 가로 이동량(px, 논리 좌표계).
   */
  function advance(delta: number, dragDeltaX: number, dragReacting: boolean) {
    if (!dragReacting) {
      leanAngle = 0;
      leanVelocity = 0;
      return 0;
    }
    const horizontalVelocity = delta > 0 ? dragDeltaX / delta : 0;
    const target = THREE.MathUtils.clamp(
      -horizontalVelocity * LEAN_VELOCITY_GAIN,
      -LEAN_MAX_ANGLE,
      LEAN_MAX_ANGLE
    );
    const acceleration = LEAN_STIFFNESS * (target - leanAngle) - LEAN_DAMPING * leanVelocity;
    leanVelocity += acceleration * delta;
    leanAngle += leanVelocity * delta;
    return leanAngle;
  }

  return { advance };
}

export { createDragLeanMotion, LEAN_MAX_ANGLE };
