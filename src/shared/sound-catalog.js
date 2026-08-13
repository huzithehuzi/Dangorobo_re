// 사운드 카탈로그 — 알람 소리, 대화 효과음, 키보드/마우스 클릭음의 **파일 목록**.
//
// 파일명이 곧 개수의 근거다. 예전에는 같은 개수가 세 곳에 흩어져 있었다:
//   settings-schema.ts의 상한 상수(ALARM_SOUND_COUNT 등) / renderer.ts의 파일명 맵 /
//   설정창 드롭다운의 [1, 2, 3, ...] 하드코딩.
// 셋 중 하나만 고치면 "설정창에서 고를 수는 있는데 소리가 안 나거나"(파일 없음),
// "파일은 넣었는데 고를 수가 없는"(상한/드롭다운 미갱신) 상태가 됐다.
// 여기 배열에 파일명을 넣으면 세 곳이 함께 따라온다.
//
// **설정에 저장되는 값은 1부터 시작하는 번호**다(배열 인덱스 + 1). 확장자는 파일마다
// 달라도 되고(현재도 mp3/wav/flac이 섞여 있다) 이 목록이 실제 로드할 파일명을 결정한다.
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (typeof root !== "undefined") {
    // 전역에 이름을 심는 UMD 관용구라 root의 정적 타입(window/globalThis)에는 이 속성이 없다.
    /** @type {any} */ (root).PetSoundCatalog = mod;
  }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ALARM_SOUNDS = ["alarm1.mp3", "alarm2.wav", "alarm3.wav", "alarm4.wav", "alarm5.mp3"];
  const TALK_SOUNDS = ["talkingsound1.wav", "talkingsound2.wav", "talkingsound3.wav"];
  const CLICK_SOUNDS = ["click1.wav", "click2.mp3", "click3.flac", "click4.wav", "click5.wav", "click6.mp3"];

  /**
   * 1부터 시작하는 설정값을 파일명으로 바꾼다.
   * @param {string[]} sounds @param {unknown} index @returns {string} 범위 밖이면 빈 문자열
   */
  function soundFile(sounds, index) {
    const n = Number(index);
    return Number.isInteger(n) && n >= 1 && n <= sounds.length ? sounds[n - 1] : "";
  }

  /**
   * 설정값 → 파일명 맵(1부터). renderer.ts처럼 번호로 바로 찾아 쓰는 쪽을 위한 형태다.
   * @param {string[]} sounds
   */
  function byIndex(sounds) {
    return Object.fromEntries(sounds.map((file, i) => [i + 1, file]));
  }

  return {
    ALARM_SOUNDS,
    TALK_SOUNDS,
    CLICK_SOUNDS,
    ALARM_SOUND_COUNT: ALARM_SOUNDS.length,
    TALK_SOUND_COUNT: TALK_SOUNDS.length,
    CLICK_SOUND_COUNT: CLICK_SOUNDS.length,
    soundFile,
    byIndex
  };
});
