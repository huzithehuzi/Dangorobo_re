// main이 알려주는 상호작용 상태.
//
// 타이핑 강도 목표치, 쓰다듬기, 축하, CapsLock, 유휴, 드래그 여섯 가지는 전부 preload
// 브리지 이벤트로만 바뀌고 애니메이션 단계 함수들이 읽기만 한다. 엔트리에 흩어진 `let`
// 여섯 개와 그 핸들러 배선을 한 소유자로 모은 것이며, main 쪽 `input-monitor.ts`와 같은
// 모양이다 — 모듈이 상태를 갖고 렌더러는 getter로 읽는다.
//
// preload 브리지는 다른 펫 모듈과 같이 `window.desktopPet`을 직접 쓴다 —
// `test/pet-renderer-types.test.js`가 그 표기를 훑어 "선언됐지만 안 쓰는 메서드"를 잡기
// 때문에, 주입으로 감추면 그 계약 검사가 무력해진다. 테스트에서는 window를 스텁한다.

const CELEBRATE_DURATION_MS = 1500;

type PetInteractionStateDependencies = {
  /** 축하 만료 시각 비교용. 테스트에서 가상 시간을 넣는다. */
  now: () => number;
  /** 쓰다듬기가 시작/종료되는 순간에만 부른다(하트 연출은 DOM이라 렌더러가 갖는다). */
  onPettingStart: () => void;
  onPettingStop: () => void;
};

function createPetInteractionState(deps: PetInteractionStateDependencies) {
  let targetTypingIntensity = 0;
  let pettingActive = false;
  let celebrateUntil = 0;
  let capsLockActive = false;
  let idleActive = false;
  let dragActive = false;

  window.desktopPet.onTypingIntensity((intensity) => {
    targetTypingIntensity = intensity;
  });
  window.desktopPet.onPetting((state) => {
    const active = state?.active === true;
    // 전이하는 순간에만 알린다 — 같은 상태가 연달아 와도 하트가 다시 뿌려지지 않는다.
    if (active && !pettingActive) deps.onPettingStart();
    if (!active && pettingActive) deps.onPettingStop();
    pettingActive = active;
  });
  window.desktopPet.onCelebrate(() => {
    celebrateUntil = deps.now() + CELEBRATE_DURATION_MS;
  });
  window.desktopPet.onCapsLock((state) => {
    capsLockActive = state?.active === true;
  });
  window.desktopPet.onIdle((state) => {
    idleActive = state?.idle === true;
  });
  window.desktopPet.onDragState((state) => {
    dragActive = state?.dragging === true;
  });

  return {
    /** 타이핑 강도의 목표치. 실제 표시값은 애니메이션이 부드럽게 따라간다. */
    getTargetTypingIntensity: () => targetTypingIntensity,
    isPetting: () => pettingActive,
    /** 체크리스트 항목을 체크하면 잠깐 알림 때와 같은 만세 동작을 한다. */
    isCelebrating: () => deps.now() < celebrateUntil,
    isCapsLockActive: () => capsLockActive,
    isIdle: () => idleActive,
    isDragging: () => dragActive
  };
}

export { createPetInteractionState, CELEBRATE_DURATION_MS };
export type { PetInteractionStateDependencies };
