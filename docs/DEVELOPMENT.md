# Dangorobo 개발 문서

이 문서는 현재 기술 구조, 기능의 구현 위치, 에셋 확장 절차, 알려진 제약과 백로그를 한곳에
정리한다. 작업 규칙과 반드시 지켜야 할 불변조건은 [AGENTS.md](../AGENTS.md), 사용자 기능은
README 3종, 완료 이력은 [CHANGELOG.md](./CHANGELOG.md), 법적 고지는
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)를 본다.

문서와 구현이 다르면 다음 원본을 우선한다.

| 항목 | 단일 원본 |
|---|---|
| 버전·의존성·패키징 | `package.json`, `package-lock.json` |
| 설정 타입·기본값·정규화 | `src/main/settings-schema.ts` |
| 커스터마이징·사운드·테마 목록 | `src/shared/*-catalog.*` |
| 설정 UI 저장 payload | `ui/settings/store.ts` |
| 설정창 패치 노트 내용 | `ui/settings/patch-notes.ts` |
| 설정창 외형·커스터마이징 상태 | `ui/settings/use-customization-state.ts` |
| 설정창 로드·수정·저장 수명주기 | `ui/settings/use-settings-lifecycle.ts` |
| 창 외형(테마·배율·글자 크기·폰트) 적용과 그 허용 범위 | `ui/lib/appearance.ts` |
| 캡처·QA 실행 인자 | `src/main/qa-capture.ts` |
| 소스 ZIP 구성 | `scripts/source-archive.js` |
| 커스텀 템플릿 ZIP 구성 | `scripts/custom-template-archive.js` |
| 회귀 범위와 현재 테스트 수 | `test/`, `npm test` 출력 |

## 현재 상태와 다음 작업

- **1.2.0 릴리스 산출물까지 만들어 둔 상태다**(`release/Dangorobo-1.2.0-Setup.exe`,
  `-Portable.exe`, `-Source.zip`, `latest.yml`). portable EXE는 임시 프로필로 실제 실행해
  설정창까지 확인했고, **설치본 설치와 자동 업데이트(낮은 버전 설치 → 새 버전 배포 → 다운로드·
  재시작)는 아직 확인하지 않았다** — 배포 전 남은 수동 검증이다.
- Windows x64용 Electron 앱이며 현재 버전은 `package.json`을 기준으로 한다. NSIS 설치본과
  portable EXE 두 형태로 배포하고(`package.json`의 `build.win.target`), 설치본만
  `electron-updater`로 자동 업데이트를 확인한다 — portable 실행은 업데이트 채널이 없어
  확인 자체가 조용히 실패한다(`auto-update-service.ts`).
- main·preload·펫 창 모듈의 구현 원본은 TypeScript다. main은 CommonJS, 펫 창 모듈은 브라우저
  ESM JavaScript로 제자리 emit해 기존 런타임 경로를 유지한다.
- 독립 창은 `ui/`의 React + Tailwind CSS 앱이고, 펫 창은 명령형 Three.js 렌더러다.
- `src/main.ts`는 창 생성·IPC 연결·프로세스 생명주기와 공유 상태 조립이 중심이다.
- IPC 등록은 도메인별로 `register<Domain>IpcHandlers(ipcMain, deps)` 모듈로 뺀다. 모듈은
  창·설정을 캡처하지 않고 getter와 동작 콜백만 받으므로 Electron 없이 Node로 검증된다.
  체크리스트·기억·기록·외형·즐겨찾기·AI 도구·설정 저장·펫 창 상태 보고가 이 형태다.
  `main.ts`에 남은 IPC는 설정창 전용 소품뿐이다(`settings:get`, `fonts:list-installed`,
  `alarm:pick-sound`, `settings:test-alarm`, 단축키 녹화 두 개).
- 창 7종의 `BrowserWindow` 생성 옵션과 창 이벤트 배선은 `windows/window-factory.ts`에 있다.
  트레이와 우클릭 팝업의 창·툴팁·디바운스 상태는 `windows/pet-menu-controller.ts`가 소유하고,
  나머지 창 핸들 바인딩과 지속 상태는 각 창 컨트롤러 또는 `main.ts`가 갖는다.
- AI 질문·펫대화·즐겨찾기 말풍선은 서로 배타적인 하나의 상태 기계라 `pet/assistant-panels.ts`에
  함께 둔다. 활성 플래그도 그 모듈이 갖고 렌더러는 getter로 읽기만 한다.
- 설정창의 즉시 미리보기는 `windows/settings-preview.ts`가 소유한다. 저장 전에도 펫에
  반영하므로 "지금 보이는 설정"이 저장된 설정과 다를 수 있고, 저장 없이 닫으면 되돌린다.
  **되돌릴지 판단하는 플래그와 미리보기 값은 함께 지운다** — 따로 두면 "값은 남았는데
  되돌리지 않는" 상태가 생겨 다음에 창을 열 때 옛 미리보기가 되살아난다.
  미리보기 값은 저장본 위에 patch를 **누적**한다. 매번 새로 만들면 색을 고른 뒤 크기를
  바꿀 때 색이 원래대로 돌아간다.
- AI 대화가 남기는 세 기록(화면 로그·대화 이력·에피소드 요약)은
  `assistant/assistant-history.ts`가 소유한다. 셋을 한 모듈에 둔 것은 수명주기가 같기
  때문이다 — 기억을 끄면 이력과 에피소드가 함께 비고, 턴 상한이 바뀌면 이력을 함께 자른다.
  화면 로그만 기억 설정과 무관하게 남는다.
  **장기 기억 추출 주기는 이력 길이가 아니라 별도 카운터로 센다.** 길이로 재면
  `assistantMemoryTurns` 상한에 걸려 3의 배수가 아닌 값에 멈춰 영영 안 돈다.
- 펫 창이 마우스를 받을 조건은 `windows/pet-interaction-mode.ts`가 정한다.
  **interactive와 focusable의 조건이 다르다** — 호버 두 가지(펫·미디어)는 interactive에만
  들어간다. 커서를 얹었다고 작업 중인 창의 포커스를 빼앗으면 타이핑이 끊긴다.
  `setIgnoreMouseEvents`의 `forward: true`가 빠지면 통과된 클릭이 아래 창에 전달되지 않는다.
  **값이 바뀌지 않으면 네이티브 호출을 하지 않는다.** Electron의 Windows `setFocusable()`은
  값과 무관하게 내부적으로 `Deactivate()`를 부르고, 그건 z-order 바로 아래 창에
  `SetForegroundWindow()`를 건다 — 펫이 다른 창들 사이로 가라앉아 있으면 엉뚱한 배경 창이
  앞으로 끌려 나와 창 순서가 뒤섞인다. 이 모듈이 "마지막으로 건 값"의 유일한 소유자이므로
  **바깥에서 `petWindow.setFocusable()`을 직접 부르지 않는다** — 캐시가 어긋나면 다음 전환이
  통째로 씹힌다. `window-debug.log`의 `focusableChanged`·`interactiveChanged`가 실제 호출
  여부를 남긴다.
- 펫 창의 논리 위치는 `windows/pet-position-controller.ts`가 소유한다. 파일 I/O는
  `pet-position-store.ts`, 작업 영역 클램프 계산은 `windows/pet-window-layout.ts`가 하고,
  컨트롤러는 그 둘을 실제 창·화면에 붙이는 부분과 "언제 디스크에 쓸지" 같은 수명주기를 맡는다.
  `screen`·`app` 경계는 주입받아 Node로 검증한다. **논리 위치는 언제나 300px 창 기준의
  좌상단**이고, 넓어진 폭은 `setBounds()`가 x를 inset만큼 당겨 흡수한다.
  화면 밖 보정은 실제로 조여졌을 때만 디스크에 쓴다 — 워치독이 매번 쓰던 것이 다른 창의
  z-order와 얽혀 보여 최소화한 규칙이다.
- 즐겨찾기 독립 창과 플로팅 독은 `windows/favorites-windows.ts`가 소유한다. 배치 계산은
  `favorites-layout.ts`의 순수 함수가 하고 이쪽은 창 수명주기를 맡는다. Electron 없이
  창 객체와 `screen`만 흉내 내면 Node로 검증된다 — 실제 창 팩토리를 거치므로 이벤트 배선까지
  함께 확인된다. 굳혀 둔 계약은 셋이다.
  **표시 방식을 바꿀 때 독은 `close()`가 아니라 `destroy()`로 닫는다** — `close()`는 실제
  파괴가 나중이라 그 사이에 `createDockWindow()`가 "이미 있다"고 보고 닫히는 중인 창을
  재사용한다.
  **시작 시점의 표시 방식을 기준선으로 잡아 둔다**(`primeSyncBaseline`) — 안 잡으면 첫 저장
  때 방식이 바뀐 것으로 보고, 사용자가 숨겨 둔 독이 설정을 저장할 때마다 되살아난다.
  **독을 펼칠 때는 접을 위치도 함께 옮긴다** — 작업 영역 보정으로 밀려난 만큼 저장 위치를
  안 옮기면 접을 때 화면 밖 원래 자리로 되돌아간다.
- 방해 금지는 감지와 대응을 갈라 둔다. `dnd-monitor.ts`가 PowerShell로 전체화면을 감지하고,
  "그래서 어떤 창을 숨길지"는 `windows/dnd-visibility.ts`가 정한다. 감지는 다른 OS에서 돌지
  않지만 대응은 창 객체만 흉내 내면 Node로 검증된다. 핵심 계약은 **우리가 숨긴 창만
  되살린다**는 것 — 사용자가 직접 숨겨 둔 펫까지 복구하면 안 된다.
- Windows 전용 API에 막혀 Electron으로 확인할 수 없는 경로는 그 API를 주입받게 바꿔
  Node 테스트로 검증한다. `pet-pointer.ts`는 `screenToDipPoint`를 받고,
  `input-monitor.ts`는 훅에 붙지 않고 핸들러를 내보낸다 — 둘 다 합성 입력으로 판단
  로직을 그대로 확인한다. 펫·미디어 호버, CapsLock, 유휴 상태와 관련 타이머는
  `input-monitor.ts`가 소유하고 엔트리는 getter로 읽는다. 실제 CapsLock 조회는
  `caps-lock-state.ts`가 주입받은 PowerShell 실행 경계에서 처리한다.
- 파츠 바리에이션 메시 판별은 `pet/pet-model-mesh.ts`에 있다. 조립할 때(로더)와 매 프레임
  지금 보이는 꼬리를 고를 때(애니메이션 루프)가 같은 판별을 쓰는데, 술어 두 개를 로더 안에
  두면 루프가 GLB 로더를 통째로 끌고 와 브라우저 밖에서는 모듈을 열 수 없다
  (이유는 [AGENTS.md의 검증 규칙](../AGENTS.md#검증) 참고).
- 프레임 루프는 `pet/animation-loop.ts`에 있다. 루프 전용 누적 상태(부드러운 입력값·알람/수면
  amount·숨쉬기 위상·꼬리 굽힘 적용값)를 이 모듈이 소유하고, 밖으로 내보내는 것은 `start()`
  하나뿐이다. 로딩 뒤에 재대입되는 값(`headPivot`·`tailPivot`·`faceTrembleAmplitude`)과
  렌더러가 소유한 플래그(`restActive`·`clickThrough`·`mediaState`)는 값이 아니라 getter로
  받는다 — 값으로 받으면 로딩 전 `undefined`가 굳거나 갱신이 반영되지 않는다.
  그리기(`renderPetScene`)와 미디어 위치는 라이브 씬·후처리 의존이 많아 렌더러에 남기고
  콜백으로 넘긴다.
- 분해 후보를 고를 때는 "재대입 `let` 개수"가 아니라 **주입해야 할 바깥 심벌 개수**로
  잰다. 그 군집에서만 쓰는 상수·헬퍼는 코드와 함께 옮겨가므로 비용이 아니다.
- 상태를 옮길 때는 세터를 주입하지 말고 **소유권을 넘긴다**. 모듈이 플래그를 갖고 엔트리가
  getter로 읽는 형태여야 분해고, 세터 여러 개를 주입하면 이름만 바뀐 같은 코드가 된다.
- 커스터마이징 라벨·팔레트 오버레이는 `pet/customize-labels.ts`로 옮겼다. 모듈이 라벨 카드·
  좌우 배정·팔레트 열림 상태를 소유하고 렌더러는 `isActive()`로 읽는다. 파츠의 3D 앵커와
  드래그 중 로컬 색 적용만 콜백으로 남겼다 — 앵커는 모델 그릇 여섯 개를, 로컬 색은
  `latestSettings`를 봐야 해서 소유권이 렌더러에 있다.
- 프리셋 썸네일의 렌더 타깃·픽셀 버퍼·2D 캔버스 캐시는 `pet/thumbnail-resources.ts`가
  소유한다. `ensure(size)`가 렌더 타깃을 돌려주므로 호출부에서 널 검사를 되풀이하지 않는다.
  썸네일 렌더 자체(파츠 적용·카메라 이동·후처리 패스)는 라이브 scene·camera·material 의존이
  많아 렌더러에 남겼다.
- 루프가 쓰던 누적 상태 중 깜박임 3개는 `pet/blink-timer.ts`, 꼬리 3개는
  `pet/tail-motion.ts`가 소유한다. 꼬리는 계산과 씬 적용을 갈라 — 모듈이 목표 각도·곡률을
  정하고 따라가면 렌더러가 `tailPivot.rotation.z` 대입과 정점 굽힘만 한다.
- 스퀴시·출렁임 재생(`squishElapsed`·`wobbleElapsed`)과 드래그 재트리거 간격은
  `pet/squish-motion.ts`가 소유한다. 앞의 둘과 달리 발동 지점(키·마우스 입력, 설정 끄기,
  드래그)과 소비 지점(몸통 변형)이 갈라져 있어서, 흩어진 네 곳을 한 소유자로 모으는 것이
  요점이었다. 드래그 펄스는 몸통 변형보다 **먼저** 돌아야 트리거된 프레임에서 바로 재생된다.
- main이 알려주는 상호작용 상태 여섯 가지는 `pet/pet-interaction-state.ts`가 소유한다.
  펫 모듈이 preload를 쓸 때는 `window.desktopPet`을 직접 부른다 —
  `test/pet-renderer-types.test.js`가 그 표기를 훑어 선언·공개·사용 셋을 맞추므로,
  브리지를 주입으로 감추면 그 계약 검사가 조용히 무력해진다.
- 설정에서 파생되는 값 열여섯 개(펫 크기·꼬리 속도·스퀴시 세기·유휴 간격·미디어 오프셋 등)는
  `pet/pet-render-settings.ts`가 소유한다. `applyPetSettings()`는 원래 "설정에서 값을 뽑는 일"과
  "DOM·씬에 적용하는 일"을 함께 했는데 앞의 절반만 옮겼다. 파생은 순수 함수라 Node로 검증되고,
  세터를 내보내지 않으므로 렌더러가 되돌려 쓸 수 없다. 설정이 바뀌면 `apply()`로 스냅샷을
  통째로 갈아 끼운다 — 부분 병합이 아니다.
- 조립 결과를 담는 그릇 아홉 개(`loadedMeshes`·`loadedMaterials`·`facePlates`·`bodyPlates`·
  `materialGroups`·`ears`·`headgear`·`eyeTextureSets`·`mouthTextureSets`)는
  `pet/pet-model-refs.ts`가 한 덩어리로 만든다. 로더는 이 그릇을 채우기만 하고 새로 만들지
  않는다 — 정체성이 유지돼야 색 적용·표정 전환·애니메이션이 로딩 전후로 같은 객체를 본다.
  `headPivot`·`tailPivot`은 그릇이 아니라 로딩 결과로 **재대입**되는 값이라 넣지 않았다.
  자리를 만들어 두면 빈 Group이 들어가 "아직 안 로드됨"이 조용히 정상 동작으로 바뀐다.
- 루프 이동은 준비 여섯 단계를 거친 뒤에 했다. 처음에는 주입 90·쓰기 14였고 그대로 옮기면
  의존 객체가 40개를 넘어 "이름만 바뀐 같은 코드"가 됐을 것이다. 누적 상태를 성격별
  소유자로 옮기고(깜박임·꼬리·스퀴시·상호작용) 설정 파생 값과 모델 그릇을 덩어리로 묶은
  뒤에야 이동 37개·주입 26개로 떨어졌다. **분해 순서를 정할 때 이 과정을 참고한다** —
  줄 수가 아니라 주입 심벌 수가 기준이고, 그 수를 줄이는 선행 작업이 본 작업보다 크다.
- 설정창 셸(`ui/settings/App.tsx`)이 `useState` 열여덟 개를 혼자 들고 있던 것을 성격별로 갈랐다.
  외형·커스터마이징 아홉 개와 그 미리보기·썸네일 요청은 `use-customization-state.ts`,
  로드·수정·저장 수명주기는 `use-settings-lifecycle.ts`가 소유한다. 수명주기 셋을 한 훅에
  두는 이유는 `dirty`를 공유하기 때문이다 — 로드가 끝나면 지우고, 고치면 세우고, 저장이
  끝나면 다시 지운다. `dirty`는 상태가 아니라 ref다: main이 창을 닫기 전에 `onQueryUnsaved`로
  **동기** 조회하므로 리렌더를 기다릴 수 없다.
  얼굴 미리보기와 프리셋 적용은 Draft를 함께 고쳐야 해서 셸에 남겼다 — 소유자가 갈리는 자리다.
  셸에 남은 상태는 폼 초안, 알람·즐겨찾기 목록, 앱 수준 값(폰트·키 보유 여부·활성 탭)이다.
- 창 외형을 `<html>`에 입히는 일은 `ui/lib/appearance.ts`가 갖는다(규칙은
  [AGENTS.md](../AGENTS.md#ui와-창), 범위 대조는 `test/settings-ui-appearance.test.js`).
  다른 창은 저장된 설정을 통째로 한 번 입히면 되지만(`applyWindowAppearance`), 설정창은 폼
  값이 바뀔 때마다 배율·글자 크기·폰트를 따로 반영해야 해서 낱개 함수를 쓴다. 배율이 걸리는
  창은 설정창뿐이고 나머지는 `{ zoom: false }`로 부른다 — 크기가 main에서 내용 기반으로
  정해지는 창이 있어서다.
  펫 창(`src/pet/renderer.ts`)에는 같은 폰트 적용 코드가 남아 있다. 펫 창은 제자리 emit한
  ESM을 직접 로드하고 `ui/`는 Vite 번들이라 서로 import할 수 없어 합치지 못한다.
- `ui/settings/store.ts`는 분해하지 않는다. 정규화·`draftFromSettings()`·`buildPayload()`가
  한 벌로 움직이는 설정 payload의 단일 원본이고, 쪼개면 설정 하나를 추가할 때 봐야 할 곳이
  늘어난다.
- `settings-schema.ts`를 분해 범위에 넣을지는 아직 결정하지 않았다.

펫 렌더러 TypeScript 포팅에서는 생성 JavaScript와 전환 전 원본의 AST가 동일함을 확인했다.
격리 프로필에서 기본·휴식·스퀴시·쓰다듬기·이동·AI 질문/답변·즐겨찾기·커스터마이징·팔레트
상태와 팔레트/외곽선 네 조합을 캡처해 구조를 비교했다. 애니메이션 위상과 난수 때문에 픽셀 단위
동일성은 합격 조건으로 쓰지 않는다.

2026-08-12 분해분(`87669f9`, `a8d92ba`, `71b287e`, `4c7419e`)은 소리·전역 입력·PowerShell·
패키징까지 Windows 11 실기로 확인을 마쳤다. 범위와 결과는 [CHANGELOG](./CHANGELOG.md)에 있고,
캡처로 안 보이는 경로를 어떻게 관측했는지는 아래 [검증과 캡처](#검증과-캡처)에 정리했다.

2026-08-13 분해분(`aff5b10`~`26cea5d`)도 전역 훅·DIP 좌표 변환·트레이 겹침·창 복원·즐겨찾기
표시 방식·패키징까지 Windows 11 실기로 확인을 마쳤다(결과는 [CHANGELOG](./CHANGELOG.md)).
새 트레이·우클릭 메뉴 컨트롤러는 Node 회귀와 macOS 격리 프로필 캡처를 통과했지만 Windows
Shell 연동은 다시 확인해야 한다. 남은 항목은 [Windows 실기 확인 목록](#windows-실기-확인-목록)에 있다.

## 아키텍처

| 경로 | 책임 |
|---|---|
| `src/main.ts` | Electron 창·IPC·생명주기·공유 상태 조립 |
| `src/preload.ts` | context isolation용 IPC 브리지 |
| `src/main/assistant/` | Gemini 전송, 질문·번역·요약 프롬프트와 그 IPC, 선제 대화, 기록 |
| `src/main/memory/` | 대화 이력, 에피소드, SQLite 장기 기억, 추출·검색·IPC |
| `src/main/windows/` | 체크리스트, 즐겨찾기, 펫 메뉴와 창 배치 |
| `src/main/*.ts` | 설정, 원자 저장, 알람, 모니터, 단축키 등 인프라 |
| `src/pet/` | Three.js 렌더러와 셰이더·소리·동작 계산·말풍선 패널 모듈 원본·런타임 emit, 펫 HTML·CSS |
| `ui/<창>/` | 설정·기록·메뉴·즐겨찾기·체크리스트 React 창 |
| `ui/lib/` | React 창 공용 IPC feed, 테마, preload 타입, CSS |
| `src/shared/` | 여러 프로세스·창이 공유하는 카탈로그, i18n, CSS, UMD 스크립트 |
| `assets/` | GLB 모델, 텍스처, 사운드, 앱 아이콘 |
| `test/` | Electron 없이 실행하는 Node 회귀 테스트 |

`ui/vite.config.mts`가 React 창을 `dist/ui/<창>/`에 빌드하고 `main.ts`의
`loadUiWindow()`가 로드한다. HMR은 `npm run ui:dev`와
`DANGOROBO_UI_DEV=http://localhost:5173` 조합을 쓴다.

main은 창의 `did-finish-load` 직후 초기 IPC를 보낼 수 있어 React effect 등록보다 빠르다.
`ui/lib/ipc-feed.ts`의 `createIpcFeed()`가 이벤트를 모듈 로드 시점부터 버퍼링하며, 초기
invoke 응답이 이미 받은 이벤트를 덮어쓰지 않게 한다.

모든 앱 창은 CSP를 두고 `contextIsolation: true`, `nodeIntegration: false`로 실행한다. 펫 창의
CSP만 정적 import map hash와 GLB 모델 로딩에 필요한 `blob:` 연결을 허용한다.

## 빌드와 배포 계약

`npm run build:runtime`은 두 런타임 빌드를 순서대로 실행한다.

1. `build:main`: `tsconfig.build.json`으로 main·preload·공용 TS를 같은 위치의 CommonJS
   JavaScript에 emit한다.
2. `build:pet`: `src/pet/tsconfig.json`으로 strict/noEmit 검사한 뒤
   `src/pet/tsconfig.build.json`으로 `src/pet`의 `.ts`를 같은 이름의 브라우저 ESM
   `.js`에 emit한다.

펫 emit 단계는 `Settings` 타입 import를 따라 main 모듈까지 ESNext로 다시 내보내지 않도록
`noResolve`·`noCheck`를 쓴다. 이는 앞 단계 strict 검사가 성공한 뒤에만 실행된다. 상대
import에 `.js` 확장자가 필요한 이유도 여기에 있다 — emit이 지정자를 해석하지 않고 그대로
내보낸다. `precheck`, `pretest`, `prestart`, `predist`는 이 계약을 자동으로 적용한다.
`npx electron .`처럼 npm 훅을 우회하면 `src/main/dev-build-guard.ts`가 누락되거나 오래된
main·preload·pet 산출물을 감지해 종료한다.

생성 JS는 Git·lint·TypeScript 검사·소스 ZIP에서 제외한다. electron-builder의 `files`에는
`src/**/*`와 `!src/**/*.ts`가 있어 런타임 JS는 포함하고 원본 TS는 배포 EXE에서 제외한다.
소스 ZIP은 반대로 원본 TS와 빌드 설정을 포함하고 제자리 emit, `dist`, `release`, 사용자
데이터, 비밀값, 로그, temp·rollback을 제외한다.

커스텀 얼굴·바디를 직접 그리려는 사용자에게 주는 `custom_template.zip`도 릴리스 산출물이다.
원본 PNG는 `assets/custom-template/`에 두고 `scripts/custom-template-archive.js`가 폴더 없이
평평한 ZIP으로 묶는다 — 커스텀 얼굴 가져오기가 폴더 구조를 무시하고 파일명만 보기 때문이다.
`predist`가 `template:verify`로 구성을(파일 목록과 PNG 여부) 먼저 확인하고 `postdist`가
`release/custom_template.zip`을 만든다. 이 PNG들은 앱 실행에 쓰이지 않으므로 electron-builder의
`files`에서 `!assets/custom-template/**`로 빼 배포 EXE에는 넣지 않는다. 얼굴 파일 이름의
표정 키는 `src/main/custom-face.ts`의 `CUSTOM_FACE_EXPRESSION_KEYS`와 같아야 하며,
`test/custom-template-archive.test.js`가 두 목록이 어긋나거나 원본 파일이 빠지면 실패한다.

`package.json`의 `build.publish`는 GitHub Releases(`huzithehuzi/Dangorobo_re`)를 가리킨다.
`npm run dist`는 로컬 빌드만 하고 업로드하지 않는다 — `electron-builder --publish always`로
직접 부르거나 CI에 `GH_TOKEN`을 넘겨야 실제로 릴리스에 올라간다. `electron-updater`는 릴리스에
설치용 EXE·`latest.yml`·`.blockmap`이 함께 있어야 새 버전을 인식하므로, NSIS 산출물 세 개를
빠짐없이 같은 릴리스에 올린다(electron-builder가 `dist` 시 `release/`에 셋 다 생성한다).

### 퍼블리시 절차 (실제로 검증된 순서)

```powershell
# GH_TOKEN은 User 환경변수에 저장해두고, 새 프로세스에서 명시적으로 읽어 넘긴다
# (레지스트리에 막 등록한 값은 이미 떠 있는 셸 프로세스에 자동으로 안 들어온다).
$env:GH_TOKEN = [System.Environment]::GetEnvironmentVariable("GH_TOKEN", "User")
npm run dist -- --publish always
```

- **`GH_TOKEN`은 classic PAT(`repo` scope)로 발급한다.** fine-grained PAT는 저장소별
  Repository access·Contents 권한 화면에서 설정을 다 맞춰도 `403 Resource not accessible by
  personal access token`이 재현성 있게 났다(2026-08-18에 두 번 다른 fine-grained 토큰으로
  확인). 원인을 더 파기보다 classic + `repo` 한 번에 발급하는 쪽이 확실하고 빠르다.
- **에셋 병렬 업로드 중 같은 태그로 draft 릴리스가 2개 생기는 레이스가 있다.** `electron-builder`가
  `Setup.exe.blockmap`/`Setup.exe`/`Portable.exe`/`latest.yml`을 동시에 올리면서 "release
  doesn't exist" 판단을 두 번 내려 `v{version}` 태그의 draft를 두 개 만드는 경우가 있었다.
  퍼블리시 뒤에는 항상 `GET /repos/{owner}/{repo}/releases`로 같은 태그가 중복됐는지 확인하고,
  중복이면 에셋이 적은 쪽을 지우고 나머지 쪽에 빠진 파일을 `POST
  uploads.github.com/.../releases/{id}/assets?name=...`로 채운 뒤 `PATCH .../releases/{id}`에
  `{"draft": false}`를 보내 발행한다. draft 상태로 남으면 `electron-updater`가 해당 릴리스를
  못 찾는다.
- 저장소가 private이면 fine-grained PAT의 repo 선택 화면이 먹통일 때 public으로 바꿔 우회할 수도
  있지만, 그러면 GET(읽기)만 인증 없이 뚫릴 뿐 릴리스 생성(POST)엔 여전히 쓰기 권한이 있는
  토큰이 필요하다 — 근본 원인(classic 토큰)과는 별개 문제였다.
- 다운로드된 `latest.yml`이 실제 버전과 SHA512를 담고 있는지, 설치본(0.9.0 등 이전 버전)에서
  실행 시 새 버전 다운로드 다이얼로그가 뜨는지까지 실기로 확인해야 "퍼블리시 성공"으로 본다.
- **`release/custom_template.zip`은 electron-builder가 올리지 않는다.** 자동 업로드 대상은
  `build.win.target` 산출물과 `latest.yml`뿐이라, 커스텀 템플릿 ZIP은 릴리스 발행 뒤
  `POST uploads.github.com/repos/{owner}/{repo}/releases/{id}/assets?name=custom_template.zip`로
  직접 올린다(1.0.0에서 이 단계를 빠뜨려 사후에 채웠다). 퍼블리시를 마쳤으면 릴리스의 에셋
  목록에 설치본 3종·`latest.yml`·`custom_template.zip`이 모두 있는지 확인한다.
- **릴리스 설명(release body)을 매번 아래 문구로 채운다** — electron-builder는 본문을 채우지
  않으므로 `PATCH /repos/{owner}/{repo}/releases/{id}`에 `{"body": "..."}`로 직접 넣는다.
  `Setup.exe` 파일명 부분의 버전 번호만 이번 릴리스 버전으로 바꾸고 나머지는 그대로 쓴다(한·영·일 순):

  ```
  recommend installing via Dangorobo-{version}-Setup.exe as it enables automatic updates.
  You can create a custom image by editing the files within the custom_template.zip

  Dangorobo-{version}-Setup.exe 으로 설치 시 자동 업데이트가 적용되므로 권장드립니다.
  custom_template.zip 압축 파일 내의 파일을 편집해서 커스텀 이미지를 만들 수 있습니다.

  Dangorobo-{version}-Setup.exeでのインストールは自動更新が適用されるため、推奨いたします。
  custom_template.zip圧縮ファイル内のファイルを編集して、カスタムイメージを作成できます。
  ```

### 소개 페이지(GitHub Pages)

`docs/index.html`이 GitHub Pages로 서비스되는 배포용 소개 페이지다. 앱 코드와 독립적이라 절차와
규칙을 [`SITE.md`](./SITE.md)에 따로 뒀다 — 문구·이미지·디자인을 고칠 일이 있으면 그 문서를 본다.
`docs/media/`의 이미지는 QA 캡처 하네스 산출물이고, 프리셋 프로필 생성과 여백 잘라내기는
`scripts/site-media.js`가 한다. **앱의 기능·기본값·외형이 바뀌면 이 페이지의 문구와 이미지도
같이 낡는다**는 것만 여기서 기억한다.

`src/main.ts`의 첫 import는 `src/main/legacy-user-data.ts`다. 이 side effect가 예전 userData
경로를 먼저 선택한 뒤에만 다른 main 모듈이 평가돼야 한다.

## 기능과 구현 위치

| 기능 | 주요 구현 |
|---|---|
| 설정 기본값·정규화 | `src/main/settings-schema.ts` |
| 외형 미리보기·커스터마이징 모드·프리셋·커스텀 에셋 | `appearance-ipc.ts` |
| 설정 저장·백업 내보내기/가져오기 IPC | `settings-ipc.ts` |
| 펫 창 상태 보고·우클릭 메뉴 IPC | `windows/pet-shell-ipc.ts` |
| 창 7종의 생성 옵션·이벤트 배선 | `windows/window-factory.ts` |
| 설정 저장·전체 가져오기 | `settings-save-transaction.ts`, `settings-commit-journal.ts`, `ui/settings/store.ts` |
| 펫 모델·표정·입력 반응 | `src/pet/renderer.ts`, `src/pet/styles.css` |
| 프레임 루프와 부위별 포즈 계산 | `src/pet/animation-loop.ts` |
| GLB 로딩·메시 조립·배치 규칙 | `src/pet/pet-model-loader.ts`, `pet-model-types.ts` |
| 파츠 바리에이션 메시 판별 | `src/pet/pet-model-mesh.ts` |
| 조립 결과를 담는 그릇(메시·머티리얼·플레이트·텍스처) | `src/pet/pet-model-refs.ts` |
| 즐겨찾기 창·플로팅 독 생명주기 | `windows/favorites-windows.ts` |
| 팔레트·디더링·외곽선·선 떨림 셰이더 | `src/pet/post-process-shader.ts` |
| 번역·문서 요약·이미지 리사이즈 말풍선 패널 | `src/pet/bubble-panels.ts` |
| AI 질문·답변·펫대화·즐겨찾기 말풍선 | `src/pet/assistant-panels.ts` |
| 알람음·대화 효과음·클릭음 | `src/pet/pet-audio.ts` |
| 랜덤 유휴 행동 예약·추첨·감쇠 | `src/pet/idle-routine.ts` |
| 스퀴시·기지개·유휴 이징 커브 | `src/pet/motion-curves.ts` |
| 눈 깜박임 대기·지속 타이머 | `src/pet/blink-timer.ts` |
| 꼬리 흔들림 위상·각도·굽힘 누적 | `src/pet/tail-motion.ts` |
| 스퀴시·출렁임 재생과 드래그 재트리거 | `src/pet/squish-motion.ts` |
| 쓰다듬기·축하·CapsLock·유휴·드래그 상태 | `src/pet/pet-interaction-state.ts` |
| 설정에서 파생되는 렌더 값(크기·속도·세기·간격) | `src/pet/pet-render-settings.ts` |
| 사용자 지정 팔레트 정지점·램프 픽셀 | `src/pet/palette-ramp.ts` |
| 커스터마이징 라벨 카드·팔레트 오버레이 상태 | `src/pet/customize-labels.ts` |
| 커스터마이징 라벨 좌우 배정 | `src/pet/customize-layout.ts` |
| 커스터마이징 라벨 세로 쌓기·연결선 | `src/pet/customize-label-layout.ts` |
| 프리셋 썸네일 해상도·픽셀 변환 | `src/pet/thumbnail-image.ts` |
| 프리셋 썸네일 오프스크린 자원 캐시 | `src/pet/thumbnail-resources.ts` |
| 프리셋 썸네일 실패 시 라이브 씬 복구 | `src/pet/thumbnail-render-transaction.ts`, `src/pet/renderer.ts` |
| 펫 위치·시각 경계·창 배치 | `windows/pet-position-controller.ts`, `pet-position-store.ts`, `windows/pet-window-layout.ts` |
| 커서 히트 판정(펫·머리·트레이·겹친 창) | `windows/pet-hit-area.ts`, `windows/pet-pointer.ts` |
| 펫 상시 드래그 이동 | `windows/pet-pointer.ts` |
| 전역 입력 훅 이벤트·호버·CapsLock·유휴 상태 | `input-monitor.ts`, `caps-lock-state.ts` |
| 말풍선 다섯 패널 열림 상태 | `windows/pet-bubble-panels.ts` |
| 머리 쓰다듬기 제스처 | `petting-tracker.ts`, `windows/pet-pointer.ts` |
| 알람 예약·DND 보류 큐 | `alarm-scheduler.ts`, `alarm-queue.ts`, `dnd-monitor.ts` |
| 자동 업데이트 확인·다운로드·재시작 확인 다이얼로그 | `auto-update-service.ts` |
| 날씨(Open-Meteo, API 키 불필요) | `weather-service.ts`, `alarm-queue.ts`의 `resolveAlarmForDisplay`, `windows/pet-menu-model.ts`의 `check-weather` 항목 |
| 체크리스트 | `windows/checklist.ts`, `checklist-ipc.ts`, `ui/checklist/` |
| 즐겨찾기와 아이콘 | `windows/favorites-panels.ts`, `favorites-layout.ts`, `favorite-icon-service.ts`, `favorites-ipc.ts`, `ui/favorites-*/` |
| 시스템 트레이·펫 우클릭 메뉴 | `windows/pet-menu-controller.ts`, `pet-menu-model.ts`, `ui/pet-context-menu/` |
| 전역 단축키·Mouse4/5 | `global-shortcut-manager.ts`, `main.ts` |
| 이미지 리사이즈 | `image-resize.ts` |
| 캡처·QA 명령줄 하네스 | `qa-capture.ts`, `main.ts`의 `qaCaptureContext()` |
| 미디어·전체화면·폰트 | `media-monitor.ts`, `dnd-monitor.ts`, `fonts.ts` |
| 방해 금지 시 창 숨김·복구 | `windows/dnd-visibility.ts` |
| 펫 창 마우스 통과·포커스 판단 | `windows/pet-interaction-mode.ts` |
| 설정창 즉시 미리보기·되돌리기 | `windows/settings-preview.ts` |
| AI 질문·번역·문서 요약 | `assistant/ask-gemini.ts`, `translate.ts`, `document-summary.ts`, `assistant-ipc.ts` |
| 펫의 선제 대화·기록 | `assistant/pet-chat-service.ts`, `assistant-logs*.ts`, `ui/logs/` |
| 화면 로그·대화 이력·에피소드 소유 | `assistant/assistant-history.ts` |
| 대화 이력·장기 기억 | `memory/`, `ui/settings/tabs-talk.tsx` |
| 공용 언어·테마·모션 | `src/shared/i18n.js`, `theme-*`, `ui-motion.*` |
| 설정창 숨김 "개발자" 탭(표정 강제·알림 즉시 트리거·렌더링 디버그 오버레이) | `ui/settings/tabs-dev.tsx`, `App.tsx`의 `devModeUnlocked`, `main.ts`의 `settings:dev-*` 핸들러 |

## 설정과 로컬 데이터

`src/main/settings-schema.ts`의 `DEFAULT_SETTINGS`와 `normalizeSettings()`가 설정 계약이다.
설정창은 `ui/settings/store.ts`의 `draftFromSettings()`와 `buildPayload()`에서 모든 키를
왕복한다. `test/settings-store-sync.test.js`가 누락을 잡는다.

이름보다 범위가 좁은 키가 둘 있다. `soundEnabled`는 설정창의 "알람 사운드 사용" 토글이라
알람음만 끄고, 키보드·마우스 클릭음은 각자의 `keyboardClickEnabled`·`mouseClickEnabled`가
따로 관리한다. `DEFAULT_SETTINGS.language`는 스키마 폴백일 뿐이고 새 설치의 실제 언어는
`main.ts`가 `detectDefaultLanguage(app.getLocale())`로 정한다 — QA용으로 설정 파일을 통째로
써 넣으면 이 감지를 건너뛰어 UI 언어와 창 제목이 바뀐다.

`settings:save`와 `settings:import-all`은 같은 저장 트랜잭션을 사용한다. 허용된 설정창
sender만 호출할 수 있고, 실패하면 암호화 키·설정·전역 단축키를 이전 상태로 보상한다. 암호화
키 변경은 commit journal이 설정 파일과 키 파일 사이의 크래시를 다음 시작 또는 다음 저장 전에
완료하거나 되돌린다. 저널에는 평문 API 키를 기록하지 않는다.

사용자 상태는 `src/main/atomic-file.ts`의 원자 교체·rollback·손상 격리·backup 복구 경로를
쓴다. JSON은 파싱뿐 아니라 의미 검증에도 실패하면 손상 파일로 격리한다. primary가 없고 rollback
후보가 하나면 복원하지만, 후보가 여러 개면 추측하지 않고 오류를 낸다.

새 설치의 기본 위치는 `%APPDATA%\dangorobo`다. 기존
`%APPDATA%\low-poly-desktop-pet`이 있으면 호환성을 위해 그 폴더를 계속 쓴다. 주요 데이터는
다음과 같다.

- 설정·키·복구: `pet-settings.json`, `assistant-keys.json`, `settings-save-journal.json`
- 위치·창 상태: `pet-position.json`, `checklist.json`, `favorites-panels.json`
- 대화: `assistant-logs.json`, `assistant-memory.json`, `assistant-episodes.json`,
  `assistant-memory.db`
- 사용자 에셋·요약: `custom-face/`, `custom-body/`, `custom-presets/`, `summaries/`

`custom-face/`·`custom-body/`는 **지금 펫에 적용된** 커스텀 이미지고, `custom-presets/<id>.zip`은
프리셋마다 굳혀 둔 그 프리셋의 이미지다(`custom-preset-assets.ts`). 프리셋을 저장할 때 활성
이미지를 zip으로 굳히고, 적용할 때 되돌린다 — zip인 것은 내보내는 세트 파일과 같은 형식이라
`importCustomFaceZip()`의 검증·원자적 교체를 그대로 쓰기 때문이다. 이 기능(2026-08-20) 전에
저장된 프리셋에는 zip이 없으므로, 시작할 때 `seedLegacyPresetAssets()`가 **커스텀 이미지를 쓰는
프리셋**에 한해 지금 활성 이미지를 한 번 복사해 준다(이미 파일이 있으면 건드리지 않아 여러 번
불러도 안전하다). 그마저 없는 프리셋을 적용하면 활성 이미지를 건드리지 않는다.
**프리셋 갤러리 썸네일은 그 프리셋의 커스텀 얼굴로 그린다** — main이 썸네일 요청에 프리셋별
`customFaceTexture`(normal 한 장)를 실어 보내고, 펫 창은 **그리기 전에** 텍스처 로드를 await한
뒤 프리셋마다 `customFaceTextureSet`을 갈아끼운다. 동기 렌더라 로드를 안 기다리면 빈 판이
찍히고, 표정 7종을 다 보내면 payload가 수십 MB가 된다.

`assistant-keys.json`은 Windows 보안 저장소에 묶이므로 다른 PC에서 재사용하지 않는다.

## AI와 기억

Gemini의 세 호출 경로는 의도적으로 다르다.

| 경로 | 현재 정책 | 구현 |
|---|---|---|
| 질문(펫대화 포함) | 짧은 응답, 최소 thinking, 제한 시간 뒤 강등 재시도, 안전 필터 4종 `BLOCK_NONE` | `ask-gemini.ts` |
| 번역 | 긴 출력, 최소 thinking, 명시적 안전 설정과 block reason 검사 | `translate.ts` |
| 문서 요약 | 긴 출력, low thinking, Markdown·Mermaid HTML 생성 | `document-summary.ts` |

한 경로의 안전 설정이나 block reason 처리를 다른 경로에 기계적으로 복사하지 않는다. 요청에는
로컬 날짜·시각·시간대·UTC가 들어가지만 외부 실시간 검색은 하지 않는다.

펫이 먼저 말을 거는 오프너(자동 주기·부르기·쓰다듬기 반응)는 화제를 코드가 골라 지정한다.
`pet-chat-service.ts`가 후보를 두 갈래로 나눠 두는데, 랜덤 소재 목록은 개수가 고정이라 몇 번
돌면 되풀이되므로 **여태 나눈 대화·기억을 소재로 삼는 이어가기 화제를 `PET_CHAT_CONTINUITY_CHANCE`
확률로 먼저 고른다**. 이어가기 후보는 재료가 있는 것만 넣는다(대화 이력·장기 기억·미완료 주제가
각각 별도 조건) — 재료 없이 지시만 주면 모델이 지난 대화를 지어낸다. 이어가기에는 전용 지시문을
쓴다: 랜덤 소재용 지시문은 "최근 소재를 되풀이하지 말라"고 해서 이어가라는 지시와 부딪친다.
오프너의 이력 예산이 질문 경로보다 큰 것도 같은 이유다 — 참조할 대화가 직전 한 마디뿐이면
구체적으로 말할 재료가 없다.

대화 이력은 최근 턴과 종료 시 에피소드 요약을 저장한다. SQLite 장기 기억은
`long_term_memory`, `open_loops`, `episodes`를 관리한다. `memory_key`는 아카이브된 행까지
포함해 유일하므로 삭제된 키를 다시 쓰면 기존 행을 부활시켜야 한다. 추출 시 LLM에 기존 기억을
보여 같은 의미면 키를 재사용하게 하고, 저장 단계의 높은 문자 유사도 검사는 보조 안전망으로만
쓴다. 한국어 의미 중복은 문자 겹침만으로 안정적으로 판단할 수 없다.

미완료 주제는 열린 목록을 LLM에 보여 해결된 항목을 닫고, 저장 시 `insertOpenLoop()`가 중복을
방지한다. 나이 처리는 두 단계이며 목적이 다르다: **프롬프트에는 마지막 언급이
`OPEN_LOOP_PROMPT_MAX_AGE_DAYS` 안쪽인 주제만 올리고**(`selectPromptOpenLoops()`, DB는 그대로 둔다),
`OPEN_LOOP_ARCHIVE_AGE_DAYS`를 넘긴 주제는 시작할 때 `archiveStaleOpenLoops()`가 닫아 표가
무한정 쌓이지 않게 한다. 앞은 "펫이 몇 달 전 일을 되묻지 않게", 뒤는 "표가 커지지 않게"다 —
뒤 기준을 앞 근처로 내리면 이사·자격증처럼 느리게 진행되는 일까지 닫힌다.
**펫이 미완료 주제를 소재로 삼을지 판정하는 곳도 프롬프트와 같은 필터를 쓴다** — 갈리면 지시만
가고 목록은 비어 모델이 주제를 지어낸다. 마지막 언급 시각을 못 읽는 주제는 양쪽 모두 남긴다.
자동 판정이 놓쳐 열린 채 남은 주제도 앞 필터로 함께 조용해지고, 사용자는 기억 관리 탭에서
언제든 직접 닫을 수 있다. 이름과 예약 키는 기억에 저장하지 않는다.

## 렌더링 계약

- `src/vendor/three/`는 배포 패키지에서 Three examples가 빠지는 문제 때문에 둔 공식 사본이다.
  대상은 `GLTFLoader.js`에서 상대 import를 따라간 폐포 전체이며, 사본 목록은
  `test/pet-renderer-types.test.js`가 upstream에서 직접 계산해 검증한다.
- `@types/three`, Three 런타임, vendored 구현과 `GLTFLoader.d.ts`의 minor를 맞춘다.
- GLB 메시에 직접 붙이는 텍스처는 `flipY = false`다. 얼굴 PlaneGeometry 데칼은 기본 방향이다.
- 명암은 몸·파츠·얼굴 무늬·얼굴 장식·몸 데칼에 적용하고, 눈·입·커스텀 얼굴은 표정 가독성을
  위해 unlit로 유지한다.
- 팔레트·디더링·선 떨림·외곽선은 WebGL 후처리다. DOM 말풍선에는 적용되지 않는다.
- 사용자 지정 팔레트는 밝기 0~1을 정렬된 2~8개 색 정지점 위치에 대응시켜 구간별로 보간한다.
- 팔레트와 외곽선이 모두 꺼지면 직접 렌더하고, 하나라도 켜지면 render target을 거친다.
- **외곽선 색은 커스터마이징 프리셋에 저장된다**(2026-08-20). 외곽선 사용 여부·두께는 외형 탭에
  남아 있고 색만 커스터마이징 탭으로 옮겼다. 프리셋의 `outlineColor`가 빈 문자열이면 "이 프리셋은
  외곽선 색을 바꾸지 않는다"는 뜻이다 — 이 변경 전에 저장된 프리셋을 적용했을 때 색이 기본값으로
  튀지 않게 하기 위한 것이라, 기본값으로 채우도록 바꾸면 안 된다. 프리셋 썸네일은 프리셋의
  외곽선 색으로 그린다(후처리 uniform 하나라 동기 렌더 안에서 바꿔 끼울 수 있다).
- 머리 장식은 몸을 가릴 수 있지만 머리·귀를 뚫지 않게 Three Layers와 `clearDepth()`를 쓰는
  3패스 렌더링을 한다. 직접·후처리 두 경로가 같은 `renderModelWithHeadgear()` 계약을 지킨다.
- 커서를 따라보는 좌우 각도는 머리와 몸통이 나눠 맡는다. `animation-loop.ts`가 정한 최종
  좌우 각도에서 `BODY_FOLLOW_RATIO`만 `modelRoot.rotation.y`로 돌리고 나머지를 머리에 남기므로,
  총 시선 방향은 비율과 무관하게 일정하고 목이 꺾이는 정도만 달라진다. 몸통에는 가로축만 준다 —
  위아래·기울임을 주면 발이 떠 보인다.
- 프레임률 독립 상태 전환은 `smoothStep()`, 가변 속도 주기는 누적 phase를 쓴다.
- 커스터마이징 모드의 3D 라벨 배정은 진입 시 고정하고 파츠 변경 때만 다시 계산한다.

출하 기본 외형과 정규화 폴백을 혼동하지 않는다. 신규 설치의 머리 장식은
`DEFAULT_SETTINGS.partVariations`가 정한 `choker`이며, 커스터마이징 카탈로그의
`headgear.defaultVariation === "none"`은 잘못된 저장값을 정규화할 때 쓰는 파츠별 폴백이다.

## 에셋 확장

카탈로그와 실제 파일이 항상 함께 바뀌어야 한다. ID 라벨은 `src/shared/i18n.js`의 한국어·영어·
일본어 번역을 모두 추가하고 `npm test`로 양방향 일치를 확인한다.

| 종류 | 파일·이름 규칙 | 함께 수정할 곳 |
|---|---|---|
| 귀 | `assets/models/ear/ear_<id>.glb`, 내부 메시도 `ear_<id>` | `PART_VARIATION_DEFS`, `VARIATION_LABEL_KEYS`, i18n |
| 꼬리 | `assets/models/tail/tail_<id>.glb`, 내부 메시도 `tail_<id>` | 같은 카탈로그·i18n |
| 머리 장식 | `assets/models/headgear/headgear_<id>.glb`, 내부 메시도 같은 이름 | 같은 카탈로그·i18n, 3패스 시각 QA |
| 얼굴 무늬 | `assets/textures/face_back/face_back_<n>.png` | `FACE_PATTERN_COUNT` |
| 얼굴 장식 | `assets/textures/face_cosmetic/face_cosmetic_<n>.png` | `FACE_COSMETIC_COUNT` |
| 몸 무늬 | `assets/textures/body_costume/body_costume_<n>.png` | `BODY_COSTUME_COUNT`, `flipY: false` |
| 눈 스타일 | `assets/textures/face/eye_<n>/eye_<n>_<expression>.png` | `FACE_EYE_STYLE_COUNT` |
| 입 스타일 | `assets/textures/face/mouth_<n>/mouth_<n>_<expression>.png` | `FACE_MOUTH_STYLE_COUNT` |
| 색칠 부위 | 별도 파일 없음 | `BODY_COLOR_DEFS`, i18n, `renderer.ts`의 `applyBodyColors()` |
| 알람·대화·클릭 소리 | `assets/sounds/` | `src/shared/sound-catalog.js` |
| 말풍선 테마 | CSS 변수 | `theme-catalog.ts`, i18n, `theme-vars.css`, `pet/styles.css` |

번호형 텍스처는 1부터 카탈로그 개수까지 중간 번호 없이 연속이어야 한다. 눈·입은
`normal`, `normal_blink`, `happy`, `angry`, `sad`, `alarm`, `shocked` 파일을 모두
둔다. 기존 슬롯의 표정만 사용자 이미지로 바꾸는 기능은
`customface_<expression>.png` 묶음 ZIP을 사용하며, 새 스타일 슬롯 추가와는 별개다.

몸 무늬는 `body_tex.glb` UV에 맞춘 투명 PNG다. 커스텀 바디 한 장은 카탈로그 항목이 아니라
userData의 `custom-body/custombody.png`를 쓰는 별도 기능이다.

새 색칠 부위를 카탈로그에 넣는 것만으로 머티리얼 색이 자동 적용되지는 않는다.
`applyBodyColors()`에서 실제 대상 머티리얼도 연결한다.

말풍선 테마는 공용 React 창의 `:root[data-theme="<id>"]` 블록과 펫 말풍선의
`.speech-bubble[data-theme="<id>"]` 블록을 모두 추가한다. 사용자 지정 테마는 배경·포인트·
글씨의 세 색을 저장한다.

## 검증과 캡처

일반 변경의 기준 명령은 다음과 같다.

```powershell
npm run build:runtime
npm run typecheck
npm run lint
npm run check
npm test
npm run ui:build
npm run source:verify
```

Electron 캡처는 사용자의 실행 중인 펫과 충돌하지 않도록 항상 고유 프로필을 쓴다.

```powershell
npx electron . --user-data-dir=<고유 임시 경로> --capture=<출력.png>
```

PNG 캡처는 macOS에서도 그대로 돈다(2026-08-13 확인). 펫 창 WebGL 렌더링, 후처리 네 조합,
독립 창 여섯 개까지 찍힌다. `--qa-assistant-instructions`처럼 창을 안 보는 프로브도 된다.

**`--qa-hit-test`는 macOS에서 쓸 수 없다.** `screen.dipToScreenPoint()`가 Windows 전용이라
그 자리에서 던지고 `app.quit()`까지 못 가서 앱이 뜬 채로 남는다. 같은 이유로
`screen.screenToDipPoint()`를 쓰는 커서 판정·펫 드래그 경로도 Electron으로는 확인할 수
없어, `windows/pet-pointer.ts`는 좌표 변환을 주입받아 Node 테스트로 검증한다.
uIOhook 전역 훅, PowerShell 폰트·미디어, SMTC, 트레이 겹침 판정도 Windows 전용이다.

셸 스크립트인 `npx`를 못 띄우는 환경에서는 Electron 실행 파일을 직접 부른다
(Windows `node_modules\electron\dist\electron.exe`,
macOS `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`).

현재 지원 인자의 최종 목록은 `src/main/qa-capture.ts`가 원본이다. 이 하네스는 `whenReady`가
창을 만든 뒤 한 번 호출하며, 필요한 창 핸들·설정·전환 함수를 `main.ts`의
`qaCaptureContext()`에서 전부 주입받는다.
렌더러 회귀 기본 행렬은 기본, 휴식, 스퀴시, 쓰다듬기, 이동, AI 질문, AI 답변, 즐겨찾기,
커스터마이징, 커스터마이징 팔레트다. 커스터마이징 팔레트 플래그는
`--capture-customize=<png>`와 함께 사용한다.

렌더링 검증은 팔레트·외곽선 ON/OFF 네 조합으로 직접 렌더와 후처리 경로를 모두 확인한다.
애니메이션 위상, 깜박임, 쓰다듬기 하트 난수 때문에 픽셀 차이 0을 요구하지 말고 창 크기,
모델 비율·위치, 색·텍스처, 후처리, 오클루전, 말풍선과 라벨의 구조를 비교한다. 커스터마이징
라벨의 좌우 배치는 진입 시점 머리 포즈로 정해져 실행마다 달라지므로 회귀로 보지 않는다.

프레임 루프는 다음 프레임을 전역 `requestAnimationFrame`으로 예약하므로, 이를 가로채
콜백을 붙잡아 두면 프레임을 한 칸씩 손으로 돌릴 수 있다. `THREE.Clock` 대신 델타를 직접
먹이는 시계를 주입하면 프레임률 독립성이나 위상 누적 같은 시간축 성질을 결정적으로 잰다.
하네스를 둘 이상 쓸 때는 전역을 붙잡아 두지 말고 예약이 일어나는 호출 동안에만 바꿔 낀다.

소리·전역 훅·트레이는 캡처에 안 잡히므로 관측 지점을 따로 잡는다.

- 소리: 펫 창에서 `pet-audio.js`를 그대로 import해 `AudioBufferSourceNode.prototype.start`와
  `Audio` 생성을 후킹하면, 실제 디코딩된 버퍼와 재생 진행(`currentTime`)을 코드 수정 없이 읽을
  수 있다. `AudioContext.outputLatency`가 0보다 크면 실제 출력 장치가 열린 것이다.
- 전역 훅: 입력은 `SendInput`으로 합성하면 uIOhook이 그대로 받는다. 펫 창이 마우스를 받는지는
  `setIgnoreMouseEvents()`가 바꾸는 확장 스타일 `WS_EX_TRANSPARENT`로 밖에서 읽을 수 있고,
  상태 전이는 `window-debug.log`의 `applyMouseInteractionState` 줄에도 남는다.
- 실기 자동 관측은 앱을 `--inspect`로 띄워 인스펙터 `Runtime.evaluate`로 창 bounds·webContents를
  읽으면서 `SendInput` 합성 입력을 보내는 조합이 실제로 동작한다(2026-08-13 검증에 사용).
  인스펙터 전역에는 `require`가 없어 `process.mainModule.require`를 쓰고, 비동기 식은
  `awaitPromise`와 함께 `replMode`를 꺼야 Promise가 `{}`로 직렬화되지 않는다. 프레임 있는
  창(설정창)의 DOM 좌표를 물리 좌표로 바꿀 때는 제목줄이 포함된 `getBounds()`가 아니라
  `getContentBounds()`를 기준으로 한다. preload 브리지의 `on*` 콜백은 리스너를 덧붙일 수
  있어서, 펫 창에 관측용 리스너를 추가하면 IPC 도착(스퀴시·클릭음·쓰다듬기·CapsLock)을
  코드 수정 없이 셀 수 있다.
- 히트 판정 값 자체가 필요하면 `--inspect`로 붙어 `isPointOverTrayIcon()`에 중단점을 걸고 그
  프레임에서 `isPointOverPet()`·`tray()?.getBounds()`를 평가한다.
- 펫 위에 겹치는 UI(미디어 플레이어 등)를 켜 두면 호버 관측이 오염된다. 히트 영역을 재는
  동안에는 꺼 둔다.
- 말풍선의 상태 전이(닫기, Escape, 모드 카드 동기화, 상호 배타)는 캡처가 한 장면만 찍어서
  안 잡힌다. 펫 창을 띄운 별도 스크립트에서 `webContents.send()`로 `assistant:question-open`·
  `favorites:open`·`pet-chat:open`을 순서대로 보내고 매 단계 `hidden` 값을 덤프하면 전이 표를
  통째로 비교할 수 있다.
- 질문창·펫대화 캡처는 입력창에 `focus()`를 걸어서, 캡처가 도는 동안 친 키가 그대로 들어간다.
  찍는 중에는 키보드를 건드리지 않는다.

배포 전에는 Windows에서 portable EXE를 직접 실행하고 소스 ZIP에 원본 TS와 빌드 설정이 있으며
제자리 JS emit, 사용자 데이터, 키, 로그가 없는지 확인한다.

## Windows 실기 확인 목록

2026-08-13 분해분(`aff5b10`~`26cea5d`)의 Windows 11 실기 확인은 끝났다(범위와 결과는
[CHANGELOG](./CHANGELOG.md)). 배율 1.5 주모니터 + 1.0 보조 모니터 구성에서 드래그·호버·
쓰다듬기·우클릭 메뉴·CapsLock·Mouse4·말풍선 배타·독 생명주기·"저장 안 함" 대화·트레이 겹침
배제·창 위치 재실행 복원·표시 방식 4종·portable EXE·소스 ZIP까지 통과했다. 이후 분해분을 포함해
아래 항목이 남아 있다.

`release/`의 EXE는 2026-08-10 빌드라 그 뒤의 변경이 하나도 들어 있지 않다. **실기 확인은
`npm run dist`로 다시 만든 산출물이나 `npm start`로 해야 한다** — 남아 있는 EXE로 확인하면
고치기 전 코드를 검증하게 된다.

| 남은 항목 | 관련 모듈 | 막힌 이유 |
|---|---|---|
| 입력 상태 소유권 이전 | `input-monitor.ts`, `caps-lock-state.ts`, `main.ts` | 합성 입력·가상 시간·주입한 PowerShell 경계의 Node 회귀는 통과. 실제 Windows에서 펫·미디어 호버의 네이티브 클릭스루 전환, 시작 직후 CapsLock 입력과 초기 조회 경합, 기능을 끈 뒤 예약된 호버 해제 취소를 다시 확인해야 함 |
| 트레이·펫 우클릭 메뉴 컨트롤러 | `windows/pet-menu-controller.ts`, `window-factory.ts` | Node 회귀와 macOS 격리 프로필 전후 동일 캡처는 통과. 실제 Windows Shell의 트레이 우클릭·팝업 바깥 닫기·툴팁 갱신 중 포커스·트레이 겹침 배제를 다시 확인해야 함 |
| AI 질문·번역·요약을 포함한 말풍선 5종 배타 | `windows/pet-bubble-panels.ts` | Gemini API 키 필요. 배타 로직은 Node 테스트가 커버하고, 실기로는 즐겨찾기↔리사이즈 양방향만 확인했다 |
| 펫 창 로드와 꼬리 굽힘 | `src/pet/pet-model-mesh.ts`, `animation-loop.ts` | 파츠 바리에이션 메시 판별을 로더에서 잎 모듈로 뺐다. 순수 이동이고 Node 회귀 34개가 붙었지만 **모듈 그래프가 바뀌었으므로 펫 창이 실제로 뜨는지 눈으로 봐야 한다** — Three 사본 누락 때 타입 검사·회귀·캡처가 전부 통과하고도 빈 화면이 됐던 전례가 있다. 꼬리 바리에이션 3종(round·cat·antenna)의 굽힘도 함께 본다 |
| 설정창 배율·글자 크기 미리보기 | `ui/lib/appearance.ts`, `ui/settings/App.tsx` | 설정창이 갖고 있던 외형 적용 사본을 창 공용 모듈로 합치면서 **배율에 없던 클램프(70~150)를 새로 넣었다**. 범위 밖 값을 쳤을 때 창이 그 배율로 커지지 않고 저장이 입력 검증에 막히는지, 배율·글자 크기·폰트 미리보기가 그대로 동작하는지 확인한다. 같은 모듈을 쓰는 나머지 창 4종 중 우클릭 메뉴·체크리스트·즐겨찾기 창은 글자 크기가 실제로 커져 있던 것을 찾아 고쳤다(2026-08-14, [CHANGELOG](./CHANGELOG.md)). 플로팅 독은 Tailwind 유틸리티가 아니라 자기 CSS로 크기를 정해 바닐라 구현과 규칙이 같고 파이 캡처도 정상이다 |
| 즐겨찾기 창·플로팅 독 컨트롤러 | `windows/favorites-windows.ts` | Node 회귀 32개는 통과했지만 창 객체와 `screen`을 흉내 낸 것이라 **실제 창 파괴 타이밍과 다중 모니터 작업 영역은 보지 못한다**. 표시 방식을 dock↔cursor로 오갈 때 독이 실제로 파괴되고 다시 만들어지는지, 화면 구석에서 펼쳤다 접을 때 자리가 유지되는지, 배율이 다른 모니터로 끌었을 때 파이 크기가 어긋나지 않는지 확인한다 |

## 알려진 제약

- PowerShell 폰트·CapsLock, SMTC 미디어, 전체화면 DND, uIOhook Mouse4/5, globalShortcut의
  OS 점유는 Windows 11에서 동작을 확인했다. 다만 Windows 버전과 셸 구성에 따라 달라지는
  경로라 이쪽을 고칠 때마다 실기로 다시 확인한다.
- `npm test`는 Windows 기준이다. `test/favorites-ipc.test.js`의 대상 선택 테스트가 Windows
  경로(`C:\...`)를 넣고 `path.basename`을 기대하므로 POSIX에서는 이 한 건이 실패한다.
- 트레이 아이콘은 Windows 11에서 기본적으로 숨겨진 아이콘 오버플로에 들어간다. 겹침 판정은
  아이콘을 작업 표시줄에 꺼낸 상태에서만 검증했고, 숨겨진 상태에서 `tray.getBounds()`가
  무엇을 가리키는지는 확인하지 않았다.
- Mouse4/5 단축키는 uIOhook가 입력을 삼키지 않아 포커스된 앱의 뒤로/앞으로 동작도 함께
  실행될 수 있다.
- 전체화면 DND는 Windows 알림 상태를 이용해 일부 앱을 전체화면으로 오인할 수 있다.
- 펫이 다른 topmost 창 아래로 내려가거나 전체화면 게임 복귀 후 숨는 현상은 장시간 실사용
  관찰이 필요하다. 렌더러/GPU 종료 이벤트는 `window-debug.log`에 기록한다.
- 창 순서가 뒤섞이던 현상의 원인은 2026-08-15에 `setFocusable()` 반복 호출로 좁혔지만
  (위 `pet-interaction-mode.ts` 항목), 진짜 전환일 때는 여전히 Electron이 `Deactivate()`를
  부른다. 휴식 알림·말풍선·이동 모드처럼 사용자가 일으키는 드문 전환만 남았으므로 실사용
  관찰로 재발 여부를 확인한다. 펫이 가라앉는 것 자체(30초 `moveTop()` 워치독이 되돌린다)는
  별개 문제로 남아 있다.
- 실제 Gemini 질문·번역·문서 요약과 기억 추출·open loop 판정은 API 키와 네트워크가 필요한
  수동 검증 영역이다. 2026-08-20에 고친 두 가지(모델이 `thinkingConfig`를 모를 때의 호환
  재시도, 오프너 프롬프트의 언어 고정)도 응답을 흉내 낸 테스트로만 확인했다 — 실제 키로
  "부르기"를 눌러 영어·일본어 환경에서 첫마디 언어를 한 번 봐 두면 좋다.
- 프리셋 갤러리 썸네일은 **머리만** 그리므로 프리셋별 커스텀 **바디** 이미지는 썸네일에
  나타나지 않는다(적용하면 펫에는 반영된다). 표정도 normal 한 장만 보내므로 다른 표정의
  커스텀 얼굴은 썸네일로 확인할 수 없다.
- 문서 요약은 모델이 Mermaid를 생략하거나 원시 SVG를 출력할 수 있다.
- HSV 축별 팔레트 양자화는 특정 경계에서 색 선택이 직관적으로 움직이지 않을 수 있다.
- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)에 알람·클릭 사운드의 정확한 출처 URL과
  라이선스가 아직 보완되지 않았다. 배포 전 해결해야 할 법적 고지 항목이다.

## 백로그

- 질문·펫대화의 차단 이유 표시: 이 경로는 `promptFeedback.blockReason`을 보지 않아, 안전 필터에
  걸리면 응답이 빈 문자열이 되고 사용자에게는 "AI 모델이 빈 답변을 보냈습니다"로만 뜬다.
  번역 경로처럼 이유를 붙여 보여줄지 검토한다(`translate.blockedError`가 선례). 필터 수준과는
  무관한 진단 개선이다 — 2026-08-14에 안전 필터를 `BLOCK_NONE`으로 내렸으므로 걸리는 빈도
  자체는 줄었지만, 남은 차단은 여전히 원인 없는 실패로 보인다.
- CI: 현재 정적 검사만 실행한다. `npm run dist`, portable EXE·소스 ZIP 구성 검사, 패키징
  artifact 업로드와 Electron QA 캡처·실행 smoke를 자동화할지 결정한다.
- 문서 요약: 문서 유형별 Mermaid, 정량 차트, 이미지 생성 지원 검토
- 장기 기억: 임베딩 기반 의미 검색·중복 판정, 다중 사용자 지원
- TypeScript: 지원되는 parser가 준비되면 TS ESLint AST 규칙 검토
- 빌드: main 제자리 emit을 outDir로 옮길 때 package main, preload, 자산 경로와 패키징을 함께 검증
- 모듈: Electron main의 native ESM 전환은 초기화·preload를 Windows 실기로 검증한 뒤 결정
- 입력 사운드: `active-win`은 Windows에서 `executableName`이 비고 배포물에 불필요한 macOS
  helper를 포함해 제거했다. 신뢰할 수 있는 Windows foreground 앱 감지 수단이 생길 때만
  앱별 필터링을 다시 검토한다.
- 꼬리: 정점마다 굽힘 각도가 달라 원본 노멀을 같은 각도로 회전하는 방식은 근사치다.
  cat·round·antenna 꼬리를 고정 굽힘·조명으로 캡처하는 수단을 먼저 만든 뒤 매 프레임
  `computeVertexNormals()` 제거 가능성을 검토한다.
