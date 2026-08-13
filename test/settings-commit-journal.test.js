// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  markSettingsCommitRollback,
  prepareSettingsCommit,
  recoverPendingSettingsCommit,
  settlePendingSettingsCommit
} = require("../src/main/settings-commit-journal.js");

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-settings-journal-"));
  return {
    directory,
    paths: {
      journalPath: path.join(directory, "settings-save-journal.json"),
      settingsPath: path.join(directory, "pet-settings.json"),
      assistantKeysPath: path.join(directory, "assistant-keys.json")
    }
  };
}

test("저널이 없으면 복구할 상태가 없다고 반환한다", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  assert.deepEqual(recoverPendingSettingsCommit(fixture.paths), { status: "none" });
});

test("목표 설정이 저장됐으면 강제 종료 뒤 암호화 키 후보를 확정한다", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  const targetSettings = JSON.stringify({ language: "ja", value: 2 }, null, 2);
  const previousKeys = JSON.stringify({ gemini: "encrypted-old" }, null, 2);
  const targetKeys = JSON.stringify({ gemini: "encrypted-new" }, null, 2);
  fs.writeFileSync(fixture.paths.assistantKeysPath, previousKeys, "utf8");

  prepareSettingsCommit(fixture.paths, targetSettings, targetKeys);
  const journalContents = fs.readFileSync(fixture.paths.journalPath, "utf8");
  assert.ok(!journalContents.includes("encrypted-new"));
  fs.writeFileSync(fixture.paths.settingsPath, targetSettings, "utf8");

  assert.deepEqual(recoverPendingSettingsCommit(fixture.paths), { status: "completed" });
  assert.equal(fs.readFileSync(fixture.paths.assistantKeysPath, "utf8"), targetKeys);
  assert.equal(fs.existsSync(fixture.paths.journalPath), false);
});

test("목표 설정이 없으면 강제 종료 뒤 이전 암호화 키를 복원한다", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  const previousSettings = JSON.stringify({ language: "ko", value: 1 }, null, 2);
  const targetSettings = JSON.stringify({ language: "en", value: 2 }, null, 2);
  const previousKeys = JSON.stringify({ gemini: "encrypted-old" }, null, 2);
  const targetKeys = JSON.stringify({ gemini: "encrypted-new" }, null, 2);
  fs.writeFileSync(fixture.paths.settingsPath, previousSettings, "utf8");
  fs.writeFileSync(fixture.paths.assistantKeysPath, previousKeys, "utf8");
  prepareSettingsCommit(fixture.paths, targetSettings, targetKeys);
  fs.writeFileSync(fixture.paths.assistantKeysPath, targetKeys, "utf8");

  assert.deepEqual(recoverPendingSettingsCommit(fixture.paths), { status: "rolledBack" });
  assert.equal(fs.readFileSync(fixture.paths.assistantKeysPath, "utf8"), previousKeys);
});

test("이전 키 파일이 없던 저장은 rollback 시 후보 키 파일을 제거한다", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  const targetSettings = JSON.stringify({ language: "en" }, null, 2);
  const targetKeys = JSON.stringify({ gemini: "encrypted-new" }, null, 2);
  prepareSettingsCommit(fixture.paths, targetSettings, targetKeys);
  fs.writeFileSync(fixture.paths.assistantKeysPath, targetKeys, "utf8");

  assert.deepEqual(recoverPendingSettingsCommit(fixture.paths), { status: "rolledBack" });
  assert.equal(fs.existsSync(fixture.paths.assistantKeysPath), false);
});

test("rollback 단계가 기록되면 목표 설정이 있어도 이전 키를 복원한다", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  const targetSettings = JSON.stringify({ language: "ja" }, null, 2);
  const previousKeys = JSON.stringify({ gemini: "encrypted-old" }, null, 2);
  const targetKeys = JSON.stringify({ gemini: "encrypted-new" }, null, 2);
  fs.writeFileSync(fixture.paths.assistantKeysPath, previousKeys, "utf8");
  prepareSettingsCommit(fixture.paths, targetSettings, targetKeys);
  markSettingsCommitRollback(fixture.paths);
  fs.writeFileSync(fixture.paths.settingsPath, targetSettings, "utf8");
  fs.writeFileSync(fixture.paths.assistantKeysPath, targetKeys, "utf8");

  assert.deepEqual(recoverPendingSettingsCommit(fixture.paths), { status: "rolledBack" });
  assert.equal(fs.readFileSync(fixture.paths.assistantKeysPath, "utf8"), previousKeys);
});

test("손상된 저널은 키를 바꾸지 않고 격리한다", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  const currentKeys = JSON.stringify({ gemini: "encrypted-current" }, null, 2);
  fs.writeFileSync(fixture.paths.assistantKeysPath, currentKeys, "utf8");
  fs.writeFileSync(fixture.paths.journalPath, JSON.stringify({ phase: "commit" }), "utf8");

  assert.deepEqual(recoverPendingSettingsCommit(fixture.paths), { status: "corrupt" });
  assert.equal(fs.readFileSync(fixture.paths.assistantKeysPath, "utf8"), currentKeys);
  assert.equal(fs.existsSync(fixture.paths.journalPath), false);
  assert.equal(
    fs.readdirSync(fixture.directory)
      .filter(name => name.startsWith("settings-save-journal.json.corrupt-")).length,
    1
  );
});

test("키 삭제 저장의 남은 저널을 후속 설정 저장 전에 정리해 이전 키 부활을 막는다", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  const targetSettings = JSON.stringify({ language: "ko", value: 2 }, null, 2);
  const followupSettings = JSON.stringify({ language: "ko", value: 3 }, null, 2);
  const previousKeys = JSON.stringify({ gemini: "encrypted-old" }, null, 2);
  const clearedKeys = JSON.stringify({}, null, 2);
  fs.writeFileSync(fixture.paths.assistantKeysPath, previousKeys, "utf8");

  prepareSettingsCommit(fixture.paths, targetSettings, clearedKeys);
  fs.writeFileSync(fixture.paths.assistantKeysPath, clearedKeys, "utf8");
  fs.writeFileSync(fixture.paths.settingsPath, targetSettings, "utf8");

  assert.deepEqual(settlePendingSettingsCommit(fixture.paths), { status: "completed" });
  fs.writeFileSync(fixture.paths.settingsPath, followupSettings, "utf8");

  assert.deepEqual(recoverPendingSettingsCommit(fixture.paths), { status: "none" });
  assert.equal(fs.readFileSync(fixture.paths.assistantKeysPath, "utf8"), clearedKeys);
  assert.equal(fs.existsSync(fixture.paths.journalPath), false);
});
