// @ts-check
// 사운드·말풍선 테마 카탈로그 ↔ 실제 자산/CSS 정합성 (2026-08-10).
//
// 커스터마이징 카탈로그와 같은 취지다 — 목록에 항목을 넣었는데 파일이나 CSS 블록을
// 같이 안 넣으면, 설정창에는 보이는데 실제로는 아무 일도 안 일어난다(에러도 안 난다).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getLocale: () => "en-US" } }
});

const sounds = require("../src/shared/sound-catalog.js");
const themes = require("../src/shared/theme-catalog.js");
const { DEFAULT_SETTINGS, normalizeSettings } = require("../src/main/settings-schema.js");

const repoRoot = path.join(__dirname, "..");

test("카탈로그에 적힌 사운드 파일이 실제로 있다", () => {
  /** @type {Array<[string, string[]]>} */
  const groups = [
    ["알람", sounds.ALARM_SOUNDS],
    ["대화 효과음", sounds.TALK_SOUNDS],
    ["클릭음", sounds.CLICK_SOUNDS]
  ];
  for (const [label, files] of groups) {
    for (const file of files) {
      const full = path.join(repoRoot, "assets/sounds", file);
      assert.ok(fs.existsSync(full), `${label} 파일이 없다: assets/sounds/${file}`);
    }
  }
});

test("assets/sounds에 카탈로그가 모르는 사운드가 남아 있지 않다", () => {
  // 파일을 지우고 카탈로그만 고치는 실수는 위 테스트가 잡지만, 반대(파일만 추가하고
  // 카탈로그에 안 넣어서 아무도 못 고르는 상태)는 이쪽이 잡는다.
  const onDisk = fs.readdirSync(path.join(repoRoot, "assets/sounds")).sort();
  const known = [...sounds.ALARM_SOUNDS, ...sounds.TALK_SOUNDS, ...sounds.CLICK_SOUNDS].sort();
  assert.deepEqual(onDisk, known);
});

test("사운드 설정의 상한이 카탈로그 개수와 같다", () => {
  const overLimit = /** @type {Record<string, any>} */ (normalizeSettings({
    alarmSound: sounds.ALARM_SOUND_COUNT + 1,
    animaleseSoundStyle: sounds.TALK_SOUND_COUNT + 1,
    keyboardClickSound: sounds.CLICK_SOUND_COUNT + 1,
    mouseClickSound: sounds.CLICK_SOUND_COUNT + 1
  }));
  assert.notEqual(overLimit.alarmSound, sounds.ALARM_SOUND_COUNT + 1);
  assert.notEqual(overLimit.animaleseSoundStyle, sounds.TALK_SOUND_COUNT + 1);
  assert.notEqual(overLimit.keyboardClickSound, sounds.CLICK_SOUND_COUNT + 1);
  assert.notEqual(overLimit.mouseClickSound, sounds.CLICK_SOUND_COUNT + 1);

  const atLimit = /** @type {Record<string, any>} */ (normalizeSettings({
    alarmSound: sounds.ALARM_SOUND_COUNT,
    animaleseSoundStyle: sounds.TALK_SOUND_COUNT,
    keyboardClickSound: sounds.CLICK_SOUND_COUNT,
    mouseClickSound: sounds.CLICK_SOUND_COUNT
  }));
  assert.equal(atLimit.alarmSound, sounds.ALARM_SOUND_COUNT);
  assert.equal(atLimit.animaleseSoundStyle, sounds.TALK_SOUND_COUNT);
  assert.equal(atLimit.keyboardClickSound, sounds.CLICK_SOUND_COUNT);
  assert.equal(atLimit.mouseClickSound, sounds.CLICK_SOUND_COUNT);
});

test("soundFile()은 1부터 시작하고 범위 밖은 빈 문자열이다", () => {
  assert.equal(sounds.soundFile(sounds.ALARM_SOUNDS, 1), sounds.ALARM_SOUNDS[0]);
  assert.equal(
    sounds.soundFile(sounds.ALARM_SOUNDS, sounds.ALARM_SOUND_COUNT),
    sounds.ALARM_SOUNDS[sounds.ALARM_SOUND_COUNT - 1]
  );
  assert.equal(sounds.soundFile(sounds.ALARM_SOUNDS, 0), "");
  assert.equal(sounds.soundFile(sounds.ALARM_SOUNDS, sounds.ALARM_SOUND_COUNT + 1), "");
  assert.equal(sounds.soundFile(sounds.ALARM_SOUNDS, "설정값 아님"), "");
});

// 테마 CSS 블록이 있어야 하는 파일 — 창 공용 변수와 펫 말풍선.
const THEME_CSS_FILES = ["src/shared/theme-vars.css", "src/pet/styles.css"];

test("기본 테마를 뺀 모든 말풍선 테마에 CSS 블록이 있다", () => {
  // 기본 테마(charcoal)는 :root의 기본 변수를 그대로 써서 자기 블록이 없다.
  const defaultTheme = DEFAULT_SETTINGS.bubbleTheme;
  assert.ok(themes.BUBBLE_THEME_IDS.includes(defaultTheme), "기본 테마가 카탈로그에 없다");

  for (const relativePath of THEME_CSS_FILES) {
    const css = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    for (const id of themes.BUBBLE_THEME_IDS) {
      if (id === defaultTheme) continue;
      assert.ok(
        css.includes(`data-theme="${id}"`),
        `${relativePath}에 "${id}" 테마 블록이 없다 — 그 테마를 고르면 색이 안 바뀐다`
      );
    }
  }
});

test("CSS에만 있고 카탈로그에 없는 테마가 없다", () => {
  for (const relativePath of THEME_CSS_FILES) {
    const css = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    const found = new Set([...css.matchAll(/data-theme="([a-z]+)"/g)].map((match) => match[1]));
    for (const id of found) {
      assert.ok(
        themes.isBubbleTheme(id),
        `${relativePath}의 "${id}" 테마를 카탈로그가 모른다 — 저장하면 기본 테마로 되돌아간다`
      );
    }
  }
});

test("설정 정규화가 카탈로그의 테마만 통과시킨다", () => {
  for (const id of themes.BUBBLE_THEME_IDS) {
    assert.equal(normalizeSettings({ bubbleTheme: id }).bubbleTheme, id);
  }
  assert.equal(normalizeSettings({ bubbleTheme: "없는테마" }).bubbleTheme, DEFAULT_SETTINGS.bubbleTheme);
});
