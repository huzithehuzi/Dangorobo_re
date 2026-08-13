// 펫 모델 조립에 쓰는 공용 타입. renderer.ts와 pet-model-loader.ts가 같은 구조를 주고받아야
// 해서 한쪽에 두지 않고 분리했다.

import type * as THREE from "three";
import type { Settings } from "../main/settings-schema.js";

export type FaceExpressionKey = "normal" | "normal_blink" | "happy" | "angry" | "sad" | "alarm" | "shocked";
export type FaceTextureSet = Record<FaceExpressionKey, THREE.Texture>;
export type PartialFaceTextureSet = Partial<FaceTextureSet>;
export type MaterialPair = { lit: THREE.MeshStandardMaterial; unlit: THREE.MeshBasicMaterial };
export type PetMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
export type TexturedMaterial = THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
export type FacePlateMesh = THREE.Mesh<THREE.BufferGeometry, TexturedMaterial>;
export type MaterialGroup = { materials: MaterialPair; objects: PetMesh[] };
export type AuthoredTransform = { position: THREE.Vector3; quaternion: THREE.Quaternion };
export type ModelPartId = "head" | "body" | "hand" | "bodyCostume";
export type LoadedMeshId = ModelPartId | "handMirror";
export type FacePlateId = "pattern" | "eye" | "mouth" | "customFace" | "cosmetic";
export type BodyPlateId = "costume" | "customBody";
export type BodyCustomizationSettings = Pick<Settings, "customBodyEnabled" | "bodyCostume">;
export type FaceCustomizationSettings = Pick<
  Settings,
  "facePattern" | "faceCosmetic" | "faceEyeStyle" | "faceMouthStyle" | "customFaceEnabled"
>;
export type FaceMaterials = {
  eye: TexturedMaterial;
  mouth: TexturedMaterial;
  pattern: MaterialPair;
  cosmetic: MaterialPair;
};
export type LoadedMaterials = {
  head?: MaterialPair;
  body?: MaterialPair;
  hand?: MaterialPair;
  bodyCostume?: MaterialPair;
  customBody?: MaterialPair;
  earsByVariation?: Record<string, MaterialPair>;
  headgearByVariation?: Record<string, MaterialPair>;
  tailByVariation?: Record<string, MaterialPair>;
  face?: FaceMaterials;
};
export type AuthoredVariationData = {
  variation: string;
  authoredPosition: THREE.Vector3;
  authoredQuaternion: THREE.Quaternion;
};
export type AuthoredVariationMesh = PetMesh & { userData: AuthoredVariationData };
export type VariationData = {
  variation: string;
  tailBendBase?: Float32Array;
  tailBendMinY?: number;
  tailBendMaxY?: number;
  tailBendScale?: number;
};
export type VariationMesh = PetMesh & { userData: VariationData };
