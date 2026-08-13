// 파츠 바리에이션 메시 판별.
//
// 조립할 때(로더)와 매 프레임 지금 보이는 꼬리를 고를 때(애니메이션 루프)가 같은 판별을
// 쓴다. 로더 안에 두면 술어 두 개 때문에 루프가 GLTFLoader까지 딸린 로더 전체를 끌고 와서,
// 브라우저 밖에서는 모듈을 아예 읽을 수 없다.

import * as THREE from "three";
import type { VariationMesh } from "./pet-model-types.js";

function isVariationMesh(object: THREE.Object3D): object is VariationMesh {
  return object instanceof THREE.Mesh && typeof object.userData.variation === "string";
}

function isVisibleVariationMesh(object: THREE.Object3D): object is VariationMesh {
  return isVariationMesh(object) && object.visible;
}

export { isVariationMesh, isVisibleVariationMesh };
