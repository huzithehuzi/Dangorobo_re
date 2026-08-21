const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const initSqlJs = require("sql.js");
const { version: appVersion } = require("../package.json");
const { writeFileAtomicSync } = require("../src/main/atomic-file.js");

/** @typedef {import("../src/main/memory/memory-sqlite.js").InitializeDatabaseOptions} InitializeDatabaseOptions */

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-memory-sqlite-"));
const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getPath: () => userDataDir } }
});

const {
  MEMORY_SCHEMA_VERSION,
  initializeDatabase,
  insertMemory,
  getMemoriesByCategory,
  searchMemories,
  deleteMemory,
  setMemoryVerified,
  archiveAllMemories,
  getMemoryCount,
  insertEpisode,
  insertOpenLoop,
  getOpenLoops,
  closeOpenLoop,
  archiveStaleOpenLoops,
  OPEN_LOOP_ARCHIVE_AGE_DAYS,
  getOpenLoopsCount,
  getEpisodesCount,
  getAllMemories,
  closeDatabase,
  getDb
} = require("../src/main/memory/memory-sqlite.js");

test("insertEpisode은 새 행 id를 반환하고 미완료 주제가 그 id를 참조한다", async (t) => {
  t.after(() => {
    closeDatabase();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  assert.equal(insertEpisode({ summary: "초기화 전" }), null);
  assert.equal(await initializeDatabase(), true);

  const initializedDatabase = getDb();
  assert.ok(initializedDatabase);
  assert.deepEqual(
    initializedDatabase.exec("SELECT schema_version, app_version FROM memory_meta WHERE id = 1")[0]?.values,
    [[MEMORY_SCHEMA_VERSION, appVersion]]
  );
  assert.deepEqual(
    initializedDatabase.exec(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_long_term_memory_active_updated'"
    )[0]?.values,
    [["idx_long_term_memory_active_updated"]]
  );

  const firstEpisodeId = insertEpisode({
    session_id: "session-one",
    date: "2026-08-10",
    summary: "첫 번째 에피소드"
  });
  const secondEpisodeId = insertEpisode({
    session_id: "session-two",
    date: "2026-08-10",
    summary: "두 번째 에피소드"
  });
  assert.ok(firstEpisodeId !== null);
  assert.ok(secondEpisodeId !== null);
  assert.ok(secondEpisodeId > firstEpisodeId);

  const database = getDb();
  assert.ok(database);
  assert.deepEqual(
    database.exec("SELECT id, summary FROM episodes ORDER BY id")[0]?.values,
    [
      [firstEpisodeId, "첫 번째 에피소드"],
      [secondEpisodeId, "두 번째 에피소드"]
    ]
  );

  assert.equal(insertOpenLoop({ episode_id: secondEpisodeId, topic: "두 번째 후속 주제" }), true);
  assert.deepEqual(
    database.exec("SELECT episode_id FROM open_loops WHERE topic = ?", ["두 번째 후속 주제"])[0]?.values,
    [[secondEpisodeId]]
  );
});

test("v2 데이터베이스를 v3으로 올리면서 데이터와 원본 백업을 보존한다", async (t) => {
  closeDatabase();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  t.after(() => {
    closeDatabase();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  legacy.run(`
    CREATE TABLE memory_meta (
      id INTEGER PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      app_version TEXT NOT NULL,
      last_migration_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE long_term_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      memory_key TEXT NOT NULL UNIQUE,
      memory_label TEXT NOT NULL,
      memory_value TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      first_detected_at TEXT NOT NULL,
      last_updated_at TEXT NOT NULL,
      mention_count INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      date TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE open_loops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      topic TEXT NOT NULL,
      mentioned_at TEXT NOT NULL,
      last_mentioned_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO memory_meta VALUES (1, 2, '1.3.0', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    INSERT INTO long_term_memory (
      category, memory_key, memory_label, memory_value, first_detected_at, last_updated_at, created_at
    ) VALUES (
      'preference', 'favorite_drink', '좋아하는 음료', '라떼',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    );
    INSERT INTO open_loops (
      episode_id, topic, mentioned_at, last_mentioned_at, created_at
    ) VALUES (
      7, '레거시 후속 주제', '2026-08-01T01:00:00.000Z',
      '2026-08-01T02:00:00.000Z', '2026-08-01T03:00:00.000Z'
    );
  `);
  const dbPath = path.join(userDataDir, "assistant-memory.db");
  fs.writeFileSync(dbPath, Buffer.from(legacy.export()));
  legacy.close();

  assert.equal(await initializeDatabase(), true);
  const migrated = getDb();
  assert.ok(migrated);
  assert.deepEqual(
    migrated.exec("SELECT schema_version, app_version FROM memory_meta WHERE id = 1")[0]?.values,
    [[MEMORY_SCHEMA_VERSION, appVersion]]
  );
  assert.deepEqual(
    migrated.exec(
      "SELECT memory_key, memory_value, is_verified, is_archived FROM long_term_memory"
    )[0]?.values,
    [["favorite_drink", "라떼", 0, 0]]
  );
  const expectedMemory = {
    id: 1,
    category: "preference",
    memory_key: "favorite_drink",
    memory_label: "좋아하는 음료",
    memory_value: "라떼",
    importance: 0.5,
    last_updated_at: "2026-08-01T00:00:00.000Z",
    mention_count: 1,
    is_verified: false,
    created_at: "2026-08-01T00:00:00.000Z"
  };
  assert.deepEqual(getAllMemories(), [expectedMemory]);
  assert.deepEqual(searchMemories(["favorite_drink"]), [expectedMemory]);
  assert.deepEqual(getMemoriesByCategory("preference"), [{
    ...expectedMemory,
    first_detected_at: "2026-08-01T00:00:00.000Z"
  }]);
  assert.deepEqual(getOpenLoops(), [{
    id: 1,
    topic: "레거시 후속 주제",
    mentioned_at: "2026-08-01T01:00:00.000Z",
    last_mentioned_at: "2026-08-01T02:00:00.000Z",
    is_closed: 0
  }]);
  assert.ok(fs.existsSync(dbPath + ".bak"));
  const backup = new SQL.Database(fs.readFileSync(dbPath + ".bak"));
  assert.deepEqual(backup.exec("SELECT schema_version FROM memory_meta")[0]?.values, [[2]]);
  backup.close();
});

test("미래 스키마는 원본 파일을 바꾸지 않고 초기화를 거부한다", async (t) => {
  closeDatabase();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  t.after(() => {
    closeDatabase();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  const SQL = await initSqlJs();
  const future = new SQL.Database();
  future.run(`
    CREATE TABLE memory_meta (
      id INTEGER PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      app_version TEXT NOT NULL,
      last_migration_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO memory_meta VALUES (1, 99, '99.0.0', '2026-08-11', '2026-08-11');
  `);
  const dbPath = path.join(userDataDir, "assistant-memory.db");
  const original = Buffer.from(future.export());
  fs.writeFileSync(dbPath, original);
  future.close();

  assert.equal(await initializeDatabase(), false);
  assert.equal(getDb(), null);
  assert.deepEqual(fs.readFileSync(dbPath), original);
  assert.equal(fs.existsSync(dbPath + ".bak"), false);
});

test("v3 메타데이터와 실제 스키마가 다르면 초기화를 거부한다", async (t) => {
  closeDatabase();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  t.after(() => {
    closeDatabase();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  t.mock.method(console, "error", () => {});

  assert.equal(await initializeDatabase(), true);
  closeDatabase();

  const SQL = await initSqlJs();
  const dbPath = path.join(userDataDir, "assistant-memory.db");
  const incomplete = new SQL.Database(fs.readFileSync(dbPath));
  incomplete.run("ALTER TABLE long_term_memory DROP COLUMN tags");
  const incompleteBytes = Buffer.from(incomplete.export());
  incomplete.close();
  fs.writeFileSync(dbPath, incompleteBytes);

  assert.equal(await initializeDatabase(), false);
  assert.equal(getDb(), null);
  assert.deepEqual(fs.readFileSync(dbPath), incompleteBytes);
});

test("손상된 주 파일을 격리하고 정상 백업에서 행과 주 파일을 복구한다", async (t) => {
  closeDatabase();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  t.after(() => {
    closeDatabase();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});

  assert.equal(await initializeDatabase(), true);
  assert.equal(insertMemory({
    category: "preference",
    memory_key: "recovery_drink",
    memory_label: "복구할 음료",
    memory_value: "보리차"
  }), true);
  closeDatabase();

  const dbPath = path.join(userDataDir, "assistant-memory.db");
  fs.copyFileSync(dbPath, dbPath + ".bak");
  fs.writeFileSync(dbPath, Buffer.from("손상된 SQLite"));

  assert.equal(await initializeDatabase(), true);
  assert.deepEqual(getAllMemories().map(memory => memory.memory_key), ["recovery_drink"]);
  assert.equal(fs.existsSync(dbPath), true);
  assert.equal(
    fs.readdirSync(userDataDir).filter(name => name.startsWith("assistant-memory.db.corrupt-")).length,
    1
  );
  const database = getDb();
  assert.ok(database);
  assert.deepEqual(database.exec("PRAGMA quick_check")[0]?.values, [["ok"]]);
});

test("주 파일이 없으면 정상 백업을 읽고 주 파일을 다시 만든다", async (t) => {
  closeDatabase();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  t.after(() => {
    closeDatabase();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  t.mock.method(console, "warn", () => {});

  assert.equal(await initializeDatabase(), true);
  assert.equal(insertMemory({
    category: "fact",
    memory_key: "backup_only_fact",
    memory_label: "백업 사실",
    memory_value: "백업만 남음"
  }), true);
  closeDatabase();

  const dbPath = path.join(userDataDir, "assistant-memory.db");
  fs.copyFileSync(dbPath, dbPath + ".bak");
  fs.rmSync(dbPath);

  assert.equal(await initializeDatabase(), true);
  assert.deepEqual(getAllMemories().map(memory => memory.memory_key), ["backup_only_fact"]);
  assert.equal(fs.existsSync(dbPath), true);
});

test("주 파일과 백업이 모두 손상되면 원본을 격리하고 빈 v3 DB를 만든다", async (t) => {
  closeDatabase();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  t.after(() => {
    closeDatabase();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  t.mock.method(console, "error", () => {});

  const dbPath = path.join(userDataDir, "assistant-memory.db");
  fs.writeFileSync(dbPath, Buffer.from("손상된 주 파일"));
  fs.writeFileSync(dbPath + ".bak", Buffer.from("손상된 백업"));

  assert.equal(await initializeDatabase(), true);
  assert.deepEqual(getAllMemories(), []);
  assert.equal(
    fs.readdirSync(userDataDir).filter(name => name.startsWith("assistant-memory.db.corrupt-")).length,
    1
  );
  const database = getDb();
  assert.ok(database);
  assert.deepEqual(database.exec("PRAGMA quick_check")[0]?.values, [["ok"]]);
  assert.deepEqual(
    database.exec("SELECT schema_version FROM memory_meta WHERE id = 1")[0]?.values,
    [[MEMORY_SCHEMA_VERSION]]
  );
});

test("저장 실패 시 모든 변경 API가 실패를 반환하고 인메모리와 파일을 되돌린다", async (t) => {
  closeDatabase();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  t.after(() => {
    closeDatabase();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  t.mock.method(console, "error", () => {});

  let failWrites = false;
  /**
   * @param {string} filePath
   * @param {string | Buffer} data
   * @param {{ backup?: boolean }} [options]
   */
  function injectedDatabaseWriter(filePath, data, options) {
    if (failWrites) {
      throw new Error("주입한 저장 실패");
    }
    writeFileAtomicSync(filePath, data, options);
  }
  const initializeOptions = /** @type {InitializeDatabaseOptions} */ ({
    writeDatabaseFile: injectedDatabaseWriter
  });
  assert.equal(await initializeDatabase(initializeOptions), true);

  assert.equal(insertMemory({
    category: "preference",
    memory_key: "favorite_drink",
    memory_label: "좋아하는 음료",
    memory_value: "라떼"
  }), true);
  const episodeId = insertEpisode({
    session_id: "rollback-session",
    date: "2026-08-11",
    summary: "롤백 기준 에피소드"
  });
  assert.ok(episodeId !== null);
  assert.equal(insertOpenLoop({ episode_id: episodeId, topic: "기준 미완료 주제" }), true);

  const dbPath = path.join(userDataDir, "assistant-memory.db");
  const persistedBeforeFailures = fs.readFileSync(dbPath);
  const baselineMemory = getAllMemories()[0];
  const baselineLoop = getOpenLoops()[0];
  assert.ok(baselineMemory);
  assert.ok(baselineLoop);

  failWrites = true;
  assert.equal(insertMemory({
    category: "fact",
    memory_key: "new_fact",
    memory_label: "새 사실",
    memory_value: "저장되면 안 됨"
  }), null);
  assert.equal(getMemoryCount(), 1);

  assert.equal(insertMemory({
    category: "preference",
    memory_key: "favorite_drink",
    memory_label: "바뀐 음료",
    memory_value: "아메리카노"
  }), null);
  assert.deepEqual(getAllMemories(), [baselineMemory]);

  assert.equal(setMemoryVerified(baselineMemory.id, true), false);
  assert.equal(getAllMemories()[0]?.is_verified, false);
  assert.equal(deleteMemory(baselineMemory.id), false);
  assert.equal(getMemoryCount(), 1);
  assert.equal(archiveAllMemories(), false);
  assert.equal(getMemoryCount(), 1);

  assert.equal(insertOpenLoop({ episode_id: episodeId, topic: "새 미완료 주제" }), null);
  assert.equal(getOpenLoopsCount(), 1);
  assert.equal(insertOpenLoop({ episode_id: episodeId, topic: "기준 미완료 주제" }), null);
  assert.deepEqual(getOpenLoops(), [baselineLoop]);
  assert.equal(closeOpenLoop(baselineLoop.id, "닫히면 안 됨"), false);
  assert.equal(getOpenLoopsCount(), 1);

  assert.equal(insertEpisode({ summary: "저장되면 안 되는 에피소드" }), null);
  assert.equal(getEpisodesCount(), 1);
  assert.deepEqual(fs.readFileSync(dbPath), persistedBeforeFailures);

  failWrites = false;
  assert.equal(insertMemory({
    category: "fact",
    memory_key: "recovered_fact",
    memory_label: "복구 후 사실",
    memory_value: "저장 재개"
  }), true);
  assert.equal(getMemoryCount(), 2);
});

// ── 오래된 미완료 주제 자동 정리 (2026-08-14) ────────────────────────────────────
//
// 프롬프트 노출은 memory-search가 3일로 자르고, 이쪽은 표가 무한정 쌓이는 것만 막는다.
// 방금 넣은 행의 나이를 뒤로 돌릴 수단이 없으므로 기준일을 0/아주 큰 값으로 줘서
// 경계 양쪽을 확인한다.

test("자동 정리는 기준보다 오래된 열린 주제만 닫는다", async (t) => {
  closeDatabase();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  t.after(() => {
    closeDatabase();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  assert.equal(await initializeDatabase(), true);
  const episodeId = insertEpisode({
    session_id: "stale-loop-session",
    date: "2026-08-14",
    summary: "오래된 주제 정리 기준"
  });
  assert.ok(episodeId !== null);
  assert.equal(insertOpenLoop({ episode_id: episodeId, topic: "정리 대상 주제" }), true);
  assert.equal(getOpenLoopsCount(), 1);

  // 기준이 아주 길면 방금 넣은 주제는 살아 있다 — 진행 중인 장기 과제를 닫지 않는다.
  assert.equal(archiveStaleOpenLoops(3650), 0);
  assert.equal(getOpenLoopsCount(), 1);

  // 기준을 0일로 주면 이미 지난 시각의 주제가 닫힌다.
  assert.equal(archiveStaleOpenLoops(0), 1);
  assert.equal(getOpenLoopsCount(), 0);
  assert.deepEqual(getOpenLoops(), [], "닫힌 주제는 열린 목록에서 빠진다");

  // 여러 번 불러도 안전하다(시작할 때마다 부른다) — 닫힌 주제를 다시 세지 않는다.
  assert.equal(archiveStaleOpenLoops(0), 0);
});

test("자동 정리 기준일은 프롬프트 노출 상한보다 훨씬 길다", () => {
  // 둘은 목적이 다르다(꺼내지 않게 / 쌓이지 않게). 기준이 노출 상한까지 내려오면
  // 사용자가 아직 이야기 중인 주제도 표에서 사라진다.
  assert.equal(OPEN_LOOP_ARCHIVE_AGE_DAYS, 14);
  const { OPEN_LOOP_PROMPT_MAX_AGE_DAYS } = require("../src/main/memory/memory-search.js");
  assert.ok(OPEN_LOOP_ARCHIVE_AGE_DAYS > OPEN_LOOP_PROMPT_MAX_AGE_DAYS * 4);
});

test("자동 정리 사유는 앱 언어를 따른다", async (t) => {
  // 예전에는 한국어로 하드코딩돼 영어·일본어 사용자의 기억 DB에도 한국어가 남았다.
  closeDatabase();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  t.after(() => {
    closeDatabase();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  assert.equal(await initializeDatabase(), true);
  const episodeId = insertEpisode({
    session_id: "archive-note-session",
    date: "2026-08-21",
    summary: "정리 사유 언어"
  });
  assert.ok(episodeId !== null);
  assert.equal(insertOpenLoop({ episode_id: episodeId, topic: "정리 사유를 볼 주제" }), true);
  assert.equal(archiveStaleOpenLoops(0, "en"), 1);

  const database = getDb();
  assert.ok(database);
  const notes = String(
    database.exec("SELECT resolution_notes FROM open_loops WHERE is_closed = 1")[0]?.values[0][0]
  );
  assert.match(notes, /Auto-archived/);
  assert.ok(!/일 이상/.test(notes), "영어 설정에 한국어가 섞이지 않는다");
});
