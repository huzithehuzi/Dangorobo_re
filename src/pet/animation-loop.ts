// 프레임 루프.
//
// `animate()`는 "어떤 순서로 무엇을 갱신하는가"만 남기고 실제 계산은 단계별 함수들이 한다.
// 예전에는 418줄이 한 함수에 이어져 있어서, 세 부위(머리·손·꼬리)가 **각자 조금씩 다른
// 순서로** 같은 우선순위 사다리(드래그 > 수면 > 답변 > 쓰다듬기 > 아이들 루틴 > 알람)를
// 재구현하고 있다는 사실이 묻혀 있었다.
//
// 부위별 공통 규칙: 먼저 "평상시 포즈"를 정하고, 아이들 루틴이 있으면 그 위에 섞고,
// 마지막에 alarmAmount 비율로 알람 포즈와 섞는다(알람이 항상 최우선). 알람·수면·
// 쓰다듬기 같은 상태 전이는 boolean이 아니라 0~1 amount로 완만하게 따라가는데,
// 그래야 상태가 바뀔 때 동작이 뚝 끊기지 않는다.
//
// 루프 전용 누적 상태(부드러운 입력값·알람/수면 amount·숨쉬기 위상·꼬리 굽힘 적용값)는
// 이 모듈이 소유한다. **호출 순서가 곧 의존 관계다** — updateFrameState()가 alarmAmount를
// 갱신한 뒤에야 머리·손이 그 값으로 알람 포즈를 섞을 수 있다.
//
// 로딩 뒤에 재대입되는 값(headPivot·tailPivot·faceTrembleAmplitude)과 렌더러가 소유한
// 플래그(restActive·clickThrough·mediaState)는 값이 아니라 getter로 받는다. 루프는
// 모델 로드가 끝난 뒤 start()로 시작하므로 그 시점엔 전부 채워져 있다.

import * as THREE from "three";
import { createBlinkTimer } from "./blink-timer.js";
import { createTailMotion } from "./tail-motion.js";
import { stretchReachAmount } from "./motion-curves.js";
import { isVisibleVariationMesh } from "./pet-model-mesh.js";
import type { PetModelRefs } from "./pet-model-refs.js";
import type { VariationMesh } from "./pet-model-types.js";
import type { IdleRoutineFrame } from "./idle-routine.js";

type TailBendData = {
  base: Float32Array;
  minY: number;
  maxY: number;
  scale: number;
};

type AnimationLoopDependencies = {
  // 씬 핸들과 기하 상수.
  pet: THREE.Group;
  modelRoot: THREE.Group;
  frontCorrection: THREE.Quaternion;
  postProcessUniforms: Record<string, { value: unknown }>;
  pointer: THREE.Vector2;
  clock: THREE.Clock;
  BASE_PET_Y: number;
  PET_BOTTOM_ANCHOR_Y: number;
  // 말풍선·미디어 DOM(표시 여부만 본다).
  assistantAnswerBubble: HTMLElement;
  petChatBubble: HTMLElement;
  mediaPlayer: HTMLElement;
  // 소유자 모듈들.
  model: PetModelRefs;
  renderSettings: { petBaseScale: number; squishStrengthPercent: number; sleepEnabled: boolean;
    dragReactionEnabled: boolean; capsLockAlertEnabled: boolean; tailSpeedMultiplier: number;
    idleRoutineEnabled: boolean; mediaNodEnabled: boolean };
  squishMotion: { advanceDragPulse: (delta: number, dragReacting: boolean) => void;
    advance: (delta: number, strengthPercent: number) => { squishAmount: number; wobbleAmount: number } };
  interactionState: { getTargetTypingIntensity: () => number; isPetting: () => boolean;
    isCelebrating: () => boolean; isCapsLockActive: () => boolean; isIdle: () => boolean;
    isDragging: () => boolean };
  assistantPanels: { isAssistantActive: () => boolean; isFavoritesActive: () => boolean;
    answerExpressionKey: () => string | null };
  customizeLabels: { updateLayout: () => void };
  idleRoutineScheduler: { update: (now: number, allowed: boolean, delta?: number) => IdleRoutineFrame | null };
  // 로딩 뒤에 채워지거나 렌더러가 소유하는 값은 getter로 받는다.
  headPivot: () => THREE.Group;
  tailPivot: () => THREE.Group;
  faceTrembleAmplitude: () => number;
  restActive: () => boolean;
  clickThrough: () => boolean;
  mediaState: () => { status: string };
  // 렌더러가 계속 갖는 동작들.
  renderPetScene: () => void;
  setFaceExpressionKey: (key: string | null | undefined) => void;
  updateMediaPlayerPosition: () => void;
};

function createAnimationLoop(deps: AnimationLoopDependencies) {
  const {
    pet, modelRoot, frontCorrection, postProcessUniforms, pointer, clock,
    BASE_PET_Y, PET_BOTTOM_ANCHOR_Y,
    assistantAnswerBubble, petChatBubble, mediaPlayer,
    model, renderSettings, squishMotion, interactionState, assistantPanels,
    customizeLabels, idleRoutineScheduler,
    renderPetScene, setFaceExpressionKey, updateMediaPlayerPosition
  } = deps;

  // 손은 frontCorrection(Y축 -90도)이 이미 걸려 있어 rotation.z를 직접 건드리면
  // 회전축이 뒤틀려 거의 안 보인다. 흔드는 각도는 항상 월드 Z축(화면상 좌우 기울임) 기준으로
  // 만들고, frontCorrection과 쿼터니언으로 합성해야 실제로 보이는 흔들림이 나온다.
  const HAND_WAVE_AXIS = new THREE.Vector3(0, 0, 1);
  const handWaveQuat = new THREE.Quaternion();
  function setHandWave(mesh: THREE.Object3D, angle: number) {
    handWaveQuat.setFromAxisAngle(HAND_WAVE_AXIS, angle);
    mesh.quaternion.copy(handWaveQuat).multiply(frontCorrection);
  }


  // 캡스락이 켜져 있으면 눈·입 데칼만 제자리에서 잘게 떨어 "덜덜" 떠는 느낌을 준다.
  // 눈과 입에 서로 다른 위상을 줘서 한 덩어리로 움직이지 않게 한다.
  function applyFaceTremble(elapsed: number, active: boolean) {
    const tremblingPlateIds: Array<"eye" | "mouth" | "customFace"> = ["eye", "mouth", "customFace"];
    for (const id of tremblingPlateIds) {
      const plate = model.facePlates[id];
      const base = plate?.userData.basePosition;
      if (!plate || !base) continue;
      if (!active) {
        plate.position.copy(base);
        continue;
      }
      const phase = id === "eye" ? 0 : id === "mouth" ? 1.7 : 0.8;
      plate.position.set(
        base.x + Math.sin(elapsed * 47 + phase) * deps.faceTrembleAmplitude(),
        base.y + Math.sin(elapsed * 61 + phase * 2) * deps.faceTrembleAmplitude(),
        base.z
      );
    }
  }


  const blinkTimer = createBlinkTimer();


  const smoothedPointer = new THREE.Vector2();
  let typingIntensity = 0;

  // 머리 쓰다듬기: main 프로세스가 전역 마우스 훅으로 판정해 pet:petting으로 알려준다.
  // 표정은 pettingActive(즉시 반영)로, 고개 숙임은 pettingAmount(부드러운 전환)로 처리한다.
  const PETTING_BOW_RAD = 0.2;
  let pettingAmount = 0;
  // 체크리스트 축하 동작이 끝나는 시각(performance.now 기준). 0이면 축하 중이 아니다.
  // 알림(휴식)/체크리스트 축하 포즈(만세). alarmPose는 즉시 켜지고 꺼지므로, 그 순간
  // 고개/팔이 뚝 끊겨 보이지 않도록 alarmAmount로 부드럽게 섞어서 적용한다
  // (pettingAmount와 같은 방식, 2026-08-02 사용자 피드백으로 추가).
  let alarmAmount = 0;
  // 캡스락 켜짐 알림: main이 pet:caps-lock으로 실제 잠금 상태를 알려주고,
  // 표시 여부는 렌더러가 설정(renderSettings.capsLockAlertEnabled)으로 판단한다.
  // 잠자기: main이 유휴 여부만 알려주고(pet:idle), 실제로 잘지는 렌더러가 판단한다
  // (미디어 재생 중에는 재우지 않기 위해 — 영상 보는 동안 잠들면 곤란하다).
  const SLEEP_HEAD_DROOP_RAD = 0.34;
  let sleepAmount = 0;
  // 좌우 시선 중 몸통(modelRoot)이 나눠 맡는 비율. 나머지는 머리에 남는다 —
  // 자세한 이유는 updateHeadRotation() 끝의 주석 참고. 평상시 추종의 최대 좌우 각도가
  // 0.62rad(약 35도)이므로 몸통은 최대 약 6도만 돌아간다("머리만큼은 아니고 살짝").
  // 더 올릴 거라면 몸 무늬·데칼이 옆으로 밀려 보이지 않는지 실제 창에서 함께 확인할 것.
  const BODY_FOLLOW_RATIO = 0.18;
  // 숨쉬기 위상. 속도(breatheSpeed)가 sleepAmount에 따라 변하므로 `elapsed * speed`로
  // 계산하면 안 된다 — 잠들거나 깨는 동안 속도가 바뀌는 순간 sin의 인자가
  // `Δspeed * elapsed`만큼 통째로 점프해서(유휴 5분이면 elapsed가 300초 이상이라 180라디안,
  // 약 30주기) 스퀴시가 빠르게 반복 재생되는 것처럼 보였다(2026-08-08 수정).
  // 매 프레임 `speed * delta`씩 누적하면 속도를 바꿔도 위상이 연속으로 이어진다.
  let breathePhase = 0;

  const tailMotion = createTailMotion();
  let tailBendApplied = 0;
  // 뿌리는 거의 안 휘고 끝으로 갈수록 곡률이 커지도록 t^0.7로 가중치를 준다.
  // (뼈대 없이 단일 메시라 프레임마다 정점을 직접 굽혀 곡선처럼 보이게 한다.)
  const TAIL_BEND_CURVE_POWER = 0.7;
  const TAIL_BEND_MAX_ANGLE = 0.85;
  // 꼬리 바리에이션마다 길이(로컬 Y 범위)가 크게 다르다(둥근꼬리 ~4, 고양이/안테나
  // ~12~13.5). 같은 각도라도 팔 길이(반지름)가 길수록 끝의 실제 이동 거리가 커져서,
  // 긴 꼬리는 몸 아래까지 파고들고 짧은 꼬리는 얌전해 보이는 차이가 났다. 둥근꼬리
  // 기준 길이로 정규화해 "끝이 실제로 움직이는 거리"를 바리에이션과 무관하게 비슷하게 맞춘다.
  const TAIL_BEND_REFERENCE_LENGTH = 4;
  // 길이 정규화만으로는 부족했다 — 둥근꼬리는 길이(4) 대비 폭(~2.7)이 넓어 세장비
  // (길이/폭)가 1.5 정도로 통통한데, 같은 각도로 굽히면 가느다란 꼬리(고양이 6.2,
  // 안테나 3.0)와 달리 뭉툭한 덩어리가 접히는 것처럼 부자연스러워 보였다. 세장비가
  // 낮을수록(통통할수록) 굽힘 각도를 추가로 줄인다. 기준값(3)은 안테나 꼬리의
  // 세장비 — 그보다 가느다란 꼬리는 그대로 두고, 그보다 통통한 꼬리만 깎는다.
  const TAIL_BEND_REFERENCE_ASLENDERNESS = 3;

  function canRunIdleRoutine({ sleeping, assistantAnswerShown, celebrating, dragReacting }: { sleeping: boolean, assistantAnswerShown: boolean, celebrating: boolean, dragReacting: boolean }) {
    return !deps.restActive() &&
      renderSettings.idleRoutineEnabled &&
      !assistantPanels.isAssistantActive() &&
      !assistantAnswerShown &&
      !assistantPanels.isFavoritesActive() &&
      deps.clickThrough() &&
      !sleeping &&
      !celebrating &&
      !interactionState.isPetting() &&
      !dragReacting &&
      deps.mediaState().status !== "Playing";
  }

  function assistantExpressionMotion(expressionKey: string | null, elapsed: number) {
    switch (expressionKey) {
      case "happy":
        return {
          amount: 1,
          headY: Math.sin(elapsed * 8.4) * 0.08,
          headX: Math.sin(elapsed * 7.2) * 0.08,
          headZ: Math.sin(elapsed * 6.4) * 0.05,
          handY: Math.sin(elapsed * 9.5) * 0.08,
          handWave: Math.sin(elapsed * 10.5) * 0.2,
          tailAmplitude: 0.34,
          tailSpeed: 4.8
        };
      case "angry":
        return {
          amount: 1,
          headY: Math.sin(elapsed * 13) * 0.13,
          headX: -0.08 + Math.sin(elapsed * 18) * 0.035,
          headZ: Math.sin(elapsed * 16) * 0.055,
          handY: 0.04,
          handWave: Math.sin(elapsed * 16) * 0.18,
          tailAmplitude: 0.22,
          tailSpeed: 6.4
        };
      case "sad":
        return {
          amount: 1,
          headY: Math.sin(elapsed * 2.5) * 0.035,
          headX: 0.18 + Math.sin(elapsed * 1.8) * 0.035,
          headZ: 0.05,
          handY: -0.05,
          handWave: -0.12,
          tailAmplitude: 0.08,
          tailSpeed: 1.2
        };
      case "shocked":
        return {
          amount: 1,
          headY: Math.sin(elapsed * 20) * 0.1,
          headX: -0.2 + Math.sin(elapsed * 24) * 0.07,
          headZ: Math.sin(elapsed * 22) * 0.06,
          handY: 0.14 + Math.sin(elapsed * 18) * 0.05,
          handWave: Math.sin(elapsed * 18) * 0.34,
          tailAmplitude: 0.24,
          tailSpeed: 5.8
        };
      case "alarm":
        return {
          amount: 1,
          headY: Math.sin(elapsed * 8.8) * 0.1,
          headX: -0.08 + Math.sin(elapsed * 10.5) * 0.09,
          headZ: Math.sin(elapsed * 8.2) * 0.07,
          handY: 0.2 + Math.sin(elapsed * 11) * 0.05,
          handWave: Math.sin(elapsed * 13) * 0.36,
          tailAmplitude: 0.36,
          tailSpeed: 5.2
        };
      default:
        return null;
    }
  }

  function ensureTailBendCache(mesh: VariationMesh): TailBendData {
    const cachedBase = mesh.userData.tailBendBase;
    const cachedMinY = mesh.userData.tailBendMinY;
    const cachedMaxY = mesh.userData.tailBendMaxY;
    const cachedScale = mesh.userData.tailBendScale;
    if (cachedBase instanceof Float32Array &&
        typeof cachedMinY === "number" &&
        typeof cachedMaxY === "number" &&
        typeof cachedScale === "number") {
      return { base: cachedBase, minY: cachedMinY, maxY: cachedMaxY, scale: cachedScale };
    }

    const geometry = mesh.geometry;
    const positionAttr = geometry.getAttribute("position");
    if (!(positionAttr instanceof THREE.BufferAttribute)) {
      throw new Error("꼬리 위치 버퍼를 읽을 수 없다");
    }
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!bounds) throw new Error("꼬리 경계 상자를 계산하지 못했다");

    const base = Float32Array.from(positionAttr.array);
    const minY = bounds.min.y;
    const maxY = bounds.max.y;
    const range = Math.max(maxY - minY, 0.0001);
    const lengthScale = THREE.MathUtils.clamp(TAIL_BEND_REFERENCE_LENGTH / range, 0.2, 1);
    const width = Math.max(
      bounds.max.x - bounds.min.x,
      bounds.max.z - bounds.min.z,
      0.0001
    );
    const slenderness = range / width;
    const slendernessScale = THREE.MathUtils.clamp(slenderness / TAIL_BEND_REFERENCE_ASLENDERNESS, 0.3, 1);
    const scale = lengthScale * slendernessScale;
    mesh.userData.tailBendBase = base;
    mesh.userData.tailBendMinY = minY;
    mesh.userData.tailBendMaxY = maxY;
    mesh.userData.tailBendScale = scale;
    return { base, minY, maxY, scale };
  }

  function applyTailBend(rawAmount: number) {
    const activeTail = deps.tailPivot().children.find(isVisibleVariationMesh);
    if (!activeTail) return;
    const clampedAmount = THREE.MathUtils.clamp(rawAmount, -TAIL_BEND_MAX_ANGLE, TAIL_BEND_MAX_ANGLE);
    if (Math.abs(clampedAmount) < 0.0005 && Math.abs(tailBendApplied) < 0.0005) return;
    const { base, minY, maxY, scale } = ensureTailBendCache(activeTail);
    const amount = clampedAmount * scale;
    const range = Math.max(maxY - minY, 0.0001);
    const positionAttr = activeTail.geometry.getAttribute("position");
    if (!(positionAttr instanceof THREE.BufferAttribute)) {
      throw new Error("꼬리 위치 버퍼를 쓸 수 없다");
    }
    const arr = positionAttr.array;
    for (let i = 0; i < arr.length; i += 3) {
      const y = base[i + 1];
      const z = base[i + 2];
      const relY = y - minY;
      const t = THREE.MathUtils.clamp(relY / range, 0, 1);
      const angle = amount * Math.pow(t, TAIL_BEND_CURVE_POWER);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // 꼬리 메시엔 MODEL_FRONT_CORRECTION_Y(로컬 Y축 -90도 보정)가 걸려 있어,
      // 로컬 X를 굽히면 화면상 앞뒤(깊이) 방향으로 튀어나와 몸을 뚫는다.
      // tailPivot이 흔드는 평면(좌우)과 맞추려면 로컬 Z-Y 평면에서 굽혀야 한다.
      arr[i + 2] = z * cos - relY * sin;
      arr[i + 1] = minY + (z * sin + relY * cos);
    }
    positionAttr.needsUpdate = true;
    activeTail.geometry.computeVertexNormals();
    tailBendApplied = clampedAmount;
  }

  // 상태 블렌딩용 지수 감쇠. 예전엔 전부 delta와 무관한 고정 계수(lerp(a, b, 0.085) 같은)를
  // 써서 전환 속도가 주사율에 그대로 붙어 있었다 — 144Hz에서는 60Hz보다 2배 넘게 빨랐고
  // 다른 앱이 GPU를 점유해 30fps로 떨어지면 절반 속도로 늘어졌다. 꼬리(tailFollowRate)만
  // 원래 이 방식이었어서 두 계열이 서로 어긋나기도 했다(2026-08-07 통일).
  // rate는 `-60 * ln(1 - 기존계수)`로 뽑아서 60Hz에서의 기존 체감이 그대로 보존된다.
  const SMOOTH_RATE_POINTER = 5.33;   // 기존 0.085
  const SMOOTH_RATE_TYPING = 2.76;    // 기존 0.045
  const SMOOTH_RATE_PETTING = 7.67;   // 기존 0.12
  const SMOOTH_RATE_SLEEP = 3.08;     // 기존 0.05 — 잠들고 깨는 건 천천히
  const SMOOTH_RATE_ALARM = 9.05;     // 기존 0.14
  function smoothStep(current: number, target: number, rate: number, delta: number) {
    return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-delta * rate));
  }

  // ── 프레임 루프 ────────────────────────────────────────────────────────────────
  // animate()는 "어떤 순서로 무엇을 갱신하는가"만 남기고, 실제 계산은 아래 단계별
  // 함수들이 한다. 예전에는 418줄이 한 함수에 이어져 있어서, 세 부위(머리·손·꼬리)가
  // **각자 조금씩 다른 순서로** 같은 우선순위 사다리(드래그 > 수면 > 답변 > 쓰다듬기 >
  // 아이들 루틴 > 알람)를 재구현하고 있다는 사실이 묻혀 있었다.
  //
  // 부위별 공통 규칙: 먼저 "평상시 포즈"를 정하고, 아이들 루틴이 있으면 그 위에 섞고,
  // 마지막에 alarmAmount 비율로 알람 포즈와 섞는다(알람이 항상 최우선). 알람·수면·
  // 쓰다듬기 같은 상태 전이는 boolean이 아니라 0~1 amount로 완만하게 따라가는데,
  // 그래야 상태가 바뀔 때 동작이 뚝 끊기지 않는다.
  //
  // 단계 함수들은 모듈 전역 상태(typingIntensity·sleepAmount·alarmAmount 등)를
  // 그대로 읽고 쓴다. **호출 순서가 곧 의존 관계다** — updateFrameState()가 alarmAmount를
  // 갱신한 뒤에야 머리·손이 그 값으로 알람 포즈를 섞을 수 있다.

  /** 시간 진행에 따라 따라가는 값들(포인터 추종, 타이핑/쓰다듬기/수면 amount)을 갱신한다. */
  function advanceSmoothedInputs(delta: number) {
    smoothedPointer.lerp(pointer, 1 - Math.exp(-delta * SMOOTH_RATE_POINTER));
    const targetTyping = interactionState.getTargetTypingIntensity();
    typingIntensity = smoothStep(typingIntensity, targetTyping, SMOOTH_RATE_TYPING, delta);
    if (typingIntensity < 0.006 && targetTyping === 0) typingIntensity = 0;
    const petting = interactionState.isPetting();
    pettingAmount = smoothStep(pettingAmount, petting ? 1 : 0, SMOOTH_RATE_PETTING, delta);
    if (pettingAmount < 0.004 && !petting) pettingAmount = 0;

    // 미디어 재생 중이면 재우지 않는다(영상·음악 감상 중엔 오히려 리듬을 타는 게 자연스럽다).
    const sleeping = interactionState.isIdle() && renderSettings.sleepEnabled && deps.mediaState().status !== "Playing";
    sleepAmount = smoothStep(sleepAmount, sleeping ? 1 : 0, SMOOTH_RATE_SLEEP, delta);
    if (sleepAmount < 0.004 && !sleeping) sleepAmount = 0;
    const dragReacting = interactionState.isDragging() && renderSettings.dragReactionEnabled;
    squishMotion.advanceDragPulse(delta, dragReacting);
    return { sleeping, dragReacting };
  }

  /** 몸통 변형: 입력 스퀴시 + 그 뒤에 남는 출렁임 + 숨쉬기. */
  function updateBodyDeform(delta: number) {
    // 스퀴시 본동작과 그 뒤 가로 출렁임의 진행은 squish-motion.ts가 소유한다.
    const { squishAmount, wobbleAmount } = squishMotion.advance(delta, renderSettings.squishStrengthPercent);

    // 숨쉬기(세로로 살짝 부풀었다 줄어듦). 발밑 앵커 보정은 아래 pet.position.y 공식이
    // scaleY 변화를 그대로 상쇄해주므로 따로 손댈 필요가 없다.
    // 2026-08-07까지는 진폭에 sleepAmount가 곱해져 있어서 **잘 때만** 숨을 쉬었다 — 그래서
    // 깨어 있는 평상시엔 눈 깜빡임 말고는 아무 움직임이 없는 완전 정지 상태였다. 지금은
    // 깨어 있을 때도 숨을 쉬고, 잘 때 더 크고 느려진다.
    // 진폭은 처음에 깰 때 0.007 / 잘 때 0.022(= 예전 값)로 넣었는데 "너무 얕다, 잘 때도
    // 얕았으니 전체적으로 눈에 띄게 늘리자"는 피드백으로 각각 0.022 / 0.048로 올렸다.
    // 더 올릴 거라면 외곽선·픽셀 아트에서 실루엣이 떨려 보이지 않는지 같이 확인할 것.
    const breatheAmplitude = 0.022 + 0.026 * sleepAmount;
    const breatheSpeed = 2.2 - 0.6 * sleepAmount;
    // 위상 누적(breathePhase 선언부의 주석 참고). 2π로 감아서 장시간 실행해도
    // 부동소수점 정밀도가 떨어지지 않게 한다.
    breathePhase = (breathePhase + breatheSpeed * delta) % (Math.PI * 2);
    const breathe = Math.sin(breathePhase) * breatheAmplitude;
    // 출렁임은 X를 늘리면 Z를 줄이는 식으로 반대로 밀어(부피 유지) "말랑한 젤리"처럼 보이게
    // 하고, Y에는 아주 약하게만 준다(세로는 이미 본 스퀴시가 크게 움직인다).
    const scaleX = renderSettings.petBaseScale * (1 + squishAmount * 0.58) * (1 - breathe * 0.5) * (1 + wobbleAmount);
    const scaleY = renderSettings.petBaseScale * (1 - squishAmount) * (1 + breathe) * (1 - wobbleAmount * 0.22);
    const scaleZ = renderSettings.petBaseScale * (1 + squishAmount * 0.3) * (1 - breathe * 0.5) * (1 - wobbleAmount * 0.6);
    pet.scale.set(scaleX, scaleY, scaleZ);
    pet.position.y = BASE_PET_Y + (renderSettings.petBaseScale - scaleY) * PET_BOTTOM_ANCHOR_Y;
  }

  /**
   * 이번 프레임의 "무슨 상태인가"를 한 번에 정한다 — 아래 부위별 갱신이 전부 이 결과를 본다.
   * 아이들 루틴 진행과 alarmAmount 추종도 여기서 한 번만 처리한다(부위마다 하면 어긋난다).
   */
  function updateFrameState(delta: number, elapsed: number, base: ReturnType<typeof advanceSmoothedInputs>) {
    const { sleeping, dragReacting } = base;
    // petChat은 답장 전(펫이 먼저 말 거는 중)에도 assistantAnswerBubble과 같은 취급(끄덕임/표정)을 받는다.
    const assistantAnswerShown = assistantPanels.isAssistantActive() && (!assistantAnswerBubble.hidden || !petChatBubble.hidden);
    // 체크리스트 항목을 체크하면 잠깐(CELEBRATE_DURATION_MS) 알림 때와 같은 만세 동작으로
    // 축하해준다. 알림이 실제로 울리는 중이면 알림이 우선이다.
    const now = performance.now();
    const celebrating = interactionState.isCelebrating();
    const routineMotion = idleRoutineScheduler.update(now, canRunIdleRoutine({
      sleeping,
      assistantAnswerShown,
      celebrating,
      dragReacting
    }), delta);
    const answerMotion = assistantAnswerShown ? assistantExpressionMotion(assistantPanels.answerExpressionKey(), elapsed) : null;
    const alarmPose = deps.restActive() || celebrating;
    // alarmPose는 즉시 켜지고/꺼지는 boolean이라 그대로 쓰면 고개·팔이 뚝 끊겨 보인다.
    // pettingAmount/sleepAmount와 같은 방식으로 alarmAmount를 부드럽게 따라가게 하고,
    // 부위별 갱신에서는 "평상시 포즈"를 먼저 계산한 뒤 alarmAmount 비율만큼 알람 포즈와 섞는다.
    alarmAmount = smoothStep(alarmAmount, alarmPose ? 1 : 0, SMOOTH_RATE_ALARM, delta);
    if (alarmAmount < 0.004 && !alarmPose) alarmAmount = 0;
    return { sleeping, dragReacting, assistantAnswerShown, celebrating, routineMotion, answerMotion };
  }

  /**
   * 머리 회전: 평상시 추종 → 아이들 루틴 → 알람 순으로 덮어쓴다.
   * 마지막에 정해진 좌우 각도의 일부를 몸통이 나눠 맡는다(아래 BODY_FOLLOW_RATIO).
   */
  function updateHeadRotation(elapsed: number, state: ReturnType<typeof updateFrameState>) {
    // 수면은 boolean(sleeping)이 아니라 sleepAmount로 판정한다 — 잠들고 깨는 사이에도
    // 추종 성분이 서서히 줄어야 해서다.
    const { dragReacting, assistantAnswerShown, routineMotion, answerMotion } = state;
    let headRotY, headRotX, headRotZ;
    if (dragReacting) {
      // 들어올려지면 놀라서 고개를 빠르게 흔든다(알람보다는 잘고 빠른 진동).
      headRotY = Math.sin(elapsed * 21) * 0.16;
      headRotX = -0.1 + Math.sin(elapsed * 26) * 0.08;
      headRotZ = Math.sin(elapsed * 17) * 0.1;
    } else if (sleepAmount > 0.01) {
      // 잘 때는 커서를 따라가지 않고(추적 성분을 sleepAmount로 줄임) 고개를 숙인 채
      // 아주 천천히 끄덕인다.
      const awake = 1 - sleepAmount;
      headRotY = smoothedPointer.x * 0.62 * awake;
      headRotX = -smoothedPointer.y * 0.27 * awake +
        (SLEEP_HEAD_DROOP_RAD + Math.sin(elapsed * 1.6) * 0.03) * sleepAmount;
      headRotZ = -smoothedPointer.x * 0.05 * awake + 0.06 * sleepAmount;
    } else if (assistantAnswerShown) {
      headRotY = smoothedPointer.x * 0.35;
      headRotX = -smoothedPointer.y * 0.16 + Math.sin(elapsed * 7.4) * 0.24;
      headRotZ = -smoothedPointer.x * 0.03;
      if (answerMotion) {
        headRotY += answerMotion.headY;
        headRotX += answerMotion.headX;
        headRotZ += answerMotion.headZ;
      }
    } else if (pettingAmount > 0.01) {
      // 쓰다듬는 동안엔 고개를 살짝 숙이고(rotation.x 양수 = 아래를 봄) 기분 좋게 몸을 살랑인다.
      // pettingAmount로 감쌌기 때문에 쓰다듬기 시작/종료 시 뚝 끊기지 않고 부드럽게 전환된다.
      headRotY = smoothedPointer.x * 0.3 + Math.sin(elapsed * 5.5) * 0.05 * pettingAmount;
      headRotX = -smoothedPointer.y * 0.12 + PETTING_BOW_RAD * pettingAmount;
      headRotZ = Math.sin(elapsed * 4.2) * 0.045 * pettingAmount;
    } else if (renderSettings.mediaNodEnabled && deps.mediaState().status === "Playing") {
      headRotY = smoothedPointer.x * 0.3 + Math.sin(elapsed * 1.7) * 0.1;
      headRotX = -smoothedPointer.y * 0.14 + Math.sin(elapsed * 3.4) * 0.16;
      headRotZ = Math.sin(elapsed * 1.7) * 0.04;
    } else {
      headRotY = smoothedPointer.x * 0.62;
      headRotX = -smoothedPointer.y * 0.27;
      headRotZ = -smoothedPointer.x * 0.05;
    }
    if (routineMotion?.kind === "lookAround") {
      const sweep = Math.sin(routineMotion.progress * Math.PI * 2.2);
      headRotY = THREE.MathUtils.lerp(headRotY, sweep * 0.55, routineMotion.amount);
      headRotX = THREE.MathUtils.lerp(headRotX, -0.06 + Math.sin(routineMotion.progress * Math.PI * 3) * 0.05, routineMotion.amount);
      headRotZ = THREE.MathUtils.lerp(headRotZ, -sweep * 0.08, routineMotion.amount);
    } else if (routineMotion?.kind === "stretch") {
      const stretchReach = stretchReachAmount(routineMotion.progress);
      const headTrembleEnvelope = Math.pow(stretchReach, 10);
      const headTremble = Math.sin(elapsed * 46) * 0.02 * headTrembleEnvelope;
      headRotY = THREE.MathUtils.lerp(headRotY, Math.sin(elapsed * 3.5) * 0.08, stretchReach);
      headRotX = THREE.MathUtils.lerp(headRotX, -0.34 + headTremble, stretchReach);
      headRotZ = THREE.MathUtils.lerp(headRotZ, Math.sin(elapsed * 5) * 0.05, stretchReach);
    } else if (routineMotion?.kind === "perkup") {
      headRotY = THREE.MathUtils.lerp(headRotY, Math.sin(elapsed * 9) * 0.12, routineMotion.amount);
      headRotX = THREE.MathUtils.lerp(headRotX, -0.12, routineMotion.amount);
      headRotZ = THREE.MathUtils.lerp(headRotZ, Math.sin(elapsed * 7) * 0.08, routineMotion.amount);
    } else if (routineMotion?.kind === "wave") {
      headRotY = THREE.MathUtils.lerp(headRotY, -0.14 + Math.sin(elapsed * 4.5) * 0.05, routineMotion.amount);
      headRotX = THREE.MathUtils.lerp(headRotX, -0.08 + Math.sin(elapsed * 6) * 0.04, routineMotion.amount);
      headRotZ = THREE.MathUtils.lerp(headRotZ, 0.08, routineMotion.amount);
    } else if (routineMotion?.kind === "doze") {
      const wakeJolt = routineMotion.progress > 0.62 && routineMotion.progress < 0.8
        ? Math.sin((routineMotion.progress - 0.62) / 0.18 * Math.PI)
        : 0;
      const nod = routineMotion.progress < 0.62 ? routineMotion.amount : 1 - wakeJolt * 0.65;
      headRotY = THREE.MathUtils.lerp(headRotY, Math.sin(elapsed * 1.8) * 0.04, routineMotion.amount);
      headRotX = THREE.MathUtils.lerp(headRotX, 0.28 * nod - 0.22 * wakeJolt, routineMotion.amount);
      headRotZ = THREE.MathUtils.lerp(headRotZ, 0.05 * nod + Math.sin(elapsed * 20) * 0.04 * wakeJolt, routineMotion.amount);
    } else if (routineMotion?.kind === "sniffAround") {
      const sniff = Math.sin(routineMotion.progress * Math.PI * 5);
      headRotY = THREE.MathUtils.lerp(headRotY, sniff * 0.18, routineMotion.amount);
      headRotX = THREE.MathUtils.lerp(headRotX, -0.32 + Math.sin(elapsed * 14) * 0.05, routineMotion.amount);
      headRotZ = THREE.MathUtils.lerp(headRotZ, sniff * 0.05, routineMotion.amount);
    } else if (routineMotion?.kind === "pawLick") {
      // 손이 정지해 있으면 "턱 괴고 생각하는" 자세로 보인다는 피드백(2026-08-07) —
      // lick 주기에 맞춰 고개도 살짝 내려갔다 올라오게 해서 실제로 핥는 동작처럼 보이게 한다.
      const lick = Math.max(Math.sin(routineMotion.progress * Math.PI * 6), 0);
      headRotY = THREE.MathUtils.lerp(headRotY, 0.24, routineMotion.amount);
      headRotX = THREE.MathUtils.lerp(headRotX, -0.16 - lick * 0.08, routineMotion.amount);
      headRotZ = THREE.MathUtils.lerp(headRotZ, 0.16, routineMotion.amount);
    } else if (routineMotion?.kind === "shakeOff") {
      headRotY = THREE.MathUtils.lerp(headRotY, Math.sin(elapsed * 22) * 0.08, routineMotion.amount);
      headRotX = THREE.MathUtils.lerp(headRotX, Math.sin(elapsed * 18) * 0.032, routineMotion.amount);
      headRotZ = THREE.MathUtils.lerp(headRotZ, Math.sin(elapsed * 22 + Math.PI / 2) * 0.14, routineMotion.amount);
    }
    if (alarmAmount > 0.001) {
      const alarmRotY = Math.sin(elapsed * 12) * 0.22;
      const alarmRotX = Math.sin(elapsed * 17) * 0.07;
      const alarmRotZ = Math.sin(elapsed * 9) * 0.06;
      headRotY = THREE.MathUtils.lerp(headRotY, alarmRotY, alarmAmount);
      headRotX = THREE.MathUtils.lerp(headRotX, alarmRotX, alarmAmount);
      headRotZ = THREE.MathUtils.lerp(headRotZ, alarmRotZ, alarmAmount);
    }
    // 몸통도 커서 쪽으로 살짝 돌아간다(2026-08-13). 위에서 정한 headRotY를 "펫이 실제로
    // 바라보는 총 좌우 각도"로 보고 그중 BODY_FOLLOW_RATIO만 몸통이 맡고 나머지를 머리에
    // 남긴다 — 그래서 총 시선 방향은 예전과 같고, 목이 꺾이는 정도만 줄어든다. 몸통에
    // 각도를 그냥 더하면 총 각도가 그만큼 커져 목이 모델 한계를 넘어 비틀린다.
    // 최종 headRotY에서 뽑으므로 아이들 루틴 좌우 스윕·알람 흔들기·드래그 허우적임에도
    // 몸통이 같은 비율로 함께 따라오고, 새 상태를 추가해도 따로 손댈 필요가 없다.
    // **가로축(rotation.y)만 준다** — 위아래(x)·기울임(z)까지 몸통에 주면 발이 땅에서 떠
    // 보이거나 몸이 넘어가는 것처럼 보인다.
    const bodyYaw = headRotY * BODY_FOLLOW_RATIO;
    modelRoot.rotation.y = bodyYaw;
    deps.headPivot().rotation.y = headRotY - bodyYaw;
    deps.headPivot().rotation.x = headRotX;
    deps.headPivot().rotation.z = headRotZ;
  }

  /** 표정과 눈 깜박임. 표정이 지정된 상태에서는 깜박임을 쉰다. */
  function updateFaceExpression(delta: number, elapsed: number, state: ReturnType<typeof updateFrameState>) {
    const { sleeping, dragReacting, assistantAnswerShown, celebrating, routineMotion } = state;
    // 표정이 따로 지정된 상태(휴식 알림/AI 답변)에서는 그 표정을 고정하고 눈 깜박임은 쉰다.
    // 평범한 아이들 상태일 때만 눈 깜박임을 재생한다.
    // 캡스락 알림은 다른 상태(알람/축하/답변/쓰다듬기)가 없을 때만 표시한다.
    // 표정과 떨림을 같은 조건으로 묶어야 "기쁜 얼굴인데 눈만 떨리는" 어긋남이 안 생긴다.
    const capsAlert = interactionState.isCapsLockActive() && renderSettings.capsLockAlertEnabled &&
      !deps.restActive() && !celebrating && !assistantAnswerShown && !interactionState.isPetting() &&
      !dragReacting && !sleeping;
    applyFaceTremble(elapsed, capsAlert);

    const expressionKeyOverride = deps.restActive()
      ? "alarm"
      : celebrating
        ? "happy"
        : dragReacting
          ? "shocked"
          : (assistantAnswerShown && assistantPanels.answerExpressionKey()) ||
            (interactionState.isPetting() ? "happy" : null) ||
            (routineMotion?.kind === "perkup" || routineMotion?.kind === "wave" ? "happy" : null) ||
            (routineMotion?.kind === "stretch"
              ? (routineMotion.progress > 0.25 && routineMotion.progress < 0.82 ? "alarm" : null)
              : null) ||
            (routineMotion?.kind === "shakeOff" ? "alarm" : null) ||
            (routineMotion?.kind === "doze"
              ? (routineMotion.progress > 0.62 && routineMotion.progress < 0.86 ? "shocked" : "normal_blink")
              : null) ||
            // 자는 동안엔 눈을 감고 있는다(깜박임 텍스처를 그대로 재활용).
            (sleeping ? "normal_blink" : null) ||
            (capsAlert ? "shocked" : null);

    if (expressionKeyOverride) {
      blinkTimer.suppress();
      setFaceExpressionKey(expressionKeyOverride);
    } else {
      // 표정 지정 상태가 끝난 프레임엔 깜박임이 꺼져 있으므로, 다음 깜박임까지 기다리지 않고
      // 매 프레임 원하는 텍스처(정상/깜박임)를 다시 계산해 즉시 되돌린다.
      setFaceExpressionKey(blinkTimer.advance(delta) ? "normal_blink" : "normal");
    }
  }

  /** 양손: 머리와 같은 순서(평상시 → 아이들 루틴 → 알람)로 위치와 흔들기를 정한다. */
  function updateHands(elapsed: number, state: ReturnType<typeof updateFrameState>) {
    const { dragReacting, assistantAnswerShown, routineMotion, answerMotion } = state;
    if (model.loadedMeshes.hand && model.loadedMeshes.handMirror) {
      const handBase = model.loadedMeshes.hand.userData.basePosition;
      const mirrorBase = model.loadedMeshes.handMirror.userData.basePosition;
      // 머리 회전과 같은 이유로, "평상시 팔 위치"를 먼저 계산해두고 alarmAmount 비율만큼
      // 알람 포즈(만세)와 섞는다 — 알림이 시작/종료될 때 팔이 뚝 끊기지 않게 한다.
      let handX = handBase.x, handY = handBase.y, handZ = handBase.z;
      let mirrorX = mirrorBase.x, mirrorY = mirrorBase.y, mirrorZ = mirrorBase.z;
      let handWave = 0;
      let mirrorWave = 0;
      if (dragReacting) {
        // 들어올려지면 놀라서 팔을 위로 들고 허우적거린다(만세보다 낮고 훨씬 빠르게).
        const flail = Math.sin(elapsed * 24) * 0.16;
        const raise = 0.3;
        handX = handBase.x + 0.16 + flail; handY = handBase.y + raise; handZ = handBase.z;
        mirrorX = mirrorBase.x - 0.16 + flail; mirrorY = mirrorBase.y + raise; mirrorZ = mirrorBase.z;
        handWave = Math.sin(elapsed * 30) * 0.7;
        mirrorWave = Math.sin(elapsed * 30 + Math.PI) * 0.7;
      } else if (assistantAnswerShown) {
        // 답변을 들려줄 때는 고개 끄덕임에 맞춰 팔이 살짝 옆으로 오간다.
        const swing = Math.sin(elapsed * 8) * 0.1;
        handX = handBase.x + swing; handY = handBase.y; handZ = handBase.z;
        mirrorX = mirrorBase.x - swing; mirrorY = mirrorBase.y; mirrorZ = mirrorBase.z;
        handWave = Math.sin(elapsed * 9) * 0.3;
        mirrorWave = Math.sin(elapsed * 9 + Math.PI) * 0.3;
        if (answerMotion) {
          handY += answerMotion.handY;
          mirrorY += answerMotion.handY;
          handWave += answerMotion.handWave;
          mirrorWave -= answerMotion.handWave;
        }
      }
      if (routineMotion?.kind === "stretch") {
        // 팍 뻗기 -> 다 뻗은 채로 유지하며 떨기 -> 서서히 내려오기 3단계로 나눈
        // stretchReachAmount()를 blend factor로 쓴다. idleRoutineEase(사인 곡선)를 쓰면
        // 오르내리는 도중에도 떨림이 겹쳐 보였다(2026-08-07 피드백) — 이제 떨림은
        // reach가 사실상 1로 유지되는 "다 뻗은" 구간에서만 커진다.
        const stretchReach = stretchReachAmount(routineMotion.progress);
        const raise = 1.6 * stretchReach;
        const spread = 0.85 * stretchReach;
        const forward = 0.22 * stretchReach;
        const sway = Math.sin(routineMotion.progress * Math.PI * 4) * 0.12 * stretchReach;
        const trembleEnvelope = Math.pow(stretchReach, 10);
        const tremble = Math.sin(elapsed * 46) * 0.045 * trembleEnvelope;
        handX = THREE.MathUtils.lerp(handX, handBase.x + spread + sway + tremble, stretchReach);
        handY = THREE.MathUtils.lerp(handY, handBase.y + raise + tremble * 0.6, stretchReach);
        handZ = THREE.MathUtils.lerp(handZ, handBase.z + forward, stretchReach);
        mirrorX = THREE.MathUtils.lerp(mirrorX, mirrorBase.x - spread + sway - tremble, stretchReach);
        mirrorY = THREE.MathUtils.lerp(mirrorY, mirrorBase.y + raise + tremble * 0.6, stretchReach);
        mirrorZ = THREE.MathUtils.lerp(mirrorZ, mirrorBase.z + forward, stretchReach);
        handWave = THREE.MathUtils.lerp(handWave, -0.58, stretchReach);
        mirrorWave = THREE.MathUtils.lerp(mirrorWave, 0.58, stretchReach);
      } else if (routineMotion?.kind === "perkup") {
        const bounce = Math.sin(routineMotion.progress * Math.PI * 5) * 0.07 * routineMotion.amount;
        handY = THREE.MathUtils.lerp(handY, handBase.y + bounce, routineMotion.amount);
        mirrorY = THREE.MathUtils.lerp(mirrorY, mirrorBase.y + bounce, routineMotion.amount);
        handWave = THREE.MathUtils.lerp(handWave, Math.sin(elapsed * 12) * 0.22, routineMotion.amount);
        mirrorWave = THREE.MathUtils.lerp(mirrorWave, Math.sin(elapsed * 12 + Math.PI) * 0.22, routineMotion.amount);
      } else if (routineMotion?.kind === "wave") {
        const raise = 0.72 * routineMotion.amount;
        const spread = 0.26 * routineMotion.amount;
        handX = THREE.MathUtils.lerp(handX, handBase.x + spread, routineMotion.amount);
        handY = THREE.MathUtils.lerp(handY, handBase.y + raise, routineMotion.amount);
        handZ = THREE.MathUtils.lerp(handZ, handBase.z + 0.12 * routineMotion.amount, routineMotion.amount);
        handWave = THREE.MathUtils.lerp(handWave, Math.sin(elapsed * 14) * 0.58, routineMotion.amount);
        mirrorY = THREE.MathUtils.lerp(mirrorY, mirrorBase.y + Math.sin(elapsed * 5) * 0.03 * routineMotion.amount, routineMotion.amount);
      } else if (routineMotion?.kind === "doze") {
        const wakeJolt = routineMotion.progress > 0.62 && routineMotion.progress < 0.8
          ? Math.sin((routineMotion.progress - 0.62) / 0.18 * Math.PI)
          : 0;
        handY = THREE.MathUtils.lerp(handY, handBase.y - 0.05 + wakeJolt * 0.16, routineMotion.amount);
        mirrorY = THREE.MathUtils.lerp(mirrorY, mirrorBase.y - 0.05 + wakeJolt * 0.16, routineMotion.amount);
        handWave = THREE.MathUtils.lerp(handWave, Math.sin(elapsed * 18) * 0.18 * wakeJolt, routineMotion.amount);
        mirrorWave = THREE.MathUtils.lerp(mirrorWave, Math.sin(elapsed * 18 + Math.PI) * 0.18 * wakeJolt, routineMotion.amount);
      } else if (routineMotion?.kind === "pawLick") {
        // 손을 얼굴 높이까지 더 확실히 들어 올리고, lick 주기로 handY/Z를 왕복시켜
        // 실제로 핥는 스트로크처럼 보이게 한다(정지된 raise만으로는 손 얹고 생각하는
        // 자세로 읽혔다 — 2026-08-07 피드백).
        const lick = Math.max(Math.sin(routineMotion.progress * Math.PI * 6), 0);
        const raise = (0.66 + lick * 0.16) * routineMotion.amount;
        const forward = (0.42 + lick * 0.14) * routineMotion.amount;
        handX = THREE.MathUtils.lerp(handX, handBase.x + 0.1, routineMotion.amount);
        handY = THREE.MathUtils.lerp(handY, handBase.y + raise, routineMotion.amount);
        handZ = THREE.MathUtils.lerp(handZ, handBase.z + forward, routineMotion.amount);
        handWave = THREE.MathUtils.lerp(handWave, Math.sin(elapsed * 16) * 0.42, routineMotion.amount);
      } else if (routineMotion?.kind === "shakeOff") {
        const shake = Math.sin(elapsed * 22) * 0.075 * routineMotion.amount;
        handX = THREE.MathUtils.lerp(handX, handBase.x + shake, routineMotion.amount);
        mirrorX = THREE.MathUtils.lerp(mirrorX, mirrorBase.x - shake, routineMotion.amount);
        handWave = THREE.MathUtils.lerp(handWave, Math.sin(elapsed * 22) * 0.19, routineMotion.amount);
        mirrorWave = THREE.MathUtils.lerp(mirrorWave, Math.sin(elapsed * 22 + Math.PI) * 0.19, routineMotion.amount);
      }
      if (alarmAmount > 0.001) {
        // 알림이 울리면 만세 하듯 손을 머리 위까지 들되, 머리에 파묻히지 않도록 양쪽으로
        // 크게 벌린 채로 왕복시켜 흔든다. (raise: 머리보다 위, spread: 머리 폭보다 바깥쪽)
        const raise = deps.headPivot().position.y + 0.35 - handBase.y;
        const spread = 0.75;
        const swingL = Math.sin(elapsed * 9) * 0.25;
        const swingR = Math.sin(elapsed * 9 + Math.PI) * 0.25;
        const alarmHandX = handBase.x + spread + swingL;
        const alarmHandY = handBase.y + raise;
        const alarmMirrorX = mirrorBase.x - spread - swingR;
        const alarmMirrorY = mirrorBase.y + raise;
        const alarmHandWave = Math.sin(elapsed * 18) * 0.6;
        const alarmMirrorWave = Math.sin(elapsed * 18 + Math.PI) * 0.6;
        handX = THREE.MathUtils.lerp(handX, alarmHandX, alarmAmount);
        handY = THREE.MathUtils.lerp(handY, alarmHandY, alarmAmount);
        handZ = THREE.MathUtils.lerp(handZ, handBase.z, alarmAmount);
        mirrorX = THREE.MathUtils.lerp(mirrorX, alarmMirrorX, alarmAmount);
        mirrorY = THREE.MathUtils.lerp(mirrorY, alarmMirrorY, alarmAmount);
        mirrorZ = THREE.MathUtils.lerp(mirrorZ, mirrorBase.z, alarmAmount);
        handWave = THREE.MathUtils.lerp(handWave, alarmHandWave, alarmAmount);
        mirrorWave = THREE.MathUtils.lerp(mirrorWave, alarmMirrorWave, alarmAmount);
      }
      model.loadedMeshes.hand.position.set(handX, handY, handZ);
      model.loadedMeshes.handMirror.position.set(mirrorX, mirrorY, mirrorZ);
      setHandWave(model.loadedMeshes.hand, handWave);
      setHandWave(model.loadedMeshes.handMirror, mirrorWave);
    }
  }

  /**
   * 꼬리. 여기만 우선순위가 다르다 — 타이핑 반응이 최우선이고 알람 포즈가 아예 없다
   * (알림 중엔 만세 동작이 주인공이라 꼬리는 직전 상태를 유지한다).
   */
  function updateTail(delta: number, state: ReturnType<typeof updateFrameState>) {
    // 누적과 추종은 tail-motion.ts가 하고, 여기서는 결과를 씬에 적용만 한다.
    const { angle, bend } = tailMotion.advance(delta, {
      typingIntensity,
      speedMultiplier: renderSettings.tailSpeedMultiplier,
      answerMotion: state.answerMotion,
      routineMotion: state.routineMotion
    });
    deps.tailPivot().rotation.z = angle;
    applyTailBend(bend);
  }

  function animate() {
    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    const base = advanceSmoothedInputs(delta);
    updateBodyDeform(delta);
    const state = updateFrameState(delta, elapsed, base);

    updateHeadRotation(elapsed, state);
    if (!mediaPlayer.hidden) updateMediaPlayerPosition();
    updateFaceExpression(delta, elapsed, state);
    updateHands(elapsed, state);
    updateTail(delta, state);

    postProcessUniforms.uTime.value = elapsed;
    renderPetScene();
    // 라벨은 실제 파츠의 월드 좌표를 따라가야 하므로 렌더 직후 매 프레임 갱신한다
    // (모드가 꺼져 있으면 첫 줄에서 바로 반환한다).
    customizeLabels.updateLayout();
    requestAnimationFrame(animate);
  }

  // 프리셋 썸네일 요청이 모델 로드보다 먼저 올 수 있어(앱 시작 직후 설정창을 연 경우)
  // 이 프라미스를 기다린 뒤에 그린다.
  // GLB 로딩·메시 조립은 pet-model-loader.js가 한다. 그릇은 여기서 계속 들고 있고
  // 로더가 처음 만드는 두 피벗과 얼굴 떨림 폭만 돌려받는다.
  return {
    /** 모델 로드가 끝난 뒤에 부른다. */
    start: () => requestAnimationFrame(animate)
  };
}

export { createAnimationLoop };
export type { AnimationLoopDependencies };
