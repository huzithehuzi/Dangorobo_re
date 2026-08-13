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
