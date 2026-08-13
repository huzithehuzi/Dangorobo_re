// @ts-check
// 커스터마이징 카탈로그 ↔ 실제 자산 파일 정합성 (2026-08-10).
//
// 카탈로그(src/shared/customization-catalog.js)는 main·펫 렌더러·설정창이 공유하는
// 유일한 기준이라, 개수를 하나 올리면 세 창이 전부 그 값을 따라간다. 그런데 **텍스처나
// GLB 파일을 같이 넣지 않으면** 설정창에는 항목이 보이는데 펫에는 아무것도 안 나타난다
// (렌더러는 로드 실패를 console.warn만 하고 넘어간다). 그 상태를 여기서 잡는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const catalog = require("../src/shared/customization-catalog.js");

const assetsDir = path.join(__dirname, "../assets");
const glbMagic = 0x46546c67;
const glbJsonChunk = 0x4e4f534a;

/**
 * @typedef {{
 *   scene?: number,
 *   scenes?: Array<{nodes?: number[]}>,
 *   nodes?: Array<{name?: string, mesh?: number, children?: number[]}>,
 *   meshes?: Array<{primitives?: Array<{attributes?: Record<string, number>, mode?: number}>}>,
 *   accessors?: Array<{bufferView?: number, componentType?: number, type?: string}>,
 *   bufferViews?: Array<{byteStride?: number}>
 * }} GlbDocument
 */

/** @param {string} relativePath @returns {GlbDocument} */
function readGlbDocument(relativePath) {
  const fullPath = path.join(assetsDir, relativePath);
  const bytes = fs.readFileSync(fullPath);
  assert.ok(bytes.length >= 20, `GLB 헤더가 너무 짧다: assets/${relativePath}`);
  assert.equal(bytes.readUInt32LE(0), glbMagic, `GLB magic이 올바르지 않다: assets/${relativePath}`);
  assert.equal(bytes.readUInt32LE(4), 2, `GLB 2.0 파일이어야 한다: assets/${relativePath}`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `GLB 선언 길이가 실제 파일과 다르다: assets/${relativePath}`);

  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), glbJsonChunk, `첫 GLB 청크가 JSON이 아니다: assets/${relativePath}`);
  assert.ok(20 + jsonLength <= bytes.length, `GLB JSON 청크가 파일 범위를 벗어난다: assets/${relativePath}`);
  const json = bytes
    .toString("utf8", 20, 20 + jsonLength)
    .replace(/[\u0000 ]+$/, "");
  return /** @type {GlbDocument} */ (JSON.parse(json));
}

/**
 * @param {GlbDocument} document
 * @param {string} relativePath
 */
function reachableSceneNodes(document, relativePath) {
  const sceneIndex = Number.isInteger(document.scene) ? Number(document.scene) : 0;
  const scene = document.scenes?.[sceneIndex];
  assert.ok(scene, `${relativePath}의 기본 scene이 존재해야 한다`);

  const reachable = new Set();
  const pending = [...(scene.nodes || [])];
  while (pending.length > 0) {
    const nodeIndex = pending.pop();
    if (typeof nodeIndex !== "number" || !Number.isInteger(nodeIndex) || reachable.has(nodeIndex)) continue;
    const node = document.nodes?.[nodeIndex];
    assert.ok(node, `${relativePath}의 scene node 인덱스가 유효해야 한다`);
    reachable.add(nodeIndex);
    pending.push(...(node.children || []));
  }
  return reachable;
}

function expectedModelParts() {
  const parts = [
    { relativePath: "models/head.glb", nodeName: "head" },
    { relativePath: "models/body.glb", nodeName: "body" },
    { relativePath: "models/hand.glb", nodeName: "hand" },
    { relativePath: "models/body_tex.glb", nodeName: "body_tex" }
  ];

  for (const def of catalog.PART_VARIATION_DEFS) {
    const folder = def.id === "ears" ? "ear" : def.id;
    for (const variation of def.variations) {
      if (variation === "none") continue;
      const nodeName = `${folder}_${variation}`;
      parts.push({ relativePath: `models/${folder}/${nodeName}.glb`, nodeName });
    }
  }
  return parts;
}

/** @param {string} relativePath */
function assertAssetExists(relativePath) {
  const full = path.join(assetsDir, relativePath);
  assert.ok(fs.existsSync(full), `자산이 없다: assets/${relativePath}`);
}

test("얼굴 무늬 텍스처가 FACE_PATTERN_COUNT만큼 있다", () => {
  for (let i = 1; i <= catalog.FACE_PATTERN_COUNT; i++) {
    assertAssetExists(`textures/face_back/face_back_${i}.png`);
  }
});

test("얼굴 장식 텍스처가 FACE_COSMETIC_COUNT만큼 있다", () => {
  for (let i = 1; i <= catalog.FACE_COSMETIC_COUNT; i++) {
    assertAssetExists(`textures/face_cosmetic/face_cosmetic_${i}.png`);
  }
});

test("몸 무늬 텍스처가 BODY_COSTUME_COUNT만큼 있다", () => {
  for (let i = 1; i <= catalog.BODY_COSTUME_COUNT; i++) {
    assertAssetExists(`textures/body_costume/body_costume_${i}.png`);
  }
});

// 눈·입은 스타일마다 표정별 텍스처가 한 벌씩 있다(renderer.ts의 FACE_EXPRESSION_KEYS).
const FACE_EXPRESSION_KEYS = ["normal", "normal_blink", "happy", "angry", "sad", "alarm", "shocked"];

test("눈·입 스타일 텍스처가 표정 수만큼 갖춰져 있다", () => {
  /** @type {Array<[string, number]>} */
  const styles = [
    ["eye", catalog.FACE_EYE_STYLE_COUNT],
    ["mouth", catalog.FACE_MOUTH_STYLE_COUNT]
  ];
  for (const [prefix, count] of styles) {
    for (let i = 1; i <= count; i++) {
      for (const expression of FACE_EXPRESSION_KEYS) {
        assertAssetExists(`textures/face/${prefix}_${i}/${prefix}_${i}_${expression}.png`);
      }
    }
  }
});

test("파츠 바리에이션마다 GLB 모델이 있다", () => {
  for (const def of catalog.PART_VARIATION_DEFS) {
    for (const variation of def.variations) {
      // "none"은 파츠를 숨기는 값이라 모델이 없다.
      if (variation === "none") continue;
      const folder = def.id === "ears" ? "ear" : def.id;
      assertAssetExists(`models/${folder}/${folder}_${variation}.glb`);
    }
  }
});

test("배포 GLB의 파츠 노드와 꼬리 정점 버퍼 구조가 렌더러 계약에 맞는다", () => {
  for (const part of expectedModelParts()) {
    const document = readGlbDocument(part.relativePath);
    const matchingNodeIndexes = (document.nodes || [])
      .map((node, index) => node.name === part.nodeName ? index : -1)
      .filter((index) => index >= 0);
    assert.equal(
      matchingNodeIndexes.length,
      1,
      `${part.relativePath}에 ${part.nodeName} 노드가 정확히 하나 있어야 한다`
    );
    const nodeIndex = matchingNodeIndexes[0];
    assert.ok(
      reachableSceneNodes(document, part.relativePath).has(nodeIndex),
      `${part.relativePath}의 ${part.nodeName} 노드는 기본 scene에서 도달할 수 있어야 한다`
    );

    const meshIndex = document.nodes?.[nodeIndex]?.mesh;
    if (typeof meshIndex !== "number" || !Number.isInteger(meshIndex)) {
      assert.fail(`${part.relativePath}의 ${part.nodeName} 노드가 단일 mesh를 가리켜야 한다`);
    }
    const mesh = document.meshes?.[meshIndex];
    assert.ok(mesh, `${part.relativePath}의 ${part.nodeName} mesh 인덱스가 유효해야 한다`);
    assert.equal(mesh.primitives?.length, 1, `${part.relativePath}의 ${part.nodeName} mesh는 primitive 하나여야 한다`);
    const primitive = mesh.primitives[0];
    assert.ok(
      [4, 5, 6].includes(primitive.mode ?? 4),
      `${part.relativePath}의 ${part.nodeName} primitive는 THREE.Mesh로 로드되는 삼각형 모드여야 한다`
    );

    if (!part.nodeName.startsWith("tail_")) continue;
    const positionAccessorIndex = primitive.attributes?.POSITION;
    if (typeof positionAccessorIndex !== "number" || !Number.isInteger(positionAccessorIndex)) {
      assert.fail(`${part.relativePath}의 POSITION accessor가 유효해야 한다`);
    }
    const accessor = document.accessors?.[positionAccessorIndex];
    assert.ok(accessor, `${part.relativePath}의 POSITION accessor가 존재해야 한다`);
    assert.equal(accessor.componentType, 5126, `${part.relativePath}의 POSITION은 Float32여야 한다`);
    assert.equal(accessor.type, "VEC3", `${part.relativePath}의 POSITION은 VEC3여야 한다`);

    const bufferViewIndex = accessor.bufferView;
    if (typeof bufferViewIndex !== "number" || !Number.isInteger(bufferViewIndex)) {
      assert.fail(`${part.relativePath}의 POSITION bufferView가 유효해야 한다`);
    }
    const bufferView = document.bufferViews?.[bufferViewIndex];
    assert.ok(bufferView, `${part.relativePath}의 POSITION bufferView가 존재해야 한다`);
    assert.equal(
      Object.prototype.hasOwnProperty.call(bufferView, "byteStride"),
      false,
      `${part.relativePath}의 POSITION bufferView는 interleaved 형식이면 안 된다`
    );
  }
});

test("파츠 기본값은 그 파츠의 바리에이션 목록 안에 있다", () => {
  for (const def of catalog.PART_VARIATION_DEFS) {
    assert.ok(
      def.variations.includes(def.defaultVariation),
      `${def.id}의 기본값 ${def.defaultVariation}이 목록에 없다`
    );
  }
});

test("모든 바리에이션 이름에 번역 키가 있다", () => {
  const labelKeys = /** @type {Record<string, string>} */ (catalog.VARIATION_LABEL_KEYS);
  for (const def of catalog.PART_VARIATION_DEFS) {
    for (const variation of def.variations) {
      assert.ok(
        labelKeys[variation],
        `${variation}의 VARIATION_LABEL_KEYS 항목이 없다 — 설정창에 원문이 그대로 노출된다`
      );
    }
  }
});

test("설정창 드롭다운 개수가 카탈로그 상수와 일치한다", () => {
  const byKey = Object.fromEntries(
    [...catalog.FACE_CUSTOMIZATION_DEFS, ...catalog.BODY_CUSTOMIZATION_DEFS].map((def) => [def.key, def.count])
  );
  assert.equal(byKey.facePattern, catalog.FACE_PATTERN_COUNT);
  assert.equal(byKey.faceCosmetic, catalog.FACE_COSMETIC_COUNT);
  assert.equal(byKey.faceEyeStyle, catalog.FACE_EYE_STYLE_COUNT);
  assert.equal(byKey.faceMouthStyle, catalog.FACE_MOUTH_STYLE_COUNT);
  assert.equal(byKey.bodyCostume, catalog.BODY_COSTUME_COUNT);
});

test("설정 정규화가 카탈로그 개수를 그대로 상한으로 쓴다", () => {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = /** @type {any} */ ({
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getLocale: () => "en-US" } }
  });
  const { normalizeSettings } = require("../src/main/settings-schema.js");

  // 상한 안의 값은 그대로 통과하고, 한 칸 넘으면 걸러져야 한다.
  const atLimit = normalizeSettings({
    facePattern: catalog.FACE_PATTERN_COUNT,
    faceCosmetic: catalog.FACE_COSMETIC_COUNT,
    bodyCostume: catalog.BODY_COSTUME_COUNT
  });
  assert.equal(atLimit.facePattern, catalog.FACE_PATTERN_COUNT);
  assert.equal(atLimit.faceCosmetic, catalog.FACE_COSMETIC_COUNT);
  assert.equal(atLimit.bodyCostume, catalog.BODY_COSTUME_COUNT);

  const overLimit = normalizeSettings({
    facePattern: catalog.FACE_PATTERN_COUNT + 1,
    faceCosmetic: catalog.FACE_COSMETIC_COUNT + 1,
    bodyCostume: catalog.BODY_COSTUME_COUNT + 1
  });
  assert.notEqual(overLimit.facePattern, catalog.FACE_PATTERN_COUNT + 1);
  assert.notEqual(overLimit.faceCosmetic, catalog.FACE_COSMETIC_COUNT + 1);
  assert.notEqual(overLimit.bodyCostume, catalog.BODY_COSTUME_COUNT + 1);
});
