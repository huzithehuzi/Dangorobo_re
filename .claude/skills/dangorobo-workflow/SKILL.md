---
name: dangorobo-workflow
description: Dangorobo(Electron + TypeScript + Three.js + React 데스크톱 펫) 저장소에서 코드·에셋·설정·문서를 작성/수정/디버깅할 때 사용. 저장소 루트에 AGENTS.md와 docs/DEVELOPMENT.md가 있거나 사용자가 "이 프로젝트", "펫 앱", "데스크톱 펫", "당고로보"를 언급하면 적용한다 — 파츠·에셋 추가, 버그 수정, 설정 추가, 렌더링·UI 변경, 리팩터링처럼 사소해 보이는 요청에도 포함. 프로젝트 문서(AGENTS.md / docs/DEVELOPMENT.md)를 규칙의 원본으로 삼고, 런타임 빌드 후 검사·테스트와 실제 창 확인으로 검증한 뒤 작업 하나가 끝날 때마다 한글 제목으로 즉시 커밋하며, 의미 있는 작업이면 해당 역할의 문서를 함께 갱신한다.
---

# Dangorobo 작업 워크플로우

**Windows용 Electron 데스크톱 펫** 저장소 하나에만 적용되는 절차다.
(예전 이름은 "Low Poly Desktop Pet", 예전 저장소 폴더 이름은 `littledesktoppet`이다.)

이 스킬은 **절차**를 담고, **사실**은 담지 않는다. 아래 요약도 결국 저장소 문서의 사본이라
낡을 수 있으니, 충돌하면 **항상 저장소 문서와 코드가 맞다**.

## 0. 시작 전

1. **`AGENTS.md`를 매번 전체 읽는다.** 세션 초반에 읽었든 오래전에 읽었든 다시 읽어라 — 자주 바뀐다.
2. **`docs/DEVELOPMENT.md`에서 필요한 범위만 읽는다**(약 500줄). 맨 앞의 "단일 원본" 표와
   "현재 상태와 다음 작업"은 통째로 읽고, 나머지는 건드릴 주제로 `grep -n "키워드" docs/DEVELOPMENT.md`
   한 뒤 그 줄 범위만 읽는다. 여기에 아키텍처, 기능별 구현 위치, 설정·로컬 데이터, 렌더링 계약,
   에셋 확장 절차, 검증·캡처, Windows 실기 확인 목록, 알려진 제약, 백로그가 모두 있다.
3. "언제 무엇을 왜 이렇게 고쳤다"가 필요하면 `docs/CHANGELOG.md`(날짜별, 최신이 맨 위)를 본다.
4. 사용자에게 보이는 기능·문구는 `README.md`(+ `README.en.md` / `README.ja.md`)가 원본이다.

**문서보다 먼저인 원본이 있다.** 값이 궁금하면 문서를 믿지 말고 이쪽을 읽는다.

| 알고 싶은 것 | 원본 |
|---|---|
| 버전·의존성·스크립트·패키징 | `package.json` |
| 설정 타입·기본값·정규화·클램프 | `src/main/settings-schema.ts` |
| 파츠·색·개수 상수·사운드·테마 목록 | `src/shared/*-catalog.*` |
| 설정창 저장 payload | `ui/settings/store.ts` |
| 캡처·QA 실행 인자 | `src/main/qa-capture.ts` |
| 소스 ZIP 구성 | `scripts/source-archive.js` |
| 회귀 범위·테스트 수 | `test/`, `npm test` 출력 |

## 1. 특히 자주 놓치는 함정

전체 원칙은 `AGENTS.md`에 있다. 아래는 **틀렸을 때 조용히 절반만 작동하거나, 검사를 모두
통과하고도 앱이 안 뜨는** 것들이라 따로 적어둔다.

- **`.js`를 고치면 안 된다.** `src/main.js`, `src/preload.js`, `src/main/**/*.js`, `src/pet/*.js`,
  `src/shared/theme-catalog.js`는 TypeScript의 **제자리 emit 산출물**이고 Git이 무시한다.
  원본은 같은 이름의 `.ts`다. 산출물을 고치면 다음 빌드에 조용히 지워지고, 워킹 트리에 남은
  변이는 눈에 띄지 않는다. (`src/shared/`의 나머지 `.js`와 `src/vendor/`는 원본이다.)
- **펫 모듈끼리의 상대 import는 `./이름.js`처럼 확장자까지 적는다.** 검사 설정은 통과시키지만
  emit이 지정자를 그대로 내보내서 **펫 창만** 로드에 실패한다. `test/pet-renderer-types.test.js`가 막는다.
- **개수 상수·파츠 목록은 이제 `src/shared/*-catalog.*` 한 곳이다.** 리팩토링 전처럼
  `main.js`와 `renderer.js` 양쪽에 올릴 필요가 없다. 대신 **i18n 라벨(한국어·영어·일본어 전부)과
  실제 에셋 파일, 회귀 테스트**를 함께 갱신한다 — 번호형 텍스처는 1부터 중간 번호 없이 연속이어야 한다.
- **새 설정은 다섯 곳을 같이 고친다**: `DEFAULT_SETTINGS`(`settings-schema.ts`),
  `normalizeSettings()`, 저장 트랜잭션(`settings-save-transaction.ts`),
  설정 UI(`ui/settings/store.ts`의 `draftFromSettings()`·`buildPayload()`), 렌더러 적용 경로.
  숫자·열거형·색·문자열은 main에서 반드시 정규화/범위 제한. `test/settings-store-sync.test.js`가 누락을 잡는다.
- **미리보기 클램프와 저장 클램프를 어긋나게 두지 않는다.** `ui/lib/appearance.ts`의 배율·글자 크기
  허용 범위 상수는 `settings-schema.ts`의 클램프와 같아야 한다. 어긋나면 창이 범위 밖 배율로 커진 채
  저장은 검증에 막혀 되돌리기 어려워진다.
- **GLB 메시 이름과 파일명이 정확히 일치해야 한다.** 안 맞으면 렌더링 에러가 아니라 콘솔 경고만
  뜨고 조용히 무시된다. GLB에 직접 붙이는 텍스처는 `flipY = false`, 코드가 만든 얼굴
  PlaneGeometry 데칼은 기본 방향이다.
- **Three를 올리면 `src/vendor/three/` 사본을 폐포 전체로 다시 맞춘다.** upstream이 새 상대
  import를 추가하면 그 파일만 404가 나 **펫 창이 통째로 안 뜨는데 타입 검사·테스트·캡처는 전부 통과한다.**
- **하위 호환성**: 기존 `pet-settings.json`과 로컬 사용자 데이터를 그대로 읽을 수 있어야 하고,
  새 기능 기본값은 기존 사용자의 화면·동작을 바꾸지 않도록 보수적으로 정한다.
  사용자 상태 파일은 `src/main/atomic-file.ts`로 저장한다(`fs.writeFileSync` 직접 사용 금지).
- **타이머를 임의로 초기화하지 않는다.** 외형·문구·사운드만 저장할 때는 진행 중인 휴식/알람
  타이머를 건드리지 않는다. 휴식 간격이나 기능 활성화가 바뀐 경우에만 일정을 재계산.
- **말풍선 위치를 바꿀 때 펫 창을 움직이지 않는다** — 투명 상단 공간 안에서 DOM 위치만 조절.
- **상태를 모듈로 옮길 때는 세터를 주입하지 말고 소유권을 넘긴다.** 모듈이 값을 갖고 엔트리가
  getter로 읽는 형태만 분해다. 세터 여럿을 주입하면 이름만 바뀐 같은 코드가 된다.
- **사용자 자산을 건드리지 않는다.** 사용자가 만든 텍스처·아이콘·사운드를 임의로 교체하지 않고,
  관련 없는 기존 변경이나 사용자 파일을 되돌리지 않는다.

## 2. 검증

커밋 전, 적용 가능한 것을 모두 실행한다. `precheck`·`pretest`·`prestart`·`predist`가
런타임 빌드를 자동으로 앞세우므로 순서를 임의로 바꾸지 않는다.

```powershell
npm run build:runtime
npm run typecheck
npm run lint
npm run check
npm test
npm run ui:build
npm run source:verify
```

그리고 바꾼 영역에 맞게(자세한 규칙은 `AGENTS.md`의 검증 섹션과
`docs/DEVELOPMENT.md`의 "검증과 캡처"):

- **UI/파츠 변경** → 실제 창을 캡처해 배치·활성화 상태를 눈으로 확인
- **렌더링/셰이더 변경** → 팔레트·외곽선 ON/OFF **네 조합**(직접 렌더 경로 + render target 경로)과
  투명 배경 확인
- **펫 모듈의 import 그래프가 바뀐 변경** → 실제 펫 창이 뜨는지 반드시 눈으로 확인
- **휴식/알람 변경** → 즉시 알림 테스트 + 카운트다운 확인
- **Windows 전용 경로**(PowerShell·SMTC·DND·uIOhook·globalShortcut·`screenToDipPoint`) →
  실기로 확인하지 못했으면 **미해결 검증으로 명시**한다

캡처는 항상 **고유 프로필**로 띄운다. 사용자의 펫이 실행 중이면 single-instance lock 때문에
캡처가 조용히 실패한다.

```powershell
npx electron . --user-data-dir=<고유 임시 경로> --capture=<출력.png>
```

지원 인자의 최종 목록은 `src/main/qa-capture.ts`가 원본이다. QA용 설정 파일을 손으로 일부만
만들지 말고 `DEFAULT_SETTINGS`에서 파생한다 — 빠진 키가 있으면 멀쩡한 코드도 고장처럼 보인다.
PowerShell 5.1의 `Out-File -Encoding utf8`은 BOM을 붙여 `JSON.parse`가 조용히 실패하므로
`[System.IO.File]::WriteAllText`를 쓴다.

새 테스트는 변이 검사로 실제로 무는지 확인한다. 다만 **빌드 산출물(`.js`)을 고쳐 변이시키지 않고**,
변이 뒤에는 `npm run build:main`으로 되돌린다.

## 3. 커밋 — 작업 하나가 끝날 때마다 즉시

사용자의 명시적 요청 없이도 **기능/수정 단위 작업이 끝나면 바로 커밋한다.** 모아두지 않는다.

- 메시지: **한글 제목으로 간단명료하게**. 필요하면 본문에 짧은 한글 설명.
  - 예: `"펫 위치 보정을 컨트롤러로 이전"`, `"헤딩 렌더링 버그 수정"`, `"귀 파츠 panda 추가"`
- **push는 하지 않는다.** 사용자가 명시적으로 "push해줘"라고 할 때만.
- 산출물 `.js`는 Git이 무시하므로 커밋에 섞일 일이 없다. 섞였다면 `.gitignore`를 확인할 신호다.

## 4. 문서 갱신 — 역할에 맞는 문서에만

`AGENTS.md`의 "문서와 배포" 절이 원본이다. 요약하면:

| 쓸 내용 | 넣을 곳 |
|---|---|
| 작업 규칙, 반드시 지켜야 할 불변조건, 검증 절차 | `AGENTS.md` |
| 현재 구조·기능 구현 위치·설정/로컬 데이터·렌더링 계약·에셋 절차·제약·백로그 | `docs/DEVELOPMENT.md` |
| "언제 무엇을 왜 이렇게 고쳤다" | `docs/CHANGELOG.md` (맨 위에 날짜 h2) |
| 사용자에게 보이는 기능·버전 | `README.md` + `README.en.md` + `README.ja.md` (3종 동시) |
| 외부 라이브러리·에셋 라이선스 고지 | `THIRD_PARTY_NOTICES.md` |

- **오타·포맷·아주 작은 수정은 문서를 건드리지 않고 커밋만** 한다. 판단이 애매하면
  `docs/CHANGELOG.md`의 기존 항목 규모를 기준으로 본다 — 거기엔 원인/수정/영향 범위와 변이 검사
  결과가 있는 항목들이 실려 있고 한두 줄짜리 사소한 수정은 없다.
- **같은 사실을 두 문서에 복사하지 않는다.** 사양이 바뀌면 `docs/DEVELOPMENT.md`의 그 문장을
  **고치고**, `docs/CHANGELOG.md`에는 바꾼 이력만 새로 적는다.
- **파일 수·테스트 수·설정 키 수·에셋 개수처럼 자주 바뀌는 값은 문서에 쓰지 않는다.** 코드나
  테스트 출력을 원본으로 링크한다.
- 버전이 바뀌면 `package.json`·`package-lock.json`과 README 3종을 함께 맞춘다.
- 에셋 하나를 추가한 것뿐이면 `docs/DEVELOPMENT.md`의 "에셋 확장" 절차는 안 건드린다 —
  "방법"이 안 바뀌었으면 갱신 대상이 아니다.

## 5. 문서 지도

| 파일 | 역할 | 읽는 방식 |
|---|---|---|
| `AGENTS.md` | 작업 규칙·불변조건·검증 | 매번 전체 |
| `docs/DEVELOPMENT.md` | 구조·기능 위치·에셋 절차·제약·백로그 | 앞부분 전체 + **grep으로 해당 섹션만** |
| `docs/CHANGELOG.md` | 날짜별 완료 이력 | 필요할 때만 |
| `README.md` / `.en` / `.ja` | 사용자용 기능 설명 | 사용자 문구 작업 시 |
| `THIRD_PARTY_NOTICES.md` | 법적 고지 | 의존성·에셋 추가 시 |
