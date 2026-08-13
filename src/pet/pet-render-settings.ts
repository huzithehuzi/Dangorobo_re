// 설정에서 파생되는 렌더 값들의 캐시.
//
// `applyPetSettings()`는 원래 두 가지를 한꺼번에 했다 — 설정에서 값을 클램프·정규화해
// 모듈 전역 열여섯 개에 대입하는 일과, DOM·씬에 실제로 적용하는 일. 앞의 절반만 이 모듈로
// 옮겼다. 파생 계산은 순수 함수라 Node에서 그대로 검증되고, 애니메이션 루프는 흩어진
// 전역 대신 이 스냅샷 하나만 읽으면 된다.
//
// 렌더러가 값을 되돌려 쓰지 못하도록 세터는 내보내지 않는다. 설정이 바뀔 때
// `apply()`로 통째로 갈아 끼운다.

import * as THREE from "three";
import type { Settings } from "../main/settings-schema.js";

// 파츠는 그대로 두고 전체 크기만 18% 줄여 머리 위쪽에 여유 공간을 만든다.
const BASE_PET_SCALE = 0.5904; // 0.72 * 0.82

type PetRenderSettingsSnapshot = {
  petBaseScale: number;
  tailSpeedMultiplier: number;
  mouseSquishEnabled: boolean;
  keyboardSquishEnabled: boolean;
  squishStrengthPercent: number;
  animaleseEnabled: boolean;
  animaleseIntervalMs: number;
  animalesePetChatEnabled: boolean;
  capsLockAlertEnabled: boolean;
  sleepEnabled: boolean;
  dragReactionEnabled: boolean;
  idleRoutineEnabled: boolean;
  idleRoutineMinGapMs: number;
  idleRoutineMaxGapMs: number;
  mediaNodEnabled: boolean;
  mediaVerticalOffset: number;
};

/**
 * 설정에서 렌더 값을 뽑는다. 설정이 없으면(창을 켠 직후) 기본값이 그대로 나오도록
 * 각 항목이 `undefined`를 안전하게 흡수한다.
 */
function derivePetRenderSettings(settings: Partial<Settings> | null | undefined): PetRenderSettingsSnapshot {
  const source = settings || {};
  const safeScale = THREE.MathUtils.clamp(Number(source.petScalePercent) || 100, 30, 130);
  const safeTailSpeed = THREE.MathUtils.clamp(Number(source.tailSpeedPercent) || 100, 25, 350);

  // 최소·최대가 뒤집혀 저장돼 있어도 좁은 쪽을 최소로 쓴다.
  const minSeconds = THREE.MathUtils.clamp(Number(source.idleRoutineMinSeconds) || 18, 5, 300);
  const maxSeconds = THREE.MathUtils.clamp(Number(source.idleRoutineMaxSeconds) || 42, 5, 300);

  const mediaPlayer: Partial<Settings["mediaPlayer"]> = source.mediaPlayer || {};
  const rawVerticalOffset = Number(mediaPlayer.verticalOffset);

  return {
    petBaseScale: BASE_PET_SCALE * safeScale / 100,
    tailSpeedMultiplier: safeTailSpeed / 100,
    mouseSquishEnabled: source.mouseSquishEnabled !== false,
    keyboardSquishEnabled: source.keyboardSquishEnabled !== false,
    squishStrengthPercent: THREE.MathUtils.clamp(Number(source.squishStrengthPercent) || 9, 5, 35),
    animaleseEnabled: source.animaleseEnabled === true,
    animaleseIntervalMs: THREE.MathUtils.clamp(Number(source.animaleseIntervalMs) || 45, 20, 150),
    animalesePetChatEnabled: source.animalesePetChatEnabled === true,
    capsLockAlertEnabled: source.capsLockAlertEnabled !== false,
    sleepEnabled: source.sleepEnabled !== false,
    dragReactionEnabled: source.dragReactionEnabled !== false,
    idleRoutineEnabled: source.idleRoutineEnabled !== false,
    idleRoutineMinGapMs: Math.min(minSeconds, maxSeconds) * 1000,
    idleRoutineMaxGapMs: Math.max(minSeconds, maxSeconds) * 1000,
    mediaNodEnabled: mediaPlayer.nodEnabled !== false,
    mediaVerticalOffset: THREE.MathUtils.clamp(
      Number.isFinite(rawVerticalOffset) ? rawVerticalOffset : 8,
      -20,
      80
    )
  };
}

function createPetRenderSettings() {
  let current = derivePetRenderSettings(null);

  return {
    /** 설정이 바뀔 때 스냅샷을 통째로 갈아 끼우고 새 값을 돌려준다. */
    apply(settings: Partial<Settings> | null | undefined) {
      current = derivePetRenderSettings(settings);
      return current;
    },
    get petBaseScale() { return current.petBaseScale; },
    get tailSpeedMultiplier() { return current.tailSpeedMultiplier; },
    get mouseSquishEnabled() { return current.mouseSquishEnabled; },
    get keyboardSquishEnabled() { return current.keyboardSquishEnabled; },
    get squishStrengthPercent() { return current.squishStrengthPercent; },
    get animaleseEnabled() { return current.animaleseEnabled; },
    get animaleseIntervalMs() { return current.animaleseIntervalMs; },
    get animalesePetChatEnabled() { return current.animalesePetChatEnabled; },
    get capsLockAlertEnabled() { return current.capsLockAlertEnabled; },
    get sleepEnabled() { return current.sleepEnabled; },
    get dragReactionEnabled() { return current.dragReactionEnabled; },
    get idleRoutineEnabled() { return current.idleRoutineEnabled; },
    get idleRoutineMinGapMs() { return current.idleRoutineMinGapMs; },
    get idleRoutineMaxGapMs() { return current.idleRoutineMaxGapMs; },
    get mediaNodEnabled() { return current.mediaNodEnabled; },
    get mediaVerticalOffset() { return current.mediaVerticalOffset; }
  };
}

export { createPetRenderSettings, derivePetRenderSettings, BASE_PET_SCALE };
export type { PetRenderSettingsSnapshot };
