// 펫 창의 소리 전부 — 알람음, 대화 효과음(animalese), 키보드/마우스 클릭음.
// 3D·DOM과 얽히지 않는 유일한 덩어리라 renderer.ts에서 떼어냈다.
//
// import 지정자에 `.js`를 붙이고 타입 전용 import를 `import type`으로 적는 이유는
// src/pet/tsconfig.build.json 주석 참고(noResolve 단일 파일 변환).
import * as THREE from "three";

// 사운드 파일 목록은 설정 정규화(main)·설정창 드롭다운과 같아야 해서
// shared/sound-catalog.js 한 곳에서 가져온다(index.html이 <script>로 먼저 읽는다).
// 알람·대화 효과음은 설정값(1부터)으로 바로 찾으므로 번호 맵으로, 클릭음은 원래대로 배열로 쓴다.
const ALARM_SOUND_FILES = window.PetSoundCatalog.byIndex(window.PetSoundCatalog.ALARM_SOUNDS);
const TALK_SOUND_FILES = window.PetSoundCatalog.byIndex(window.PetSoundCatalog.TALK_SOUNDS);
const CLICK_SOUND_FILES = window.PetSoundCatalog.CLICK_SOUNDS;

// 키보드는 키를 꾹 누르고 있으면(자동 반복) 계속 재생 요청이 들어온다. 처음엔 "이전
// 재생이 끝날 때까지(사운드 길이만큼) 대기"로 겹침을 막았는데, 사운드 길이가 타이핑
// 속도보다 길면 오히려 빠르게 칠 때 소리가 통째로 씹혀서(2026-08-02 피드백 — "키보드
// 빠르게 치면 소리가 몇개는 씹히는 느낌") 짧은 고정 간격으로 바꿨다. 실제 키보드
// 클릭음도 빠르게 치면 자연스럽게 겹쳐 들리는 게 정상이라, 완전히 안 겹치게 하기보다는
// 진짜 중복 트리거(예: 같은 이벤트가 두 번 오는 등)만 걸러내는 정도로 짧게 잡는다.
const MIN_CLICK_SOUND_INTERVAL_MS = 45;

// 이 모듈이 실제로 읽는 설정 키만 적는다 — 나머지는 renderer.ts의 몫이다.
type PetAudioSettings = Pick<
  PetRendererSettings,
  | "soundEnabled"
  | "animalesePitchPercent"
  | "animaleseSoundStyle"
  | "alarmSound"
  | "keyboardClickEnabled"
  | "keyboardClickSound"
  | "keyboardClickVolume"
  | "keyboardClickMinPitch"
  | "keyboardClickMaxPitch"
  | "mouseClickEnabled"
  | "mouseClickSound"
  | "mouseClickVolume"
  | "mouseClickMinPitch"
  | "mouseClickMaxPitch"
>;

function soundAssetUrl(filename: string) {
  return new URL(`../../assets/sounds/${filename}`, import.meta.url).href;
}

function createPetAudio() {
  let soundEnabled = true;
  let alarmSoundIndex = 1;
  let animaleseSoundStyle = 1;
  let animalesePitchPercent = 8;
  let animaleseAudioContext: AudioContext | undefined;
  let animaleseBufferPromise: Promise<AudioBuffer | null> | undefined;

  const restSound = new Audio(soundAssetUrl(ALARM_SOUND_FILES[alarmSoundIndex]));
  restSound.preload = "auto";
  restSound.volume = 0.65;

  // 클릭 사운드: 사용자가 고른 파일을 매번 다른 높낮이로 재생한다. 파일마다 확장자가
  // 다를 수 있어서(wav/mp3/flac) 브라우저 디코더에 맡기고 확장자는 신경 안 쓴다.
  // 한 번 디코딩한 버퍼는 캐시에 담아두고 재사용한다.
  let clickSoundContext: AudioContext | undefined;
  const clickSoundBuffers: (Promise<AudioBuffer> | undefined)[] = [];
  const clickSoundBusyUntil = { keyboard: 0, mouse: 0 };
  let keyboardClickEnabled = false;
  let keyboardClickSound = 2;
  let keyboardClickVolume = 60;
  let keyboardClickMinPitch = 90;
  let keyboardClickMaxPitch = 110;
  let mouseClickEnabled = false;
  let mouseClickSound = 1;
  let mouseClickVolume = 60;
  let mouseClickMinPitch = 90;
  let mouseClickMaxPitch = 110;

  function applyAlarmSoundSetting(value: unknown) {
    const index = Number(value);
    const resolved = ALARM_SOUND_FILES[index] ? index : 1;
    if (resolved === alarmSoundIndex) return;
    alarmSoundIndex = resolved;
    restSound.src = soundAssetUrl(ALARM_SOUND_FILES[alarmSoundIndex]);
    restSound.load();
  }

  function applyAnimaleseSoundSetting(value: unknown) {
    const index = Number(value);
    const resolved = TALK_SOUND_FILES[index] ? index : 1;
    if (resolved === animaleseSoundStyle) return;
    animaleseSoundStyle = resolved;
    // 다음 재생 때 새 스타일 파일로 다시 받아오도록 캐시된 버퍼를 무효화한다.
    animaleseBufferPromise = undefined;
  }

  function stopRest() {
    restSound.pause();
    restSound.currentTime = 0;
  }

  function playRest() {
    if (!soundEnabled) return;
    stopRest();
    restSound.play().catch((error: unknown) => console.warn("Rest alert sound could not play:", error));
  }

  // 알람이 사용자 지정 사운드를 들고 오면 그 데이터 URL을, 없으면 현재 알람음을 쓴다.
  function setRestSource(dataUrl: string | null | undefined) {
    restSound.src = dataUrl || soundAssetUrl(ALARM_SOUND_FILES[alarmSoundIndex]);
    restSound.load();
  }

  function prepareAnimalese() {
    if (!animaleseAudioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return Promise.reject(new Error("Web Audio is not supported."));
      animaleseAudioContext = new AudioContextClass();
    }
    const audioContext = animaleseAudioContext;
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    if (!animaleseBufferPromise) {
      animaleseBufferPromise = fetch(soundAssetUrl(TALK_SOUND_FILES[animaleseSoundStyle]))
        .then((response) => {
          if (!response.ok) throw new Error(`Animalese sound request failed (${response.status})`);
          return response.arrayBuffer();
        })
        .then((data) => audioContext.decodeAudioData(data))
        .catch((error: unknown) => {
          animaleseBufferPromise = undefined;
          throw error;
        });
    }
    return animaleseBufferPromise;
  }

  // 로드에 실패했으면 buffer가 없으며, 함수 첫 줄에서 걸러낸다.
  function playAnimaleseCharacter(character: string, index: number, buffer: AudioBuffer | null | undefined) {
    const audioContext = animaleseAudioContext;
    if (!audioContext || !buffer || !/[\p{L}\p{N}]/u.test(character)) return;
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const pitchPosition = (((character.codePointAt(0) ?? 0) * 7 + index * 11) % 101) / 50 - 1;
    source.buffer = buffer;
    source.playbackRate.value = THREE.MathUtils.clamp(
      1 + pitchPosition * animalesePitchPercent / 100,
      0.7,
      1.3
    );
    gain.gain.value = 0.22;
    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start();
  }

  function prepareClickSoundContext() {
    if (!clickSoundContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      clickSoundContext = new AudioContextClass();
    }
    if (clickSoundContext.state === "suspended") clickSoundContext.resume().catch(() => {});
    return clickSoundContext;
  }

  function loadClickSoundBuffer(index: number) {
    if (!clickSoundBuffers[index]) {
      const ctx = prepareClickSoundContext();
      if (!ctx) return Promise.reject(new Error("Web Audio is not supported."));
      clickSoundBuffers[index] = fetch(soundAssetUrl(CLICK_SOUND_FILES[index]))
        .then((response) => {
          if (!response.ok) throw new Error(`Click sound request failed (${response.status})`);
          return response.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data))
        .catch((error: unknown) => {
          clickSoundBuffers[index] = undefined;
          throw error;
        });
    }
    return clickSoundBuffers[index];
  }

  function playClick(source: PetInputSource) {
    const enabled = source === "mouse" ? mouseClickEnabled : keyboardClickEnabled;
    if (!enabled) return;
    const now = performance.now();
    if (now < clickSoundBusyUntil[source]) return;
    const ctx = prepareClickSoundContext();
    if (!ctx) return;
    const volume = source === "mouse" ? mouseClickVolume : keyboardClickVolume;
    const minPitch = source === "mouse" ? mouseClickMinPitch : keyboardClickMinPitch;
    const maxPitch = source === "mouse" ? mouseClickMaxPitch : keyboardClickMaxPitch;
    // 파일 자체는 무작위가 아니라 사용자가 고른 사운드로 고정한다(높낮이만 매번 랜덤).
    const soundNumber = source === "mouse" ? mouseClickSound : keyboardClickSound;
    const index = THREE.MathUtils.clamp(soundNumber, 1, CLICK_SOUND_FILES.length) - 1;
    const pitchPercent = minPitch + Math.random() * (maxPitch - minPitch);
    const playbackRate = THREE.MathUtils.clamp(pitchPercent / 100, 0.5, 2);
    clickSoundBusyUntil[source] = now + MIN_CLICK_SOUND_INTERVAL_MS;
    loadClickSoundBuffer(index).then((buffer) => {
      const bufferSource = ctx.createBufferSource();
      const gain = ctx.createGain();
      bufferSource.buffer = buffer;
      bufferSource.playbackRate.value = playbackRate;
      gain.gain.value = THREE.MathUtils.clamp(volume, 0, 100) / 100;
      bufferSource.connect(gain);
      gain.connect(ctx.destination);
      bufferSource.start();
    }).catch((error: unknown) => console.warn("Click sound could not play:", error));
  }

  // 분리 전 applyPetSettings의 소리 관련 대입을 원래 순서 그대로 모아둔 것이다.
  function applySettings(settings: PetAudioSettings) {
    keyboardClickEnabled = settings.keyboardClickEnabled === true;
    keyboardClickSound = Number(settings.keyboardClickSound) || 2;
    keyboardClickVolume = Number(settings.keyboardClickVolume) || 0;
    keyboardClickMinPitch = Number(settings.keyboardClickMinPitch) || 90;
    keyboardClickMaxPitch = Number(settings.keyboardClickMaxPitch) || 110;
    mouseClickEnabled = settings.mouseClickEnabled === true;
    mouseClickSound = Number(settings.mouseClickSound) || 1;
    mouseClickVolume = Number(settings.mouseClickVolume) || 0;
    mouseClickMinPitch = Number(settings.mouseClickMinPitch) || 90;
    mouseClickMaxPitch = Number(settings.mouseClickMaxPitch) || 110;
    soundEnabled = settings.soundEnabled !== false;
    animalesePitchPercent = THREE.MathUtils.clamp(Number(settings.animalesePitchPercent) || 0, 0, 30);
    applyAnimaleseSoundSetting(settings.animaleseSoundStyle);
    applyAlarmSoundSetting(settings.alarmSound);
    if (!soundEnabled) stopRest();
  }

  return {
    applySettings,
    playRest,
    stopRest,
    setRestSource,
    prepareAnimalese,
    playAnimaleseCharacter,
    playClick
  };
}

export { createPetAudio };
export type { PetAudioSettings };
