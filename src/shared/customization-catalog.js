// 펫 커스터마이징 카탈로그 — 몸 색 부위, 파츠 바리에이션, 얼굴/몸 무늬 개수, 조명 항목.
//
// 이 목록은 세 곳이 **완전히 같은 값**을 봐야 한다:
//   1) main 프로세스(src/main/settings-schema.ts): 저장된 값의 정규화·클램프
//   2) 펫 렌더러(src/pet/renderer.ts): 실제 3D 모델에 반영
//   3) 설정창(ui/settings/): 사용자가 고르는 목록
// 예전에는 세 곳이 각자 복사본을 들고 있어서, 무늬를 하나 늘릴 때 한 곳만 고치면
// "설정창에서 고를 수는 있는데 펫에는 안 나타나는" 식으로 조용히 어긋났다
// (반대로 renderer만 늘리면 정규화가 그 인덱스를 잘라버린다). i18n.js/favorite-icons.js와
// 같은 UMD 스타일이라 Node(require)·펫 창(<script>)·설정창(Vite import) 모두에서 쓸 수 있다.
//
// **개수를 늘릴 때는 텍스처 파일도 함께 추가해야 한다** — assets/textures의
// face_back/face_back_<N>.png, face_cosmetic/face_cosmetic_<N>.png,
// body_costume/body_costume_<N>.png 등(renderer.ts의 로더 참고).
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (typeof root !== "undefined") {
    // 전역에 이름을 심는 UMD 관용구라 root의 정적 타입(window/globalThis)에는 이 속성이 없다.
    /** @type {any} */ (root).PetCustomizationCatalog = mod;
  }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {
  // 얼굴/몸 무늬·장식 개수. 값 N은 "1..N번 텍스처가 있다"는 뜻이고, 0은 "없음"이다
  // (eye만 0을 허용하지 않는다 — 눈은 항상 하나를 고른다).
  const FACE_PATTERN_COUNT = 6;
  const FACE_COSMETIC_COUNT = 4;
  const FACE_EYE_STYLE_COUNT = 5;
  const FACE_MOUTH_STYLE_COUNT = 2;
  const BODY_COSTUME_COUNT = 6;

  // 색을 따로 지정할 수 있는 부위. labelKey는 i18n.js의 번역 키로, 펫 주변 커스터마이징
  // 라벨과 설정창 항목이 같은 이름으로 보이도록 맞춰둔 것이다.
  // defaultColor는 저장값이 없거나 올바르지 않을 때와 최초 출하 설정에 함께 쓰는 기본색이다.
  const BODY_COLOR_DEFS = [
    { id: "head", labelKey: "bodyColor.head", defaultColor: "#ffcd42" },
    { id: "body", labelKey: "bodyColor.body", defaultColor: "#ffcd42" },
    { id: "ears", labelKey: "bodyColor.ears", defaultColor: "#ffcd42" },
    { id: "tail", labelKey: "bodyColor.tail", defaultColor: "#e1b12d" },
    { id: "headgear", labelKey: "bodyColor.headgear", defaultColor: "#39a5c0" },
    { id: "hand", labelKey: "bodyColor.hand", defaultColor: "#39a5c0" },
    { id: "eye", labelKey: "bodyColor.eye", defaultColor: "#39fbfe" },
    { id: "mouth", labelKey: "bodyColor.mouth", defaultColor: "#39fbfe" },
    { id: "facePattern", labelKey: "faceCustom.facePattern", defaultColor: "#262222" },
    { id: "faceCosmetic", labelKey: "faceCustom.faceCosmetic", defaultColor: "#ff8e52" },
    { id: "bodyCostume", labelKey: "bodyCustom.bodyCostume", defaultColor: "#262222" }
  ];

  // 교체 가능한 파츠. variations는 GLB 안의 오브젝트 이름과 1:1이라(renderer.ts의
  // 파츠 로더 참고) 이름을 바꾸면 모델도 함께 바꿔야 한다. "none"은 파츠를 숨긴다.
  const PART_VARIATION_DEFS = [
    {
      id: "ears",
      labelKey: "bodyColor.ears",
      variations: ["bear", "bunny", "cat", "fox", "droopy", "none"],
      defaultVariation: "cat"
    },
    {
      id: "tail",
      labelKey: "bodyColor.tail",
      variations: ["antenna", "cat", "round", "none"],
      defaultVariation: "cat"
    },
    {
      // "머리 장식" — 귀와 같은 방식의 선택적 액세서리다. 이 defaultVariation은 저장값
      // 정규화 폴백이고, 신규 설치의 출하 기본은 settings-schema.ts가 별도로 정한다.
      id: "headgear",
      labelKey: "bodyColor.headgear",
      variations: ["antenna", "choker", "glassesround", "glassessquare", "ribbon", "halo", "buckethat", "ballcap", "none"],
      defaultVariation: "none"
    }
  ];

  const VARIATION_LABEL_KEYS = {
    antenna: "partVariation.antenna",
    ballcap: "partVariation.ballcap",
    bear: "partVariation.bear",
    buckethat: "partVariation.buckethat",
    bunny: "partVariation.bunny",
    cat: "partVariation.cat",
    choker: "partVariation.choker",
    droopy: "partVariation.droopy",
    fox: "partVariation.fox",
    glassesround: "partVariation.glassesround",
    glassessquare: "partVariation.glassessquare",
    halo: "partVariation.halo",
    none: "common.none",
    ribbon: "partVariation.ribbon",
    round: "partVariation.round"
  };

  // 설정창의 얼굴/몸 커스터마이징 드롭다운. allowNone이면 "없음"(0)을 고를 수 있다.
  const FACE_CUSTOMIZATION_DEFS = [
    { key: "facePattern", labelKey: "faceCustom.facePattern", count: FACE_PATTERN_COUNT, allowNone: true },
    { key: "faceCosmetic", labelKey: "faceCustom.faceCosmetic", count: FACE_COSMETIC_COUNT, allowNone: true },
    { key: "faceEyeStyle", labelKey: "faceCustom.eye", count: FACE_EYE_STYLE_COUNT, allowNone: false },
    { key: "faceMouthStyle", labelKey: "faceCustom.mouth", count: FACE_MOUTH_STYLE_COUNT, allowNone: true }
  ];

  const BODY_CUSTOMIZATION_DEFS = [
    { key: "bodyCostume", labelKey: "bodyCustom.bodyCostume", count: BODY_COSTUME_COUNT, allowNone: true }
  ];

  // 조명 항목. 항목을 늘리면 settings-schema.ts의 normalizeLighting()과
  // renderer.ts의 조명 적용부도 함께 고쳐야 한다(둘 다 id를 직접 적고 있다).
  const LIGHTING_DEFS = [
    { id: "ambient", labelKey: "lighting.ambient" },
    { id: "keyLight", labelKey: "lighting.keyLight" },
    { id: "rimLight", labelKey: "lighting.rimLight" }
  ];

  /** @param {string} id @returns {string[]} 해당 파츠의 바리에이션 목록(없으면 빈 배열) */
  function variationsFor(id) {
    const def = PART_VARIATION_DEFS.find((entry) => entry.id === id);
    return def ? def.variations : [];
  }

  return {
    FACE_PATTERN_COUNT,
    FACE_COSMETIC_COUNT,
    FACE_EYE_STYLE_COUNT,
    FACE_MOUTH_STYLE_COUNT,
    BODY_COSTUME_COUNT,
    BODY_COLOR_DEFS,
    PART_VARIATION_DEFS,
    VARIATION_LABEL_KEYS,
    FACE_CUSTOMIZATION_DEFS,
    BODY_CUSTOMIZATION_DEFS,
    LIGHTING_DEFS,
    variationsFor
  };
});
