# 소개 페이지 안내

`docs/index.html` 하나로 된 배포용 소개 페이지를 고칠 때 보는 문서다. **이 페이지는 앱 코드와
아무 관계가 없다** — 앱을 빌드하지 않아도 고칠 수 있고, 여기를 고쳐도 앱은 바뀌지 않는다.
반대로 앱의 기능·기본값이 바뀌면 이 페이지의 문구와 이미지가 조용히 낡으므로 그때는 같이 손봐야 한다.

앱 쪽 작업 규칙은 [`../AGENTS.md`](../AGENTS.md), 앱 구조와 기능 위치는
[`DEVELOPMENT.md`](./DEVELOPMENT.md)에 있다.

## 어디에 있고 어떻게 배포되나

| | |
|---|---|
| 주소 | `https://huzithehuzi.github.io/Dangorobo_re/` |
| 발행 설정 | 저장소 Settings → Pages → Deploy from a branch → `main` / `/docs` |
| 페이지 | `docs/index.html` (CSS·JS 전부 이 파일 안에) |
| 이미지 | `docs/media/` |
| `docs/.nojekyll` | Jekyll 전처리를 끈다. 지우면 안 된다 |

GitHub Pages는 발행 소스로 **저장소 루트와 `/docs`만** 받는다. 그래서 개발 문서와 같은 폴더에
있다 — 옮기고 싶어도 하위 폴더는 지정할 수 없다. `main`에 push하면 1~2분 뒤 반영된다.

같은 폴더의 `.md` 파일들도 함께 서빙되지만(`/DEVELOPMENT.md` 등) 링크를 걸어두지 않았고 원래
공개 저장소라 그대로 둔다.

## 고치고 바로 확인하기

로컬에 정적 서버를 띄워 보는 게 가장 빠르다. `file://`로 열면 되긴 하지만 실제 배포와 조건이
달라져서(상대 경로·폰트) 권장하지 않는다.

```bash
npx serve docs
```

`serve`가 없으면 Node로 열어도 된다 — 페이지는 빌드 과정이 없으니 파일을 고치고 새로고침하면 끝이다.

## 문구 고치기

문구는 전부 `<script>` 안 `I18N` 객체 한 곳에 모여 있고, 마크업의 속성으로 꽂힌다.

- `data-i18n="키"` — 텍스트만 넣는다(`textContent`).
- `data-i18n-html="키"` — 태그가 섞인 문구(`innerHTML`). 지금은 제목의 `<br>`과 강조 `<span class="hl">`에 쓴다.

**세 언어를 반드시 같이 고친다.** `ko` / `en` / `ja` 중 하나만 고치면 나머지 언어에서 옛 문구가
그대로 남는다. 방문자의 브라우저 언어로 처음 언어가 정해지고, 고른 언어는 `localStorage`에 남는다.

빠뜨린 키가 없는지는 페이지를 열어둔 채 콘솔에서 확인한다:

```js
const used = [...document.querySelectorAll('[data-i18n]')].map(e => e.dataset.i18n)
  .concat([...document.querySelectorAll('[data-i18n-html]')].map(e => e.dataset.i18nHtml));
['ko','en','ja'].forEach(l => console.log(l, [...new Set(used)].filter(k => I18N[l][k] === undefined)));
```

세 줄 모두 빈 배열이어야 한다. 반대로 `I18N`에만 있고 마크업에 없는 키는
`band.metaVer`(스크립트가 직접 쓴다) 하나뿐이다.

### 표현 규칙

- **제품을 종으로 부르지 않는다.** 파츠와 색을 바꾸면 고양이가 아니게 되므로 "펫 / pet / ペット"로
  쓴다. 앱 안의 파츠 이름("고양이 귀" 등)은 카탈로그 용어라 그대로 두고, 이건 소개 문구에만
  적용되는 규칙이다.
- **"로우폴리"보다 "레트로 감성"을 앞세운다.** 픽셀·디더링·색 단계 제한으로 옛 게임 같은 질감을
  내는 쪽이 지금 이 앱의 성격에 더 가깝다. README 3종과 `package.json`의 `description`도 같은 표현을 쓴다.
- 버전 번호를 문구에 직접 적지 않는다 — 아래 "버전 문구" 참고.

### 버전 문구

다운로드 배너 아래 한 줄은 GitHub API(`releases/latest`)로 최신 태그를 읽어
`band.metaVer`의 `{v}`를 채운다. 레이트 리밋에 걸리거나 오프라인이면 정적 문구(`band.meta`)가
그대로 남는다 — **그래서 두 문구를 다 손봐야 한다.** 이 방식이라 릴리스를 새로 내도 페이지를
고칠 필요가 없다.

## 이미지 다시 찍기

`docs/media/`의 이미지는 전부 **QA 캡처 하네스 산출물이다.** 손으로 스크린샷을 찍지 않는다.
지원 인자의 최종 목록은 `src/main/qa-capture.ts`가 원본이다.

펫 외형, 설정창 UI, 즐겨찾기 파이 메뉴가 크게 바뀌면 해당 이미지를 다시 뽑아야 실제 앱과
어긋나지 않는다.

### 공통 규칙

- **반드시 고유한 `--user-data-dir`로 띄운다.** 사용자의 펫이 실행 중이면 single-instance lock
  때문에 캡처가 조용히 실패한다.
- 캡처 전에 런타임 빌드가 최신이어야 한다(`npm run build:runtime`). `npx electron .`은 npm 훅을
  우회하므로 `dev-build-guard`가 오래된 산출물을 잡아 종료시킬 수 있다.
- 찍은 PNG는 투명 여백이 크게 남으므로 잘라서 넣는다.

### 일반 화면

| 파일 | 인자 |
|---|---|
| `pet.png` | `--capture=<출력>` |
| `rest.png` | `--capture-rest=<출력>` |
| `dock.png` | `--capture-favorites-dock=<출력>` |
| `customize.png` | `--capture-customize=<출력>` |
| `settings.png` | `--capture-settings=<출력> --capture-settings-tab=appearance` |

```powershell
npm run build:runtime
npx electron . --user-data-dir=<고유 임시 경로> --capture-rest=<출력.png>
```

설정창은 `--capture-settings-tab=customization`으로 찍으면 프리셋 썸네일이 "미리보기 준비 중"
상태로 잡힌다. 그래서 지금 이미지는 `appearance` 탭이다.

### 프리셋 3종

`--capture`는 그 프로필의 설정을 그대로 그린다. 프리셋별 프로필을 만들어 각각 찍는다 —
`pet-settings.json`은 **반드시 `DEFAULT_SETTINGS`에서 파생시킨다**(키를 손으로 골라 담으면
빠진 키 때문에 멀쩡한 앱이 고장난 것처럼 찍힌다). 그 일을 하는 스크립트가 저장소에 있다.

```powershell
npm run build:runtime
node scripts/site-media.js profiles <프로필 루트>
# 위 출력의 폴더마다 한 번씩
npx electron . --user-data-dir=<프로필 루트>\<프리셋 id> --capture=<출력\이름.png>
node scripts/site-media.js crop <입력 폴더> <출력 폴더>
```

파일 이름은 `preset-cherry.png` / `preset-miro.png` / `preset-loro.png`이고, 페이지에서는 이름
없이 이미지만 쓴다 — 이 단락은 "색과 파츠만으로 이만큼 달라진다"만 보여주는 자리다.

### 알려진 한계

화면 캡처에는 **한국어 UI 문구가 박혀 있어** 영어·일본어로 전환해도 그대로다. 언어별로 캡처
세트를 3벌 유지하는 비용이 더 크다고 보고 감수한 부분이다. 언젠가 바꾸려면 `--capture-*`를
언어별 프로필(`pet-settings.json`의 `language`)로 세 번씩 돌리면 된다.

## 디자인 약속

색은 `:root`의 CSS 변수로만 쓴다. 새 색을 하드코딩하지 말고 토큰을 늘린다.

| 토큰 | 쓰임 |
|---|---|
| `--bg` `--bg-2` `--surface` `--surface-2` | 배경과 카드 |
| `--accent` | 펫의 노란색. 주요 버튼·강조 |
| `--pink` `--cyan` `--peach` `--mint` | 보조 강조. 카드 아이콘과 프리셋 색조 |
| `--text` `--muted` `--muted-2` | 본문·보조·아주 옅은 글씨 |

- **제목용 폰트 Jua는 400 한 굵기만 있다.** 이 폰트를 쓰는 선택자에 `font-weight: 400`을 못박아
  뒀으니 굵기를 올리지 말 것 — 브라우저가 합성 볼드를 그려 획이 뭉개진다. 한글·라틴은 Jua가,
  일본어는 다음 순위인 M PLUS Rounded 1c가 글리프별로 받는다. 본문은 Pretendard다.
- **외부 요청은 웹폰트와 GitHub API뿐이고, 전부 실패해도 페이지는 그대로 뜬다**(폰트는 시스템
  글꼴로, 버전 문구는 정적 문구로 떨어진다). 이 성질을 깨는 의존성을 새로 넣지 않는다.
- **움직임은 모두 `prefers-reduced-motion`으로 끈다.** 지금 대상은 커서 추적·둥실·반짝임·물결이다.
  새 움직임을 넣으면 그 가드에도 같이 넣는다.
- 톤은 "밤에 책상 스탠드 하나 켜둔" 쪽이다. 매끈한 SaaS 페이지처럼 보이면 제품 성격과 어긋난다 —
  둥근 폰트, 옅은 노이즈, 살짝 기울인 카드, 손그림 밑줄이 그래서 있는 것들이다.

## 손대다 밟기 쉬운 것들

전부 실제로 한 번씩 밟은 것들이다.

- **그리드 자식의 `min-width`는 `auto`가 기본이다.** 안쪽 이미지에 고정 폭을 주면 좁은 화면에서
  칸이 그 아래로 줄어들지 못해 페이지에 가로 스크롤이 생긴다. `.shot > * { min-width: 0 }`을
  두고, 이미지 폭은 `width: min(Npx, 100%)`로 준다(`max-width: Npx`는 줄어들지 못한다).
- **`.band p`가 `.dl-meta`보다 명시도가 높다**(클래스+타입 vs 클래스). 그래서 배너 마지막 줄의
  `margin-bottom`을 누르려면 `.band .dl-meta`로 올려야 한다. 안 그러면 박스 아래에 설명 없는
  빈 공간이 남는다.
- **장식용 그라디언트에 `height`를 주면 다 사라지기 전에 잘려 하드 엣지가 보인다.** 박스 안에
  이유 없는 가로 이음선이 보이면 이걸 의심한다. `inset: 0`으로 박스를 다 덮고 그라디언트가
  `transparent`까지 가게 둔다.
- **프리셋 3장은 좁은 화면에서도 3열을 유지한다.** 서로 견주는 게 그 단락의 전부라서 세로로
  쌓으면 의미가 사라진다. 대신 여백을 줄인다.
- 캡처 이미지에 새 고정 폭을 줄 때는 375px에서 가로 오버플로가 없는지 반드시 다시 본다.

## 고친 뒤 확인 목록

페이지는 빌드도 테스트도 없으니 눈과 콘솔이 전부다.

1. **넓은 화면과 375px** 둘 다 본다. 각 폭에서 가로 스크롤이 없어야 한다:
   ```js
   document.documentElement.scrollWidth > document.documentElement.clientWidth
   ```
   `false`여야 한다.
2. **세 언어를 다 전환해 본다.** 위 i18n 누락 스니펫이 세 줄 다 빈 배열인지 확인한다.
3. **콘솔에 에러가 없는지** 본다.
4. 이미지를 새로 넣었으면 **깨진 이미지가 없는지** 본다:
   ```js
   [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src)
   ```
   빈 배열이어야 한다.
5. 앱 기능을 함께 바꿨다면 **페이지 문구가 실제 동작과 맞는지** 다시 읽는다.

## 문서를 갱신할 곳

- 페이지 작업 절차·규칙(이 문서에 있는 것) → **이 문서**
- "언제 무엇을 왜 고쳤다" → [`CHANGELOG.md`](./CHANGELOG.md)
- 앱 구조·기능 위치·빌드/배포 계약 → [`DEVELOPMENT.md`](./DEVELOPMENT.md)

같은 사실을 두 문서에 복사하지 않는다. `DEVELOPMENT.md`의 "빌드와 배포 계약"에는 이 문서를
가리키는 한 줄만 둔다.
