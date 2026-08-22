// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { t } = require("../src/shared/i18n.js");

const repoRoot = path.join(__dirname, "..");
const memoryTabSource = fs.readFileSync(path.join(repoRoot, "ui/settings/tabs-talk.tsx"), "utf8");
const globalTypesSource = fs.readFileSync(path.join(repoRoot, "ui/lib/global.d.ts"), "utf8");

test("장기 기억 전체 삭제 문구는 보존되는 데이터 범위를 세 언어로 명시한다", () => {
  const requiredTerms = {
    ko: {
      longTerm: /장기 기억/,
      openLoops: /미완료 주제/,
      episodes: /대화 기록/
    },
    en: {
      longTerm: /long-term memor/i,
      openLoops: /open loops/i,
      episodes: /conversation sessions/i
    },
    ja: {
      longTerm: /長期記憶/,
      openLoops: /未解決のトピック/,
      episodes: /会話記録/
    }
  };

  for (const [language, terms] of Object.entries(requiredTerms)) {
    const button = t(language, "settings.memory.clearButton");
    const confirm = t(language, "settings.memory.confirmClear");
    const success = t(language, "settings.memory.clearedAlert");
    assert.match(button, terms.longTerm);
    for (const message of [confirm, success]) {
      assert.match(message, terms.longTerm);
      assert.match(message, terms.openLoops);
      assert.match(message, terms.episodes);
    }
  }
});

test("설정 UI는 장기 기억 전체 보관 실패를 성공으로 처리하지 않는다", () => {
  assert.match(
    memoryTabSource,
    /const archived = await window\.desktopPet\.clearAllMemories\(\);\s*if \(archived !== true\) \{\s*alert\(tt\("settings\.memory\.clearRejected"\)\);\s*return;/,
    "IPC가 false를 반환하면 성공 알림 전에 중단해야 한다"
  );
  assert.match(
    globalTypesSource,
    /clearAllMemories\(\): Promise<boolean>;/,
    "preload의 성공 여부 계약이 unknown으로 넓어지면 UI가 실패 처리를 놓칠 수 있다"
  );
});

// ── 잊은 기억 되살리기 (2026-08-21) ────────────────────────────────────────────────
//
// is_forgotten은 자동 추출이 그 사실을 다시 배우지 못하게 막는다. 되살릴 수단이 UI에
// 없으면 LLM이 잘못 고른 기억을 영구히 잃는다.

test("설정 UI에 잊은 기억을 되살리는 경로가 있다", () => {
  assert.match(
    memoryTabSource,
    /window\.desktopPet\.restoreForgottenMemory\(memory\.id\)/,
    "되살리기 IPC를 실제로 부른다"
  );
  assert.match(
    memoryTabSource,
    /window\.desktopPet\.getForgottenMemories\(\)/,
    "잊은 기억은 활성 목록에 없으므로 따로 읽어야 한다"
  );
  assert.match(
    globalTypesSource,
    /restoreForgottenMemory\(id: number\): Promise<boolean>;/,
    "성공 여부 계약이 unknown으로 넓어지면 UI가 실패를 놓친다"
  );
});

test("잊은 기억 문구는 자동 저장이 막힌다는 점을 세 언어로 알린다", () => {
  // 이 점을 모르면 "다시 말했는데 왜 안 저장되냐"가 된다.
  const blocked = {
    ko: /자동으로 저장되지 않/,
    en: /will not save them automatically/i,
    ja: /自動保存されません/
  };
  for (const [language, pattern] of Object.entries(blocked)) {
    assert.match(t(language, "settings.memory.forgottenNote"), pattern);
    assert.notEqual(t(language, "settings.memory.forgottenHeading"), "settings.memory.forgottenHeading");
    assert.notEqual(t(language, "settings.memory.restoreButton"), "settings.memory.restoreButton");
    assert.notEqual(t(language, "settings.memory.confirmRestore"), "settings.memory.confirmRestore");
  }
});

// ── 잊은 기억이 있으면 기억 관리 탭이 나온다 (2026-08-21) ──────────────────────────
//
// memoryTabVisible은 기본 false다. 되살리기 UI가 그 탭 안에만 있으므로, 탭이 숨어 있으면
// 펫이 잘못 잊었을 때 일반 사용자에게는 복구 경로가 아예 없다.

test("설정 UI는 잊은 기억이 있으면 토글과 무관하게 기억 관리 탭을 넣는다", () => {
  const appSource = fs.readFileSync(path.join(repoRoot, "ui/settings/App.tsx"), "utf8")
    .replace(/\r\n?/g, "\n");
  assert.match(
    appSource,
    /const memoryTabShown = Boolean\(d\?\.memoryTabVisible\) \|\| hasForgottenMemories;/,
    "토글 OR 잊은 기억 존재로 판정해야 한다"
  );
  assert.match(appSource, /stats\.forgottenCount/, "통계에서 잊은 기억 수를 읽는다");
  // 탭을 넣는 조건과 "그 탭에서 내보내는" 조건이 갈리면 탭은 보이는데 못 머문다.
  assert.match(
    appSource,
    /if \(activeTab === "memory" && d && !memoryTabShown\) activateTab\("conversation"\);/,
    "탭 노출 조건과 이탈 조건이 같은 값을 봐야 한다"
  );
});
