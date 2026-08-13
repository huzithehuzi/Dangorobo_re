// 펫 동작의 순수 애니메이션 커브. 인자로 받은 진행도(0~1)만 보고 값을 돌려주며 3D·DOM·설정
// 상태를 전혀 참조하지 않는다 — 캡처로는 중간 구간의 모양을 확인할 수 없어 테스트로 고정한다.
//
// import 지정자에 `.js`를 붙이는 이유는 src/pet/tsconfig.build.json 주석 참고(noResolve 단일 파일 변환).
import * as THREE from "three";

function idleRoutineEase(progress: number) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  return Math.sin(p * Math.PI);
}

// stretch 전용 곡선: 기본 idleRoutineEase(사인 곡선)는 오르내림이 대칭이라 올리는 중에도
// 떨림이 겹쳐 보였다(2026-08-07 1차 피드백). "팍 올리고 서서히 내리기"로 나눴다가,
// 다시 피드백을 받아 반대로 바꿨다 — 서서히 들어올리고(45%), 다 뻗은 채로 유지하며
// 떨고(25%), 내려오는 건 빠르게(15%, ease-out) 끝낸다. 나머지 15%는 이미 내려온
// 상태로 대기.
function stretchReachAmount(progress: number) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  if (p < 0.45) {
    const t = p / 0.45;
    return 3 * t * t - 2 * t * t * t;
  }
  if (p < 0.7) return 1;
  if (p < 0.88) {
    // 내려오는 시작 순간이 뚝 끊기듯 보인다는 피드백(2026-08-07)으로 pow(1-t, 2)
    // (초반에 기울기가 가장 큰 곡선) 대신 양 끝 기울기가 0인 smoothstep으로 바꾸고
    // 구간도 살짝(15%→18%) 넓혔다. 여전히 올라가는 구간보다는 짧고 빠르다.
    const t = (p - 0.7) / 0.18;
    return 1 - (3 * t * t - 2 * t * t * t);
  }
  return 0;
}

// 눌렸다가 되돌아오는 스퀴시: 눌리고(0~0.3) → 반대로 살짝 튀고(0.3~0.68) → 되돌아온다.
function squishCurve(progress: number) {
  if (progress < 0.3) return THREE.MathUtils.smoothstep(progress, 0, 0.3);
  if (progress < 0.68) {
    return THREE.MathUtils.lerp(
      1,
      -0.18,
      THREE.MathUtils.smoothstep(progress, 0.3, 0.68)
    );
  }
  return THREE.MathUtils.lerp(
    -0.18,
    0,
    THREE.MathUtils.smoothstep(progress, 0.68, 1)
  );
}

export { idleRoutineEase, stretchReachAmount, squishCurve };
