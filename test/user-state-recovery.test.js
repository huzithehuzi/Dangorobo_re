// @ts-check
// 사용자 상태 JSON의 손상 격리·백업 복구 회귀 테스트.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-user-state-recovery-"));
const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: {
      getPath: () => userDataDir,
      getLocale: () => "ko-KR"
    }
  }
});

const {
  assistantMemoryPath,
  assistantEpisodesPath,
  loadConversationHistoryFromDisk,
  saveConversationHistoryToDisk,
  appendConversationTurnToHistory,
  loadEpisodeSummariesFromDisk,
  saveEpisodeSummariesToDisk,
  appendEpisodeMemory
} = require("../src/main/memory/memory-persistence.js");
const {
  assistantLogsPath,
  loadAssistantLogs,
  saveAssistantLogs
} = require("../src/main/assistant/assistant-logs.js");
const {
  checklistPath,
  loadChecklist,
  saveChecklist
} = require("../src/main/windows/checklist.js");
const {
  favoritesPanelsPath,
  loadFavoritesPanels,
  saveFavoritesPanels
} = require("../src/main/windows/favorites-panels.js");

/** @param {string} filePath @param {unknown} value */
function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

/** @param {string} filePath @returns {any} */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/** @param {string} filePath @param {unknown} backup */
function corruptPrimaryWithBackup(filePath, backup) {
  writeJson(filePath + ".bak", backup);
  fs.writeFileSync(filePath, "{ 잘린 JSON", "utf8");
}

/** @param {string} filePath */
function resetStateFile(filePath) {
  fs.rmSync(filePath, { force: true });
  fs.rmSync(filePath + ".bak", { force: true });
  const prefix = path.basename(filePath) + ".corrupt-";
  for (const name of fs.readdirSync(path.dirname(filePath))) {
    if (name.startsWith(prefix)) {
      fs.rmSync(path.join(path.dirname(filePath), name), { force: true });
    }
  }
}

/** @param {string} filePath @param {string} [expectedContents] */
function assertPrimaryWasQuarantined(filePath, expectedContents = "{ 잘린 JSON") {
  const prefix = path.basename(filePath) + ".corrupt-";
  const quarantined = fs.readdirSync(path.dirname(filePath)).filter((name) => name.startsWith(prefix));
  assert.equal(quarantined.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(filePath), quarantined[0]), "utf8"), expectedContents);
}

test.after(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

test("대화 이력은 손상 원본을 격리하고 백업에서 이어 쓴다", () => {
  const filePath = assistantMemoryPath();
  resetStateFile(filePath);
  corruptPrimaryWithBackup(filePath, {
    version: 1,
    currentSessionStarted: "2026-08-10T00:00:00.000Z",
    conversationHistory: [{
      question: "  이전 질문  ",
      answer: "  이전 답변  ",
      timestamp: "2026-08-10T00:00:00.000Z",
      modelUsed: "gemini",
      personality: "normal"
    }]
  });

  assert.deepEqual(loadConversationHistoryFromDisk().map(({ question, answer }) => ({ question, answer })), [
    { question: "이전 질문", answer: "이전 답변" }
  ]);
  assertPrimaryWasQuarantined(filePath);

  appendConversationTurnToHistory("새 질문", "새 답변");
  appendConversationTurnToHistory("두 번째 질문", "두 번째 답변");

  assert.deepEqual(
    readJson(filePath).conversationHistory.map((/** @type {any} */ turn) => ({
      question: turn.question,
      answer: turn.answer
    })),
    [
      { question: "  이전 질문  ", answer: "  이전 답변  " },
      { question: "새 질문", answer: "새 답변" },
      { question: "두 번째 질문", answer: "두 번째 답변" }
    ]
  );
  assert.deepEqual(
    readJson(filePath + ".bak").conversationHistory.map((/** @type {any} */ turn) => ({
      question: turn.question,
      answer: turn.answer
    })),
    [
      { question: "  이전 질문  ", answer: "  이전 답변  " },
      { question: "새 질문", answer: "새 답변" }
    ]
  );

  saveConversationHistoryToDisk([{ question: "종료 질문", answer: "종료 답변" }]);
  assert.deepEqual(readJson(filePath).conversationHistory, [
    { question: "종료 질문", answer: "종료 답변" }
  ]);
  assert.equal(readJson(filePath + ".bak").conversationHistory.length, 3);
});

test("대화 이력의 읽기와 이어 쓰기는 구조가 잘못된 원본 대신 정상 백업을 사용한다", () => {
  const filePath = assistantMemoryPath();
  const backup = {
    version: 1,
    currentSessionStarted: "2026-08-10T00:00:00.000Z",
    conversationHistory: [{ question: "백업 질문", answer: "백업 답변" }]
  };

  resetStateFile(filePath);
  writeJson(filePath + ".bak", backup);
  const invalidForLoad = { version: 1, conversationHistory: [null] };
  writeJson(filePath, invalidForLoad);
  assert.deepEqual(loadConversationHistoryFromDisk().map(({ question, answer }) => ({ question, answer })), [
    { question: "백업 질문", answer: "백업 답변" }
  ]);
  assertPrimaryWasQuarantined(filePath, JSON.stringify(invalidForLoad, null, 2));

  resetStateFile(filePath);
  writeJson(filePath + ".bak", backup);
  const invalidForAppend = { version: 1, conversationHistory: [42] };
  writeJson(filePath, invalidForAppend);
  appendConversationTurnToHistory("새 질문", "새 답변");
  assert.deepEqual(
    readJson(filePath).conversationHistory.map((/** @type {any} */ turn) => [turn.question, turn.answer]),
    [["백업 질문", "백업 답변"], ["새 질문", "새 답변"]]
  );
  assertPrimaryWasQuarantined(filePath, JSON.stringify(invalidForAppend, null, 2));
});

test("에피소드 요약은 손상 원본을 격리하고 백업에서 이어 쓴다", () => {
  const filePath = assistantEpisodesPath();
  resetStateFile(filePath);
  const createdAt = new Date().toISOString();
  corruptPrimaryWithBackup(filePath, {
    version: 1,
    episodes: [{
      id: "old-episode",
      date: createdAt.slice(0, 10),
      summary: "이전 에피소드",
      keyTopics: ["복구"],
      importance: 0.8,
      messageCount: 2,
      createdAt
    }]
  });

  assert.deepEqual(loadEpisodeSummariesFromDisk().map(({ id, summary }) => ({ id, summary })), [
    { id: "old-episode", summary: "이전 에피소드" }
  ]);
  assertPrimaryWasQuarantined(filePath);

  appendEpisodeMemory({ id: "new-episode", summary: "새 에피소드", keyTopics: ["추가"] });
  appendEpisodeMemory({ id: "next-episode", summary: "다음 에피소드", keyTopics: ["백업"] });

  assert.deepEqual(readJson(filePath).episodes.map((/** @type {any} */ episode) => episode.id), [
    "old-episode",
    "new-episode",
    "next-episode"
  ]);
  assert.deepEqual(readJson(filePath + ".bak").episodes.map((/** @type {any} */ episode) => episode.id), [
    "old-episode",
    "new-episode"
  ]);

  saveEpisodeSummariesToDisk([{
    id: "saved-episode",
    date: createdAt.slice(0, 10),
    summary: "종료 저장",
    keyTopics: ["저장"],
    importance: 0.7,
    messageCount: 3,
    createdAt
  }]);
  assert.deepEqual(readJson(filePath).episodes.map((/** @type {any} */ episode) => episode.id), ["saved-episode"]);
  assert.equal(readJson(filePath + ".bak").episodes.length, 3);
});

test("에피소드의 읽기와 이어 쓰기는 구조가 잘못된 원본 대신 정상 백업을 사용한다", () => {
  const filePath = assistantEpisodesPath();
  const createdAt = new Date().toISOString();
  const backup = {
    version: 1,
    episodes: [{
      id: "backup-episode",
      date: createdAt.slice(0, 10),
      summary: "백업 에피소드",
      keyTopics: ["복구"],
      importance: 0.8,
      messageCount: 2,
      createdAt
    }]
  };

  resetStateFile(filePath);
  writeJson(filePath + ".bak", backup);
  const invalidForLoad = { version: 1, episodes: [null] };
  writeJson(filePath, invalidForLoad);
  assert.deepEqual(loadEpisodeSummariesFromDisk().map(({ id, summary }) => ({ id, summary })), [
    { id: "backup-episode", summary: "백업 에피소드" }
  ]);
  assertPrimaryWasQuarantined(filePath, JSON.stringify(invalidForLoad, null, 2));

  resetStateFile(filePath);
  writeJson(filePath + ".bak", backup);
  const invalidForAppend = { version: 1, episodes: [42] };
  writeJson(filePath, invalidForAppend);
  appendEpisodeMemory({ id: "new-episode", summary: "새 에피소드" });
  assert.deepEqual(
    readJson(filePath).episodes.map((/** @type {any} */ episode) => episode.id),
    ["backup-episode", "new-episode"]
  );
  assertPrimaryWasQuarantined(filePath, JSON.stringify(invalidForAppend, null, 2));
});

test("AI 기록은 백업에서 복구하고 다음 저장에 직전 정상본을 남긴다", () => {
  const filePath = assistantLogsPath();
  corruptPrimaryWithBackup(filePath, [{
    id: "old-log",
    timestamp: "2026-08-10T00:00:00.000Z",
    question: " 이전 질문 ",
    answer: " 이전 답변 ",
    model: "gemini-2.5-flash",
    personality: "normal"
  }]);

  const recovered = loadAssistantLogs();
  assert.deepEqual(recovered.map(({ id, question, answer }) => ({ id, question, answer })), [{
    id: "old-log",
    question: "이전 질문",
    answer: "이전 답변"
  }]);
  assertPrimaryWasQuarantined(filePath);

  saveAssistantLogs(recovered);
  saveAssistantLogs([...recovered, {
    id: "new-log",
    timestamp: "2026-08-11T00:00:00.000Z",
    question: "새 질문",
    answer: "새 답변",
    model: "gemini-2.5-flash",
    personality: "normal"
  }]);

  assert.deepEqual(readJson(filePath).map((/** @type {any} */ log) => log.id), ["old-log", "new-log"]);
  assert.deepEqual(readJson(filePath + ".bak").map((/** @type {any} */ log) => log.id), ["old-log"]);
});

test("AI 기록은 구조가 잘못된 원본 대신 배열 백업을 사용한다", () => {
  const filePath = assistantLogsPath();
  const backup = [{
    id: "backup-log",
    timestamp: "2026-08-10T00:00:00.000Z",
    question: "백업 질문",
    answer: "백업 답변",
    model: "gemini-2.5-flash",
    personality: "normal"
  }];
  const invalidPrimary = { logs: backup };
  resetStateFile(filePath);
  writeJson(filePath + ".bak", backup);
  writeJson(filePath, invalidPrimary);

  assert.deepEqual(loadAssistantLogs().map((log) => log.id), ["backup-log"]);
  assertPrimaryWasQuarantined(filePath, JSON.stringify(invalidPrimary, null, 2));
  assert.deepEqual(readJson(filePath + ".bak"), backup);
});

test("체크리스트는 백업에서 복구하면서 기존 정규화를 유지한다", () => {
  const filePath = checklistPath();
  corruptPrimaryWithBackup(filePath, {
    open: true,
    position: { x: 10.4, y: "20.6" },
    size: { width: 100, height: 1200 },
    items: [
      { id: "task-one", text: "  첫 작업  ", done: true },
      { id: "empty", text: "   ", done: false }
    ]
  });

  const recovered = loadChecklist();
  assert.deepEqual(recovered, {
    open: true,
    position: { x: 10, y: 21 },
    size: { width: 200, height: 900 },
    items: [{ id: "task-one", text: "첫 작업", done: true }]
  });
  assertPrimaryWasQuarantined(filePath);

  saveChecklist(recovered);
  saveChecklist({ ...recovered, open: false });
  assert.equal(readJson(filePath).open, false);
  assert.deepEqual(readJson(filePath + ".bak"), recovered);
});

test("체크리스트는 구조가 잘못된 원본 대신 정상 백업을 사용한다", () => {
  const filePath = checklistPath();
  const backup = {
    open: true,
    position: { x: 11, y: 22 },
    size: { width: 250, height: 330 },
    items: [{ id: "backup-task", text: "백업 작업", done: false }]
  };
  const invalidPrimary = { open: true, items: { id: "배열 아님" } };
  resetStateFile(filePath);
  writeJson(filePath + ".bak", backup);
  writeJson(filePath, invalidPrimary);

  assert.deepEqual(loadChecklist(), backup);
  assertPrimaryWasQuarantined(filePath, JSON.stringify(invalidPrimary, null, 2));
  assert.deepEqual(readJson(filePath + ".bak"), backup);
});

test("즐겨찾기 패널 상태는 백업에서 복구하면서 기존 정규화를 유지한다", () => {
  const filePath = favoritesPanelsPath();
  corruptPrimaryWithBackup(filePath, {
    window: {
      open: true,
      position: { x: "30.2", y: 40.8 },
      size: { width: 50, height: 1000 }
    },
    dock: {
      open: true,
      position: { x: 70.5, y: "80.4" }
    }
  });

  const recovered = loadFavoritesPanels();
  assert.deepEqual(recovered, {
    window: {
      open: true,
      position: { x: 30, y: 41 },
      size: { width: 200, height: 900 }
    },
    dock: {
      open: true,
      position: { x: 71, y: 80 }
    }
  });
  assertPrimaryWasQuarantined(filePath);

  saveFavoritesPanels(recovered);
  saveFavoritesPanels({ ...recovered, dock: { ...recovered.dock, open: false } });
  assert.equal(readJson(filePath).dock.open, false);
  assert.deepEqual(readJson(filePath + ".bak"), recovered);
});

test("즐겨찾기 패널은 구조가 잘못된 원본 대신 정상 백업을 사용한다", () => {
  const filePath = favoritesPanelsPath();
  const backup = {
    window: {
      open: true,
      position: { x: 33, y: 44 },
      size: { width: 264, height: 340 }
    },
    dock: { open: false, position: { x: 55, y: 66 } }
  };
  const invalidPrimary = { window: { open: true } };
  resetStateFile(filePath);
  writeJson(filePath + ".bak", backup);
  writeJson(filePath, invalidPrimary);

  assert.deepEqual(loadFavoritesPanels(), backup);
  assertPrimaryWasQuarantined(filePath, JSON.stringify(invalidPrimary, null, 2));
  assert.deepEqual(readJson(filePath + ".bak"), backup);
});
