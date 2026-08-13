// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { t } = require("../src/shared/i18n.js");

const repoRoot = path.resolve(__dirname, "..");

// Windows 체크아웃은 CRLF라, 소스 구간을 문자열로 잘라내는 단언이 줄바꿈 바이트에 걸린다.
// 여기서 보는 것은 로드 체인 구조뿐이므로 LF로 맞춘다.
/** @param {...string} segments */
function readSource(...segments) {
  return fs.readFileSync(path.join(repoRoot, ...segments), "utf8").replace(/\r\n?/g, "\n");
}

const appSource = readSource("ui", "settings", "App.tsx");
const cssSource = readSource("ui", "settings", "settings.css");
// 선택 자원(커스텀 텍스처)과 프리셋 썸네일은 외형 상태 훅이 소유한다.
const customizationSource = readSource("ui", "settings", "use-customization-state.ts");
// 로드·수정·저장 상태와 dirty 추적은 수명주기 훅이 소유한다.
const lifecycleSource = readSource("ui", "settings", "use-settings-lifecycle.ts");

function loadChainSource() {
  const start = appSource.indexOf(
    "settingsPromise\n      .then((settings) => {\n        applyLoaded(settings);"
  );
  const end = appSource.indexOf("\n  }, [applyLoaded, isDirty, markLoaded, markLoadFailed]);", start);
  assert.ok(start >= 0 && end > start, "설정 초기 로드 성공·실패 체인을 찾는다");
  return appSource.slice(start, end);
}

function loadEffectSource() {
  const start = appSource.indexOf("const settingsPromise = window.desktopPet.getSettings()");
  const end = appSource.indexOf("\n  }, [applyLoaded, isDirty, markLoaded, markLoadFailed]);", start);
  assert.ok(start >= 0 && end > start, "설정 초기 로드 effect를 찾는다");
  return appSource.slice(start, end);
}

test("초기 설정 로드는 성공과 실패를 서로 다른 상태로 끝낸다", () => {
  assert.match(
    lifecycleSource,
    /useState<LoadStatus>\("loading"\)/
  );
  // 로드 성공은 ready 전환과 dirty 해제를 한 번에 한다 — 둘이 갈리면 "막 열었는데 더럽다"가 된다.
  const markLoaded = lifecycleSource.indexOf("const markLoaded = useCallback");
  const markLoadedEnd = lifecycleSource.indexOf("}, []);", markLoaded);
  assert.ok(markLoaded >= 0 && markLoadedEnd > markLoaded, "markLoaded 본문을 찾는다");
  const markLoadedBody = lifecycleSource.slice(markLoaded, markLoadedEnd);
  assert.match(markLoadedBody, /setLoadStatus\("ready"\)/);
  assert.match(markLoadedBody, /dirtyRef\.current = false/);
  assert.match(lifecycleSource, /const markLoadFailed = useCallback\(\(\) => setLoadStatus\("failed"\)/);

  const source = loadChainSource();
  const applyLoaded = source.indexOf("applyLoaded(settings)");
  const ready = source.indexOf("markLoaded()");
  const catchStart = source.indexOf(".catch((error) => {");
  const failed = source.indexOf("markLoadFailed()");

  assert.ok(applyLoaded >= 0 && ready > applyLoaded, "설정을 폼 상태에 적용한 뒤 ready로 전환한다");
  assert.ok(catchStart > ready, "settingsPromise의 성공 처리 뒤에 실패 처리를 붙인다");
  assert.ok(failed > catchStart, "거부되거나 applyLoaded가 실패하면 failed로 전환한다");
  assert.match(source, /console\.error\("\[Settings\] Load settings failed:", error\)/);

  const effectSource = loadEffectSource();
  assert.match(
    effectSource,
    /^const settingsPromise = window\.desktopPet\.getSettings\(\) as Promise<Record<string, unknown>>;/,
    "settings:get의 거부를 성공값으로 바꾸지 않고 실패 체인까지 전달한다"
  );
  const themeCatch = effectSource.indexOf(".catch(() => {})");
  assert.ok(themeCatch >= 0, "테마 적용 체인은 설정 거부를 소비한다");
  assert.doesNotMatch(effectSource, /Promise\.all\(\[settingsPromise, fontsPromise\]\)/);
  assert.match(
    effectSource,
    /const fontsPromise = window\.desktopPet\.getInstalledFonts\(\)\.catch\(\(\) => \[\] as string\[\]\);/,
    "폰트 조회 실패는 빈 목록으로 복구한다"
  );
  assert.match(
    effectSource,
    /fontsPromise\.then\(\(fonts\) => \{\s*setInstalledFonts\(Array\.isArray\(fonts\) \? fonts : \[\]\);\s*\}\);/,
    "폰트 응답은 설정 화면 준비와 독립적으로 반영한다"
  );
  assert.match(
    appSource,
    /useEffect\(\(\) => \{\s*if \(loadStatus !== "loading"\) window\.PetUiMotion\?\.markReady\(\);\s*\}, \[loadStatus\]\);/,
    "성공·실패 UI가 렌더된 뒤 motion gate를 연다"
  );
});

test("실패 화면은 빈 화면 가드보다 먼저 오류와 재시도를 보여준다", () => {
  const failureStart = appSource.indexOf('if (loadStatus === "failed")');
  const loadingGuard = appSource.indexOf('if (loadStatus !== "ready" || !store || !d) return null;');
  assert.ok(failureStart >= 0 && loadingGuard > failureStart, "failed 분기가 null 가드보다 앞선다");
  const failureSource = appSource.slice(failureStart, loadingGuard);

  assert.match(failureSource, /role="alert"/);
  assert.match(failureSource, /tt\("settings\.loadError"\)/);
  assert.match(failureSource, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
  assert.match(failureSource, /tt\("common\.retry"\)/);
  assert.match(failureSource, /<main className="settings-load-failure" lang=\{language\}>/);
  assert.match(cssSource, /\.settings-load-failure\s*\{/);
  assert.match(cssSource, /\.settings-load-failure-card\s*\{/);
});

test("선택 자원과 썸네일 조회 실패는 처리되지 않은 거부를 남기지 않는다", () => {
  const applyStart = customizationSource.indexOf("const applyFromSettings = useCallback");
  const applyEnd = customizationSource.indexOf("\n  }, []);", applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart, "applyFromSettings 본문을 찾는다");
  const applyLoadedSource = customizationSource.slice(applyStart, applyEnd);
  assert.match(
    applyLoadedSource,
    /getCustomFaceTextures\(\)[\s\S]*?\.catch\(\(error\) => console\.error\("\[Settings\] Load custom face textures failed:", error\)\)/
  );
  assert.match(
    applyLoadedSource,
    /getCustomBodyTexture\(\)[\s\S]*?\.catch\(\(error\) => console\.error\("\[Settings\] Load custom body texture failed:", error\)\)/
  );

  const thumbnailStart = customizationSource.indexOf("const refreshPresetThumbnails = useCallback");
  const thumbnailEnd = customizationSource.indexOf("\n  }, []);", thumbnailStart);
  assert.ok(thumbnailStart >= 0 && thumbnailEnd > thumbnailStart, "썸네일 요청 본문을 찾는다");
  const thumbnailSource = customizationSource.slice(thumbnailStart, thumbnailEnd);
  const catchStart = thumbnailSource.indexOf(".catch((error) => {");
  const finallyStart = thumbnailSource.indexOf(".finally(() => {");
  assert.ok(catchStart >= 0 && finallyStart > catchStart, "썸네일 거부를 소비한 뒤 대기 상태를 정리한다");
  assert.match(
    thumbnailSource,
    /\.catch\(\(error\) => \{\s*console\.error\("\[Settings\] Render preset thumbnails failed:", error\);\s*\}\)\s*\.finally/,
    "썸네일 오류를 다시 던지지 않고 정리 단계로 넘긴다"
  );
});

test("설정을 읽기 전에는 OS 언어로 오류 화면과 창 제목을 번역한다", () => {
  assert.match(
    appSource,
    /const language = d\?\.language \?\? window\.PetI18n\.detectDefaultLanguage\(navigator\.language\);/
  );
  assert.match(
    appSource,
    /useEffect\(\(\) => \{\s*if \(!d && loadStatus !== "failed"\) return;\s*document\.title = tt\("window\.settingsTitle"\);\s*document\.documentElement\.lang = language;\s*\}, \[tt, d, loadStatus, language\]\);/
  );
  assert.match(
    appSource,
    /useEffect\(\(\) => \{\s*if \(loadStatus === "ready"\) refreshPresetThumbnails\(\);\s*\}, \[loadStatus, refreshPresetThumbnails\]\);/
  );
});

test("초기 로드 실패 문구와 재시도는 세 언어에 모두 있다", () => {
  const expected = {
    ko: ["설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "다시 시도"],
    en: ["Couldn't load the settings. Please try again.", "Retry"],
    ja: ["設定を読み込めませんでした。しばらくしてからもう一度お試しください。", "再試行"]
  };
  for (const [language, [message, retry]] of Object.entries(expected)) {
    assert.equal(t(language, "settings.loadError"), message);
    assert.equal(t(language, "common.retry"), retry);
  }
});
