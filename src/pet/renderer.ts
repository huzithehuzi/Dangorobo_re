import * as THREE from "three";
// three/examples/jsm는 electron-builder가 "examples" 폴더로 인식해 빌드에서 제외해버려서
// 배포판에서 net::ERR_FILE_NOT_FOUND가 났다. node_modules에 의존하지 않도록 프로젝트
// 소스(src/vendor)로 직접 복사해서 쓴다. three 업그레이드 시 다시 복사해줘야 한다.
import { createPetAudio } from "./pet-audio.js";
import { createIdleRoutineScheduler } from "./idle-routine.js";
import { createSquishMotion } from "./squish-motion.js";
import { createPetInteractionState } from "./pet-interaction-state.js";
import { createPetRenderSettings } from "./pet-render-settings.js";
import { TAIL_REST_ANGLE } from "./tail-motion.js";
import {
  POST_PROCESS_FRAGMENT_SHADER,
  POST_PROCESS_VERTEX_SHADER
} from "./post-process-shader.js";
import { createBubblePanels } from "./bubble-panels.js";
import { createAssistantPanels } from "./assistant-panels.js";
import { createPetModelLoader } from "./pet-model-loader.js";
import { createPetModelRefs } from "./pet-model-refs.js";
import { createAnimationLoop } from "./animation-loop.js";
import {
  PALETTE_RAMP_WIDTH,
  buildPaletteRampPixels,
  normalizeCustomStops,
  paletteRampSignature
} from "./palette-ramp.js";
import { createCustomizeLabels } from "./customize-labels.js";
import { thumbnailCameraDistance, thumbnailRenderSize } from "./thumbnail-image.js";
import { createThumbnailResources } from "./thumbnail-resources.js";
import { runThumbnailRenderTransaction } from "./thumbnail-render-transaction.js";
import type { Settings } from "../main/settings-schema.js";
import type {
  BodyCustomizationSettings,
  FaceCustomizationSettings,
  FaceExpressionKey,
  FaceTextureSet,
  MaterialPair,
  PartialFaceTextureSet,
} from "./pet-model-types.js";
import type { PaletteStop } from "./palette-ramp.js";

// 소리는 3D·DOM과 얽히지 않아 통째로 pet-audio.ts가 들고 있다.
const petAudio = createPetAudio();

// 설정에서 파생되는 렌더 값. 모듈이 소유하고 여기서는 읽기만 한다.
const renderSettings = createPetRenderSettings();

// GLB 로더가 채우는 조립 결과 그릇들. 정체성이 유지돼야 하므로 여기서 한 번만 만든다.
const model = createPetModelRefs();


// pet/index.html에 정적으로 들어 있는 요소들을 잡는다. 없으면 그 자체가 버그이므로
// 조용히 넘기지 않고 바로 던진다 — 예전에도 null이면 처음 쓰는 자리에서 TypeError가 났고,
// 여기서 던지면 어느 선택자가 비었는지가 메시지에 남는다.
function requireElement<TElement extends HTMLElement = HTMLElement>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) throw new Error(`pet/index.html에 ${selector} 요소가 없다`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#pet-canvas");
const modeCard = requireElement("#mode-card");
const restBubble = requireElement("#rest-bubble");
const restConfirm = requireElement("#rest-confirm");
const restIcon = requireElement("#rest-icon");
const restTitle = requireElement("#rest-title");
const restMessage = requireElement("#rest-message");
// 즐겨찾기용으로 만든 시계 SVG 템플릿(favorite-icons.js)을 재사용 — 알람 말풍선 전용
// 아이콘을 새로 그리지 않는다.
if (restIcon) restIcon.innerHTML = window.FavoriteIcons.svgMarkup("clock", "currentColor");
const assistantQuestionBubble = requireElement("#assistant-question-bubble");
const assistantAnswerBubble = requireElement("#assistant-answer-bubble");
const assistantQuestion = requireElement<HTMLTextAreaElement>("#assistant-question");
const assistantStatus = requireElement("#assistant-status");
const assistantSubmit = requireElement<HTMLButtonElement>("#assistant-submit");
const petChatCallNowButton = requireElement<HTMLButtonElement>("#pet-chat-call-now");
const assistantCancel = requireElement<HTMLButtonElement>("#assistant-cancel");
const assistantAnswerText = requireElement("#assistant-answer-text");
const assistantAnswerClose = requireElement("#assistant-answer-close");
const petChatBubble = requireElement("#pet-chat-bubble");
const petChatMessage = requireElement("#pet-chat-message");
const petChatReply = requireElement<HTMLTextAreaElement>("#pet-chat-reply");
const petChatStatus = requireElement("#pet-chat-status");
const petChatSubmit = requireElement<HTMLButtonElement>("#pet-chat-submit");
const petChatClose = requireElement<HTMLButtonElement>("#pet-chat-close");
const favoritesBubble = requireElement("#favorites-bubble");
const favoritesStatus = requireElement("#favorites-status");
const favoritesList = requireElement("#favorites-list");
const favoritesClose = requireElement("#favorites-close");
const pettingHeartsLayer = requireElement("#petting-hearts");
const mediaPlayer = requireElement("#media-player");
const mediaPreviousButton = requireElement("#media-previous");
const mediaPlayButton = requireElement("#media-play");
const mediaPauseButton = requireElement("#media-pause");
const mediaNextButton = requireElement("#media-next");
function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
// 펫이 너무 크거나(스케일 110%+) 귀가 긴 파츠(세로로 더 튀어나옴)일 때 카메라 프러스텀
// 밖으로 잘려 보이는 문제가 있었다. 발밑 앵커(feetWorldY = BASE_PET_Y + scale*PET_BOTTOM_ANCHOR_Y)는
// 그대로 두고 전체 크기만 18% 줄여서(pet-render-settings.ts의 BASE_PET_SCALE에 0.82 적용)
// 머리 위쪽에 여유 공간을 만든다.
// BASE_PET_Y도 같이 보정해 발 위치(화면상 앵커)는 이전과 동일하게 유지된다.
const BASE_PET_Y = -0.8185; // 발 앵커 유지 보정: -0.65 + 0.72*(1-0.82)*(-1.3)
const PET_BOTTOM_ANCHOR_Y = -1.3;
const PET_VISUAL_TOP_LOCAL_Y = 2.05;
const REST_BUBBLE_ARROW_HEIGHT = 9;
const REST_BUBBLE_GAP = 10;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100);
camera.position.set(0, 0, 7);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const sceneRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  depthBuffer: true,
  stencilBuffer: false
});
sceneRenderTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
sceneRenderTarget.texture.generateMipmaps = false;
sceneRenderTarget.samples = 4;

const postProcessUniforms = {
  tDiffuse: { value: sceneRenderTarget.texture },
  uResolution: { value: new THREE.Vector2(300, 420) },
  uPaletteEnabled: { value: 0 },
  uPaletteMode: { value: 0 },
  uPaletteSteps: { value: 12 },
  // 사용자 지정 팔레트(그라디언트 맵)용 1D 램프. buildPaletteRampTexture()가 만든다.
  uPaletteRamp: { value: (null as THREE.Texture | null) },
  uDitherPattern: { value: 0 },
  uDitherAmount: { value: 1 },
  uOutlineEnabled: { value: 0 },
  uOutlineColor: { value: new THREE.Color("#000000") },
  uOutlineThickness: { value: 2 },
  uTime: { value: 0 },
  uLineWobbleEnabled: { value: 0 },
  uLineWobbleFrequency: { value: 6 },
  uLineWobbleSpeed: { value: 1.5 },
  uLineWobbleAmount: { value: 1.5 }
};
const postProcessMaterial = new THREE.ShaderMaterial({
  uniforms: postProcessUniforms,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.NoBlending,
  toneMapped: false,
  vertexShader: POST_PROCESS_VERTEX_SHADER,
  fragmentShader: POST_PROCESS_FRAGMENT_SHADER
});
const postProcessScene = new THREE.Scene();
const postProcessCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postProcessScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postProcessMaterial));
const renderBufferSize = new THREE.Vector2();

const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
const keyLight = new THREE.DirectionalLight(0xffffff, 1);
keyLight.castShadow = true;
const rimLight = new THREE.DirectionalLight(0xffffff, 1);
scene.add(hemisphereLight, keyLight, rimLight);
// 조명은 카메라 레이어 필터링과 무관하게 항상 적용돼야 한다 — 머리 장식 조건부
// 오클루전(renderModelWithHeadgear)이 패스마다 camera.layers를 바꿔서 그리는데,
// 조명도 다른 Object3D처럼 카메라 레이어 테스트를 거치므로 기본 레이어(0)에만
// 있으면 헤드기어 전용 패스(레이어 2)에서 조명이 전부 빠져 새까맣게 나온다.
hemisphereLight.layers.enableAll();
keyLight.layers.enableAll();
rimLight.layers.enableAll();

const textureLoader = new THREE.TextureLoader();
// flipY: 얼굴 데칼은 코드가 만든 PlaneGeometry에 붙어서 three 기본 UV 규약(v=0이 이미지
// 아래쪽)을 따르지만, GLB 메시에 붙는 텍스처는 glTF 규약(v=0이 이미지 위쪽)이라 뒤집으면
// 안 된다. GLTFLoader가 자기 텍스처에 flipY=false를 걸어주는 것과 같은 이유 — 여기서는
// 텍스처를 직접 만들어 쓰므로 호출부가 알려줘야 한다(안 맞추면 무늬가 위아래로 어긋난다).
function loadTexture(slotName: string, { flipY = true }: { flipY?: boolean } = {}) {
  const texture = new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.flipY = flipY;

  const applyLoadedTexture = (loaded: THREE.Texture) => {
    texture.image = loaded.image;
    texture.needsUpdate = true;
  };
  const assetUrl = (extension: string) =>
    new URL(`../../assets/textures/${slotName}.${extension}`, import.meta.url).href;

  textureLoader.load(
    assetUrl("png"),
    applyLoadedTexture,
    undefined,
    () => textureLoader.load(assetUrl("svg"), applyLoadedTexture)
  );
  return texture;
}

// 무늬 개수·부위·파츠 목록은 main(설정 정규화)·설정창과 반드시 같아야 해서
// shared/customization-catalog.js 한 곳에서 가져온다(index.html이 <script>로 먼저 읽는다).
const {
  FACE_PATTERN_COUNT,
  FACE_COSMETIC_COUNT,
  FACE_EYE_STYLE_COUNT,
  FACE_MOUTH_STYLE_COUNT,
  BODY_COSTUME_COUNT,
  BODY_COLOR_DEFS,
  PART_VARIATION_DEFS,
} = window.PetCustomizationCatalog;
// 눈·입 각 스타일 폴더 안에 있는 표정별 텍스처 이름(예: face/eye_1/eye_1_normal.png).
const FACE_EXPRESSION_KEYS: FaceExpressionKey[] = ["normal", "normal_blink", "happy", "angry", "sad", "alarm", "shocked"];

function isFaceExpressionKey(value: string | null | undefined): value is FaceExpressionKey {
  return value != null && FACE_EXPRESSION_KEYS.some((key) => key === value);
}

function loadFaceLayerTextureSet(prefix: string, styleIndex: number) {
  const set: PartialFaceTextureSet = {};
  for (const key of FACE_EXPRESSION_KEYS) {
    set[key] = loadTexture(`face/${prefix}_${styleIndex}/${prefix}_${styleIndex}_${key}`);
  }
  return (set as FaceTextureSet);
}

const textures: Partial<Record<string, THREE.Texture>> = {};
for (let i = 1; i <= FACE_EYE_STYLE_COUNT; i++) model.eyeTextureSets[i] = loadFaceLayerTextureSet("eye", i);
for (let i = 1; i <= FACE_MOUTH_STYLE_COUNT; i++) model.mouthTextureSets[i] = loadFaceLayerTextureSet("mouth", i);

let eyeStyleIndex = 1;
let mouthStyleIndex = 1;
let currentFaceExpressionKey: FaceExpressionKey = "normal";
// 커스텀 얼굴: 사용자가 zip으로 불러온 표정별 이미지(data URL)를 THREE.Texture로
// 바꿔서 들고 있는다. main이 앱 시작 시(getCustomFaceTextures)와 새로 불러올 때마다
// (onCustomFaceTexturesUpdated) 이 값을 채워준다. 키가 없는 표정은 setFaceExpressionKey()에서
// customFaceTextureSet.normal로 대체되고, 그마저 없으면 판 자체를 숨긴다.
let customFaceEnabled = false;
let customFaceTextureSet: PartialFaceTextureSet = {};
function rebuildCustomFaceTextureSet(texturesByKey: Record<string, string> | null | undefined) {
  customFaceTextureSet = {};
  for (const [key, dataUrl] of Object.entries(texturesByKey || {})) {
    if (!isFaceExpressionKey(key)) continue;
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    textureLoader.load(dataUrl, (loaded: THREE.Texture) => {
      texture.image = loaded.image;
      texture.needsUpdate = true;
    });
    customFaceTextureSet[key] = texture;
  }
}
window.desktopPet.getCustomFaceTextures().then(rebuildCustomFaceTextureSet);
window.desktopPet.onCustomFaceTexturesUpdated(rebuildCustomFaceTextureSet);
for (let i = 1; i <= FACE_PATTERN_COUNT; i++) {
  textures[`facePattern${i}`] = loadTexture(`face_back/face_back_${i}`);
}
for (let i = 1; i <= FACE_COSMETIC_COUNT; i++) {
  textures[`faceCosmetic${i}`] = loadTexture(`face_cosmetic/face_cosmetic_${i}`);
}

// 몸 무늬(바디 데칼). 얼굴 무늬와 같은 방식이지만 몸통 셸 모델(body_tex.glb)에 붙는다.
for (let i = 1; i <= BODY_COSTUME_COUNT; i++) {
  textures[`bodyCostume${i}`] = loadTexture(`body_costume/body_costume_${i}`, { flipY: false });
}

// 커스텀 바디: 커스텀 얼굴과 같은 원리지만 표정이 없어서 이미지가 한 장뿐이다.
// main이 앱 시작 시(getCustomBodyTexture)와 새로 불러올 때마다(onCustomBodyTextureUpdated)
// data URL을 보내주고, 여기서 THREE.Texture로 바꿔 들고 있는다.
let customBodyEnabled = false;
let customBodyTexture: THREE.Texture | null = null;
function rebuildCustomBodyTexture(dataUrl: string | null | undefined) {
  customBodyTexture = null;
  if (typeof dataUrl === "string" && dataUrl) {
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    // GLB 메시(body_tex.glb)에 붙으므로 glTF UV 규약을 따른다 — loadTexture의 주석 참고.
    texture.flipY = false;
    textureLoader.load(dataUrl, (loaded: THREE.Texture) => {
      texture.image = loaded.image;
      texture.needsUpdate = true;
    });
    customBodyTexture = texture;
  }
  // 이미지가 늦게 도착해도(비동기 IPC) 지금 설정 기준으로 다시 반영한다.
  if (latestSettings) applyBodyCustomization(latestSettings);
}
window.desktopPet.getCustomBodyTexture().then(rebuildCustomBodyTexture);
window.desktopPet.onCustomBodyTextureUpdated(rebuildCustomBodyTexture);


// 머리 장식이 "몸은 뚫고 앞에 보이지만 머리·귀는 뚫지 않는" 조건부 오클루전을
// 3-패스 렌더링으로 구현한다(단일 깊이 버퍼 비교로는 파츠별로 다른 규칙을 못 둔다):
// 1) 몸/머리/귀/손/꼬리를 평소처럼 그린다(기존과 동일한 깊이 규칙 그대로 유지).
// 2) 깊이 버퍼만 지우고, 머리/귀만 다시 "안 보이게"(colorWrite:false) 그려서 깊이
//    버퍼를 머리·귀 형상만으로 다시 채운다 — 몸/손/꼬리의 깊이는 이 시점에 사라진다.
// 3) 머리 장식을 그리면, 방금 채운 머리·귀 전용 깊이 버퍼와만 비교된다 — 몸에는
//    안 뚫리고(깊이가 없으니 항상 이김) 머리·귀에는 실제 표면 깊이로 정확히 뚫린다.
// 얼굴 위 안경처럼 머리 표면보다 카메라에 더 가깝게 모델링된 장식은 3)에서 깊이
// 테스트를 통과해 얼굴 위에 정상적으로 보인다(스텐실로 실루엣 전체를 막던 이전
// 방식과 달리, 실제 표면 깊이를 비교하기 때문).
const HEAD_EAR_DEPTH_LAYER = 1;
const HEADGEAR_LAYER = 2;
const headEarDepthMaskMaterial = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: true,
  depthTest: true
});


const pet = new THREE.Group();
pet.position.y = BASE_PET_Y;
scene.add(pet);


// 머리·몸통·귀는 Blender에서 한 화면에 실제 크기·위치로 조립돼 있었다(공통 원점 근처,
// 서로 다른 translation.y로 상대 높이가 이미 맞춰짐). 이 상대 배치를 그대로 살리고,
// 캐릭터가 Blender에서 +X를 보고 있어서 정면(+Z)으로 돌리는 보정만 추가한다.
// 원본 회전을 지우면 메시 자체 기울기를 상쇄하던 값까지 사라져 귀가 한쪽으로 기운다.
const MODEL_FRONT_CORRECTION_Y = -Math.PI / 2;
const frontCorrection = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  MODEL_FRONT_CORRECTION_Y
);


let headPivot: THREE.Group;
let tailPivot: THREE.Group;
// 얼굴 판 크기에서 정해지는 값이라 조립이 끝난 뒤 로더에게 받아 넣는다.
let faceTrembleAmplitude = 0.01;

// 조립된 모델 전체를 담는 그룹. pet(스퀴시 스케일용)의 자식으로 두고,
// 발밑 기준선 맞추기용 수직 이동과 전체 크기 보정만 여기에 준다.
// 모델링 자체가 원래 기준보다 커서 말풍선이 머리와 겹쳐 살짝 줄인다.
const MODEL_ROOT_SCALE = 0.85;
const modelRoot = new THREE.Group();
modelRoot.scale.setScalar(MODEL_ROOT_SCALE);
pet.add(modelRoot);

let petVisualTopLocalY = PET_VISUAL_TOP_LOCAL_Y;

// object 서브트리의 경계 상자를 frame 오브젝트의 로컬 좌표계로 환산해 돌려준다.
function boundingBoxInFrame(
  object: THREE.Object3D,
  frame: THREE.Object3D,
  { visibleOnly = false }: { visibleOnly?: boolean } = {}
) {
  object.updateWorldMatrix(true, true);
  frame.updateWorldMatrix(true, false);
  const inverseFrame = frame.matrixWorld.clone().invert();
  const transform = new THREE.Matrix4();
  const box = new THREE.Box3();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (visibleOnly && !child.visible) return;
    child.geometry.computeBoundingBox();
    const childBounds = child.geometry.boundingBox;
    if (!childBounds) throw new Error("메시 경계 상자를 계산하지 못했다");
    const childBox = childBounds.clone();
    transform.multiplyMatrices(inverseFrame, child.matrixWorld);
    childBox.applyMatrix4(transform);
    box.union(childBox);
  });
  return box;
}

// 말풍선은 실제로 보이는 모델의 최상단을 기준으로 띄운다. 귀를 바꾸면 높이가 달라지므로
// 파츠 변경 때마다 다시 계산한다.
function refreshPetVisualTop() {
  const box = boundingBoxInFrame(modelRoot, pet, { visibleOnly: true });
  if (!box.isEmpty()) {
    petVisualTopLocalY = box.max.y;
    // 우클릭·창 배치 계산이 실제 머리 꼭대기 높이를 알아야 하므로 main 프로세스에 공유한다.
    window.desktopPet.reportVisualTop(petVisualTopLocalY);
  }
}


function applyBodyCustomization(settings: BodyCustomizationSettings) {
  customBodyEnabled = settings.customBodyEnabled === true;

  const costumeIndex = Number(settings.bodyCostume);
  const costumeTexture = Number.isInteger(costumeIndex) && costumeIndex >= 1 && costumeIndex <= BODY_COSTUME_COUNT
    ? textures[`bodyCostume${costumeIndex}`] ?? null
    : null;
  // 명암 토글로 lit/unlit이 언제든 스왑되므로 둘 다 갱신한다(얼굴 무늬와 같은 이유).
  if (model.bodyPlates.costume && model.loadedMaterials.bodyCostume) {
    model.loadedMaterials.bodyCostume.lit.map = costumeTexture;
    model.loadedMaterials.bodyCostume.lit.needsUpdate = true;
    model.loadedMaterials.bodyCostume.unlit.map = costumeTexture;
    model.loadedMaterials.bodyCostume.unlit.needsUpdate = true;
    // 커스텀 바디가 켜져 있으면 기본 무늬는 숨긴다(커스텀 얼굴이 눈·입을 숨기는 것과 같다).
    model.bodyPlates.costume.visible = costumeTexture != null && !customBodyEnabled;
  }

  const customTexture = customBodyEnabled ? customBodyTexture : null;
  if (model.bodyPlates.customBody && model.loadedMaterials.customBody) {
    model.loadedMaterials.customBody.lit.map = customTexture;
    model.loadedMaterials.customBody.lit.needsUpdate = true;
    model.loadedMaterials.customBody.unlit.map = customTexture;
    model.loadedMaterials.customBody.unlit.needsUpdate = true;
    model.bodyPlates.customBody.visible = customTexture != null;
  }
}

function setFaceExpressionKey(expressionKey: string | null | undefined) {
  const key = isFaceExpressionKey(expressionKey) ? expressionKey : "normal";
  currentFaceExpressionKey = key;

  const eyePlate = model.facePlates.eye;
  if (eyePlate) {
    // 커스텀 얼굴이 켜져 있으면 기존 눈 렌더링은 완전히 숨긴다(사용자 요청).
    eyePlate.visible = !customFaceEnabled;
    const eyeSet = model.eyeTextureSets[eyeStyleIndex] || model.eyeTextureSets[1];
    const texture = eyeSet[key] || eyeSet.normal;
    if (eyePlate.material.map !== texture) {
      eyePlate.material.map = texture;
      eyePlate.material.needsUpdate = true;
    }
  }

  const mouthPlate = model.facePlates.mouth;
  if (mouthPlate) {
    const mouthSet = mouthStyleIndex >= 1 ? model.mouthTextureSets[mouthStyleIndex] : null;
    // 커스텀 얼굴이 켜져 있으면 기존 입 렌더링도 완전히 숨긴다.
    mouthPlate.visible = !customFaceEnabled && mouthSet != null;
    if (mouthSet) {
      const texture = mouthSet[key] || mouthSet.normal;
      if (mouthPlate.material.map !== texture) {
        mouthPlate.material.map = texture;
        mouthPlate.material.needsUpdate = true;
      }
    }
  }

  const customFacePlate = model.facePlates.customFace;
  if (customFacePlate) {
    const texture = customFaceEnabled ? (customFaceTextureSet[key] || customFaceTextureSet.normal || null) : null;
    customFacePlate.visible = texture != null;
    if (texture && customFacePlate.material.map !== texture) {
      customFacePlate.material.map = texture;
      customFacePlate.material.needsUpdate = true;
    }
  }
}

function applyFaceCustomization(settings: FaceCustomizationSettings) {
  const faceMaterials = model.loadedMaterials.face;
  const patternIndex = Number(settings.facePattern);
  const patternPlate = model.facePlates.pattern;
  if (patternPlate) {
    if (!faceMaterials) throw new Error("얼굴 무늬 머티리얼이 준비되지 않았다");
    const texture = Number.isInteger(patternIndex) && patternIndex >= 1 && patternIndex <= FACE_PATTERN_COUNT
      ? textures[`facePattern${patternIndex}`] ?? null
      : null;
    // lit/unlit 명암 토글로 언제든 스왑될 수 있으니 둘 다 갱신한다(현재 활성 머티리얼만
    // 바꾸면 토글 시 비활성 쪽이 예전 텍스처로 되돌아간다).
    faceMaterials.pattern.lit.map = texture;
    faceMaterials.pattern.lit.needsUpdate = true;
    faceMaterials.pattern.unlit.map = texture;
    faceMaterials.pattern.unlit.needsUpdate = true;
    patternPlate.visible = texture != null;
  }

  const cosmeticIndex = Number(settings.faceCosmetic);
  const cosmeticPlate = model.facePlates.cosmetic;
  if (cosmeticPlate) {
    if (!faceMaterials) throw new Error("얼굴 장식 머티리얼이 준비되지 않았다");
    const texture = Number.isInteger(cosmeticIndex) && cosmeticIndex >= 1 && cosmeticIndex <= FACE_COSMETIC_COUNT
      ? textures[`faceCosmetic${cosmeticIndex}`] ?? null
      : null;
    faceMaterials.cosmetic.lit.map = texture;
    faceMaterials.cosmetic.lit.needsUpdate = true;
    faceMaterials.cosmetic.unlit.map = texture;
    faceMaterials.cosmetic.unlit.needsUpdate = true;
    cosmeticPlate.visible = texture != null;
  }

  const eyeIndex = Number(settings.faceEyeStyle);
  eyeStyleIndex = Number.isInteger(eyeIndex) && eyeIndex >= 1 && eyeIndex <= FACE_EYE_STYLE_COUNT ? eyeIndex : 1;

  const mouthIndex = Number(settings.faceMouthStyle);
  mouthStyleIndex = Number.isInteger(mouthIndex) && mouthIndex >= 0 && mouthIndex <= FACE_MOUTH_STYLE_COUNT
    ? mouthIndex
    : 1;

  customFaceEnabled = settings.customFaceEnabled === true;
}

const pointer = new THREE.Vector2();
let restActive = false;
const idleRoutineScheduler = createIdleRoutineScheduler({
  getGapRange: () => ({ minGapMs: renderSettings.idleRoutineMinGapMs, maxGapMs: renderSettings.idleRoutineMaxGapMs })
});
idleRoutineScheduler.scheduleFirst(performance.now());
// 들어올리기(드래그) 반응
let clickThrough = true;
let shadingEnabled = true;
let pixelArtPercent = 0;
let paletteEnabled = false;
let outlineEnabled = false;
let lineWobbleEnabled = false;
const squishMotion = createSquishMotion();
// 번역 대상 언어 목록. main.js의 TRANSLATE_LANGUAGES와 키를 맞춰야 한다.
// 라벨은 앱 UI 언어에 따라 바뀌므로(예: 영어 UI에선 "Translate to Korean"),
// 상수 배열이 아니라 매번 tt()로 계산하는 함수로 둔다.
function translateLanguageOptions() {
  return [
    { value: "ko", label: tt("translate.toKorean") },
    { value: "en", label: tt("translate.toEnglish") },
    { value: "ja", label: tt("translate.toJapanese") },
    { value: "zh-CN", label: tt("translate.toChineseSimplified") },
    { value: "es", label: tt("translate.toSpanish") },
    { value: "fr", label: tt("translate.toFrench") },
    { value: "de", label: tt("translate.toGerman") }
  ];
}
let mediaState = { status: "None" };


function applyShading(enabled: boolean) {
  shadingEnabled = enabled;
  for (const group of model.materialGroups) {
    const nextMaterial = enabled ? group.materials.lit : group.materials.unlit;
    for (const object of group.objects) object.material = nextMaterial;
  }
}

function setPairColor(materials: MaterialPair | undefined, color: string | number) {
  if (!materials) return;
  materials.lit.color.set(color);
  materials.unlit.color.set(color);
}

function applyBodyColors(settings: Pick<Settings, "bodyColors">) {
  const entries = Array.isArray(settings.bodyColors) ? settings.bodyColors : [];
  const validateColor = (color: unknown) => /^#[0-9a-fA-F]{6}$/.test(String(color || "")) ? String(color) : "#ffffff";

  const partColors = {
    head: validateColor(entries.find((e) => e?.id === "head")?.color || "#ffffff"),
    body: validateColor(entries.find((e) => e?.id === "body")?.color || "#ffffff"),
    ears: validateColor(entries.find((e) => e?.id === "ears")?.color || "#ffffff"),
    tail: validateColor(entries.find((e) => e?.id === "tail")?.color || "#ffffff"),
    headgear: validateColor(entries.find((e) => e?.id === "headgear")?.color || "#ffffff"),
    hand: validateColor(entries.find((e) => e?.id === "hand")?.color || "#ffffff"),
    eye: validateColor(entries.find((e) => e?.id === "eye")?.color || "#ffffff"),
    mouth: validateColor(entries.find((e) => e?.id === "mouth")?.color || "#ffffff"),
    facePattern: validateColor(entries.find((e) => e?.id === "facePattern")?.color || "#000000"),
    faceCosmetic: validateColor(entries.find((e) => e?.id === "faceCosmetic")?.color || "#ffffff"),
    bodyCostume: validateColor(entries.find((e) => e?.id === "bodyCostume")?.color || "#ffffff")
  };

  setPairColor(model.loadedMaterials.head, partColors.head);
  setPairColor(model.loadedMaterials.body, partColors.body);
  setPairColor(model.loadedMaterials.hand, partColors.hand);

  for (const materials of Object.values(model.loadedMaterials.earsByVariation || {})) {
    setPairColor(materials, partColors.ears);
  }

  for (const materials of Object.values(model.loadedMaterials.tailByVariation || {})) {
    setPairColor(materials, partColors.tail);
  }

  for (const materials of Object.values(model.loadedMaterials.headgearByVariation || {})) {
    setPairColor(materials, partColors.headgear);
  }

  if (model.loadedMaterials.face) {
    model.loadedMaterials.face.eye.color.set(partColors.eye);
    model.loadedMaterials.face.mouth.color.set(partColors.mouth);
    setPairColor(model.loadedMaterials.face.pattern, partColors.facePattern);
    setPairColor(model.loadedMaterials.face.cosmetic, partColors.faceCosmetic);
  }

  // 커스텀 바디(model.loadedMaterials.customBody)는 일부러 뺀다 — 커스텀 얼굴과 같이
  // 사용자가 만든 이미지에는 색을 입히지 않고 원본 그대로 보여준다.
  setPairColor(model.loadedMaterials.bodyCostume, partColors.bodyCostume);
}

function applyPartVariations(settings: Pick<Settings, "partVariations">) {
  const entries = Array.isArray(settings.partVariations) ? settings.partVariations : [];

  for (const def of PART_VARIATION_DEFS) {
    const entry = entries.find((e) => e?.id === def.id);
    const selectedVariation = entry?.variation || def.defaultVariation;

    if (def.id === "ears") {
      for (const earMesh of model.ears) {
        earMesh.visible = earMesh.userData?.variation === selectedVariation;
      }
    } else if (def.id === "tail" && tailPivot) {
      const tailChildren = tailPivot.children.filter((c) => c.userData?.variation);
      for (const tailMesh of tailChildren) {
        tailMesh.visible = tailMesh.userData?.variation === selectedVariation;
      }
    } else if (def.id === "headgear") {
      for (const headgearMesh of model.headgear) {
        headgearMesh.visible = headgearMesh.userData?.variation === selectedVariation;
      }
    }
  }

  refreshPetVisualTop();
}

function applyPixelArt(percent: number) {
  pixelArtPercent = THREE.MathUtils.clamp(Number(percent) || 0, 0, 100);
  canvas.classList.toggle("pixel-art", pixelArtPercent > 0);
  resize();
}

const PALETTE_MODES = {
  auto: 0,
  warm: 1,
  cool: 2,
  monochrome: 3,
  gameboy: 4,
  custom: 5
};

function isPaletteMode(value: string): value is keyof typeof PALETTE_MODES {
  return Object.hasOwn(PALETTE_MODES, value);
}

/* 디더링 패턴 이름 → 셰이더의 uDitherPattern 번호. **셰이더 ditherThreshold()의 분기 순서와
   반드시 같은 순서**여야 한다(설정창 select의 option 순서, settings-schema.js의
   DITHER_PATTERNS와도 같이 맞출 것 — 세 곳이 어긋나면 고른 것과 다른 무늬가 나온다). */
const DITHER_PATTERNS = ["none", "bayer2", "bayer4", "bayer8", "checker", "lines", "verticalLines", "noise"];

/* 사용자 지정 팔레트(그라디언트 맵)용 1D 램프 텍스처. 램프 픽셀 계산과 정지점 정규화는
   palette-ramp.ts가 하고, 여기서는 GPU 자원 생성과 캐시만 맡는다.

   ⚠ colorSpace를 건드리지 않는다(DataTexture 기본값 NoColorSpace). 정지점 hex는 sRGB
   값이고, 이 램프를 읽는 지점의 color도 이미 sRGB 인코딩 상태라 그대로 대입해야 맞다.
   여기서 three가 자동 변환하게 두면 색이 한 번 더 감마를 먹는다. */
let paletteRampTexture: THREE.DataTexture | null = null;
// 정지점이 그대로면 다시 굽지 않는다(applyRenderEffects는 설정이 바뀔 때마다 불린다).
let paletteRampCachedSignature = "";

function buildPaletteRampTexture(stops: PaletteStop[]) {
  const signature = paletteRampSignature(stops);
  if (paletteRampTexture && signature === paletteRampCachedSignature) return paletteRampTexture;

  const data = buildPaletteRampPixels(stops, window.PetColorPicker.hexToRgb);

  paletteRampTexture?.dispose();
  paletteRampTexture = new THREE.DataTexture(data, PALETTE_RAMP_WIDTH, 1, THREE.RGBAFormat);
  paletteRampTexture.minFilter = THREE.LinearFilter;
  paletteRampTexture.magFilter = THREE.LinearFilter;
  paletteRampTexture.wrapS = THREE.ClampToEdgeWrapping;
  paletteRampTexture.wrapT = THREE.ClampToEdgeWrapping;
  paletteRampTexture.needsUpdate = true;
  paletteRampCachedSignature = signature;
  return paletteRampTexture;
}
function applyRenderEffects(settings: Settings) {
  paletteEnabled = settings.paletteEnabled === true;
  outlineEnabled = settings.outlineEnabled === true;
  postProcessUniforms.uPaletteEnabled.value = paletteEnabled ? 1 : 0;

  let paletteMode = settings.palettePreset ?? "auto";

  if (paletteMode === "auto" && settings.lighting?.ambient?.color) {
    const color = String(settings.lighting.ambient.color).toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) {
      const r = parseInt(color.slice(1, 3), 16);
      const b = parseInt(color.slice(5, 7), 16);
      const warmth = r - b;
      if (warmth > 30) {
        paletteMode = "warm";
      } else if (warmth < -30) {
        paletteMode = "cool";
      }
    }
  }

  postProcessUniforms.uPaletteMode.value = isPaletteMode(paletteMode) ? PALETTE_MODES[paletteMode] : 0;
  postProcessUniforms.uPaletteSteps.value = THREE.MathUtils.clamp(
    Math.round(Number(settings.paletteSteps) || 12),
    2,
    32
  );
  /* 램프는 "사용자 지정"일 때만 필요하지만 항상 만들어 둔다 — 셰이더는 uPaletteMode와
     무관하게 컴파일되고, 일부 드라이버는 바인딩 안 된 sampler2D를 읽으면 경고를 내거나
     검은색을 돌려준다. 정지점이 그대로면 buildPaletteRampTexture()가 캐시를 돌려주므로
     매번 다시 굽지 않는다. */
  postProcessUniforms.uPaletteRamp.value = buildPaletteRampTexture(
    normalizeCustomStops(settings.paletteCustomStops)
  );
  // 디더링. 셰이더의 ditherThreshold() 분기 순서와 이 배열 순서가 반드시 같아야 한다.
  postProcessUniforms.uDitherPattern.value = Math.max(0, DITHER_PATTERNS.indexOf(settings.ditherPattern));
  // Number(undefined)는 NaN이라 ?? 로는 못 거른다 — 유한한지 직접 확인한다.
  const ditherAmount = Number(settings.ditherAmount);
  postProcessUniforms.uDitherAmount.value = THREE.MathUtils.clamp(
    (Number.isFinite(ditherAmount) ? ditherAmount : 100) / 100,
    0,
    1
  );
  postProcessUniforms.uOutlineEnabled.value = outlineEnabled ? 1 : 0;
  postProcessUniforms.uOutlineColor.value.set(
    /^#[0-9a-fA-F]{6}$/.test(String(settings.outlineColor || ""))
      ? settings.outlineColor
      : "#000000"
  );
  postProcessUniforms.uOutlineThickness.value = THREE.MathUtils.clamp(
    Math.round(Number(settings.outlineThickness) || 4),
    1,
    8
  );

  lineWobbleEnabled = settings.lineWobbleEnabled === true;
  postProcessUniforms.uLineWobbleEnabled.value = lineWobbleEnabled ? 1 : 0;
  postProcessUniforms.uLineWobbleFrequency.value = THREE.MathUtils.clamp(
    Number(settings.lineWobbleFrequency) || 6,
    1,
    30
  );
  postProcessUniforms.uLineWobbleSpeed.value = THREE.MathUtils.clamp(
    Number(settings.lineWobbleSpeed) || 1.5,
    0.1,
    10
  );
  postProcessUniforms.uLineWobbleAmount.value = THREE.MathUtils.clamp(
    Number(settings.lineWobbleAmount) || 1.5,
    0,
    6
  );
}

// 머리 장식 조건부 오클루전 3-패스 렌더링 (위 HEAD_EAR_DEPTH_LAYER 주석 참고).
// renderer.autoClear가 기본 true라 render()를 호출할 때마다 색상+깊이를 통째로
// 지워버린다 — 이러면 2·3번째 패스가 1번째 패스의 결과를 매번 지우고 시작하게
// 되어(실제로 이 버그로 몸/머리/손/꼬리가 전부 사라지고 headgear만 남는 증상이
// 났었다) 자동 클리어를 끄고 프레임 시작에 한 번만 수동으로 지운 뒤, 패스 사이에는
// 깊이만 지운다.
function renderModelWithHeadgear(target: THREE.WebGLRenderTarget | null) {
  renderer.setRenderTarget(target);
  renderer.autoClear = false;
  renderer.clear(true, true, false);

  camera.layers.set(0);
  renderer.render(scene, camera);

  renderer.clearDepth();
  camera.layers.set(HEAD_EAR_DEPTH_LAYER);
  scene.overrideMaterial = headEarDepthMaskMaterial;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;

  camera.layers.set(HEADGEAR_LAYER);
  renderer.render(scene, camera);

  camera.layers.enableAll();
  renderer.autoClear = true;
}

function renderPetScene() {
  if (!paletteEnabled && !outlineEnabled && !lineWobbleEnabled) {
    renderModelWithHeadgear(null);
    return;
  }
  renderModelWithHeadgear(sceneRenderTarget);
  renderer.setRenderTarget(null);
  renderer.render(postProcessScene, postProcessCamera);
}

// ── 커스터마이징 프리셋 썸네일 (2026-08-06) ────────────────────────────────
// 설정창에는 Three.js 씬이 없다(비모듈 스크립트 하나뿐이고, 조립·얼굴 데칼·후처리
// 셰이더를 통째로 복제해야 한다). 대신 모델·조명·후처리가 이미 살아 있는 이 펫
// 렌더러가 프리셋별로 "머리만" 오프스크린 렌더해서 PNG data URL로 돌려준다.
// 해상도 산정과 픽셀 변환은 thumbnail-image.ts가 하고, 여기서는 렌더 타깃과 씬 상태를 맡는다.
const thumbnailResources = createThumbnailResources({ renderer });

const thumbnailBox = new THREE.Box3();
const thumbnailUnionBox = new THREE.Box3();
const thumbnailCenter = new THREE.Vector3();
const thumbnailSize = new THREE.Vector3();

function renderPresetThumbnails(presets: Settings["customizationPresets"]) {
  const list = Array.isArray(presets) ? presets : [];
  // 모델 로드 전(설정창을 앱 시작 직후에 연 경우)에는 아무것도 못 그린다.
  if (!list.length || !headPivot || !latestSettings) return {};

  // 애니메이션 중인 상태(숨쉬기 스퀴시, 마우스를 따라가는 고개, 표정)를 그대로 찍으면
  // 프리셋마다 자세가 달라진다. 잠시 기본 자세로 되돌려 찍고 전부 복구한다.
  // 라이브 렌더는 이 함수가 끝난 뒤 다음 프레임에 다시 그려지므로 깜빡임은 없다.
  const savedPetScale = pet.scale.clone();
  const savedPetPositionY = pet.position.y;
  const savedHeadRotation = headPivot.rotation.clone();
  const savedBodyVisible = model.loadedMeshes.body?.visible ?? false;
  const savedHandVisible = model.loadedMeshes.hand?.visible ?? false;
  const savedHandMirrorVisible = model.loadedMeshes.handMirror?.visible ?? false;
  const savedTailVisible = tailPivot?.visible ?? false;
  const savedCameraPosition = camera.position.clone();
  const savedCameraQuaternion = camera.quaternion.clone();
  const savedCameraAspect = camera.aspect;
  const savedResolution = postProcessUniforms.uResolution.value.clone();
  const savedDiffuse = postProcessUniforms.tDiffuse.value;
  const savedRenderTarget = renderer.getRenderTarget();
  const savedAutoClear = renderer.autoClear;
  const savedCameraLayerMask = camera.layers.mask;
  const savedOverrideMaterial = scene.overrideMaterial;
  const savedCostumeVisible = model.bodyPlates.costume?.visible ?? false;
  const savedCustomBodyVisible = model.bodyPlates.customBody?.visible ?? false;
  const savedFaceExpressionKey = currentFaceExpressionKey;
  const settingsToRestore = latestSettings;

  return runThumbnailRenderTransaction(() => {
    pet.scale.setScalar(renderSettings.petBaseScale);
    pet.position.y = BASE_PET_Y;
    headPivot.rotation.set(0, 0, 0);
    if (model.loadedMeshes.body) model.loadedMeshes.body.visible = false;
    if (model.bodyPlates.costume) model.bodyPlates.costume.visible = false;
    if (model.bodyPlates.customBody) model.bodyPlates.customBody.visible = false;
    if (model.loadedMeshes.hand) model.loadedMeshes.hand.visible = false;
    if (model.loadedMeshes.handMirror) model.loadedMeshes.handMirror.visible = false;
    if (tailPivot) tailPivot.visible = false;

    // 1단계: 모든 프리셋의 머리 경계 상자를 합집합으로 모아 카메라를 한 번만 정한다.
    // 프리셋마다 따로 맞추면 귀·모자 크기에 따라 머리 배율이 달라져서 목록이 들쭉날쭉해진다.
    thumbnailUnionBox.makeEmpty();
    for (const preset of list) {
      applyPartVariations(preset);
      applyFaceCustomization(preset);
      setFaceExpressionKey("normal");
      thumbnailBox.copy(boundingBoxInFrame(headPivot, scene, { visibleOnly: true }));
      if (!thumbnailBox.isEmpty()) thumbnailUnionBox.union(thumbnailBox);
    }

    const thumbnails: Record<string, string> = {};
    if (!thumbnailUnionBox.isEmpty()) {
      thumbnailUnionBox.getCenter(thumbnailCenter);
      thumbnailUnionBox.getSize(thumbnailSize);
      const distance = thumbnailCameraDistance(thumbnailSize, camera.fov);
      const size = thumbnailRenderSize(renderBufferSize.y, distance, camera.position.z);
      const { sceneTarget, outputTarget } = thumbnailResources.ensure(size);
      camera.aspect = 1;
      camera.quaternion.identity();
      camera.position.set(thumbnailCenter.x, thumbnailCenter.y, thumbnailCenter.z + distance);
      camera.updateProjectionMatrix();

      // 후처리를 항상 거친다(효과가 다 꺼져 있으면 사실상 통과 패스다) — 라이브처럼
      // 분기하면 MSAA 경로가 갈려서 같은 코드로 읽어낼 수 없다.
      postProcessUniforms.uResolution.value.set(size, size);
      postProcessUniforms.tDiffuse.value = sceneTarget.texture;

      // 2단계: 프리셋별로 색·파츠·얼굴을 적용해 한 장씩 찍는다.
      for (const preset of list) {
        if (!preset?.id) continue;
        applyBodyColors(preset);
        applyPartVariations(preset);
        applyFaceCustomization(preset);
        setFaceExpressionKey("normal");
        renderModelWithHeadgear(sceneTarget);
        renderer.setRenderTarget(outputTarget);
        renderer.render(postProcessScene, postProcessCamera);
        thumbnails[preset.id] = thumbnailResources.toDataUrl(size);
      }
      renderer.setRenderTarget(null);
    }
    return thumbnails;
  }, [
    () => renderer.setRenderTarget(savedRenderTarget),
    () => { renderer.autoClear = savedAutoClear; },
    () => { camera.layers.mask = savedCameraLayerMask; },
    () => { scene.overrideMaterial = savedOverrideMaterial; },
    () => { postProcessUniforms.tDiffuse.value = savedDiffuse; },
    () => { postProcessUniforms.uResolution.value.copy(savedResolution); },
    () => { camera.aspect = savedCameraAspect; },
    () => { camera.quaternion.copy(savedCameraQuaternion); },
    () => { camera.position.copy(savedCameraPosition); },
    () => { camera.updateProjectionMatrix(); },
    () => { camera.updateMatrixWorld(true); },
    () => { if (model.loadedMeshes.body) model.loadedMeshes.body.visible = savedBodyVisible; },
    () => { if (model.loadedMeshes.hand) model.loadedMeshes.hand.visible = savedHandVisible; },
    () => { if (model.loadedMeshes.handMirror) model.loadedMeshes.handMirror.visible = savedHandMirrorVisible; },
    () => { if (tailPivot) tailPivot.visible = savedTailVisible; },
    () => { headPivot.rotation.copy(savedHeadRotation); },
    () => { pet.position.y = savedPetPositionY; },
    () => { pet.scale.copy(savedPetScale); },
    // 외형 복구 하나가 실패해도 뒤의 복구를 계속 시도한다.
    () => applyBodyColors(settingsToRestore),
    () => applyPartVariations(settingsToRestore),
    () => applyFaceCustomization(settingsToRestore),
    () => applyBodyCustomization(settingsToRestore),
    () => { if (model.bodyPlates.costume) model.bodyPlates.costume.visible = savedCostumeVisible; },
    () => { if (model.bodyPlates.customBody) model.bodyPlates.customBody.visible = savedCustomBodyVisible; },
    () => setFaceExpressionKey(savedFaceExpressionKey)
  ]);
}

window.desktopPet.onRenderPresetThumbnails(async (payload: PetPresetThumbnailRequest) => {
  let thumbnails: Record<string, string> = {};
  try {
    await modelsReady;
    thumbnails = renderPresetThumbnails(payload.presets);
  } catch (error) {
    console.error("💥 프리셋 썸네일 렌더 실패:", error);
  }
  window.desktopPet.sendPresetThumbnails({ requestId: payload.requestId, thumbnails });
});

const bubbleHeadAnchor = new THREE.Vector3();
// 머리 꼭대기의 화면상 y좌표(px) — 말풍선 위치와 쓰다듬기 하트 이펙트가 공유한다.
function headTopScreenY() {
  const renderHeight = canvas.clientHeight;
  const renderTop = window.innerHeight - renderHeight;
  const headWorldY = BASE_PET_Y + renderSettings.petBaseScale * petVisualTopLocalY;
  bubbleHeadAnchor.set(0, headWorldY, 0).project(camera);
  return renderTop + (1 - bubbleHeadAnchor.y) * renderHeight / 2;
}
function updateBubblePosition(bubble: HTMLElement) {
  if (!bubble || bubble.hidden) return;
  const headTop = headTopScreenY();
  const bubbleHeight = bubble.offsetHeight;
  const idealTop = headTop - bubbleHeight - REST_BUBBLE_ARROW_HEIGHT - REST_BUBBLE_GAP;
  const minTop = 8;
  const maxTop = Math.max(
    minTop,
    window.innerHeight - bubbleHeight - REST_BUBBLE_ARROW_HEIGHT - 8
  );
  const nextTop = THREE.MathUtils.clamp(idealTop, minTop, maxTop);
  bubble.style.top = `${Math.round(nextTop)}px`;
}

function updateVisibleBubblePositions() {
  updateBubblePosition(restBubble);
  updateBubblePosition(assistantQuestionBubble);
  updateBubblePosition(assistantAnswerBubble);
  updateBubblePosition(petChatBubble);
  updateBubblePosition(favoritesBubble);
  updateBubblePosition(modeCard);
}

// 쓰다듬기 하트 이펙트(2026-08-08) — 표정·고개숙임 말고는 쓰다듬는 동안 아무 시각 효과가
// 없어서 심심하다는 판단으로 추가. 즐겨찾기용 하트 SVG(favorite-icons.js)를 그대로 쓴다.
// 하트 하나짜리 애니메이션이 끝나면 스스로 지우므로 별도 정리 타이밍이 필요 없다.
// 간격·개수는 떠 있는 시간(styles.css의 petting-heart-float 지속시간)과 맞물려 있다 —
// 지속시간만 늘리고 간격을 그대로 두면 이 캡(MAX_ALIVE)에 자주 걸려 스폰이 들쭉날쭉해진다
// (2026-08-08, 느리게 요청 반영하며 간격도 같이 늘림).
const PETTING_HEART_INTERVAL_MS = 520;
const PETTING_HEART_MAX_ALIVE = 4;
const PETTING_HEART_COLOR = "#d75566";
let pettingHeartTimer: ReturnType<typeof setTimeout> | undefined;
let pettingHeartAliveCount = 0;

function spawnPettingHeart() {
  if (!pettingHeartsLayer || pettingHeartAliveCount >= PETTING_HEART_MAX_ALIVE) return;
  const heart = document.createElement("span");
  heart.className = "petting-heart";
  heart.innerHTML = window.FavoriteIcons.svgMarkup("heart", PETTING_HEART_COLOR);
  heart.style.top = `${Math.round(headTopScreenY())}px`;
  // 시작 지점 자체를 머리 중심에서 좌우로 랜덤하게 흩어 놓고(전부 같은 자리에서 시작하면
  // 기계적으로 보인다), 뜨는 동안에는 그보다 좁은 폭으로 한 번 더 드리프트를 준다.
  heart.style.setProperty("--heart-start-x", `${Math.round((Math.random() - 0.5) * 64)}px`);
  heart.style.setProperty("--heart-drift", `${Math.round((Math.random() - 0.5) * 30)}px`);
  pettingHeartsLayer.append(heart);
  pettingHeartAliveCount += 1;
  heart.addEventListener("animationend", () => {
    heart.remove();
    pettingHeartAliveCount -= 1;
  }, { once: true });
}

function startPettingHearts() {
  if (pettingHeartTimer) return;
  spawnPettingHeart();
  pettingHeartTimer = setInterval(spawnPettingHeart, PETTING_HEART_INTERVAL_MS);
}

function stopPettingHearts() {
  clearInterval(pettingHeartTimer);
  pettingHeartTimer = undefined;
}

const mediaPlayerAnchor = new THREE.Vector3();
let lastReportedMediaRect: { left: number, top: number, width: number, height: number } | null = null;
// CSS top은 아래로 갈수록 값이 커지므로, 화면상 "더 위로" 옮기려면 이 값을 음수로 둔다.
// 사용자 설정(verticalOffset)의 기본값·범위는 그대로 두고, 기본 배치 자체만 위로 20px 옮긴다.
const MEDIA_PLAYER_BASE_OFFSET_PX = -20;

function updateMediaPlayerPosition() {
  if (!mediaPlayer || mediaPlayer.hidden) return;
  const renderHeight = canvas.clientHeight;
  const renderTop = window.innerHeight - renderHeight;
  const feetWorldY = BASE_PET_Y + renderSettings.petBaseScale * PET_BOTTOM_ANCHOR_Y;
  mediaPlayerAnchor.set(0, feetWorldY, 0).project(camera);
  const feetScreenY = renderTop + (1 - mediaPlayerAnchor.y) * renderHeight / 2;
  mediaPlayer.style.top = `${Math.round(feetScreenY + renderSettings.mediaVerticalOffset + MEDIA_PLAYER_BASE_OFFSET_PX)}px`;

  const rect = mediaPlayer.getBoundingClientRect();
  const changed = !lastReportedMediaRect ||
    Math.abs(rect.left - lastReportedMediaRect.left) > 0.5 ||
    Math.abs(rect.top - lastReportedMediaRect.top) > 0.5 ||
    Math.abs(rect.width - lastReportedMediaRect.width) > 0.5 ||
    Math.abs(rect.height - lastReportedMediaRect.height) > 0.5;
  if (changed) {
    lastReportedMediaRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    window.desktopPet.reportMediaPlayerRect(lastReportedMediaRect);
  }
}

// ── 펫 주변 커스터마이징 오버레이 (2026-08-06) ──────────────────────────────
// "커스터마이징 UI가 비직관적"이라는 피드백에 대한 대응. 설정창 탭에서 이름만 보고
// 색을 고르는 대신, 펫 좌우에 파츠별 라벨을 띄우고 각 라벨을 그 파츠의 실제 3D 위치에
// 연결선으로 묶는다. 창 폭은 main이 커스터마이징 모드에서 CUSTOMIZE_WINDOW_WIDTH로
// 넓혀주므로(좌우 대칭 확장이라 펫은 그대로 화면 중앙) 라벨을 놓을 여백이 생긴다.
const customizeLayer = requireElement("#customize-layer");
const customizeLabelsHost = requireElement("#customize-labels");
const customizeDoneButton = requireElement("#customize-done");
const customizeCancelButton = requireElement("#customize-cancel");
const customizePalette = requireElement("#customize-palette");

// ── 색상 선택기 ────────────────────────────────────────────────────────────
// 라벨을 붙일 대상 3D 오브젝트를 파츠 id로 찾아준다. 실제 오브젝트의 월드 좌표를
// 쓰기 때문에 애니메이션(꼬리 흔들기·손 만세·숨쉬기)에도 라벨이 자연스럽게 따라간다.
// 모델 그릇 여섯 개를 봐야 해서 라벨 모듈로 옮기지 않고 콜백으로 넘긴다.
function customizeAnchorObject(id: string) {
  switch (id) {
    case "head": return model.loadedMeshes.head || null;
    case "body": return model.loadedMeshes.body || null;
    case "hand": return model.loadedMeshes.hand || null;
    case "ears": return model.ears.find((mesh) => mesh.visible) || null;
    case "headgear": return model.headgear.find((mesh) => mesh.visible) || null;
    case "tail": return tailPivot?.children.find((child) => child.userData?.variation && child.visible) || null;
    case "eye": return model.facePlates.eye || null;
    case "mouth": return model.facePlates.mouth || null;
    case "facePattern": return model.facePlates.pattern || null;
    case "faceCosmetic": return model.facePlates.cosmetic || null;
    // 무늬를 안 골랐거나 커스텀 바디로 대체된 상태면 라벨을 띄우지 않는다(귀·머리 장식과 동일).
    case "bodyCostume": return model.bodyPlates.costume?.visible ? model.bodyPlates.costume : null;
    default: return null;
  }
}

// 드래그 중 미리보기용. main을 거치지 않고 이 창의 머티리얼에만 바로 색을 넣는다
// (main을 거치면 매 프레임 pet-settings.json을 쓰게 된다). latestSettings도 같이
// 갱신해서, 이후 다른 설정 변경으로 applyBodyColors가 다시 불려도 색이 안 튀게 한다.
function applyLocalBodyColor(id: string, color: string) {
  if (!latestSettings) return;
  const entries = BODY_COLOR_DEFS.map((def) => {
    const current = (latestSettings?.bodyColors || []).find((entry) => entry?.id === def.id);
    return { id: def.id, color: def.id === id ? color : (current?.color || def.defaultColor) };
  });
  latestSettings = { ...latestSettings, bodyColors: entries };
  applyBodyColors(latestSettings);
}

const customizeLabels = createCustomizeLabels({
  elements: {
    layer: customizeLayer,
    labelsHost: customizeLabelsHost,
    palette: customizePalette,
    doneButton: customizeDoneButton,
    cancelButton: customizeCancelButton
  },
  camera,
  canvas,
  translate: tt,
  anchorObject: customizeAnchorObject,
  applyLocalColor: applyLocalBodyColor
});

window.desktopPet.onCustomizeMode((payload) => customizeLabels.setActive(payload.active, payload.bodyColors));
window.desktopPet.onClickSound(petAudio.playClick);

function triggerSquish(source: PetInputSource) {
  const sourceEnabled = source === "mouse"
    ? renderSettings.mouseSquishEnabled
    : renderSettings.keyboardSquishEnabled;
  if (!sourceEnabled) return;
  squishMotion.trigger();
}

function applyUiFont(enabled: boolean, preset: string) {
  const root = document.documentElement;
  root.style.removeProperty("--ui-font-family");
  if (!enabled) {
    delete root.dataset.uiFont;
    return;
  }
  if (String(preset || "").startsWith("local:")) {
    delete root.dataset.uiFont;
    const family = String(preset).slice(6).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    root.style.setProperty(
      "--ui-font-family",
      `"${family}", "Segoe UI", "Malgun Gothic", sans-serif`
    );
    return;
  }
  root.dataset.uiFont = preset || "gulim";
}

function applyUiFontSize(percent: number) {
  const safePercent = THREE.MathUtils.clamp(Number(percent) || 100, 80, 150);
  document.documentElement.style.setProperty("--ui-font-size-scale", String(safePercent / 100));
}

function applyLighting(settings: Settings) {
  const lt = settings.lighting || {};

  const ambient = lt.ambient || {};
  hemisphereLight.color.set(ambient.color || "#fff4e8");
  hemisphereLight.groundColor.set(ambient.groundColor || "#30384e");
  hemisphereLight.intensity = THREE.MathUtils.clamp(Number(ambient.intensity) || 2.25, 0, 10);

  const keyLt = lt.keyLight || {};
  keyLight.color.set(keyLt.color || "#ffd8ba");
  keyLight.intensity = THREE.MathUtils.clamp(Number(keyLt.intensity) || 2.5, 0, 10);
  keyLight.position.set(
    THREE.MathUtils.clamp(Number(keyLt.posX) || -3, -10, 10),
    THREE.MathUtils.clamp(Number(keyLt.posY) || 5, -10, 10),
    THREE.MathUtils.clamp(Number(keyLt.posZ) || 5, -10, 10)
  );

  const rimLt = lt.rimLight || {};
  rimLight.color.set(rimLt.color || "#7694ff");
  rimLight.intensity = THREE.MathUtils.clamp(Number(rimLt.intensity) || 1.25, 0, 10);
  rimLight.position.set(
    THREE.MathUtils.clamp(Number(rimLt.posX) || 4, -10, 10),
    THREE.MathUtils.clamp(Number(rimLt.posY) || 3, -10, 10),
    THREE.MathUtils.clamp(Number(rimLt.posZ) || -2, -10, 10)
  );
}

// 앱 언어(한국어/영어/일본어). i18n.js는 index.html에 classic <script>로 먼저
// 로드되어 있어 window.PetI18n으로 접근한다. tt()는 이 파일 안에서 짧게 쓰기 위한 래퍼.
let currentLanguage = window.PetI18n.DEFAULT_LANGUAGE;
function tt(key: string, vars?: Record<string, unknown>) {
  return window.PetI18n.t(currentLanguage, key, vars);
}

function applyPetSettings(settings: PetRendererSettings) {
  // 파생 값을 먼저 갱신한다 — 아래 적용 단계와 애니메이션이 같은 스냅샷을 본다.
  renderSettings.apply(settings);
  currentLanguage = window.PetI18n.normalizeLanguage(settings.language);
  window.PetI18n.applyDomTranslations(document, currentLanguage);
  applyUiFont(settings.uiFontEnabled === true, settings.uiFontPreset);
  applyUiFontSize(settings.uiFontSizePercent);
  applyShading(settings.shadingEnabled !== false);
  applyPixelArt(settings.pixelArtPercent);
  applyRenderEffects(settings);
  applyFaceCustomization(settings);
  applyBodyCustomization(settings);
  applyBodyColors(settings);
  applyPartVariations(settings);
  applyLighting(settings);
  if (!renderSettings.mouseSquishEnabled && !renderSettings.keyboardSquishEnabled) {
    squishMotion.stop();
  }
  const bubbleTheme = settings.bubbleTheme || "charcoal";
  if (settings.bubbleThemeCustomBg) {
    document.documentElement.style.setProperty("--custom-bg", settings.bubbleThemeCustomBg);
  }
  if (settings.bubbleThemeCustomAccent) {
    document.documentElement.style.setProperty("--custom-accent", settings.bubbleThemeCustomAccent);
  }
  if (settings.bubbleThemeCustomText) {
    document.documentElement.style.setProperty("--custom-text", settings.bubbleThemeCustomText);
  }
  for (const bubble of [restBubble, assistantQuestionBubble, assistantAnswerBubble, petChatBubble, favoritesBubble, modeCard, mediaPlayer, customizeLayer]) {
    bubble.dataset.theme = bubbleTheme;
  }
  if (restActive || assistantPanels.isAssistantActive() || assistantPanels.isFavoritesActive() || !clickThrough) requestAnimationFrame(updateVisibleBubblePositions);
  idleRoutineScheduler.cancel();
  idleRoutineScheduler.schedule(performance.now());
  petAudio.applySettings(settings);
  applyMediaPlayerSettings(settings);
}

function applyMediaPlayerSettings(settings: Settings) {
  const mp = settings.mediaPlayer || {};
  const scale = THREE.MathUtils.clamp(Number(mp.scale) || 100, 50, 150) / 100;
  const opacity = THREE.MathUtils.clamp(Number(mp.opacity) || 100, 20, 100) / 100;
  mediaPlayer.style.setProperty("--media-scale", String(scale));
  mediaPlayer.style.setProperty("--media-opacity", String(opacity));
  if (mp.enabled !== true) mediaPlayer.hidden = true;
}

async function updatePointer() {
  const [cursor, bounds] = await Promise.all([
    window.desktopPet.getCursor(),
    window.desktopPet.getWindowBounds()
  ]);
  if (!bounds) return;


  const renderHeight = canvas.clientHeight;
  const renderTop = bounds.y + bounds.height - renderHeight;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = renderTop + renderHeight * 0.64;
  pointer.x = THREE.MathUtils.clamp((cursor.x - centerX) / 600, -1, 1);
  pointer.y = THREE.MathUtils.clamp((centerY - cursor.y) / 480, -1, 1);
}

// 모드 카드는 휴식·AI 질문·즐겨찾기 중 아무거나 떠 있거나 클릭 통과 상태면 감춘다.
// 플래그 넷이 서로 다른 곳에서 바뀌므로 계산식을 한 군데로 모은다.
function syncModeCard() {
  modeCard.hidden = restActive
    || assistantPanels.isAssistantActive()
    || assistantPanels.isFavoritesActive()
    || clickThrough;
  if (!modeCard.hidden) requestAnimationFrame(updateVisibleBubblePositions);
}

function setRestAppearance(enabled: boolean) {
  restActive = enabled;
  restBubble.hidden = !enabled;
  modeCard.hidden = enabled
    || assistantPanels.isAssistantActive()
    || assistantPanels.isFavoritesActive()
    || clickThrough;
  // 다른 경로와 달리 "휴식을 켤 때"만 위치를 다시 잡는다 — 끌 때는 모드 카드가 보이더라도
  // 곧이어 오는 설정 반영이 처리한다.
  if (enabled) requestAnimationFrame(updateVisibleBubblePositions);
  applyShading(shadingEnabled);
}

function updateMode(state: PetInteractionMode) {
  clickThrough = state.clickThrough;
  canvas.classList.toggle("move-mode", !clickThrough);
  syncModeCard();
}

window.desktopPet.getMode().then(updateMode);
let latestSettings: PetRendererSettings | null = null;
function applyPetSettingsAndCache(settings: PetRendererSettings) {
  latestSettings = settings;
  applyPetSettings(settings);
  // 커스터마이징 모드 중이면 라벨 입력칸도 방금 확정된 색으로 맞춘다
  // (설정창에서 색을 바꿨거나, 프리셋을 적용했을 때도 여기로 들어온다).
  // 좌우 배정은 여기서 무효화하지 않는다 — 색을 저장하면 main이 이 이벤트를 되돌려 보내므로
  // 여기서 null을 넣으면 색을 고를 때마다 순서가 바뀐다. 파츠 구성 변화는
  // customizeLabels.updateLayout()이 지문으로 알아서 감지한다.
  if (customizeLabels.isActive()) customizeLabels.syncInputs(settings?.bodyColors);
}
const settingsReady = window.desktopPet.getSettings().then(applyPetSettingsAndCache);
window.desktopPet.onSettingsUpdated(applyPetSettingsAndCache);
window.desktopPet.onInteractionMode(updateMode);
window.desktopPet.onSquishPulse(triggerSquish);
const interactionState = createPetInteractionState({
  now: () => performance.now(),
  onPettingStart: startPettingHearts,
  onPettingStop: stopPettingHearts
});
// 이미지 리사이징·번역 패널이 답변 말풍선을 빌려 쓸 때 innerHTML을 통째로 갈아치우는데,
// 그러면 원래 들어있던 assistantAnswerText/assistantAnswerClose 노드가 DOM에서
// 떨어져 나간다(단, 이 두 상수가 참조하는 객체 자체는 그대로 살아있다 — 여기서 그
// 같은 두 노드를 다시 붙여넣기만 하면 된다, 새로 만들 필요 없음). 복원을 안 하면
// 다음 AI 답변·펫이 먼저 말 걸기 때 이 잔재 HTML이 그대로 보이고, 그 안에 남은
// "닫기" 버튼은 이미 꺼진 패널의 리스너(가드에서 바로 return)라 눌러도 반응이 없다.
// 답변 말풍선을 빌려 쓰는 세 패널(번역·문서 요약·이미지 리사이즈)은 자기 활성 상태를
// 직접 들고 있다. 렌더러는 Escape 처리에서만 그 상태를 본다.
const bubblePanels = createBubblePanels({
  elements: { bubble: assistantAnswerBubble, answerText: assistantAnswerText, answerClose: assistantAnswerClose },
  updateBubblePosition,
  translate: tt,
  escapeHtml,
  translateLanguageOptions,
  getImageResizeDefaults: () => ({
    scale: latestSettings?.imageResizeScale || 2,
    filter: latestSettings?.imageResizeFilter || "nearest"
  })
});
mediaPreviousButton.addEventListener("click", () => {
  window.desktopPet.sendMediaCommand("previous");
});
mediaPlayButton.addEventListener("click", () => {
  window.desktopPet.sendMediaCommand("play");
});
mediaPauseButton.addEventListener("click", () => {
  window.desktopPet.sendMediaCommand("pause");
});
mediaNextButton.addEventListener("click", () => {
  window.desktopPet.sendMediaCommand("next");
});

window.desktopPet.onMediaUpdate((data) => {
  const status = data?.status || "None";
  const active = status === "Playing" || status === "Paused";

  if (!active) {
    mediaPlayer.hidden = true;
    mediaState = { status: "None" };
    if (lastReportedMediaRect) {
      lastReportedMediaRect = null;
      window.desktopPet.reportMediaPlayerRect(null);
    }
    return;
  }

  const wasHidden = mediaPlayer.hidden;
  mediaState = { status };
  mediaPlayer.hidden = false;
  if (wasHidden) requestAnimationFrame(updateMediaPlayerPosition);
});

// 날씨 브리핑처럼 줄마다 아이콘이 붙는 경우 배지로 그린다 — 이모지를 본문 글자 크기로
// 섞으면 Windows 기본 이모지 폰트가 옅은 색이라 밝은 말풍선 배경에 잘 안 보인다(피드백,
// 2026-08). 배지 배경색이 대비를 대신 보장하므로 이모지 자체 색과 무관하게 잘 보인다.
// 시계 아이콘(#rest-icon)은 날씨 브리핑일 때 자리를 넉넉히 쓰도록 뺀다.
function renderRestMessage(payload: PetRestStartPayload | undefined): void {
  const lines = payload?.weatherLines;
  restMessage.textContent = "";
  restBubble.classList.toggle("weather-briefing", Boolean(lines && lines.length > 0));
  if (lines && lines.length > 0) {
    restIcon.hidden = true;
    for (const line of lines) {
      const row = document.createElement("span");
      row.className = "weather-line";
      const badge = document.createElement("span");
      badge.className = "weather-icon-badge";
      badge.textContent = line.icon;
      const text = document.createElement("span");
      text.className = "weather-line-text";
      text.textContent = line.text;
      row.append(badge, text);
      restMessage.append(row);
    }
  } else {
    restIcon.hidden = false;
    restMessage.textContent = payload?.message || tt("alarm.defaultMessage");
  }
}

window.desktopPet.onRestStart((payload) => {
  restTitle.textContent = payload?.title || tt("alarm.defaultTitle");
  renderRestMessage(payload);
  // 알람마다 고른 커스텀 소리(soundDataUrl)가 있으면 그걸 쓰고, 없으면 항상 현재
  // 전역 알람 사운드 설정으로 되돌린다 — 안 그러면 커스텀 소리 알람 다음에 울리는
  // 기본 알람이 이전 알람의 소리를 그대로 이어받는다.
  petAudio.setRestSource(payload?.soundDataUrl);
  setRestAppearance(true);
  settingsReady.then(petAudio.playRest);
});
window.desktopPet.onRestEnd(() => {
  setRestAppearance(false);
  petAudio.stopRest();
});
// AI 질문·펫대화·즐겨찾기 말풍선의 상태와 배선은 assistant-panels.js가 들고 있다.
// 여기서는 모드 카드 계산에 필요한 restActive·clickThrough만 넘겨준다.
const assistantPanels = createAssistantPanels({
  elements: {
    modeCard,
    assistantQuestionBubble,
    assistantAnswerBubble,
    assistantAnswerText,
    assistantAnswerClose,
    assistantQuestion,
    assistantStatus,
    assistantSubmit,
    assistantCancel,
    petChatBubble,
    petChatMessage,
    petChatReply,
    petChatStatus,
    petChatSubmit,
    petChatClose,
    petChatCallNowButton,
    favoritesBubble,
    favoritesStatus,
    favoritesList,
    favoritesClose
  },
  translate: tt,
  updateVisibleBubblePositions,
  syncModeCard,
  closeActiveBubblePanel: () => bubblePanels.closeActivePanel(),
  prepareAnimalese: petAudio.prepareAnimalese,
  playAnimaleseCharacter: petAudio.playAnimaleseCharacter,
  isAnimaleseEnabled: () => renderSettings.animaleseEnabled,
  isAnimalesePetChatEnabled: () => renderSettings.animalesePetChatEnabled,
  animaleseIntervalMs: () => renderSettings.animaleseIntervalMs
});

// 우클릭은 이제 main의 전역 마우스 훅에서 트레이 메뉴를 띄운다(main.js의 mousedown
// 핸들러, tray.popUpContextMenu()). 브라우저 기본 컨텍스트 메뉴만 막아서 우클릭할 때
// Electron/Chromium 기본 메뉴가 뜨는 걸 방지한다 — 예전엔 여기서 AI 질문을 직접
// 열었는데, 그러면 트레이 메뉴와 AI 질문창이 동시에 뜨는 버그가 생긴다.
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
restConfirm.addEventListener("click", () => window.desktopPet.confirmRest());

setInterval(updatePointer, 32);
window.addEventListener("resize", resize);

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const effectStrength = pixelArtPercent / 100;
  const resolutionScale = THREE.MathUtils.lerp(1, 0.32, effectStrength);
  const pixelRatio = THREE.MathUtils.lerp(
    Math.min(window.devicePixelRatio, 2),
    1,
    effectStrength
  );
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(
    Math.max(1, Math.round(width * resolutionScale)),
    Math.max(1, Math.round(height * resolutionScale)),
    false
  );
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(renderBufferSize);
  sceneRenderTarget.setSize(
    Math.max(1, Math.round(renderBufferSize.x)),
    Math.max(1, Math.round(renderBufferSize.y))
  );
  // 외곽선(과 앞으로 추가될 선 떨림)의 픽셀 반경 계산은 실제 tDiffuse 텍스처의
  // 해상도(= sceneRenderTarget과 같은, 픽셀 아트 효과로 줄어든 실제 렌더 버퍼 크기)를
  // 기준으로 해야 한다. CSS 표시 크기(width/height)를 그대로 쓰면, 픽셀 아트 효과가
  // 해상도를 줄여도 외곽선 반경 계산은 줄어들기 전 크기를 기준으로 나눠서 실제 텍셀
  // 기준으로는 반경이 1픽셀도 안 되게 쪼그라들어 외곽선이 사실상 안 먹히는 버그가 있었다.
  postProcessUniforms.uResolution.value.set(
    Math.max(1, renderBufferSize.x),
    Math.max(1, renderBufferSize.y)
  );
  if (restActive || assistantPanels.isAssistantActive() || assistantPanels.isFavoritesActive() || !clickThrough) requestAnimationFrame(updateVisibleBubblePositions);
}

const clock = new THREE.Clock();
const petModelLoader = createPetModelLoader({
  modelRoot,
  refs: model,
  PET_BOTTOM_ANCHOR_Y,
  TAIL_REST_ANGLE,
  HEAD_EAR_DEPTH_LAYER,
  HEADGEAR_LAYER,
  MODEL_FRONT_CORRECTION_Y,
  frontCorrection,
  boundingBoxInFrame,
  refreshPetVisualTop,
  applyShading,
  getShadingEnabled: () => shadingEnabled
});

// 프레임 루프. 로딩 뒤에 재대입되는 값과 렌더러가 소유한 플래그는 getter로 넘긴다.
const animationLoop = createAnimationLoop({
  pet,
  modelRoot,
  frontCorrection,
  postProcessUniforms,
  pointer,
  clock,
  BASE_PET_Y,
  PET_BOTTOM_ANCHOR_Y,
  assistantAnswerBubble,
  petChatBubble,
  mediaPlayer,
  model,
  renderSettings,
  squishMotion,
  interactionState,
  assistantPanels,
  customizeLabels,
  idleRoutineScheduler,
  headPivot: () => headPivot,
  tailPivot: () => tailPivot,
  faceTrembleAmplitude: () => faceTrembleAmplitude,
  restActive: () => restActive,
  clickThrough: () => clickThrough,
  mediaState: () => mediaState,
  renderPetScene,
  setFaceExpressionKey,
  updateMediaPlayerPosition
});

const modelsReady = (async () => {
  const assembly = await petModelLoader.load();
  headPivot = assembly.headPivot;
  tailPivot = assembly.tailPivot;
  faceTrembleAmplitude = assembly.faceTrembleAmplitude;
  if (latestSettings) applyPetSettings(latestSettings);
  resize();
  animationLoop.start();
})();
