// @ts-check
// 조립된 펫 모델을 담는 그릇들. 로더가 제자리에서 채우므로 "정체성이 유지되는가"가 계약이다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createPetModelRefs } = require("../src/pet/pet-model-refs.js");

/** 키 이름으로 훑어보려고 인덱싱 가능한 형태로 본다. */
function refsByKey() {
  return /** @type {Record<string, any>} */ (/** @type {unknown} */ (createPetModelRefs()));
}

const repoRoot = path.resolve(__dirname, "..");

// Windows 체크아웃은 CRLF라, 소스 구간을 문자열로 잘라내는 단언이 줄바꿈 바이트에 걸린다.
/** @param {...string} segments */
function readSource(...segments) {
  return fs.readFileSync(path.join(repoRoot, ...segments), "utf8").replace(/\r\n?/g, "\n");
}

const CONTAINERS = [
  "loadedMeshes", "loadedMaterials", "facePlates", "bodyPlates",
  "materialGroups", "ears", "headgear", "eyeTextureSets", "mouthTextureSets"
];

test("그릇 아홉 개를 전부 비어 있는 채로 만든다", () => {
  const refs = refsByKey();
  assert.deepEqual(Object.keys(refs).sort(), [...CONTAINERS].sort());

  for (const key of ["materialGroups", "ears", "headgear"]) {
    assert.ok(Array.isArray(refs[key]), `${key}는 배열이다`);
    assert.equal(refs[key].length, 0, `${key}는 비어 있다`);
  }
  for (const key of ["loadedMeshes", "loadedMaterials", "facePlates", "bodyPlates", "eyeTextureSets", "mouthTextureSets"]) {
    assert.deepEqual(refs[key], {}, `${key}는 빈 객체다`);
  }
});

test("호출할 때마다 새 그릇을 만든다(인스턴스끼리 공유하지 않는다)", () => {
  // 모듈 수준에서 하나를 만들어 돌려주면 QA 캡처처럼 두 번 초기화하는 경로에서
  // 이전 조립 결과가 그대로 남는다.
  const first = refsByKey();
  const second = refsByKey();

  for (const key of CONTAINERS) {
    assert.notEqual(first[key], second[key], `${key}가 인스턴스 사이에 공유된다`);
  }

  first.ears.push(/** @type {any} */ ({ name: "ear_cat" }));
  first.loadedMeshes.head = /** @type {any} */ ({ name: "head" });
  assert.equal(second.ears.length, 0);
  assert.equal(second.loadedMeshes.head, undefined);
});

test("채워도 그릇의 정체성이 유지된다", () => {
  // 로더가 새 객체를 돌려주고 재대입하는 형태였다면, 로딩이 끝나는 순간 조립 전에 잡아 둔
  // 참조가 전부 낡는다. 색 적용·표정 전환·애니메이션이 그 참조를 들고 있다.
  const refs = createPetModelRefs();
  const meshes = refs.loadedMeshes;
  const ears = refs.ears;

  refs.loadedMeshes.body = /** @type {any} */ ({ name: "body" });
  refs.ears.push(/** @type {any} */ ({ name: "ear_bunny" }));

  assert.equal(refs.loadedMeshes, meshes, "loadedMeshes가 교체되지 않았다");
  assert.equal(refs.ears, ears, "ears가 교체되지 않았다");
  assert.equal(meshes.body?.name, "body");
  assert.equal(ears.length, 1);
});

test("렌더러와 로더는 그릇을 스스로 선언하지 않는다", () => {
  const rendererSource = readSource("src", "pet", "renderer.ts");
  const loaderSource = readSource("src", "pet", "pet-model-loader.ts");

  for (const name of CONTAINERS) {
    assert.doesNotMatch(
      rendererSource,
      new RegExp(`^(?:const|let)\\s+${name}\\b`, "m"),
      `${name}은 렌더러가 만들지 않는다`
    );
    assert.doesNotMatch(
      loaderSource,
      new RegExp(`^\\s*(?:const|let)\\s+${name}\\s*[:=]`, "m"),
      `${name}은 로더가 만들지 않는다`
    );
  }
  // 로더는 넘겨받은 그릇에서 구조분해해 쓴다.
  assert.match(loaderSource, /\} = deps\.refs;/);
  assert.match(rendererSource, /refs: model,/);
});

test("headPivot·tailPivot은 그릇에 넣지 않는다", () => {
  // 둘만 로딩 결과로 재대입되는 값이라 그릇이 아니다. 자리를 만들어 두면 빈 Group이
  // 들어가 "아직 안 로드됨"이 조용히 정상 동작으로 바뀐다.
  const refs = createPetModelRefs();
  assert.equal("headPivot" in refs, false);
  assert.equal("tailPivot" in refs, false);
});
