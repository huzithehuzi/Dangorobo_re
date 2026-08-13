// @ts-check
// AI 대화가 남기는 세 기록의 소유자. 디스크 형식은 assistant-logs·memory-persistence가
// 따로 검증하고, 여기서는 "무엇을 들고 있고 언제 쓰는가"를 본다.
//
// 특히 장기 기억 추출 주기는 이력 길이가 아니라 **별도 카운터**로 센다 — 길이로 재면
// assistantMemoryTurns 상한에 걸려 3의 배수가 아닌 값에 멈춰 영영 안 돈다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const electronPath = require.resolve("electron");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-assistant-history-"));
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getPath: () => tempRoot, getLocale: () => "ko-KR" } }
});

const {
  createAssistantHistory,
  ASSISTANT_LOG_LIMIT,
  MEMORY_EXTRACTION_TURN_INTERVAL
} = require("../src/main/assistant/assistant-history.js");

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

function setup() {
  /** @type {any[]} */
  const added = [];
  const history = createAssistantHistory({
    onLogAdded: (/** @type {any} */ entry) => added.push(entry)
  });
  return { history, added };
}

/** @param {number} index */
const logEntry = (index) => /** @type {any} */ ({
  id: `log-${index}`, question: `q${index}`, answer: `a${index}`, createdAt: index
});

/** @param {number} index */
const turn = (index) => /** @type {any} */ ({ question: `q${index}`, answer: `a${index}` });

test("처음에는 아무것도 들고 있지 않다", () => {
  const { history } = setup();
  assert.deepEqual(history.getLogs(), []);
  assert.deepEqual(history.getHistory(), []);
  assert.deepEqual(history.getEpisodeSummaries(), []);
});

test("로그를 붙이면 기록 창에 알린다", () => {
  const { history, added } = setup();
  history.appendLog(logEntry(1));
  assert.deepEqual(history.getLogs().map((/** @type {any} */ e) => e.id), ["log-1"]);
  assert.deepEqual(added.map((e) => e.id), ["log-1"]);
});

test("로그는 상한을 넘으면 오래된 것부터 잘린다", () => {
  const { history } = setup();
  for (let i = 0; i < ASSISTANT_LOG_LIMIT + 5; i += 1) history.appendLog(logEntry(i));

  const ids = history.getLogs().map((/** @type {any} */ e) => e.id);
  assert.equal(ids.length, ASSISTANT_LOG_LIMIT);
  assert.equal(ids[0], `log-5`, "가장 오래된 다섯 개가 밀려났다");
  assert.equal(ids[ids.length - 1], `log-${ASSISTANT_LOG_LIMIT + 4}`);
});

test("대화 이력은 지정한 턴 수만 남긴다", () => {
  const { history } = setup();
  for (let i = 0; i < 10; i += 1) history.pushTurn(turn(i), 3);

  assert.deepEqual(
    history.getHistory().map((/** @type {any} */ t) => t.question),
    ["q7", "q8", "q9"]
  );
});

test("추출 주기는 이력 길이가 아니라 별도 카운터로 센다", () => {
  // 이력이 상한에 걸려 더 안 늘어나는 동안에도 카운터는 계속 돌아야 한다.
  const { history } = setup();
  /** @type {boolean[]} */
  const results = [];
  for (let i = 0; i < 9; i += 1) {
    history.pushTurn(turn(i), 2); // 상한 2 — 이력 길이는 곧 2에서 멈춘다
    results.push(history.countTurnForExtraction());
  }

  assert.equal(history.getHistory().length, 2, "이력은 상한에서 멈춘다");
  assert.deepEqual(
    results,
    [false, false, true, false, false, true, false, false, true],
    "그래도 3턴마다 추출한다"
  );
});

test("추출한 뒤에는 카운터가 다시 0부터 센다", () => {
  const { history } = setup();
  for (let i = 0; i < MEMORY_EXTRACTION_TURN_INTERVAL - 1; i += 1) {
    assert.equal(history.countTurnForExtraction(), false);
  }
  assert.equal(history.countTurnForExtraction(), true);
  assert.equal(history.countTurnForExtraction(), false, "바로 다음 턴에 또 돌지 않는다");
});

test("기억을 끄면 이력과 에피소드만 비우고 로그는 남긴다", () => {
  const { history } = setup();
  history.appendLog(logEntry(1));
  history.pushTurn(turn(1), 10);

  history.clearMemory();

  assert.deepEqual(history.getHistory(), []);
  assert.deepEqual(history.getEpisodeSummaries(), []);
  assert.equal(history.getLogs().length, 1, "화면 로그는 기억 설정과 무관하다");
});

test("턴 상한이 줄어든 설정을 저장하면 이력도 맞춰 자른다", () => {
  const { history } = setup();
  for (let i = 0; i < 6; i += 1) history.pushTurn(turn(i), 10);
  assert.equal(history.getHistory().length, 6);

  history.trimHistory(2);
  assert.deepEqual(
    history.getHistory().map((/** @type {any} */ t) => t.question),
    ["q4", "q5"]
  );
});

test("setLogs는 목록을 통째로 갈아 끼운다", () => {
  const { history, added } = setup();
  history.appendLog(logEntry(1));
  history.setLogs([logEntry(9)]);

  assert.deepEqual(history.getLogs().map((/** @type {any} */ e) => e.id), ["log-9"]);
  assert.equal(added.length, 1, "갈아 끼우기는 기록 창 알림을 보내지 않는다");
});

test("이력이 비어 있으면 종료 시 저장하지 않는다", () => {
  // 빈 배열을 쓰면 이전 세션의 이력을 지우게 된다.
  const { history } = setup();
  const before = fs.readdirSync(tempRoot);
  history.saveHistory(10);
  assert.deepEqual(fs.readdirSync(tempRoot), before);
});
