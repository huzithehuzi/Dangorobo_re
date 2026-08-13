// 조립된 펫 모델을 담는 그릇들.
//
// GLB 로더는 이 그릇을 **채우기만** 하고 새로 만들지 않는다. 그릇의 정체성이 유지돼야
// 색 적용·표정 전환·애니메이션 루프가 로딩 전후로 같은 객체를 본다 — 로더가 새 객체를
// 돌려주고 렌더러가 재대입하는 형태였다면 로딩이 끝나는 순간 기존 참조가 전부 낡는다.
//
// 흩어져 있던 그릇 아홉 개를 한 덩어리로 묶은 것은 "조립된 모델"이 실제로 하나의 개념이기
// 때문이다. 로더의 의존성 목록도 아홉 줄에서 한 줄로 줄었다.
//
// `headPivot`·`tailPivot`은 여기 없다. 둘만 로딩 결과로 **재대입**되는 값이라 그릇이 아니고,
// 로딩 전에는 존재하지 않는다. 자리를 만들어 두면 빈 Group이 들어가 "아직 안 로드됨"이
// 조용히 정상 동작으로 바뀐다.

import type {
  AuthoredVariationMesh,
  BodyPlateId,
  FacePlateId,
  FacePlateMesh,
  FaceTextureSet,
  LoadedMaterials,
  LoadedMeshId,
  MaterialGroup,
  PetMesh
} from "./pet-model-types.js";

type PetModelRefs = {
  loadedMeshes: Partial<Record<LoadedMeshId, PetMesh>>;
  loadedMaterials: LoadedMaterials;
  facePlates: Partial<Record<FacePlateId, FacePlateMesh>>;
  bodyPlates: Partial<Record<BodyPlateId, PetMesh>>;
  materialGroups: MaterialGroup[];
  ears: AuthoredVariationMesh[];
  headgear: AuthoredVariationMesh[];
  eyeTextureSets: Record<number, FaceTextureSet>;
  mouthTextureSets: Record<number, FaceTextureSet>;
};

function createPetModelRefs(): PetModelRefs {
  return {
    loadedMeshes: {},
    loadedMaterials: {},
    facePlates: {},
    bodyPlates: {},
    materialGroups: [],
    ears: [],
    headgear: [],
    eyeTextureSets: {},
    mouthTextureSets: {}
  };
}

export { createPetModelRefs };
export type { PetModelRefs };
