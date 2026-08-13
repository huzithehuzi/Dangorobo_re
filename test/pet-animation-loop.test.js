// @ts-check
// 프레임 루프.
//
// 앞쪽은 소유권·배선 계약을 소스 수준에서 확인하고, 뒤쪽은 루프를 실제로 돌린다.
// 씬 핸들과 DOM은 좌표·표시 여부만 읽히므로 Three 객체와 평범한 객체로 대신할 수 있고,
// `requestAnimationFrame`을 가로채면 프레임을 한 칸씩 손으로 돌릴 수 있다. 캡처는 한 장면만
// 찍으므로 우선순위 사다리와 시간축 성질(위상 누적, 프레임률 독립, amount 스냅)은 여기서만
// 확인할 수 있다.
//
// **Three는 반드시 동적 import로 받는다.** `require("three")`는 `build/three.cjs`를,
// 펫 모듈의 `import`는 `build/three.module.js`를 쓰는데 클래스 정체성이 서로 달라서
// `require`로 만든 메시는 루프의 `instanceof THREE.Mesh` 판별을 통과하지 못한다. 그러면
// 꼬리 굽힘 경로가 통째로 건너뛰어져 "변이해도 통과하는" 공허한 검사가 된다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createAnimationLoop } = require("../src/pet/animation-loop.js");
const { createPetModelRefs } = require("../src/pet/pet-model-refs.js");
const { derivePetRenderSettings } = require("../src/pet/pet-render-settings.js");
const { DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");

/** @type {any} */
let THREE;
test.before(async () => {
  THREE = await import("three");
});

const repoRoot = path.resolve(__dirname, "..");

// Windows 체크아웃은 CRLF라, 소스 구간을 문자열로 잘라내는 단언이 줄바꿈 바이트에 걸린다.
/** @param {...string} segments */
function readSource(...segments) {
  return fs.readFileSync(path.join(repoRoot, ...segments), "utf8").replace(/\r\n?/g, "\n");
}

/** 설계 의도를 적어둔 주석에 심벌 이름이 그대로 나오므로 코드만 본다. @param {string} source */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const rendererSource = codeOnly(readSource("src", "pet", "renderer.ts"));
const loopSource = codeOnly(readSource("src", "pet", "animation-loop.ts"));

/** 루프가 소유하는 프레임 누적 상태. */
const LOOP_STATE = [
  "smoothedPointer", "typingIntensity", "pettingAmount", "alarmAmount",
  "sleepAmount", "breathePhase", "tailBendApplied"
];

/** 루프 안에서만 쓰는 단계 함수들. */
const LOOP_FUNCTIONS = [
  "smoothStep", "advanceSmoothedInputs", "updateBodyDeform", "updateFrameState",
  "updateHeadRotation", "updateFaceExpression", "updateHands", "updateTail", "animate"
];

test("프레임 누적 상태는 루프가 소유하고 렌더러에 남지 않는다", () => {
  for (const name of LOOP_STATE) {
    assert.doesNotMatch(
      rendererSource,
      new RegExp(`^(?:let|const)\\s+${name}\\b`, "m"),
      `${name}은 렌더러가 소유하지 않는다`
    );
    assert.match(
      loopSource,
      new RegExp(`^  (?:let|const)\\s+${name}\\b`, "m"),
      `${name}은 루프가 소유한다`
    );
  }
});

test("단계 함수는 전부 루프 모듈에만 있다", () => {
  for (const name of LOOP_FUNCTIONS) {
    assert.match(loopSource, new RegExp(`^  function ${name}\\b`, "m"), `${name}은 루프에 있다`);
    assert.doesNotMatch(rendererSource, new RegExp(`^function ${name}\\b`, "m"), `${name}은 렌더러에 없다`);
  }
});

test("로딩 뒤에 채워지는 값과 렌더러 소유 플래그는 getter로 받는다", () => {
  // 값으로 받으면 로딩 전 undefined가 굳어 버리거나(피벗) 갱신이 반영되지 않는다(플래그).
  for (const name of ["headPivot", "tailPivot", "faceTrembleAmplitude", "restActive", "clickThrough", "mediaState"]) {
    assert.match(
      rendererSource,
      new RegExp(`${name}: \\(\\) => ${name}`),
      `${name}을 getter로 넘긴다`
    );
    assert.match(loopSource, new RegExp(`deps\\.${name}\\(\\)`), `${name}을 호출 시점에 읽는다`);
  }
});

test("루프는 모델 로드가 끝난 뒤에 시작한다", () => {
  // 피벗과 얼굴 떨림 폭이 채워지기 전에 돌면 첫 프레임에서 터진다.
  const assign = rendererSource.indexOf("faceTrembleAmplitude = assembly.faceTrembleAmplitude;");
  const start = rendererSource.indexOf("animationLoop.start();");
  assert.ok(assign >= 0 && start > assign, "start()가 조립 결과 대입보다 뒤에 온다");
  assert.match(loopSource, /start: \(\) => requestAnimationFrame\(animate\)/);
  // 렌더러가 루프를 직접 예약하면 시작 시점 계약이 두 곳으로 갈린다.
  assert.doesNotMatch(rendererSource, /requestAnimationFrame\(animate\)/);
});

test("그리기와 미디어 위치는 렌더러가 계속 갖고 콜백으로 받는다", () => {
  // 후처리 패스·렌더 타깃은 라이브 씬 상태가 많아 루프로 옮기지 않았다.
  for (const name of ["renderPetScene", "setFaceExpressionKey", "updateMediaPlayerPosition"]) {
    assert.match(rendererSource, new RegExp(`^function ${name}\\b`, "m"), `${name}은 렌더러에 있다`);
  }
  assert.doesNotMatch(loopSource, /^ {2}function renderPetScene\b/m);
  assert.match(loopSource, /renderPetScene\(\);/);
});

test("루프가 내보내는 것은 start뿐이다", () => {
  // 누적 상태를 밖으로 열면 소유권이 다시 갈린다. 렌더러는 루프를 시작만 시킨다.
  const returnStart = loopSource.lastIndexOf("  return {");
  assert.ok(returnStart >= 0, "반환 객체를 찾는다");
  const returned = loopSource.slice(returnStart, loopSource.indexOf("\n  };", returnStart));
  const keys = [...returned.matchAll(/^\s{4}(\w+)\s*[:(]/gm)].map((match) => match[1]);
  assert.deepEqual(keys, ["start"]);

  for (const name of LOOP_STATE) {
    assert.doesNotMatch(
      returned,
      new RegExp(`\\b${name}\\b`),
      `${name}을 밖으로 내보내지 않는다`
    );
  }
});

// ── 프레임을 실제로 돌려 확인하는 부분 ──────────────────────────────────────────

/** @param {number} actual @param {number} expected @param {number} [tolerance] @param {string} [message] */
function closeTo(actual, expected, tolerance = 1e-6, message = "") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} — ${actual}이(가) ${expected}에서 ${tolerance} 이내여야 한다`
  );
}

/**
 * 꼬리 메시 한 장. 굽힘 배율은 로컬 Y 길이와 세장비(길이/폭)로 정해지므로 둘을 인자로 받는다.
 * @param {{ length?: number, width?: number, visible?: boolean }} [options]
 */
function createTailMesh(options = {}) {
  const length = options.length ?? 4;
  const width = options.width ?? 2.7;
  const half = width / 2;
  const positions = new Float32Array([
    -half, 0, -half,
    half, 0, half,
    -half, length, -half,
    half, 0, half,
    half, length, half,
    -half, length, -half
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.userData.variation = "test";
  mesh.visible = options.visible ?? true;
  return mesh;
}

const HEAD_PIVOT_Y = 1.5;
const HAND_BASE = { x: 0.6, y: 1, z: 0 };

/**
 * 루프를 조립하고 프레임을 손으로 돌릴 수 있게 감싼다.
 * @param {{ withHands?: boolean, tail?: any }} [options]
 */
function createHarness(options = {}) {
  const control = {
    targetTyping: 0,
    petting: false,
    celebrating: false,
    capsLock: false,
    idle: false,
    dragging: false,
    restActive: false,
    clickThrough: true,
    mediaStatus: "None",
    assistantActive: false,
    favoritesActive: false,
    /** @type {string | null} */
    answerExpressionKey: null,
    answerBubbleHidden: true,
    petChatBubbleHidden: true,
    mediaPlayerHidden: true,
    squishAmount: 0,
    wobbleAmount: 0,
    /** @type {any} */
    routineFrame: null
  };
  /** @type {string[]} */
  const log = [];
  /** @type {boolean[]} */
  const idleAllowed = [];
  /** @type {(string | null | undefined)[]} */
  const expressions = [];

  const model = /** @type {any} */ (createPetModelRefs());
  for (const id of ["eye", "mouth", "customFace"]) {
    const plate = new THREE.Object3D();
    plate.userData.basePosition = new THREE.Vector3(0.1, 0.2, 0.3);
    model.facePlates[id] = plate;
  }
  const hand = new THREE.Object3D();
  hand.userData.basePosition = new THREE.Vector3(HAND_BASE.x, HAND_BASE.y, HAND_BASE.z);
  const handMirror = new THREE.Object3D();
  handMirror.userData.basePosition = new THREE.Vector3(-HAND_BASE.x, HAND_BASE.y, HAND_BASE.z);
  if (options.withHands !== false) {
    model.loadedMeshes.hand = hand;
    model.loadedMeshes.handMirror = handMirror;
  }

  const headPivot = new THREE.Group();
  headPivot.position.y = HEAD_PIVOT_Y;
  const tailPivot = new THREE.Group();
  if (options.tail) tailPivot.add(options.tail);

  const pet = new THREE.Group();
  const modelRoot = new THREE.Group();
  pet.add(modelRoot);
  const pointer = new THREE.Vector2();
  const postProcessUniforms = { uTime: { value: -1 } };
  const renderSettings = derivePetRenderSettings(DEFAULT_SETTINGS);

  // 실제 THREE.Clock 대신 델타를 손으로 먹인다 — 시간축 성질을 재려면 프레임 간격이
  // 실행 속도가 아니라 테스트가 정한 값이어야 한다.
  const clock = {
    elapsedTime: 0,
    delta: 1 / 60,
    getDelta() {
      this.elapsedTime += this.delta;
      return this.delta;
    }
  };

  // 루프는 다음 프레임을 전역 requestAnimationFrame으로 예약한다. 하네스를 둘 이상 쓰는
  // 테스트가 있으므로 전역을 붙잡아 두지 않고, 예약이 일어날 수 있는 호출 동안에만 자기
  // 것으로 바꿔 끼운다 — 붙잡아 두면 나중에 만든 하네스가 앞선 하네스의 프레임을 가로챈다.
  /** @type {(() => void) | null} */
  let pending = null;
  /** @param {() => void} body */
  function capturingFrames(body) {
    const saved = globalThis.requestAnimationFrame;
    /** @type {any} */ (globalThis).requestAnimationFrame = (/** @type {() => void} */ callback) => {
      pending = callback;
      return 1;
    };
    try {
      body();
    } finally {
      /** @type {any} */ (globalThis).requestAnimationFrame = saved;
    }
  }

  const loop = createAnimationLoop(/** @type {any} */ ({
    pet,
    modelRoot,
    frontCorrection: new THREE.Quaternion(),
    postProcessUniforms,
    pointer,
    clock,
    BASE_PET_Y: 0.5,
    PET_BOTTOM_ANCHOR_Y: 2,
    assistantAnswerBubble: { get hidden() { return control.answerBubbleHidden; } },
    petChatBubble: { get hidden() { return control.petChatBubbleHidden; } },
    mediaPlayer: { get hidden() { return control.mediaPlayerHidden; } },
    model,
    renderSettings,
    squishMotion: {
      advanceDragPulse: () => { log.push("dragPulse"); },
      advance: () => {
        log.push("bodyDeform");
        return { squishAmount: control.squishAmount, wobbleAmount: control.wobbleAmount };
      }
    },
    interactionState: {
      getTargetTypingIntensity: () => control.targetTyping,
      isPetting: () => control.petting,
      isCelebrating: () => control.celebrating,
      isCapsLockActive: () => control.capsLock,
      isIdle: () => control.idle,
      isDragging: () => control.dragging
    },
    assistantPanels: {
      isAssistantActive: () => control.assistantActive,
      isFavoritesActive: () => control.favoritesActive,
      answerExpressionKey: () => control.answerExpressionKey
    },
    customizeLabels: { updateLayout: () => { log.push("labels"); } },
    idleRoutineScheduler: {
      update: (/** @type {number} */ _now, /** @type {boolean} */ allowed) => {
        idleAllowed.push(allowed);
        return control.routineFrame;
      }
    },
    headPivot: () => headPivot,
    tailPivot: () => tailPivot,
    faceTrembleAmplitude: () => 0.01,
    restActive: () => control.restActive,
    clickThrough: () => control.clickThrough,
    mediaState: () => ({ status: control.mediaStatus }),
    renderPetScene: () => { log.push("render"); },
    setFaceExpressionKey: (/** @type {string | null | undefined} */ key) => {
      expressions.push(key);
      log.push("expression");
    },
    updateMediaPlayerPosition: () => { log.push("mediaPosition"); }
  }));
  capturingFrames(() => loop.start());

  const harness = {
    control, log, idleAllowed, expressions,
    model, pet, modelRoot, pointer, headPivot, tailPivot, hand, handMirror, clock,
    postProcessUniforms, renderSettings,
    /**
     * 펫이 실제로 바라보는 좌우 각도. 머리와 몸통이 나눠 맡으므로 우선순위 사다리는
     * 머리 로컬 각도가 아니라 이 합으로 판정한다.
     */
    gazeY: () => headPivot.rotation.y + modelRoot.rotation.y,
    /** 다음 프레임이 예약돼 있는지. */
    isScheduled: () => pending !== null,
    /** @param {number} [delta] */
    step(delta = 1 / 60) {
      clock.delta = delta;
      const callback = pending;
      assert.ok(callback, "다음 프레임이 예약돼 있어야 한다");
      pending = null;
      capturingFrames(callback);
    },
    /** @param {number} seconds @param {number} [delta] */
    run(seconds, delta = 1 / 60) {
      const frames = Math.round(seconds / delta);
      for (let i = 0; i < frames; i += 1) harness.step(delta);
    },
    /** 지금까지 쌓인 기록을 비운다. */
    clear() {
      log.length = 0;
      idleAllowed.length = 0;
      expressions.length = 0;
    }
  };
  return harness;
}

/** 포인터를 완전히 따라잡은 상태에서 시작하고 싶을 때. 큰 좌표를 써서 분기별 계수를 벌린다. */
function settledHarness(/** @type {{ withHands?: boolean, tail?: any }} */ options = {}) {
  const harness = createHarness(options);
  harness.pointer.set(100, 100);
  harness.run(5);
  harness.clear();
  return harness;
}

// ── 프레임 진행 ────────────────────────────────────────────────────────────────

test("start()가 첫 프레임을 예약하고 매 프레임 다음 프레임을 다시 건다", () => {
  const h = createHarness();

  assert.ok(h.isScheduled(), "start()가 첫 프레임을 예약한다");
  h.step();
  assert.ok(h.isScheduled(), "animate()가 스스로 다음 프레임을 예약한다");
  h.step();
  assert.ok(h.isScheduled());
});

test("한 프레임의 갱신 순서는 드래그 펄스 → 몸통 → 표정 → 렌더 → 라벨이다", () => {
  const h = createHarness();

  h.step();
  assert.deepEqual(h.log, ["dragPulse", "bodyDeform", "expression", "render", "labels"]);
});

test("델타는 0.05로 잘려 오래 멈췄다 돌아와도 한 프레임에 몰아 적용하지 않는다", () => {
  const slow = createHarness();
  const capped = createHarness();

  slow.pointer.set(100, 100);
  capped.pointer.set(100, 100);
  // 10초짜리 한 프레임과 0.05초짜리 한 프레임이 같은 추종량을 낸다.
  slow.step(10);
  capped.step(0.05);
  closeTo(slow.gazeY(), capped.gazeY(), 1e-9, "추종은 잘린 델타로만 진행한다");
  // 시계 자체는 실제 경과를 그대로 들고 있어야 한다(uTime은 실시간이다).
  assert.equal(slow.clock.elapsedTime, 10);
});

test("후처리 uTime에는 시계의 경과 시간이 그대로 들어간다", () => {
  const h = createHarness();

  h.step();
  h.step();
  assert.equal(h.postProcessUniforms.uTime.value, h.clock.elapsedTime);
});

test("미디어 플레이어가 숨어 있으면 위치를 갱신하지 않는다", () => {
  const h = createHarness();

  h.step();
  assert.ok(!h.log.includes("mediaPosition"), "숨어 있으면 부르지 않는다");

  h.control.mediaPlayerHidden = false;
  h.clear();
  h.step();
  assert.ok(h.log.includes("mediaPosition"), "보이면 부른다");
  assert.ok(
    h.log.indexOf("mediaPosition") < h.log.indexOf("expression"),
    "머리 회전 직후, 표정보다 먼저 갱신한다"
  );
});

// ── 머리 우선순위 사다리 ────────────────────────────────────────────────────────

test("평상시 머리는 부드러워진 포인터를 정해진 비율로 따라간다", () => {
  const h = settledHarness();

  h.step();
  closeTo(h.gazeY(), 62, 1e-6, "좌우 시선 총합은 0.62배");
  closeTo(h.headPivot.rotation.x, -27, 1e-6, "x는 -0.27배");
  closeTo(h.headPivot.rotation.z, -5, 1e-6, "z는 -0.05배");
});

test("몸통은 좌우 시선의 일부만 나눠 맡고 총 시선 방향은 그대로다", () => {
  const h = settledHarness();

  h.step();
  // 몸통이 각도를 "더하는" 방식이면 총합이 0.62배를 넘어 목이 모델 한계까지 비틀린다.
  closeTo(h.gazeY(), 62, 1e-6, "총 시선은 몸통 도입 전과 같다");
  closeTo(h.modelRoot.rotation.y, 62 * 0.18, 1e-6, "몸통이 정해진 비율만 맡는다");
  closeTo(h.headPivot.rotation.y, 62 * 0.82, 1e-6, "머리에는 나머지가 남는다");
  assert.ok(
    Math.abs(h.modelRoot.rotation.y) < Math.abs(h.headPivot.rotation.y),
    "몸통은 머리보다 덜 돌아간다"
  );
});

test("몸통은 가로축만 돌아간다", () => {
  // 위아래(x)나 기울임(z)까지 몸통에 주면 발이 떠 보이거나 넘어가는 것처럼 보인다.
  const h = settledHarness();

  const states = [
    () => {},
    () => { h.control.petting = true; },
    () => { h.control.petting = false; h.control.restActive = true; },
    () => { h.control.restActive = false; h.control.dragging = true; },
    () => { h.control.dragging = false; h.control.idle = true; }
  ];
  for (const enter of states) {
    enter();
    h.run(1);
    assert.equal(h.modelRoot.rotation.x, 0, "몸통에 위아래 회전이 없다");
    assert.equal(h.modelRoot.rotation.z, 0, "몸통에 기울임이 없다");
  }
});

test("커서를 따라가지 않는 상태에서는 몸통도 제자리로 돌아온다", () => {
  const h = settledHarness();

  h.step();
  assert.ok(Math.abs(h.modelRoot.rotation.y) > 1, "먼저 몸통이 돌아간 상태를 만든다");

  h.control.idle = true;
  h.run(4);
  // 몸통은 최종 시선 각도에서 파생되므로 잠들어 추종이 사라지면 함께 풀린다.
  assert.ok(Math.abs(h.modelRoot.rotation.y) < 0.01, `잠들면 몸통도 정면으로 돌아온다 (실측 ${h.modelRoot.rotation.y})`);
});

test("드래그 반응이 수면보다 앞선다", () => {
  const h = settledHarness();

  h.control.idle = true;
  h.run(4);
  assert.ok(Math.abs(h.gazeY()) < 0.01, "먼저 잠든 상태를 만든다");

  h.control.dragging = true;
  h.step();
  closeTo(
    h.gazeY(),
    Math.sin(h.clock.elapsedTime * 21) * 0.16,
    1e-9,
    "드래그 흔들림 공식을 그대로 쓴다"
  );
});

test("수면이 AI 답변보다 앞선다", () => {
  const h = settledHarness();

  h.control.assistantActive = true;
  h.control.answerBubbleHidden = false;
  h.control.idle = true;
  h.run(4);

  assert.ok(
    Math.abs(h.gazeY()) < 0.01,
    "잠들면 커서 추종이 사라진다 — 답변 분기였다면 35 근처가 나온다"
  );
  closeTo(h.headPivot.rotation.z, 0.06, 1e-3, "수면 분기의 고정 기울임");
});

test("AI 답변이 쓰다듬기보다 앞선다", () => {
  const h = settledHarness();

  h.control.petting = true;
  h.run(2);
  closeTo(h.headPivot.rotation.x, -11.8, 1e-3, "쓰다듬기 분기: -0.12배 + 고개 숙임");

  h.control.assistantActive = true;
  h.control.answerBubbleHidden = false;
  h.step();
  closeTo(h.gazeY(), 35, 1e-6, "답변 분기: 0.35배");
});

test("쓰다듬기가 미디어 끄덕임보다 앞선다", () => {
  const h = settledHarness();

  h.control.mediaStatus = "Playing";
  h.run(2);
  const mediaRotX = h.headPivot.rotation.x;
  assert.ok(mediaRotX < -13.5 && mediaRotX > -14.5, "미디어 분기: -0.14배 ± 끄덕임");

  h.control.petting = true;
  h.run(2);
  closeTo(h.headPivot.rotation.x, -11.8, 1e-3, "쓰다듬기 분기로 넘어간다");
});

test("펫대화 말풍선만 열려 있어도 답변과 같은 취급을 받는다", () => {
  const h = settledHarness();

  h.control.assistantActive = true;
  h.control.petChatBubbleHidden = false;
  h.step();
  closeTo(h.gazeY(), 35, 1e-6, "답변 분기 계수를 쓴다");
});

// ── 시간축 성질 ────────────────────────────────────────────────────────────────

test("추종 속도는 프레임률에 종속되지 않는다", () => {
  const slow = createHarness();
  const fast = createHarness();

  slow.pointer.set(100, 100);
  fast.pointer.set(100, 100);
  slow.run(1, 1 / 60);
  fast.run(1, 1 / 144);

  // 지수 감쇠라 프레임 분할과 무관하게 같은 값이 나와야 한다. 고정 계수 lerp로 되돌리면
  // 144Hz 쪽이 2배 넘게 빨라져 크게 벌어진다.
  closeTo(fast.gazeY(), slow.gazeY(), 1e-9, "60Hz와 144Hz가 같다");
  assert.ok(slow.gazeY() > 61, "1초면 대부분 따라잡는다");
});

test("숨쉬기는 위상을 누적하므로 오래 켜 둔 뒤 속도가 바뀌어도 크기가 튀지 않는다", () => {
  const h = createHarness();

  // 경과 시간을 충분히 키운다. `elapsed * speed`로 계산하면 여기서 속도가 바뀌는 순간
  // sin의 인자가 Δspeed * 60만큼 통째로 점프한다.
  h.run(60);

  h.control.idle = true;
  let previous = h.pet.scale.y;
  let maxJump = 0;
  for (let i = 0; i < 120; i += 1) {
    h.step();
    maxJump = Math.max(maxJump, Math.abs(h.pet.scale.y - previous));
    previous = h.pet.scale.y;
  }
  assert.ok(maxJump < 0.005, `잠드는 동안 프레임 간 크기 변화가 완만해야 한다 (실측 ${maxJump})`);
});

test("알람 amount는 임계 아래로 떨어지면 0으로 스냅돼 잔여 성분을 남기지 않는다", () => {
  const withAlarm = settledHarness();
  const without = settledHarness();

  withAlarm.control.restActive = true;
  withAlarm.run(2);
  without.run(2);
  assert.notEqual(withAlarm.gazeY(), without.gazeY());

  // 알람을 끄고 0.7초. 스냅이 없으면 amount가 0.002 언저리로 남아 알람 포즈가 계속 섞인다.
  withAlarm.control.restActive = false;
  withAlarm.run(0.7);
  without.run(0.7);
  closeTo(
    withAlarm.gazeY(),
    without.gazeY(),
    1e-12,
    "알람이 꺼진 뒤에는 한 번도 알람이 없던 것과 완전히 같아야 한다"
  );
});

// ── 표정 ──────────────────────────────────────────────────────────────────────

test("휴식 알림 표정은 다른 모든 상태보다 앞선다", () => {
  const h = createHarness();

  h.control.restActive = true;
  h.control.celebrating = true;
  h.control.dragging = true;
  h.control.petting = true;
  // 깜박임 간격 최대가 5.5초라 10초면 표정 지정이 없을 때 반드시 한 번은 감는다.
  h.run(10);
  assert.deepEqual([...new Set(h.expressions)], ["alarm"], "10초 내내 alarm만 나온다");
});

test("표정이 지정된 동안에는 깜박임 대기가 밀리지 않는다", () => {
  const h = createHarness();

  // 표정 지정 프레임에는 깜박임 타이머를 진행시키지 않고 쉬게만 한다. 이 10초 동안
  // 대기가 함께 흘렀다면(간격은 최대 5.5초) 대기가 이미 바닥나 있을 것이다.
  h.control.restActive = true;
  h.run(10);

  h.control.restActive = false;
  h.clear();
  // 최소 간격이 2.5초이므로, 대기가 보존됐다면 2.4초 안에는 절대 감지 않는다.
  h.run(2.4);
  assert.ok(
    !h.expressions.includes("normal_blink"),
    "표정이 풀린 직후에는 남아 있던 대기만큼 기다렸다가 깜박인다"
  );
});

test("축하 → 드래그 → 답변 순으로 표정이 정해진다", () => {
  const h = createHarness();

  h.control.celebrating = true;
  h.control.dragging = true;
  h.control.assistantActive = true;
  h.control.answerBubbleHidden = false;
  h.control.answerExpressionKey = "sad";
  h.step();
  assert.equal(h.expressions.at(-1), "happy", "축하가 가장 앞선다");

  h.control.celebrating = false;
  h.clear();
  h.step();
  assert.equal(h.expressions.at(-1), "shocked", "그다음이 드래그");

  h.control.dragging = false;
  h.clear();
  h.step();
  assert.equal(h.expressions.at(-1), "sad", "그다음이 답변 표정");
});

test("표정이 지정되지 않으면 깜박임 타이머가 눈을 정한다", () => {
  const h = createHarness();

  h.run(10);
  const seen = new Set(h.expressions);
  assert.ok(seen.has("normal"), "평소에는 뜬 눈");
  assert.ok(seen.has("normal_blink"), "10초 안에 적어도 한 번은 감는다");
  assert.equal(seen.size, 2, "그 둘 말고는 나오지 않는다");
});

test("CapsLock 알림은 다른 상태가 하나도 없을 때만 표시된다", () => {
  const h = createHarness();
  const eye = h.model.facePlates.eye;

  h.control.capsLock = true;
  h.step();
  assert.equal(h.expressions.at(-1), "shocked", "혼자일 때는 놀란 표정");
  assert.notEqual(eye.position.x, 0.1, "얼굴 떨림도 함께 켜진다");

  // 표정으로만 재면 드래그(shocked)처럼 같은 표정을 쓰는 상태와 구별되지 않는다.
  // 떨림은 CapsLock 알림에만 붙으므로 이쪽이 정확한 관측 지점이다.
  /** @type {Array<[string, () => void, () => void]>} */
  const blockers = [
    ["휴식 알림", () => { h.control.restActive = true; }, () => { h.control.restActive = false; }],
    ["축하", () => { h.control.celebrating = true; }, () => { h.control.celebrating = false; }],
    ["쓰다듬기", () => { h.control.petting = true; }, () => { h.control.petting = false; }],
    ["드래그", () => { h.control.dragging = true; }, () => { h.control.dragging = false; }],
    ["수면", () => { h.control.idle = true; }, () => { h.control.idle = false; }],
    ["기능 꺼짐", () => { h.renderSettings.capsLockAlertEnabled = false; }, () => { h.renderSettings.capsLockAlertEnabled = true; }],
    [
      "AI 답변",
      () => { h.control.assistantActive = true; h.control.answerBubbleHidden = false; },
      () => { h.control.assistantActive = false; h.control.answerBubbleHidden = true; }
    ]
  ];

  for (const [label, enable, disable] of blockers) {
    enable();
    h.step();
    assert.equal(eye.position.x, 0.1, `${label} 중에는 CapsLock 떨림이 꺼진다`);
    disable();
    h.step();
    assert.notEqual(eye.position.x, 0.1, `${label}가 풀리면 다시 떨린다`);
  }
});

test("CapsLock 알림일 때만 눈·입 데칼이 기준 위치를 벗어나 떨린다", () => {
  const h = createHarness();

  h.step();
  const eye = h.model.facePlates.eye;
  assert.deepEqual(
    [eye.position.x, eye.position.y, eye.position.z],
    [0.1, 0.2, 0.3],
    "평소에는 기준 위치 그대로"
  );

  h.control.capsLock = true;
  h.step();
  assert.notEqual(eye.position.x, 0.1, "떨림이 들어간다");
  assert.equal(eye.position.z, 0.3, "깊이는 건드리지 않는다");

  const mouth = h.model.facePlates.mouth;
  assert.notEqual(mouth.position.x, eye.position.x, "눈과 입은 위상을 달리해 함께 움직이지 않는다");

  h.control.capsLock = false;
  h.step();
  assert.equal(eye.position.x, 0.1, "꺼지면 기준 위치로 되돌린다");
});

// ── 아이들 루틴 허용 조건 ───────────────────────────────────────────────────────

test("직접 조작·방해 상태가 하나라도 있으면 아이들 루틴을 허용하지 않는다", () => {
  const h = createHarness();

  h.step();
  assert.equal(h.idleAllowed.at(-1), true, "평상시에는 허용한다");

  /** @type {Array<[string, () => void, () => void]>} */
  const blockers = [
    ["휴식 알림", () => { h.control.restActive = true; }, () => { h.control.restActive = false; }],
    ["기능 꺼짐", () => { h.renderSettings.idleRoutineEnabled = false; }, () => { h.renderSettings.idleRoutineEnabled = true; }],
    ["AI 패널", () => { h.control.assistantActive = true; }, () => { h.control.assistantActive = false; }],
    ["즐겨찾기", () => { h.control.favoritesActive = true; }, () => { h.control.favoritesActive = false; }],
    ["마우스 받는 중", () => { h.control.clickThrough = false; }, () => { h.control.clickThrough = true; }],
    ["수면", () => { h.control.idle = true; }, () => { h.control.idle = false; }],
    ["축하", () => { h.control.celebrating = true; }, () => { h.control.celebrating = false; }],
    ["쓰다듬기", () => { h.control.petting = true; }, () => { h.control.petting = false; }],
    ["드래그", () => { h.control.dragging = true; }, () => { h.control.dragging = false; }],
    ["미디어 재생", () => { h.control.mediaStatus = "Playing"; }, () => { h.control.mediaStatus = "None"; }]
  ];

  for (const [label, enable, disable] of blockers) {
    enable();
    h.clear();
    h.step();
    assert.equal(h.idleAllowed.at(-1), false, `${label} 중에는 허용하지 않는다`);
    disable();
    h.clear();
    h.step();
    assert.equal(h.idleAllowed.at(-1), true, `${label}가 풀리면 다시 허용한다`);
  }
});

test("수면 판정은 미디어 재생 중에는 서지 않는다", () => {
  const h = settledHarness();

  h.control.idle = true;
  h.control.mediaStatus = "Playing";
  h.run(4);
  // 잠들었다면 커서 추종이 사라진다. 미디어 끄덕임 분기에 남아 있어야 한다.
  assert.ok(h.gazeY() > 29, "영상을 보는 동안에는 재우지 않는다");
});

// ── 손 ────────────────────────────────────────────────────────────────────────

test("손 메시가 아직 없으면 손 갱신을 통째로 건너뛴다", () => {
  const h = createHarness({ withHands: false });

  h.control.restActive = true;
  h.run(2);
  assert.deepEqual(
    [h.hand.position.x, h.hand.position.y, h.hand.position.z],
    [0, 0, 0],
    "로딩 전에는 아무것도 건드리지 않는다"
  );
});

test("알림이 울리면 손을 머리 위로 올리고 양쪽으로 벌린다", () => {
  const h = createHarness();

  h.control.restActive = true;
  h.run(3);

  closeTo(h.hand.position.y, HEAD_PIVOT_Y + 0.35, 1e-6, "머리보다 위로 올린다");
  closeTo(h.handMirror.position.y, HEAD_PIVOT_Y + 0.35, 1e-6);
  assert.ok(h.hand.position.x > HAND_BASE.x + 0.4, "오른손은 바깥으로");
  assert.ok(h.handMirror.position.x < -HAND_BASE.x - 0.4, "왼손도 반대쪽 바깥으로");
});

// ── 꼬리 굽힘 ──────────────────────────────────────────────────────────────────

test("보이지 않는 꼬리 메시는 굽히지 않는다", () => {
  const tail = createTailMesh({ visible: false });
  const before = Float32Array.from(tail.geometry.getAttribute("position").array);
  const h = createHarness({ tail });

  h.control.targetTyping = 1;
  h.run(3);

  assert.deepEqual(Array.from(tail.geometry.getAttribute("position").array), Array.from(before));
  assert.equal(tail.userData.tailBendBase, undefined, "캐시도 만들지 않는다");
});

test("굽힘 캐시는 한 번만 계산하고 그 뒤로는 같은 원본 배열을 재사용한다", () => {
  const tail = createTailMesh();
  const h = createHarness({ tail });

  h.control.targetTyping = 1;
  h.run(1);
  const cachedBase = tail.userData.tailBendBase;
  assert.ok(cachedBase instanceof Float32Array, "원본 정점을 캐시해 둔다");
  assert.equal(tail.userData.tailBendMinY, 0);
  assert.equal(tail.userData.tailBendMaxY, 4);

  h.run(2);
  assert.equal(tail.userData.tailBendBase, cachedBase, "같은 배열을 계속 쓴다");
});

test("굽힘은 매 프레임 원본에서 다시 계산되므로 누적되지 않는다", () => {
  const tail = createTailMesh();
  const before = Float32Array.from(tail.geometry.getAttribute("position").array);
  const h = createHarness({ tail });

  h.control.targetTyping = 1;
  h.run(3);
  const bent = tail.geometry.getAttribute("position").array;
  assert.ok(
    Array.from(bent).some((value, index) => Math.abs(value - before[index]) > 0.01),
    "흔드는 동안에는 실제로 정점이 움직인다"
  );

  // 타이핑을 멈추면 굽힘이 0으로 수렴하고 정점은 원본으로 돌아온다. 굽힘이 0.0005 아래로
  // 내려가면 갱신을 멈추므로 그만큼(꼬리 폭 × 배율 ≈ 5e-4)은 남는다 — 누적됐다면 흔든
  // 진폭(0.01 이상)만큼 벌어지므로 이 여유로도 충분히 구별된다.
  h.control.targetTyping = 0;
  h.run(6);
  const settled = tail.geometry.getAttribute("position").array;
  for (let i = 0; i < before.length; i += 1) {
    closeTo(settled[i], before[i], 1e-3, `정점 ${i}이 원본으로 되돌아온다`);
  }
});

test("굽힘 배율은 꼬리가 길수록, 통통할수록 작아진다", () => {
  // 기준 길이 4, 기준 세장비 3.
  const round = createTailMesh({ length: 4, width: 2.7 });   // 짧고 통통 — 세장비 1.48
  const slim = createTailMesh({ length: 4, width: 1 });      // 짧고 가늘다 — 세장비 4
  const long = createTailMesh({ length: 12, width: 12 / 6.2 }); // 길고 가늘다 — 세장비 6.2

  /** @param {any} tail */
  function bendScaleOf(tail) {
    const h = createHarness({ tail });
    h.control.targetTyping = 1;
    h.run(1);
    return tail.userData.tailBendScale;
  }

  const slimScale = bendScaleOf(slim);
  const roundScale = bendScaleOf(round);
  const longScale = bendScaleOf(long);

  closeTo(slimScale, 1, 1e-6, "기준 길이 이하 + 충분히 가늘면 깎지 않는다");
  closeTo(roundScale, 4 / 2.7 / 3, 1e-6, "통통한 꼬리는 세장비 비율만큼 깎는다");
  closeTo(longScale, 4 / 12, 1e-6, "긴 꼬리는 기준 길이 비율만큼 깎는다");
  assert.ok(roundScale < slimScale && longScale < roundScale);
});
