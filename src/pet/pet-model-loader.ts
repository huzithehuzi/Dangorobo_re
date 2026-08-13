// GLB 파츠를 읽어 펫 모델을 조립한다 — 머리·몸·손·꼬리·귀·머리 장식과 얼굴/몸 데칼 판.
//
// 조립 결과를 담는 그릇(loadedMeshes, facePlates, materialGroups 등)은 렌더러가 계속 들고
// 있고 이 모듈은 채우기만 한다. 그릇의 정체성이 유지돼야 색 적용·표정 전환·애니메이션 루프가
// 로딩 전후로 같은 객체를 계속 보기 때문이다. 반대로 로딩이 처음 만들어내는 headPivot과
// tailPivot은 반환값으로 돌려주고 렌더러가 받아 보관한다.
//
// 배치 규칙(정면 보정, 손·꼬리 수동 배치, 머리 그룹 오프셋)과 GLB 목록은 로딩에서만 쓰므로
// 함께 옮겼다.

import * as THREE from "three";
import { GLTFLoader } from "../vendor/three/loaders/GLTFLoader.js";
import { isVariationMesh } from "./pet-model-mesh.js";
import type { PetModelRefs } from "./pet-model-refs.js";
import type {
  AuthoredTransform,
  BodyPlateId,
  AuthoredVariationMesh,
  FacePlateId,
  MaterialPair,
  ModelPartId,
  PetMesh,
  TexturedMaterial
} from "./pet-model-types.js";

const { variationsFor } = window.PetCustomizationCatalog;

type PetModelLoaderDependencies = {
  // 조립 결과를 담을 그릇들. 이 모듈은 채우기만 하고 새로 만들지 않는다.
  modelRoot: THREE.Group;
  refs: PetModelRefs;
  // 배치 계산에 쓰는 렌더러 쪽 상수·헬퍼.
  PET_BOTTOM_ANCHOR_Y: number;
  TAIL_REST_ANGLE: number;
  HEAD_EAR_DEPTH_LAYER: number;
  HEADGEAR_LAYER: number;
  MODEL_FRONT_CORRECTION_Y: number;
  frontCorrection: THREE.Quaternion;
  boundingBoxInFrame: (
    target: THREE.Object3D,
    frame: THREE.Object3D,
    options?: { visibleOnly?: boolean }
  ) => THREE.Box3;
  refreshPetVisualTop: () => void;
  applyShading: (enabled: boolean) => void;
  // 렌더러가 설정에 따라 재대입하는 바인딩이라 값이 아니라 getter로 받는다.
  getShadingEnabled: () => boolean;
};

function hasAuthoredVariationData(object: THREE.Object3D): object is AuthoredVariationMesh {
  return object instanceof THREE.Mesh &&
    typeof object.userData.variation === "string" &&
    object.userData.authoredPosition instanceof THREE.Vector3 &&
    object.userData.authoredQuaternion instanceof THREE.Quaternion;
}

type PetModelAssembly = {
  headPivot: THREE.Group;
  tailPivot: THREE.Group;
  /** 얼굴 판 크기에서 정해지는 떨림 폭. 조립이 끝나야 확정된다. */
  faceTrembleAmplitude: number;
};

function createPetModelLoader(deps: PetModelLoaderDependencies) {
  const {
    modelRoot,
    PET_BOTTOM_ANCHOR_Y, TAIL_REST_ANGLE, HEAD_EAR_DEPTH_LAYER, HEADGEAR_LAYER,
    MODEL_FRONT_CORRECTION_Y, frontCorrection,
    boundingBoxInFrame, refreshPetVisualTop, applyShading, getShadingEnabled
  } = deps;
  // 그릇은 제자리에서 채우기만 하므로 구조분해로 참조를 꺼내 써도 정체성이 유지된다.
  const {
    loadedMeshes, loadedMaterials, facePlates, bodyPlates, materialGroups,
    ears, headgear, eyeTextureSets, mouthTextureSets
  } = deps.refs;

  let headPivot: THREE.Group;
  let tailPivot: THREE.Group;

  function materialPair(map: THREE.Texture | null) {
    return {
      lit: new THREE.MeshStandardMaterial({
        map,
        color: 0xffffff,
        roughness: 0.88,
        metalness: 0.02,
        flatShading: false,
        transparent: false,
        depthWrite: true,
        depthTest: true
      }),
      unlit: new THREE.MeshBasicMaterial({
        map,
        color: 0xffffff,
        transparent: false,
        depthWrite: true,
        depthTest: true
      })
    };
  }

  // 얼굴 판(plate) 중 얼굴무늬·얼굴장식만 명암 토글을 따라간다 — 눈·입·커스텀 얼굴은
  // 표정을 읽기 쉬워야 해서 항상 unlit 유지(사용자 요청, 2026-08-06). 데칼이라
  // transparent/depthWrite 설정은 얼굴 판 공용 규칙(투명 배경, 깊이 안 씀)을 그대로 따른다.
  function facePlateMaterialPair(defaultColor: string | number) {
    return {
      lit: new THREE.MeshStandardMaterial({
        map: null,
        color: defaultColor,
        roughness: 0.88,
        metalness: 0.02,
        flatShading: false,
        transparent: true,
        depthWrite: false,
        depthTest: true
      }),
      unlit: new THREE.MeshBasicMaterial({
        map: null,
        color: defaultColor,
        transparent: true,
        depthWrite: false,
        depthTest: true
      })
    };
  }

  function mesh<
    TGeometry extends THREE.BufferGeometry,
    TMaterial extends THREE.Material | THREE.Material[]
  >(geometry: TGeometry, meshMaterial: TMaterial, parent: THREE.Object3D) {
    const object = new THREE.Mesh(geometry, meshMaterial);
    object.castShadow = true;
    parent.add(object);
    return object;
  }

  const gltfLoader = new GLTFLoader();

  const PART_DEFINITIONS: Array<{ id: ModelPartId, meshName?: string, path: string }> = [
    { id: "head", path: "../../assets/models/head.glb" },
    { id: "body", path: "../../assets/models/body.glb" },
    { id: "hand", path: "../../assets/models/hand.glb" },
    // 몸 데칼용 셸. 몸통을 살짝 부풀려 UV를 입힌 별도 모델이라 몸통과 겹쳐 그려도
    // z-파이팅이 나지 않는다(GLB 안의 메시 이름은 body_tex라 id와 따로 적는다).
    { id: "bodyCostume", meshName: "body_tex", path: "../../assets/models/body_tex.glb" }
  ];

  // 바리에이션 이름은 GLB 안의 오브젝트 이름과 1:1이다. 목록 자체는 설정창·main과
  // 공유하는 카탈로그에 있다(shared/customization-catalog.js).
  const EAR_VARIATIONS = variationsFor("ears");
  const TAIL_VARIATIONS = variationsFor("tail");
  const HEADGEAR_VARIATIONS = variationsFor("headgear");

  // 손과 꼬리는 위 세 파츠와 전혀 다른 좌표 범위에 있어(작업 공간에 따로 배치된 것으로 보임)
  // 원본 위치를 신뢰할 수 없다 - 이 둘은 계속 코드에서 직접 배치한다.
  // 기준 배치는 몸통 크기에 비례해 자동 계산한다(GLB를 갈아치워도 따라오도록).
  const HAND_HEIGHT_RATIO = 0.30;   // 몸통 높이 대비 팔 높이
  const HAND_SPREAD_RATIO = 0.4;    // 몸통 폭 대비 좌우 벌림
  const HAND_FORWARD_OFFSET = 0.13;

  // 위 기준 배치에서 팔(손) 위치를 미세조정하는 값. 팔은 좌우 대칭이라 한쪽만 계산하고
  // 반대쪽은 x를 뒤집어 만들기 때문에, x 하나로 양쪽이 같이 벌어지거나 좁혀진다.
  // 세 값 모두 같은 단위(모델 좌표)라 감각적으로 조정하기 쉽다. 팔 위치를 바꾸고 싶으면
  // 위 비율 상수보다 이 세 값을 먼저 건드리면 된다.
  const HAND_OFFSET_X = 0.14;   // + 양쪽으로 더 벌어짐 / - 몸통에 더 붙음
  const HAND_OFFSET_Y = -0.17;   // + 위로 / - 아래로
  const HAND_OFFSET_Z = 0;   // + 앞으로(화면 쪽) / - 뒤로

  const TAIL_ATTACH_OFFSET = 0.12;

  // 머리 그룹(headPivot = 머리 + 귀 + 얼굴 데칼 전체)을 Blender 원본 위치에서 위/아래로
  // 미세 조정한다. 음수면 아래로 내려간다(몸통에 더 파묻힘), 양수면 위로 올라간다.
  // 귀·얼굴은 headPivot의 자식이라 같이 따라오고, 말풍선 위치·우클릭 판정 범위도
  // refreshPetVisualTop()이 실제 모델을 다시 측정하므로 자동으로 따라온다.
  const HEAD_GROUP_OFFSET_Y = -0.4;

  // GLB의 원본 translation/quaternion을 그대로 두면 Blender 씬 좌표가 나온다.
  // origin을 뺀 상대 벡터에 정면 보정을 적용해 modelRoot 기준 위치로 바꾼다.
  function relativeCorrectedPosition(originalPosition: THREE.Vector3, origin: THREE.Vector3) {
    return originalPosition.clone().sub(origin).applyQuaternion(frontCorrection);
  }

  function correctedQuaternion(originalQuaternion: THREE.Quaternion) {
    return frontCorrection.clone().multiply(originalQuaternion);
  }

  async function loadModels() {
    console.log("🔄 loadModels 시작");
    headPivot = new THREE.Group();
    modelRoot.add(headPivot);

    const authored: Partial<Record<ModelPartId, AuthoredTransform>> = {};
    for (const part of PART_DEFINITIONS) {
      try {
        console.log(`📦 로딩: ${part.path}`);
        const gltf = await gltfLoader.loadAsync(part.path);
        const mesh = gltf.scene.getObjectByName(part.meshName || part.id);
        if (!(mesh instanceof THREE.Mesh)) {
          console.warn(`❌ 메시 못 찾음: ${part.meshName || part.id} in ${part.path}`);
          continue;
        }
        console.log(`✅ 로드됨: ${part.id}`, mesh);
        // Blender에서 조립된 원본 위치/회전을 나중에 쓸 수 있게 미리 복사해둔다.
        authored[part.id] = {
          position: mesh.position.clone(),
          quaternion: mesh.quaternion.clone()
        };
        loadedMeshes[part.id] = mesh;
      } catch (err) {
        console.error(`💥 ${part.id} 로드 실패:`, err);
      }
    }

    tailPivot = new THREE.Group();
    tailPivot.position.set(0.5, -0.85, -0.55);
    tailPivot.rotation.z = TAIL_REST_ANGLE;
    modelRoot.add(tailPivot);

    await loadEarVariations();
    await loadHeadgearVariations();
    await loadTailVariations();

    // head/body/ears는 Blender에서 실제 캐릭터 배치대로 조립돼 있었다(공통 원점 근처).
    // body의 원본 위치를 원점으로 삼아 서로의 상대 위치를 그대로 보존한다.
    const origin = authored.body?.position ?? new THREE.Vector3();

    if (loadedMeshes.body && authored.body) {
      modelRoot.add(loadedMeshes.body);
      loadedMeshes.body.position.copy(relativeCorrectedPosition(authored.body.position, origin));
      loadedMeshes.body.quaternion.copy(correctedQuaternion(authored.body.quaternion));
    }

    if (loadedMeshes.bodyCostume && authored.bodyCostume) {
      createBodyCostumePlates(authored.bodyCostume, origin);
    }

    if (loadedMeshes.head && authored.head) {
      const headFinalPos = relativeCorrectedPosition(authored.head.position, origin);
      headPivot.position.copy(headFinalPos);
      headPivot.position.y += HEAD_GROUP_OFFSET_Y;
      loadedMeshes.head.position.set(0, 0, 0);
      loadedMeshes.head.quaternion.copy(correctedQuaternion(authored.head.quaternion));
      headPivot.add(loadedMeshes.head);

      for (const earMesh of ears) {
        const earFinalPos = relativeCorrectedPosition(earMesh.userData.authoredPosition, origin);
        earMesh.position.copy(earFinalPos.clone().sub(headFinalPos));
        earMesh.quaternion.copy(correctedQuaternion(earMesh.userData.authoredQuaternion));
      }

      for (const headgearMesh of headgear) {
        const headgearFinalPos = relativeCorrectedPosition(headgearMesh.userData.authoredPosition, origin);
        headgearMesh.position.copy(headgearFinalPos.clone().sub(headFinalPos));
        headgearMesh.quaternion.copy(correctedQuaternion(headgearMesh.userData.authoredQuaternion));
      }

      const headBox = boundingBoxInFrame(loadedMeshes.head, headPivot);
      createFacePlates(headBox);
    }

    // 몸통 바닥이 기존 발밑 기준선에 오도록 조립체 전체(modelRoot)를 한 번에 이동한다.
    // (개별 파츠 상대 위치는 그대로 유지된다.)
    let bodyTopY = 0.2;
    let bodyBottomY = -1.1;
    let bodyWidth = 1.4;
    if (loadedMeshes.body) {
      const bodyBox = boundingBoxInFrame(loadedMeshes.body, modelRoot);
      bodyBottomY = bodyBox.min.y;
      bodyTopY = bodyBox.max.y;
      bodyWidth = bodyBox.max.x - bodyBox.min.x;
    }
    modelRoot.position.y = PET_BOTTOM_ANCHOR_Y - bodyBottomY;

    // 손·꼬리는 Blender 작업 공간에 따로 있던 파츠라 원본 위치를 못 믿는다.
    // 몸통 크기 기준으로 코드에서 직접 배치한다.
    const tailVariationMeshesForLayout = tailPivot.children.filter(isVariationMesh);
    for (const tailMesh of tailVariationMeshesForLayout) {
      const tailBox = boundingBoxInFrame(tailMesh, tailPivot);
      tailMesh.position.y = TAIL_ATTACH_OFFSET - tailBox.min.y;
      tailMesh.position.x -= (tailBox.min.x + tailBox.max.x) / 2;
      tailMesh.position.z -= (tailBox.min.z + tailBox.max.z) / 2;
    }

    if (loadedMeshes.hand) {
      modelRoot.add(loadedMeshes.hand);
      loadedMeshes.hand.position.set(0, 0, 0);
      loadedMeshes.hand.rotation.set(0, MODEL_FRONT_CORRECTION_Y, 0);
      const handBox = boundingBoxInFrame(loadedMeshes.hand, modelRoot);
      const bodyHeight = bodyTopY - bodyBottomY;
      loadedMeshes.hand.position.x -= (handBox.min.x + handBox.max.x) / 2;
      loadedMeshes.hand.position.z -= (handBox.min.z + handBox.max.z) / 2;
      loadedMeshes.hand.position.y = bodyBottomY + bodyHeight * HAND_HEIGHT_RATIO - handBox.min.y;
      loadedMeshes.hand.position.x += bodyWidth * HAND_SPREAD_RATIO + HAND_OFFSET_X;
      loadedMeshes.hand.position.y += HAND_OFFSET_Y;
      loadedMeshes.hand.position.z += HAND_FORWARD_OFFSET + HAND_OFFSET_Z;

      const handMirror = loadedMeshes.hand.clone();
      handMirror.position.x = -loadedMeshes.hand.position.x;
      modelRoot.add(handMirror);
      loadedMeshes.handMirror = handMirror;

      // 만세·박수 애니메이션이 매 프레임 기준 자세에서 델타를 더할 수 있도록 저장
      loadedMeshes.hand.userData.basePosition = loadedMeshes.hand.position.clone();
      handMirror.userData.basePosition = handMirror.position.clone();
    }

    const litUnlitMaterials: Partial<Record<"head" | "body" | "hand", MaterialPair>> = {};

    const shadedPartIds: Array<"head" | "body" | "hand"> = ["head", "body", "hand"];
    for (const partId of shadedPartIds) {
      const partMesh = loadedMeshes[partId];
      if (partMesh) {
        const materials = materialPair(null);
        litUnlitMaterials[partId] = materials;
        const objects = [partMesh];
        partMesh.material = materials.lit;
        if (partId === "head") {
          partMesh.layers.enable(HEAD_EAR_DEPTH_LAYER);
        }
        if (partId === "hand" && loadedMeshes.handMirror) {
          loadedMeshes.handMirror.material = materials.lit;
          objects.push(loadedMeshes.handMirror);
        }
        materialGroups.push({ materials, objects });
      }
    }

    const earMaterialsMap: Record<string, MaterialPair> = {};
    for (const earMesh of ears) {
      const materials = materialPair(null);
      earMaterialsMap[earMesh.userData.variation] = materials;
      earMesh.material = materials.lit;
      // 조건부 오클루전의 2번째 패스(깊이 마스크)에서도 그려지도록 head 전용 레이어를 추가로 켠다.
      earMesh.layers.enable(HEAD_EAR_DEPTH_LAYER);
      materialGroups.push({ materials, objects: [earMesh] });
    }

    const headgearMaterialsMap: Record<string, MaterialPair> = {};
    for (const headgearMesh of headgear) {
      const materials = materialPair(null);
      headgearMaterialsMap[headgearMesh.userData.variation] = materials;
      headgearMesh.material = materials.lit;
      // 1번째 패스(기본 레이어)에는 안 그려지고, headgear 전용 3번째 패스에서만 그려지도록
      // 레이어를 통째로 교체한다(조건부 오클루전 — 위 materialPair 주석 참고).
      headgearMesh.layers.set(HEADGEAR_LAYER);
      materialGroups.push({ materials, objects: [headgearMesh] });
    }

    const tailVariationMeshes = tailPivot.children.filter(isVariationMesh);
    const tailMaterialsMap: Record<string, MaterialPair> = {};
    for (const tailMesh of tailVariationMeshes) {
      const materials = materialPair(null);
      tailMaterialsMap[tailMesh.userData.variation] = materials;
      tailMesh.material = materials.lit;
      tailMesh.visible = tailMesh.userData.variation === "cat";
      materialGroups.push({ materials, objects: [tailMesh] });
    }

    for (const earMesh of ears) {
      earMesh.visible = earMesh.userData.variation === "cat";
    }

    // 머리 장식은 기본값이 "없음"이라, 로드된 메시 중 그 어느 것도 처음엔 안 보인다.
    for (const headgearMesh of headgear) {
      headgearMesh.visible = false;
    }

    loadedMaterials.head = litUnlitMaterials.head;
    loadedMaterials.body = litUnlitMaterials.body;
    loadedMaterials.hand = litUnlitMaterials.hand;
    loadedMaterials.earsByVariation = earMaterialsMap;
    loadedMaterials.headgearByVariation = headgearMaterialsMap;
    loadedMaterials.tailByVariation = tailMaterialsMap;

    applyShading(getShadingEnabled());
    refreshPetVisualTop();

    console.log("✅ loadModels 완료", { loadedMeshes, ears: ears.length, headgear: headgear.length, tailVariations: tailVariationMeshes.length });
  }

  async function loadEarVariations() {
    for (const variation of EAR_VARIATIONS) {
      if (variation === "none") continue;
      try {
        const path = `../../assets/models/ear/ear_${variation}.glb`;
        const gltf = await gltfLoader.loadAsync(path);
        const earMesh = gltf.scene.getObjectByName(`ear_${variation}`);
        if (!(earMesh instanceof THREE.Mesh)) {
          console.warn(`❌ 귀 메시 못 찾음: ear_${variation}`);
          continue;
        }
        if (ears.some(e => e.userData.variation === variation)) continue;
        earMesh.visible = false;
        // 원본 위치/회전을 보관해둔다 - 실제 배치는 loadModels에서 head 기준 상대좌표로 계산한다.
        earMesh.userData.authoredPosition = earMesh.position.clone();
        earMesh.userData.authoredQuaternion = earMesh.quaternion.clone();
        earMesh.userData.variation = variation;
        if (!hasAuthoredVariationData(earMesh)) throw new Error(`귀 ${variation}의 원본 변환을 보관하지 못했다`);
        headPivot.add(earMesh);
        ears.push(earMesh);
        console.log(`✅ 귀 로드됨: ${variation}`);
      } catch (err) {
        console.error(`💥 귀 ${variation} 로드 실패:`, err);
      }
    }
  }

  async function loadHeadgearVariations() {
    for (const variation of HEADGEAR_VARIATIONS) {
      if (variation === "none") continue;
      try {
        const path = `../../assets/models/headgear/headgear_${variation}.glb`;
        const gltf = await gltfLoader.loadAsync(path);
        const headgearMesh = gltf.scene.getObjectByName(`headgear_${variation}`);
        if (!(headgearMesh instanceof THREE.Mesh)) {
          console.warn(`❌ 머리 장식 메시 못 찾음: headgear_${variation}`);
          continue;
        }
        if (headgear.some(h => h.userData.variation === variation)) continue;
        headgearMesh.visible = false;
        // 귀와 동일하게, 원본 위치/회전을 보관해둔다 - 실제 배치는 loadModels에서
        // head 기준 상대좌표로 계산한다(머리 위치에 맞춰 모델링됐다고 확인함).
        headgearMesh.userData.authoredPosition = headgearMesh.position.clone();
        headgearMesh.userData.authoredQuaternion = headgearMesh.quaternion.clone();
        headgearMesh.userData.variation = variation;
        if (!hasAuthoredVariationData(headgearMesh)) {
          throw new Error(`머리 장식 ${variation}의 원본 변환을 보관하지 못했다`);
        }
        headPivot.add(headgearMesh);
        headgear.push(headgearMesh);
        console.log(`✅ 머리 장식 로드됨: ${variation}`);
      } catch (err) {
        console.error(`💥 머리 장식 ${variation} 로드 실패:`, err);
      }
    }
  }

  async function loadTailVariations() {
    for (const variation of TAIL_VARIATIONS) {
      if (variation === "none") continue;
      try {
        const path = `../../assets/models/tail/tail_${variation}.glb`;
        const gltf = await gltfLoader.loadAsync(path);
        const tailMesh = gltf.scene.getObjectByName(`tail_${variation}`);
        if (!(tailMesh instanceof THREE.Mesh)) {
          console.warn(`❌ 꼬리 메시 못 찾음: tail_${variation}`);
          continue;
        }
        tailMesh.visible = false;
        tailPivot.add(tailMesh);
        // 꼬리 자체의 원본 회전(예: 참고용으로 미리 기울여 둔 각도)은 버린다.
        // TAIL_REST_ANGLE을 tailPivot 하나에서만 적용해 각도가 두 번 겹치지 않게 한다.
        tailMesh.position.set(0, 0, 0);
        tailMesh.rotation.set(0, MODEL_FRONT_CORRECTION_Y, 0);
        tailMesh.userData.variation = variation;
        console.log(`✅ 꼬리 로드됨: ${variation}`);
      } catch (err) {
        console.error(`💥 꼬리 ${variation} 로드 실패:`, err);
      }
    }
  }

  // 얼굴은 머리 앞면에 겹쳐 붙는 3장의 평면 데칼로 구성한다. 텍스처가 머리 UV 전체(앞면)에
  // 맞춰 그려져 있으므로 데칼도 머리 앞면 폭·높이의 대부분을 덮어야 한다.
  // 무늬(pattern)는 얼굴 이목구비 뒤에 깔리는 배경이므로 먼저 그리고, 그 위에 표정(base)이
  // 덮이고, 장식(cosmetic)이 맨 앞에 온다. 머리 표면에 최대한 밀착시키려 오프셋을 아주 작게 둔다.
  const FACE_PLATE_WIDTH_RATIO = 1.0;
  const FACE_PLATE_HEIGHT_RATIO = 1.0;
  const FACE_PLATE_Y_RATIO = 0.5;
  const FACE_PLATE_FORWARD_OFFSET = 0.075;
  const FACE_PLATE_LAYER_GAP = 0.0015;
  // 가운데는 그대로 두고 가장자리를 머리 쪽으로 말아 넣어(오목화) 둥근 머리에 감싸듯 밀착시킨다.
  // 예전 값(0.24)은 가장자리가 실제 머리 표면보다 살짝 앞으로 튀어나와, 그 튀어나온 테두리가
  // 배경과 맞닿아 외곽선 효과에서 얼굴만 이중 선으로 보이는 원인이 됐다. 가장자리가 확실히
  // depthTest에 걸려 머리 뒤로 숨도록 더 깊게 말아 넣는다.
  const FACE_PLATE_CURVE_RATIO = 0.33;
  // 캡스락 떨림 폭(얼굴 판 크기 대비 비율). 키우면 더 크게 흔들린다.
  const FACE_TREMBLE_RATIO = 0.014;
  let faceTrembleAmplitude = 0.01;

  // 평면을 그대로 쓰면 가장자리가 둥근 머리 표면에서 떠 보인다. UV는 평면 그대로 유지한 채
  // 가장자리만 뒤로(-Z) 말아 넣는 돔 형태로 변형해 가상의 구형 머리에 씌운 듯한 느낌을 낸다.
  function createCurvedPlateGeometry(width: number, height: number, curveDepth: number, segments: number = 14) {
    const geometry = new THREE.PlaneGeometry(width, height, segments, segments);
    const position = geometry.attributes.position;
    const halfW = width / 2;
    const halfH = height / 2;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const nx = halfW > 0 ? x / halfW : 0;
      const ny = halfH > 0 ? y / halfH : 0;
      // 모서리(대각선 꼭짓점)는 중심에서 변 중앙보다 더 멀리 떨어져 있어 머리 곡면에
      // 밀착하려면 더 깊이 말려야 한다. 예전엔 1로 clamp해 모서리가 변 중앙과 똑같은
      // 깊이로 멈춰서 실제 머리 실루엣보다 살짝 튀어나왔고, 그 튀어나온 경계가
      // 외곽선 효과에서 얼굴 부분만 두 겹으로(두껍게) 그려지는 원인이 됐다.
      const r2 = nx * nx + ny * ny;
      position.setZ(i, -curveDepth * r2);
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  function createFacePlates(headBox: THREE.Box3) {
    const width = headBox.max.x - headBox.min.x;
    const height = headBox.max.y - headBox.min.y;
    const plateWidth = width * FACE_PLATE_WIDTH_RATIO;
    const plateHeight = height * FACE_PLATE_HEIGHT_RATIO;
    const centerX = (headBox.min.x + headBox.max.x) / 2;
    const centerY = headBox.min.y + height * FACE_PLATE_Y_RATIO;
    const frontZ = headBox.max.z + FACE_PLATE_FORWARD_OFFSET;
    const curveDepth = Math.min(plateWidth, plateHeight) * FACE_PLATE_CURVE_RATIO;
    const curvedGeometry = createCurvedPlateGeometry(plateWidth, plateHeight, curveDepth);

    // 눈과 입은 같은 레이어(order 1)에 그린다 — 서로 겹치지 않는 영역만 그리는
    // 텍스처라 z-파이팅 걱정 없이 같은 깊이에 둘 수 있다.
    const layers: Array<{
      id: FacePlateId;
      texture: THREE.Texture | null;
      order: number;
      defaultColor: number;
      alwaysVisible: boolean;
    }> = [
      { id: "pattern", texture: null, order: 0, defaultColor: 0x000000, alwaysVisible: false },
      { id: "eye", texture: eyeTextureSets[1].normal, order: 1, defaultColor: 0xffffff, alwaysVisible: true },
      { id: "mouth", texture: mouthTextureSets[1].normal, order: 1, defaultColor: 0xffffff, alwaysVisible: true },
      // 커스텀 얼굴 켜져 있으면 눈·입 대신 이 판 하나를 보여준다(둘이 동시에 보이는 일은
      // 없어서 같은 order/z에 둬도 z-파이팅이 안 난다). 색은 절대 입히지 않는다(0xffffff 고정).
      { id: "customFace", texture: null, order: 1, defaultColor: 0xffffff, alwaysVisible: false },
      { id: "cosmetic", texture: null, order: 2, defaultColor: 0xffffff, alwaysVisible: false }
    ];

    const shadedLayerIds = new Set(["pattern", "cosmetic"]);
    const facePlateMaterials: Partial<Record<"pattern" | "cosmetic", MaterialPair>> = {};

    for (const layer of layers) {
      let material: TexturedMaterial;
      if (layer.id === "pattern" || layer.id === "cosmetic") {
        const materials = facePlateMaterialPair(layer.defaultColor);
        materials.lit.map = layer.texture;
        materials.unlit.map = layer.texture;
        facePlateMaterials[layer.id] = materials;
        material = materials.unlit;
      } else {
        material = new THREE.MeshBasicMaterial({
          map: layer.texture,
          color: layer.defaultColor,
          transparent: true,
          depthWrite: false,
          depthTest: true
        });
      }
      const plate = mesh(curvedGeometry, material, headPivot);
      plate.position.set(centerX, centerY, frontZ + layer.order * FACE_PLATE_LAYER_GAP);
      // 캡스락 떨림처럼 데칼을 흔들 때 되돌아올 원래 위치를 기억해둔다.
      plate.userData.basePosition = plate.position.clone();
      plate.renderOrder = layer.order;
      plate.visible = layer.alwaysVisible;
      facePlates[layer.id] = plate;
    }
    for (const id of shadedLayerIds) {
      if (id !== "pattern" && id !== "cosmetic") continue;
      const materials = facePlateMaterials[id];
      const plate = facePlates[id];
      if (!materials || !plate) throw new Error(`얼굴 ${id} 판을 만들지 못했다`);
      materialGroups.push({ materials, objects: [plate] });
    }
    // 떨림 폭은 얼굴 판 크기에 비례하게 둬서 모델 크기가 바뀌어도 비슷하게 보이도록 한다.
    faceTrembleAmplitude = Math.min(plateWidth, plateHeight) * FACE_TREMBLE_RATIO;

    const eyePlate = facePlates.eye;
    const mouthPlate = facePlates.mouth;
    const patternMaterials = facePlateMaterials.pattern;
    const cosmeticMaterials = facePlateMaterials.cosmetic;
    if (!eyePlate || !mouthPlate || !patternMaterials || !cosmeticMaterials) {
      throw new Error("얼굴 판 머티리얼을 구성하지 못했다");
    }
    loadedMaterials.face = {
      eye: eyePlate.material,
      mouth: mouthPlate.material,
      pattern: patternMaterials,
      cosmetic: cosmeticMaterials
    };
  }

  // 몸 데칼은 얼굴과 달리 판을 새로 만들지 않고, 몸통을 살짝 부풀린 셸 모델(body_tex.glb)을
  // 그대로 쓴다 — 몸은 정면만 보이는 얼굴과 달리 옆·살짝 뒤까지 감싸야 해서 평면 데칼로는
  // 안 되고, 부풀린 셸이라 몸통과 겹쳐 그려도 z-파이팅이 나지 않는다.
  // 얼굴처럼 두 장을 겹쳐 두되(기본 무늬 / 커스텀 바디) 동시에 보이는 일은 없다.

  function createBodyCostumePlates(authoredShell: AuthoredTransform, origin: THREE.Vector3) {
    const bodyCostumeMesh = loadedMeshes.bodyCostume;
    if (!bodyCostumeMesh) throw new Error("몸 무늬 셸 메시가 로드되지 않았다");
    const shellPosition = relativeCorrectedPosition(authoredShell.position, origin);
    const shellQuaternion = correctedQuaternion(authoredShell.quaternion);
    // 커스텀 바디는 같은 셸을 복제해서 쓴다(지오메트리는 공유된다).
    const plateObjects: Record<BodyPlateId, PetMesh> = {
      costume: bodyCostumeMesh,
      customBody: bodyCostumeMesh.clone()
    };

    const plateIds: BodyPlateId[] = ["costume", "customBody"];
    for (const id of plateIds) {
      const object = plateObjects[id];
      // 얼굴 판과 같은 데칼 규칙(투명 배경, 깊이 안 씀)을 쓴다. 색 틴트는 기본 무늬에만
      // 걸고(loadedMaterials.bodyCostume), 커스텀 바디는 커스텀 얼굴과 마찬가지로
      // 항상 흰색 = 원본 이미지 그대로 보여준다.
      const materials = facePlateMaterialPair(0xffffff);
      object.material = materials.unlit;
      object.position.copy(shellPosition);
      object.quaternion.copy(shellQuaternion);
      // 몸통보다 먼저 그려지면 투명 배경이 몸통을 지운다 — 항상 뒤에 그린다.
      object.renderOrder = 1;
      object.visible = false;
      modelRoot.add(object);
      bodyPlates[id] = object;
      loadedMaterials[id === "costume" ? "bodyCostume" : "customBody"] = materials;
      materialGroups.push({ materials, objects: [object] });
    }
  }

  return {
    /** GLB를 모두 읽어 조립하고, 이때 처음 만들어진 값들을 돌려준다. */
    async load(): Promise<PetModelAssembly> {
      await loadModels();
      return { headPivot, tailPivot, faceTrembleAmplitude };
    }
  };
}

export { createPetModelLoader };
export type { PetModelLoaderDependencies, PetModelAssembly };
