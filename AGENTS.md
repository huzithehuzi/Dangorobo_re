# Dangorobo 작업 지침

## 프로젝트와 문서

- Windows 전용 Electron 데스크톱 펫이다. 앱 이름은 **Dangorobo**(당고로보)이며, 예전 userData
  폴더 이름 `low-poly-desktop-pet`은 기존 사용자 호환성을 위해 유지한다.
- Three.js로 투명한 항상 위 펫 창을 렌더링하고, 독립 창은 React + Tailwind CSS로 만든다.
- 현재 버전과 의존성의 원본은 `package.json`, 설정 기본값의 원본은
  `src/main/settings-schema.ts`, 파츠·색·사운드 목록의 원본은 `src/shared/*-catalog.*`다.
- 새 세션은 이 문서와 필요한 범위의 [개발 문서](./docs/DEVELOPMENT.md)를 읽고 시작한다.
  사용자 기능은 README 3종, 완료 이력은 [CHANGELOG](./docs/CHANGELOG.md), 법적 고지는
  [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES.md)가 담당한다.
- 코드·테스트·빌드 설정과 문서가 다르면 코드·테스트·빌드 설정을 기준으로 문서를 고친다.

## 주요 명령

```powershell
npm ci
npm start
npm run build:runtime
npm run typecheck
npm run lint
npm run check
npm test
npm run ui:build
npm run source:verify
npm run dist
```

- `npm start`: UI와 런타임 산출물을 먼저 빌드한 뒤 개발 실행
- `npm run build:main`: main·preload·공용 TS를 CommonJS 런타임 JS로 제자리 emit
- `npm run build:pet`: 펫 렌더러를 strict 검사한 뒤 브라우저 ESM JS로 제자리 emit
- `npm run build:runtime`: main과 pet 런타임을 순서대로 빌드
- `npm run ui:build`: React 창을 `dist/ui/`에 빌드
- `npm run source:verify` / `source:dist`: 소스 ZIP 구성 검사 / 생성
- `npm run dist`: portable Windows EXE와 소스 ZIP 생성

## 구조와 코드 배치

- `src/main.ts`와 `src/preload.ts`는 엔트리다. `main.ts`에는 창·IPC·생명주기 조립과 공유 상태만
  두고, 기능 로직은 `src/main/` 모듈에 둔다.
- `src/main/assistant/`는 Gemini·프롬프트·대화·기록, `memory/`는 기억 저장·추출·검색,
  `windows/`는 체크리스트·즐겨찾기·메뉴·창 생성과 배치·커서 히트 판정·말풍선 열림 상태를 담당한다. 어느 군집에도 속하지 않는 설정,
  원자 저장, 알람, 모니터, 단축키 같은 인프라는 `src/main/` 바로 아래 둔다.
- 펫 창은 `src/pet/renderer.ts`와 `index.html`·`styles.css`, 독립 창은 `ui/<창 이름>/`,
  여러 프로세스·창의 공용 자원은 `src/shared/`에 둔다.
- 새 창을 추가하거나 전환할 때는 `ui/vite.config.mts` input, `ui/lib/global.d.ts` preload 타입,
  `main.ts`의 `loadUiWindow()`를 함께 갱신한다.
- `src/main.ts`의 첫 import는 반드시 `src/main/legacy-user-data.ts` side effect다. 다른 모듈이
  예전 userData 경로 선택보다 먼저 평가되지 않도록 순서 회귀 테스트를 유지한다.
- 엔트리에서 코드를 뺄 때는 상태의 **소유권을 모듈로 넘기고** 엔트리는 getter로 읽는다.
  세터를 여럿 주입하는 형태는 분해가 아니라 이름만 바뀐 같은 코드다.
- 엔트리 중간에서 모듈을 만들면 그보다 위에서 만들어지는 객체가 그 모듈을 즉시 참조하는지
  확인한다. 참조가 필요하면 화살표로 감싸 호출 시점까지 미룬다.
- Windows 전용 API(`screen.screenToDipPoint`, uIOhook 등) 때문에 다른 OS에서 실행되지 않는
  경로는 그 API를 주입받거나 핸들러를 내보내 Node 테스트로 검증할 수 있게 만든다.
- 기능별 구현 위치와 에셋 규칙은 [개발 문서](./docs/DEVELOPMENT.md)를 기준으로 찾는다.

## 변경 원칙

- 요청 범위 밖 코드를 고치거나 사용자 파일·에셋을 되돌리지 않는다.
- 새로 쓰거나 수정하는 코드 주석은 한국어로 작성하고, 비자명한 이유·불변조건·호환성만 설명한다.
- 기존 설정 파일과 로컬 사용자 데이터의 하위 호환성을 유지한다.
- 새 설정은 `DEFAULT_SETTINGS`, `normalizeSettings()`, 저장 트랜잭션, 설정 UI의
  `draftFromSettings()`·`buildPayload()`, 렌더러 적용 경로를 함께 수정한다.
- 숫자·열거형·색·문자열 설정은 main에서 정규화하거나 범위를 제한한다. 기본값은 기존 사용자의
  화면과 동작을 바꾸지 않도록 보수적으로 정한다.
- 외형·문구·사운드만 저장할 때 휴식 타이머를 초기화하지 않는다. 휴식 간격이나 기능 활성화가
  바뀌었을 때만 일정을 다시 계산한다.
- 사용자 상태 파일은 `src/main/atomic-file.ts`로 저장한다. 새 경로에서
  `fs.writeFileSync`를 직접 사용하지 않는다.
- 설정 저장·전체 가져오기는 `settings-save-transaction.ts`의 같은 트랜잭션과 보상 절차를 쓰고,
  암호화 키 변경은 `settings-commit-journal.ts`의 크래시 복구 경계를 유지한다.

## TypeScript와 런타임 빌드

- root·pet·ui 검사 설정은 모두 strict와 미사용 심벌 검사를 유지한다. `// @ts-nocheck`는
  `src/vendor/three/`의 upstream 사본 외에는 추가하지 않는다.
- `build:main`은 `tsconfig.build.json`으로 TS를 같은 경로의 CommonJS JS에 emit한다.
- `build:pet`은 `src/pet/tsconfig.json`의 strict/noEmit 검사를 먼저 통과한 뒤
  `src/pet/tsconfig.build.json`으로 `src/pet`의 `.ts`를 같은 이름의 브라우저 ESM `.js`로 emit한다.
  두 번째 단계의 `noResolve`·`noCheck`는 타입 의존성을 따라 main CommonJS 산출물을 ESNext로
  덮어쓰지 않기 위한 것이다. 앞의 strict 검사를 대체하거나 순서를 바꾸지 않는다.
- 펫 모듈끼리의 상대 import는 `./이름.js`처럼 확장자까지 적는다. 검사 설정은
  `moduleResolution: Bundler`라 확장자를 빼도 통과하지만 emit은 `noResolve`라 그대로 나가서
  펫 창만 로드에 실패한다. `test/pet-renderer-types.test.js`가 이를 막는다.
- precheck·pretest·prestart·predist는 `build:runtime`을 거친다. 훅을 타지 않는
  `npx electron .`은 `dev-build-guard.ts`가 누락·노후 산출물을 거부한다.
- 생성된 `src/main.js`, `src/preload.js`, `src/main/**/*.js`,
  `src/pet/*.js`, `src/shared/theme-catalog.js`는 런타임 산출물이지 원본이 아니다.
  Git·lint·TypeScript 검사·소스 ZIP에서 제외하되 electron-builder 패키지에는 포함한다.
- TS·Node·Electron 경계는 정적 `import`·`import type`을 쓴다. 브라우저 겸용 UMD와
  CommonJS 전용 패키지만 타입이 붙은 `require()` 경계로 남긴다.
- 구현 없는 전역 계약만 `.d.ts`에 둔다. Three 런타임과 `@types/three` minor를 맞추고,
  모듈 전체를 `any`로 만드는 shim이나 타입 억제를 추가하지 않는다.

## UI와 창

- React 창의 초기 IPC는 `ui/lib/ipc-feed.ts`의 `createIpcFeed()`를 모듈 최상위에서 등록한다.
  초기 invoke 스냅샷이 먼저 도착한 이벤트를 덮어쓰지 않도록 한다.
- 테마 변수 원본은 `src/shared/theme-vars.css`다. `ui/lib/window-base.css`는 Tailwind 토큰으로
  매핑만 한다.
- `src/shared/ui-motion.css`는 창 CSS보다 뒤에, `ui-motion.js`는 창 스크립트보다 앞에 로드한다.
  공용 모션의 레이아웃 속성은 `:where()`로 명시도를 0으로 둔다.
- transform을 이미 쓰는 버튼에 `button:active` scale을 추가할 때 기존 translate를 보존하고
  공용 선택자보다 높은 명시도로 뒤에 둔다. `prefers-reduced-motion`도 함께 처리한다.
- **공용 버튼 애니메이션(누름 젤리 등)은 `transform`이 아니라 독립 `scale`/`translate`/`rotate`
  속성을 움직인다.** 키프레임 값은 명시도와 무관하게 일반 선언을 이기므로, `transform`을
  애니메이션하면 translate로 자리를 잡은 버튼(`.fab`·`.gradient-stop`·`.pie-item`)이 애니메이션이
  도는 동안 통째로 튄다 — 위 :active 규칙과 달리 **명시도를 올려도 막을 수 없다**.
  `test/ui-motion-jelly.test.js`가 막는다.
- 누름 효과(파문·젤리)는 `pointerdown`에서 돈다. `--capture-settings-click`의 `el.click()`은
  pointerdown을 만들지 않으므로 그 경로로는 확인할 수 없다 — `--capture-settings-press`를 쓰고,
  선택자는 `.tab-panel.active ...`로 좁힌다(숨은 탭의 0×0 요소를 잡으면 아무것도 안 보인다).
- **Tailwind 창에서 `font` 축약(`[font:inherit]`)으로 글자 크기를 덮지 않는다.** preflight가 이미
  `button,input,select,optgroup,textarea`에 걸어 주고(base 레이어라 유틸리티에 항상 진다),
  유틸리티로 쓰면 클래스에 적은 순서와 무관하게 `fs-*`보다 뒤에 정렬돼 크기를 루트 상속값으로
  되돌린다. 글자 크기는 `fs-<px>` 유틸리티만 쓴다.
- 앱의 색 선택은 `src/shared/color-picker.*`만 사용한다. 펫 창 위에 네이티브 팝업이나
  `<input type="color">` 대화상자를 띄우지 않는다.
- 창 외형(말풍선 테마·UI 배율·글자 크기·폰트)을 `<html>`에 입히는 일은 `ui/lib/appearance.ts`의
  함수만 쓴다. 창마다 사본을 두지 않는다. 배율·글자 크기의 허용 범위는 그 모듈의 상수가
  원본이며 `settings-schema.ts`의 클램프와 같아야 한다 — 저장 전 미리보기가 범위를 넘기면
  창이 그 배율로 커진 채 저장은 입력 검증에 막혀 되돌리기 어려워진다.
- 모든 창은 CSP, `contextIsolation: true`, `nodeIntegration: false`를 유지한다. 펫 CSP만
  정적 import map hash와 모델 로딩용 `blob:`을 허용한다.
- 말풍선 위치를 바꿀 때 펫 창을 움직이지 않고 투명 상단 공간 안의 DOM만 이동한다.
- 커스터마이징 창의 논리 좌표는 항상 300px 기준이다. 실제 x는 `petWindowLogicalX()`,
  펫 중심은 실제 `bounds.width / 2`를 사용한다.
- `resizable: false` 창을 코드로 리사이즈할 때 `setResizable(true)` → `setBounds` →
  `setResizable(false)`로 감싼다. 배율이 다른 모니터로 이동하면 `show()` 뒤에도 bounds를 적용한다.
- `screen.getCursorScreenPoint()`는 이미 DIP다. `screenToDipPoint()`는 uIOhook 좌표에만 쓴다.
- 3D 라벨의 좌우·순서는 진입 시 고정하고 파츠 구성이 바뀔 때만 무효화한다.

## 입력과 펫 동작

- 스퀴시는 대기열을 만들지 않고 마지막 입력에서 짧게 재시작한다. 키 자동 반복은 중복 재생하지 않는다.
- 상태 블렌딩은 `smoothStep(current, target, rate, delta)`를 사용한다. 고정 계수 lerp로
  프레임률에 전환 속도가 종속되지 않게 한다.
- 상태에 따라 속도가 바뀌는 주기 운동은 절대 elapsed에 속도를 곱하지 않고
  `phase = (phase + speed * delta) % (Math.PI * 2)`로 위상을 누적한다.
- 랜덤 행동은 키보드 입력 중에도 가능하다. 말풍선·즐겨찾기·이동·쓰다듬기·드래그·수면·
  미디어 재생 같은 직접 조작·방해 상태에서만 멈춘다.
- `alarm` 표정은 긴장보다 신난 만세 연출이므로 AI 모션에서도 들뜬 계열로 취급한다.
- 펫 창의 상시 편집 UI를 추가하면 전역 훅의 호버 토글·드래그·우클릭을 그 모드에서 끈다.
- 즐겨찾기 제한을 바꿀 때 `FAVORITE_ITEM_LIMIT`, `RING_RADIUS_BY_COUNT`,
  `FAVORITES_DOCK_EXPANDED`, 펫 말풍선 목록 높이를 함께 계산하고 검증한다.

## 렌더링과 에셋

- GLB 보조 모듈은 `src/vendor/three/` 사본을 쓴다. Three를 올리면 공식 구현 사본,
  인접 선언, `@types/three`를 같은 minor로 맞춘다. 사본 대상은 `GLTFLoader.js`에서
  상대 import를 따라간 **폐포 전체**다 — upstream이 새 상대 import를 추가하면 그 파일만
  404가 나 펫 창이 통째로 안 뜬다. 타입 검사·회귀 테스트는 멀쩡히 통과하므로 Three를
  올린 뒤에는 반드시 실제 창을 띄워 확인한다.
- GLB 메시에 직접 붙이는 텍스처는 `flipY = false`로 만든다. 코드가 만든 얼굴 PlaneGeometry
  데칼은 기본 방향을 유지한다.
- 팔레트와 외곽선은 WebGL 캔버스에만 적용한다. 둘 다 꺼진 직접 렌더 경로와 하나라도 켠
  render-target 경로를 모두 검증한다.
- 머리 장식은 `renderModelWithHeadgear()`의 3패스 레이어 오클루전을 쓴다. 레이어 규칙을
  바꾸면 직접 렌더와 후처리용 `sceneRenderTarget` 경로에서 모두 확인한다.
- GLSL은 TypeScript 템플릿 리터럴 안에 있으므로 문자열 내부 주석에 백틱을 쓰지 않는다.
  셰이더 변경 후 Electron에서 컴파일·투명 배경을 확인한다.
- 렌더링 QA 설정은 손으로 일부만 만들지 말고 `DEFAULT_SETTINGS`에서 파생한다.
  PowerShell 5.1에서는 BOM 없는 `[System.IO.File]::WriteAllText`로 저장한다.
- 모델·텍스처·사운드·테마 추가 절차는 [개발 문서의 에셋 확장](./docs/DEVELOPMENT.md#에셋-확장)을
  따르고 카탈로그·i18n·파일 존재 회귀 테스트를 함께 갱신한다.

## AI와 기억

- Gemini API 키는 `safeStorage`로 암호화하며 일반 JSON, 백업, 로그, 소스 ZIP에 넣지 않는다.
- 사용자 성격은 최대 300자 한 줄로 정규화한다. 비어 있으면 편한 친구 성격을 쓰고,
  이모지·과한 애교·동물극 제한을 유지한다.
- 요청에는 PC 날짜·시각·시간대와 UTC를 넣되 뉴스·날씨·주가 같은 외부 실시간 정보를 추측하지 않는다.
- 질문·번역·문서 요약은 토큰·안전 설정·block reason 정책이 서로 다르다. 한 경로의 설정을
  다른 경로로 임의 확장하지 않는다. 질문(펫대화 포함)과 번역은 안전 필터 4종을 각각
  `BLOCK_NONE`으로 보내지만 **상수를 공유하지 않는다** — 한 곳을 고치면 다른 경로가 함께
  바뀌는 배선을 만들지 않는다. 문서 요약은 보내지 않고, `promptFeedback.blockReason` 검사는
  번역에만 있다.
- 장기 기억의 `memory_key`는 아카이브 포함 UNIQUE다. 삭제된 키를 재사용할 때 새 행을 만들지 말고
  기존 행을 되살린다. 문자 유사도는 높은 임계값의 안전망으로만 쓰고 의미 판단은 추출 LLM에 맡긴다.
- 미완료 주제도 LLM 해결 판정과 `insertOpenLoop()` 중복 방지 경로를 유지한다. 나이 처리는
  **펫이 스스로 꺼낼 수 있는 상한**(`selectFreshOpenLoops()`)과 **사용자가 그 이야기를 꺼냈을 때
  되살리는 경로**(`selectPromptOpenLoops()`)로 나뉘며, 뒤가 앞의 상위집합이어야 한다. 펫이 소재로
  삼을지 판정하는 곳은 반드시 앞을 쓴다 — 뒤로 재면 사용자 질문에 걸린 옛 주제까지 세어, 오프너에는
  없는 목록을 두고 "미완료 주제 중 하나를 골라 물어보라"는 지시가 나간다. 사용자 발화가 아닌
  프롬프트(오프너)는 되살리기를 끈다.
- 기억 DB에 남기는 사람이 읽는 값(종료 사유·에피소드 요약)은 앱 언어로 만든다. 한국어로
  하드코딩하지 않는다.
- **잊어달라는 요청은 소프트 삭제만으로 처리하지 않는다.** `insertMemory()`는 같은 키를 다시
  넣으면 아카이브를 풀어 되살리고 `insertOpenLoop()`는 닫힌 주제를 중복으로 보지 않는다 —
  `is_forgotten`(스키마 v4)을 세우는 `forgetMemory()`·`forgetOpenLoop()`를 쓴다. 일반 삭제와
  자동 정리는 되살아나도 되는 경로라 그 표시를 세우지 않는다. 사용자가 직접 하는 가져오기·
  복원만 표시를 지운다. 표시를 세우는 경로를 늘리면 **되살릴 UI 경로도 함께** 만든다 —
  잊은 사실은 다시 배울 수 없으므로 되돌릴 수단이 없으면 영구 손실이다.

## 검증

변경 후 적용 가능한 항목을 모두 실행한다.

```powershell
npm run build:runtime
npm run typecheck
npm run lint
npm run check
npm test
npm run ui:build
npm run source:verify
```

- Electron 의존 경계 테스트는 mock하고 순수 모듈 테스트는 Node에서 실행 가능하게 유지한다.
  창을 만드는 main 모듈은 `require.cache`에 `electron`을 끼워 `BrowserWindow`·`screen`을 흉내
  내면 소스를 고치지 않고 검증된다. 실제 `window-factory.ts`를 거치므로 창 이벤트 배선까지
  함께 확인된다.
- 펫 모듈을 Node 테스트에서 쓸 때 **Three는 동적 `import`로 받는다**. `require("three")`는
  `build/three.cjs`를, 펫 모듈의 `import`는 `build/three.module.js`를 읽어 클래스 정체성이
  달라진다. `require`로 만든 객체는 `instanceof` 판별을 통과하지 못해 그 경로가 통째로
  건너뛰어지고, 변이를 넣어도 통과하는 공허한 검사가 된다.
- 브라우저 ESM으로 emit되는 펫 모듈은 Node에서 그대로 `require`할 수 있지만, GLB 로더를
  끌어오는 모듈은 못 읽는다 — vendor `GLTFLoader.js`가 CommonJS 패키지 안의 `.js`로 취급돼
  named export를 주지 못한다. 로더에 딸린 작은 술어 때문에 큰 모듈이 통째로 끌려오지 않게
  잎 모듈로 분리한다(`pet-model-mesh.ts`가 그 경우다).
- `tsconfig.build.json`은 `noEmitOnError`라 변이 검사 중 컴파일이 깨지면 emit이 없어 옛 `.js`가
  남고 "변이해도 통과"로 보인다. 변이 스크립트는 빌드 오류를 반드시 함께 판정한다.
- 새 테스트는 변이 검사로 실제로 무는지 확인한다. 다만 **빌드 산출물(`.js`)을 직접 고쳐
  변이시키지 않는다** — 중간에 멈추면 변이가 워킹 트리에 남고 산출물은 Git이 무시해 눈에 띄지
  않는다. 변이 뒤에는 `npm run build:main`으로 되돌린다.
- 타이머를 거는 테스트는 `t.after()`로 정리를 보장한다. 단언이 먼저 실패하면 남은 인터벌
  때문에 테스트 러너가 끝나지 않는다.
- `src/` 모듈 파일 이름을 `-test`·`_test`로 끝내거나 `test-`로 시작하지 않는다. 제자리 emit
  산출물이 `node --test` 기본 탐색 패턴에 걸려 모듈 자체가 테스트로 실행된다. 같은 이유로
  `test/` 안에는 테스트가 아닌 헬퍼 `.js`를 두지 않는다 — 그 패턴은 `test/`의 모든 `.js`를
  테스트 파일로 실행한다.
- 소스 텍스트를 읽어 구조를 단언하는 테스트는 읽은 뒤 `replace(/\r\n?/g, "\n")`으로 줄바꿈을
  맞춘다. 저장소 인덱스는 LF지만 Windows 체크아웃은 CRLF라, `indexOf("...\n\n...")`처럼 `\n`
  앞뒤가 붙는 패턴만 조용히 -1이 된다(`"\n" + 텍스트` 형태는 우연히 통과해서 더 늦게 드러난다).
  바이트 자체가 계약인 파일은 반대로 `.gitattributes`에 `eol=lf`를 둔다 — `*.html`이 그 경우로,
  펫 창 CSP의 import map sha256이 줄바꿈까지 포함해 계산된다.
- UI·파츠 변경은 고유한 `--user-data-dir=<임시 폴더>`로 실제 창을 캡처한다. 같은 프로필의 앱이
  이미 실행 중이면 single-instance lock 때문에 캡처가 조용히 실패할 수 있다.
- 렌더링 변경은 팔레트·외곽선 ON/OFF 네 조합과 투명 배경을 확인한다.
- 휴식·알람 변경은 즉시 알림과 카운트다운을 확인한다.
- 배포 전에는 Windows NSIS 설치본·portable EXE, 소스 ZIP 구성, 버전, 비밀값·사용자 데이터 제외를
  직접 확인한다. 설치본으로 자동 업데이트를 확인할 때는 `release/`의 낮은 버전을 먼저 설치해
  두고 그 위에서 새 버전을 배포해 다운로드·재시작 다이얼로그·설치까지 실제로 거친다.
- Windows 전용 PowerShell·SMTC·DND·uIOhook·globalShortcut 변경은 Windows 실기로 확인하지 못했다면
  미해결 검증으로 명시한다.

## 문서와 배포

- 작업 규칙·검증 불변조건은 이 문서, 현재 구조·기능 위치·에셋 절차·제약·백로그는
  `docs/DEVELOPMENT.md`, 완료 이력은 `docs/CHANGELOG.md`에만 쓴다.
- **GitHub Pages 소개 페이지(`docs/index.html`)는 앱과 독립적이다.** 그 페이지의 문구·이미지·
  디자인 절차는 `docs/SITE.md`에만 쓴다. 앱의 기능·기본값·외형을 바꿨으면 그 페이지도 낡았는지
  확인한다(문구 3개 언어와 캡처 이미지).
- 사용자에게 보이는 기능·버전이 바뀌면 README 3종과 `package.json`·`package-lock.json`을 맞춘다.
- 제품을 소개하는 문구에서는 종(고양이/cat/猫)으로 부르지 않고 "펫"으로 쓰고, "로우폴리"보다
  "레트로 감성"을 앞세운다 — 파츠·색을 바꾸면 고양이가 아니게 된다. 앱 안의 파츠 이름
  ("고양이 귀" 등)은 카탈로그 용어라 그대로 둔다.
- 같은 사실을 여러 문서에 복사하지 않는다. 파일 수·테스트 수·설정 키 수·기본값·에셋 개수처럼
  자주 바뀌는 값은 코드나 테스트 출력을 원본으로 링크한다.
- 오타나 포맷만 고친 변경에는 이력을 추가하지 않는다.
- **기능·수정 단위 작업이 끝나면 사용자의 명시적 요청 없이도 바로 커밋한다.** 여러 작업을
  모아두지 않는다. 메시지는 한글 제목으로 간단명료하게 쓰고, 필요하면 본문에 짧은 한글 설명을 붙인다.
- **push는 사용자가 명시적으로 요청할 때만 한다.**
- 소스 ZIP 원본 목록은 `scripts/source-archive.js`다. 빌드 결과, 제자리 TS emit, 사용자 데이터,
  API 키, 대화 로그, 임시·rollback 파일을 포함하지 않는다.
