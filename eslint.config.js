const js = require("@eslint/js");
const globals = require("globals");

// 이 프로젝트는 세 가지 실행 환경이 섞여 있다(AGENTS.md 참고):
// - Node/CommonJS: scripts, tests (main/preload 원본은 TypeScript)
// - 브라우저 ES 모듈: renderer.ts (생성 renderer.js는 index.html에서 type="module"로 로드)
// - 브라우저 일반 스크립트(비모듈): src/shared의 공용 전역 유틸.
// - i18n.js/favorite-icons.js/customization-catalog.js/sound-catalog.js는 main.ts(require)와
//   브라우저 <script> 양쪽에서 쓰는 UMD 유틸이라 두 환경 전역을 함께 허용한다.
module.exports = [
  {
    // ui/(React·TSX)는 eslint 기본 파서가 못 읽으므로 tsc(ui/tsconfig.json)가 검사한다.
    // main/preload·펫 렌더러와 공용 TypeScript의 emit 산출물(.js)은 생성물이라 제외한다.
    ignores: [
      "node_modules/**", "release/**", "src/vendor/**", "assets/**", "ui/**", "dist/**",
      "src/main/**/*.js", "src/main.js", "src/preload.js", "src/pet/*.js",
      "src/shared/theme-catalog.js"
    ]
  },
  js.configs.recommended,
  {
    files: ["eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node }
    }
  },
  {
    files: ["scripts/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node }
    }
  },
  {
    files: [
      // 공용 UI 모션 드라이버 — 창 7개 전부에서 로드된다(React 창은 side-effect import).
      "src/shared/ui-motion.js",
      // 공용 색 선택기 — 펫 창과 설정창이 로드한다.
      "src/shared/color-picker.js"
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser }
    }
  },
  {
    files: [
      "src/shared/i18n.js",
      "src/shared/favorite-icons.js",
      "src/shared/customization-catalog.js",
      "src/shared/sound-catalog.js"
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.node }
    }
  },
  {
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      // 이 코드베이스는 "있으면 쓰고 없으면 조용히 넘어가는" 선택적 읽기에
      // 의도적으로 빈 catch를 쓴다(예: 커스텀 얼굴 PNG 개별 로드) — 버그가 아니다.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // 파일명/폰트명 등에서 보이지 않는 제어 문자를 걸러내려고 의도적으로
      // \x00-\x1f 같은 제어 문자 범위를 정규식에 쓰는 곳이 여러 곳 있다.
      "no-control-regex": "off"
    }
  }
];
