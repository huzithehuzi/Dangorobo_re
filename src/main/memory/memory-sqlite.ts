import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import initSqlJs = require("sql.js");
import { detectConflict } from "./memory-extraction.js";
import {
  writeFileAtomicSync,
  quarantineCorruptFile,
  recoverInterruptedAtomicWriteSync
} from "../atomic-file.js";
const { version: APP_VERSION } = require("../../../package.json") as { version: string };
const { t } = require("../../shared/i18n.js");

type SqlJsStatic = initSqlJs.SqlJsStatic;
type Database = initSqlJs.Database;
type SqlValue = initSqlJs.SqlValue;
type DatabaseWriter = typeof writeFileAtomicSync;
type InitializeDatabaseOptions = { writeDatabaseFile?: DatabaseWriter };
type MemoryData = {
  category: string;
  memory_key: string;
  memory_label: string;
  memory_value: string;
  importance?: unknown;
  first_detected_at?: string;
};
type EpisodeData = {
  session_id?: string;
  date?: string;
  summary: string;
  keyTopics?: unknown[];
  importance?: unknown;
  messageCount?: number;
};
type MemoryRow = {
  id: number;
  category: string;
  memory_key: string;
  memory_label: string;
  memory_value: string;
  importance: number;
  first_detected_at?: string;
  last_updated_at: string;
  mention_count: number;
  is_verified: boolean;
  created_at: string;
};
type OpenLoopRow = {
  id: number;
  topic: string;
  mentioned_at: string;
  last_mentioned_at: string;
  is_closed: number;
};

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let writeDatabaseFile = writeFileAtomicSync;

const MEMORY_SCHEMA_VERSION = 4;

function getMemoryDbPath() {
  return path.join(app.getPath("userData"), "assistant-memory.db");
}

async function initializeDatabase(options: InitializeDatabaseOptions = {}) {
  try {
    writeDatabaseFile = options.writeDatabaseFile || writeFileAtomicSync;
    if (!SQL) {
      SQL = await initSqlJs();
    }

    db = openDatabaseWithRecovery(getMemoryDbPath());
    migrateDatabaseSchema();
    if (!saveDatabase()) {
      throw new Error("마이그레이션된 데이터베이스를 저장하지 못했다");
    }
    return true;
  } catch (error) {
    console.error("[MemorySQLite] Database initialization failed:", error);
    // 초기화가 실패했으면 준비 안 된 DB 핸들을 남기지 않는다 —
    // 이후 모든 접근 함수의 `if (!db)` 가드가 정확히 동작하게 된다.
    try {
      db?.close();
    } catch {}
    db = null;
    return false;
  }
}

// DB 파일이 깨져 있으면 .corrupt-<시각>으로 격리하고 .bak(직전 정상본)에서 복구를
// 시도한다. 둘 다 못 쓰면 빈 DB로 시작한다 — 이때 손상 원본은 격리돼 있으므로
// 다음 저장이 덮어써도 증거가 사라지지 않는다.
function openDatabaseWithRecovery(dbPath: string): Database {
  // initializeDatabase()가 SQL을 채운 뒤에만 부르는 함수다. 여기서 던지면 그쪽
  // try/catch가 받아 초기화 실패로 처리한다.
  if (!SQL) throw new Error("[MemorySQLite] sql.js가 아직 초기화되지 않았다");
  const sqlJs = SQL;
  try {
    recoverInterruptedAtomicWriteSync(dbPath);
  } catch (error) {
    console.error("[MemorySQLite] 중단된 원자 저장 복구 실패:", error);
  }
  const candidates = [
    { path: dbPath, label: "본 파일" },
    { path: dbPath + ".bak", label: "백업" }
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.path)) continue;
    try {
      const database = new sqlJs.Database(fs.readFileSync(candidate.path));
      // sql.js는 손상된 버퍼로도 생성 자체는 성공할 수 있어 quick_check로 확인한다.
      const verdict = database.exec("PRAGMA quick_check")[0]?.values?.[0]?.[0];
      if (verdict !== "ok") {
        throw new Error(`quick_check: ${String(verdict)}`);
      }
      if (candidate.path !== dbPath) {
        console.warn(`[MemorySQLite] ${candidate.label}에서 복구했다: ${candidate.path}`);
      }
      return database;
    } catch (error) {
      console.error(`[MemorySQLite] ${candidate.label} 손상 감지: ${candidate.path}`, error);
      if (candidate.path === dbPath) {
        quarantineCorruptFile(dbPath);
      }
    }
  }
  return new sqlJs.Database();
}

function createDomainTables() {
  if (!db) throw new Error("데이터베이스가 초기화되지 않았다");
  db.run(`
      CREATE TABLE IF NOT EXISTS long_term_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        memory_key TEXT NOT NULL UNIQUE,
        memory_label TEXT NOT NULL,
        memory_value TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        first_detected_at TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        mention_count INTEGER DEFAULT 1,
        conflict_notes TEXT,
        is_verified BOOLEAN DEFAULT 0,
        is_archived BOOLEAN DEFAULT 0,
        is_forgotten BOOLEAN DEFAULT 0,
        source_episode_id INTEGER,
        tags TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        date TEXT NOT NULL,
        summary TEXT NOT NULL,
        key_topics TEXT,
        importance REAL DEFAULT 0.5,
        message_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS open_loops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id INTEGER NOT NULL,
        topic TEXT NOT NULL,
        mentioned_at TEXT NOT NULL,
        last_mentioned_at TEXT NOT NULL,
        mention_count INTEGER DEFAULT 1,
        expected_resolution_date TEXT,
        resolution_notes TEXT,
        is_closed BOOLEAN DEFAULT 0,
        closed_at TEXT,
        is_forgotten BOOLEAN DEFAULT 0,
        created_at TEXT NOT NULL
      );
  `);
}

function createBaseIndexes() {
  if (!db) throw new Error("데이터베이스가 초기화되지 않았다");
  db.run(`

      CREATE INDEX IF NOT EXISTS idx_long_term_memory_category
        ON long_term_memory(category);
      CREATE INDEX IF NOT EXISTS idx_long_term_memory_updated
        ON long_term_memory(last_updated_at);
      CREATE INDEX IF NOT EXISTS idx_episodes_date
        ON episodes(date);
      CREATE INDEX IF NOT EXISTS idx_open_loops_closed
        ON open_loops(is_closed);
  `);
}

function tableExists(tableName: string) {
  if (!db) return false;
  return Boolean(db.exec(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  )[0]?.values[0]);
}

function tableColumns(tableName: string): Set<string> {
  if (!db || !tableExists(tableName)) return new Set();
  const rows = db.exec(`PRAGMA table_info(${tableName})`)[0]?.values || [];
  return new Set(rows.map(row => String(row[1])));
}

/** 마이그레이션 상수로만 호출하며 외부 입력을 SQL 식별자로 사용하지 않는다. */
function ensureColumn(tableName: string, columnName: string, definition: string) {
  if (!db) throw new Error("데이터베이스가 초기화되지 않았다");
  if (!tableColumns(tableName).has(columnName)) {
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function ensureVersion2Columns() {
  createDomainTables();
  const columns = {
    long_term_memory: [
      ["conflict_notes", "TEXT"],
      ["is_verified", "BOOLEAN DEFAULT 0"],
      ["is_archived", "BOOLEAN DEFAULT 0"],
      ["source_episode_id", "INTEGER"],
      ["tags", "TEXT"]
    ],
    episodes: [
      ["key_topics", "TEXT"],
      ["importance", "REAL DEFAULT 0.5"],
      ["message_count", "INTEGER DEFAULT 0"]
    ],
    open_loops: [
      ["mention_count", "INTEGER DEFAULT 1"],
      ["expected_resolution_date", "TEXT"],
      ["resolution_notes", "TEXT"],
      ["is_closed", "BOOLEAN DEFAULT 0"],
      ["closed_at", "TEXT"]
    ]
  };
  for (const [tableName, definitions] of Object.entries(columns)) {
    for (const [columnName, definition] of definitions) {
      ensureColumn(tableName, columnName, definition);
    }
  }
  createBaseIndexes();
}

function migrateToVersion1() {
  createDomainTables();
}

function migrateToVersion2() {
  ensureVersion2Columns();
}

function migrateToVersion3() {
  ensureVersion2Columns();
  if (!db) throw new Error("데이터베이스가 초기화되지 않았다");
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_long_term_memory_active_updated
      ON long_term_memory(is_archived, last_updated_at DESC)
  `);
}

// v4: "사용자가 잊어달라고 한 것"을 표시하는 열. 소프트 삭제(is_archived)와 주제 닫기
// (is_closed)만으로는 부족하다 — insertMemory()는 같은 키를 다시 넣으면 아카이브를 풀어
// 되살리고, insertOpenLoop()는 닫힌 주제를 중복으로 보지 않아 같은 주제를 새 행으로
// 다시 만든다. 즉 표시가 없으면 대화 이력에 그 이야기가 남아 있는 동안 추출이 돌 때마다
// 잊은 것이 조용히 돌아온다.
function ensureVersion4Columns() {
  ensureColumn("long_term_memory", "is_forgotten", "BOOLEAN DEFAULT 0");
  ensureColumn("open_loops", "is_forgotten", "BOOLEAN DEFAULT 0");
}

function migrateToVersion4() {
  migrateToVersion3();
  ensureVersion4Columns();
}

const SCHEMA_MIGRATIONS = new Map<number, () => void>([
  [1, migrateToVersion1],
  [2, migrateToVersion2],
  [3, migrateToVersion3],
  [4, migrateToVersion4]
]);

function validateCurrentSchema() {
  const requiredColumns = {
    memory_meta: [
      "id", "schema_version", "app_version", "last_migration_at", "created_at"
    ],
    long_term_memory: [
      "id", "category", "memory_key", "memory_label", "memory_value", "importance",
      "first_detected_at", "last_updated_at", "mention_count", "conflict_notes",
      "is_verified", "is_archived", "is_forgotten", "source_episode_id", "tags", "created_at"
    ],
    episodes: [
      "id", "session_id", "date", "summary", "key_topics", "importance",
      "message_count", "created_at"
    ],
    open_loops: [
      "id", "episode_id", "topic", "mentioned_at", "last_mentioned_at",
      "mention_count", "expected_resolution_date", "resolution_notes", "is_closed",
      "closed_at", "is_forgotten", "created_at"
    ]
  };
  for (const [tableName, expectedColumns] of Object.entries(requiredColumns)) {
    const actualColumns = tableColumns(tableName);
    for (const columnName of expectedColumns) {
      if (!actualColumns.has(columnName)) {
        throw new Error(`${tableName}.${columnName} 열이 없다`);
      }
    }
  }
  const requiredIndexes = [
    "idx_long_term_memory_category",
    "idx_long_term_memory_updated",
    "idx_episodes_date",
    "idx_open_loops_closed",
    "idx_long_term_memory_active_updated"
  ];
  for (const indexName of requiredIndexes) {
    if (!db?.exec(
      "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
      [indexName]
    )[0]?.values[0]) {
      throw new Error(`${indexName} 인덱스가 없다`);
    }
  }
}

function migrateDatabaseSchema() {
  if (!db) throw new Error("데이터베이스가 초기화되지 않았다");
  const hasLegacyTables = ["long_term_memory", "episodes", "open_loops"].some(tableExists);
  db.run("BEGIN TRANSACTION");
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS memory_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        app_version TEXT NOT NULL,
        last_migration_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    const storedRow = db.exec(
      "SELECT schema_version FROM memory_meta WHERE id = 1"
    )[0]?.values[0];
    let storedVersion: number;
    if (storedRow) {
      const rawStoredVersion = storedRow[0];
      if (typeof rawStoredVersion !== "number"
        || !Number.isInteger(rawStoredVersion)
        || rawStoredVersion < 0) {
        throw new Error(`잘못된 스키마 버전: ${String(rawStoredVersion)}`);
      }
      storedVersion = rawStoredVersion;
    } else {
      storedVersion = hasLegacyTables ? 1 : 0;
      const now = new Date().toISOString();
      db.run(`
        INSERT INTO memory_meta (id, schema_version, app_version, last_migration_at, created_at)
        VALUES (1, ?, ?, ?, ?)
      `, [storedVersion, APP_VERSION, now, now]);
    }

    if (storedVersion > MEMORY_SCHEMA_VERSION) {
      throw new Error(
        `지원하지 않는 미래 스키마 버전 ${storedVersion} (현재 ${MEMORY_SCHEMA_VERSION})`
      );
    }
    for (let nextVersion = storedVersion + 1;
      nextVersion <= MEMORY_SCHEMA_VERSION;
      nextVersion += 1) {
      const migrate = SCHEMA_MIGRATIONS.get(nextVersion);
      if (!migrate) {
        throw new Error(`스키마 v${nextVersion} 마이그레이션이 없다`);
      }
      migrate();
      db.run(`
        UPDATE memory_meta
        SET schema_version = ?, app_version = ?, last_migration_at = ?
        WHERE id = 1
      `, [nextVersion, APP_VERSION, new Date().toISOString()]);
    }

    validateCurrentSchema();
    db.run("UPDATE memory_meta SET app_version = ? WHERE id = 1", [APP_VERSION]);
    db.run("COMMIT");
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch {}
    throw error;
  }
}

function saveDatabase() {
  if (!db) return false;

  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    // 원자 저장 + 직전 정상본 .bak 유지 — 쓰다가 중단돼도 DB가 잘리지 않는다.
    writeDatabaseFile(getMemoryDbPath(), buffer, { backup: true });
    return true;
  } catch (error) {
    console.error("[MemorySQLite] Save database failed:", error);
    return false;
  }
}

/**
 * 디스크 저장까지 성공해야 변경을 확정한다. 저장 실패 시 직전 스냅샷으로 인메모리 DB도
 * 되돌려, 실패를 반환한 변경이 같은 프로세스 안에서 보이는 일을 막는다.
 */
function runPersistentMutation<T>(
  operation: string,
  failureValue: T,
  mutation: (database: Database) => T
): T {
  if (!db || !SQL) return failureValue;

  const database = db;
  const sqlJs = SQL;
  let snapshot: Uint8Array | null = null;
  let transactionOpen = false;
  try {
    snapshot = database.export();
    database.run("BEGIN TRANSACTION");
    transactionOpen = true;
    const result = mutation(database);
    database.run("COMMIT");
    transactionOpen = false;
    if (!saveDatabase()) {
      throw new Error("데이터베이스 파일을 저장하지 못했다");
    }
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        database.run("ROLLBACK");
      } catch {}
    }
    if (snapshot) {
      try {
        database.close();
      } catch {}
      db = new sqlJs.Database(snapshot);
    }
    console.error(`[MemorySQLite] ${operation} failed:`, error);
    return failureValue;
  }
}

// memory_key만 완전히 같을 때가 아니라, 같은 분류 안에서 memory_value가
// 의미상 거의 같을 때도(detectConflict === "duplicate") 새 행을 만들지 않고
// 기존 행의 mention_count를 올린다. LLM이 매 추출마다 다른 memory_key를
// 지어내는 경우가 많아 key 일치만으로는 중복을 못 잡기 때문.
// 돌려주는 두 값은 스키마상 long_term_memory.id(INTEGER)와 importance(REAL)라
// 언제나 숫자다. sql.js는 어느 열이든 SqlValue로 주므로 그 자리에서 좁힌다.
function findDuplicateMemory(
  category: string,
  memoryKey: string,
  memoryValue: string
): { id: number; importance: number; isForgotten: boolean } | null {
  if (!db) return null;

  try {
    // memory_key has a UNIQUE constraint over the WHOLE table, including archived
    // (soft-deleted) rows, so an exact key match must be checked regardless of
    // is_archived - otherwise re-saving a previously deleted key throws a UNIQUE
    // constraint error instead of reviving/updating that row.
    const keyMatch = db.exec(
      `SELECT id, importance, is_forgotten FROM long_term_memory WHERE memory_key = ?`,
      [memoryKey]
    );
    const keyRow = keyMatch[0]?.values[0];
    if (keyRow) {
      return {
        id: Number(keyRow[0]),
        importance: Number(keyRow[1]),
        isForgotten: Boolean(keyRow[2])
      };
    }

    const result = db.exec(
      `SELECT id, memory_value, importance, is_forgotten FROM long_term_memory
       WHERE category = ? AND is_archived = 0`,
      [category]
    );

    const rows = result[0]?.values || [];
    for (const row of rows) {
      const [id, existingValue, importance, isForgotten] = row;
      if (detectConflict(memoryValue, existingValue).type === "duplicate") {
        return {
          id: Number(id),
          importance: Number(importance),
          isForgotten: Boolean(isForgotten)
        };
      }
    }
    return null;
  } catch (error) {
    console.error("[MemorySQLite] Find duplicate memory failed:", error);
    return null;
  }
}

/**
 * 기억을 저장한다. 같은 키·같은 뜻의 행이 있으면 새로 만들지 않고 그 행을 갱신한다.
 *
 * **사용자가 잊어달라고 한 행(`is_forgotten`)은 자동 추출이 되살리지 못한다.** 잊으라고 한
 * 사실은 잊은 뒤에도 대화 이력에 한동안 남아 있어서, 막지 않으면 다음 추출이 같은 사실을
 * 다시 넣어 아카이브가 풀린다 — 사용자에게는 "잊어달라 했는데 안 잊는다"로 보인다.
 * 사용자가 직접 하는 가져오기·복원은 `allowForgotten`으로 그 표시를 지우고 되살린다.
 */
function insertMemory(
  memoryData: MemoryData,
  options: { allowForgotten?: boolean } = {}
): true | null {
  if (!db) return null;

  return runPersistentMutation("Insert memory", null, database => {
    const now = new Date().toISOString();
    const duplicate = findDuplicateMemory(memoryData.category, memoryData.memory_key, memoryData.memory_value);

    if (duplicate?.isForgotten && options.allowForgotten !== true) {
      // 성공으로 돌려준다 — 호출부(추출 러너)에는 실패가 아니고, 저장할 것이 없을 뿐이다.
      return true;
    }

    if (duplicate) {
      database.run(
        `UPDATE long_term_memory
         SET memory_value = ?, memory_label = ?, importance = ?, last_updated_at = ?,
             mention_count = mention_count + 1, is_archived = 0, is_forgotten = 0
         WHERE id = ?`,
        [
          memoryData.memory_value,
          memoryData.memory_label,
          Math.min(1, Math.max(0, Number(memoryData.importance) || duplicate.importance || 0.5)),
          now,
          duplicate.id
        ]
      );
      return true;
    }

    database.run(
      `INSERT INTO long_term_memory (
        category, memory_key, memory_label, memory_value,
        importance, first_detected_at, last_updated_at, mention_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        memoryData.category,
        memoryData.memory_key,
        memoryData.memory_label,
        memoryData.memory_value,
        Math.min(1, Math.max(0, Number(memoryData.importance) || 0.5)),
        memoryData.first_detected_at || now,
        now,
        now
      ]
    );
    return true;
  });
}

function getMemoriesByCategory(category: string, limit = 10): MemoryRow[] {
  if (!db) return [];

  try {
    const result = db.exec(
      `SELECT id, category, memory_key, memory_label, memory_value, importance,
              first_detected_at, last_updated_at, mention_count, is_verified, created_at
       FROM long_term_memory
       WHERE category = ? AND is_archived = 0
       ORDER BY last_updated_at DESC, mention_count DESC
       LIMIT ?`,
      [category, limit]
    );

    const rows = result[0]?.values || [];
    return rows.map(row => ({
      id: Number(row[0]),
      category: String(row[1]),
      memory_key: String(row[2]),
      memory_label: String(row[3]),
      memory_value: String(row[4]),
      importance: Number(row[5]),
      first_detected_at: String(row[6]),
      last_updated_at: String(row[7]),
      mention_count: Number(row[8]),
      is_verified: !!row[9],
      created_at: String(row[10])
    }));
  } catch (error) {
    console.error("[MemorySQLite] Get memories by category failed:", error);
    return [];
  }
}

function searchMemories(keywords: string[], limit = 5): MemoryRow[] {
  if (!db || !Array.isArray(keywords) || keywords.length === 0) return [];

  try {
    const placeholders = keywords.map(() => "(memory_key LIKE ? OR memory_label LIKE ?)").join(" OR ");
    const params: SqlValue[] = [];
    keywords.forEach(kw => {
      params.push(`%${kw}%`, `%${kw}%`);
    });
    params.push(limit);

    const result = db.exec(
      `SELECT id, category, memory_key, memory_label, memory_value, importance,
              last_updated_at, mention_count, is_verified, created_at
       FROM long_term_memory
       WHERE is_archived = 0 AND (${placeholders})
       ORDER BY last_updated_at DESC, mention_count DESC
       LIMIT ?`,
      params
    );

    const rows = result[0]?.values || [];
    return rows.map(row => ({
      id: Number(row[0]),
      category: String(row[1]),
      memory_key: String(row[2]),
      memory_label: String(row[3]),
      memory_value: String(row[4]),
      importance: Number(row[5]),
      last_updated_at: String(row[6]),
      mention_count: Number(row[7]),
      is_verified: !!row[8],
      created_at: String(row[9])
    }));
  } catch (error) {
    console.error("[MemorySQLite] Search memories failed:", error);
    return [];
  }
}

function deleteMemory(memoryId: number): boolean {
  if (!db) return false;

  return runPersistentMutation("Delete memory", false, database => {
    database.run(
      `UPDATE long_term_memory SET is_archived = 1 WHERE id = ?`,
      [memoryId]
    );
    return true;
  });
}

/**
 * 사용자가 잊어달라고 한 기억. 소프트 삭제에 "되살리지 말라" 표시를 함께 세운다.
 * 표시가 없으면 다음 추출이 같은 사실을 다시 넣어 아카이브가 풀린다(insertMemory 참고).
 */
function forgetMemory(memoryId: number): boolean {
  if (!db) return false;

  return runPersistentMutation("Forget memory", false, database => {
    database.run(
      `UPDATE long_term_memory SET is_archived = 1, is_forgotten = 1 WHERE id = ?`,
      [memoryId]
    );
    return true;
  });
}

/**
 * 잊은 기억을 되살린다. 사용자가 기억 관리 탭에서 직접 부르는 경로 — 잘못 잊은 것을
 * 되돌릴 수단이 없으면 `is_forgotten`이 영구히 그 사실을 다시 배우지 못하게 막는다.
 */
function restoreForgottenMemory(memoryId: number): boolean {
  if (!db) return false;

  return runPersistentMutation("Restore forgotten memory", false, database => {
    database.run(
      `UPDATE long_term_memory SET is_archived = 0, is_forgotten = 0, last_updated_at = ?
       WHERE id = ?`,
      [new Date().toISOString(), memoryId]
    );
    return true;
  });
}

/** 잊은 기억 목록. 기억 관리 탭이 복원 버튼과 함께 보여준다. */
function getForgottenMemories(limit = 100): MemoryRow[] {
  if (!db) return [];

  try {
    const result = db.exec(
      `SELECT id, category, memory_key, memory_label, memory_value, importance,
              last_updated_at, mention_count, is_verified, created_at
       FROM long_term_memory WHERE is_forgotten = 1 ORDER BY last_updated_at DESC LIMIT ?`,
      [limit]
    );

    const rows = result[0]?.values || [];
    return rows.map(row => ({
      id: Number(row[0]),
      category: String(row[1]),
      memory_key: String(row[2]),
      memory_label: String(row[3]),
      memory_value: String(row[4]),
      importance: Number(row[5]),
      last_updated_at: String(row[6]),
      mention_count: Number(row[7]),
      is_verified: !!row[8],
      created_at: String(row[9])
    }));
  } catch (error) {
    console.error("[MemorySQLite] Get forgotten memories failed:", error);
    return [];
  }
}

function getForgottenMemoryCount(): number {
  if (!db) return 0;

  try {
    const result = db.exec(
      `SELECT COUNT(*) FROM long_term_memory WHERE is_forgotten = 1`
    );
    return Number(result[0]?.values[0][0]) || 0;
  } catch (error) {
    console.error("[MemorySQLite] Get forgotten memory count failed:", error);
    return 0;
  }
}

function setMemoryVerified(memoryId: number, verified: boolean): boolean {
  if (!db) return false;
  return runPersistentMutation("Set memory verified", false, database => {
    database.run(
      `UPDATE long_term_memory SET is_verified = ? WHERE id = ?`,
      [verified ? 1 : 0, memoryId]
    );
    return true;
  });
}

/**
 * 활성 장기 기억만 소프트 삭제한다. 미완료 주제와 에피소드는 별도 수명 주기를
 * 가지므로 설정창의 이 작업으로 변경하지 않는다.
 */
function archiveAllMemories(): boolean {
  if (!db) return false;
  return runPersistentMutation("Archive all memories", false, database => {
    database.run(`UPDATE long_term_memory SET is_archived = 1`);
    return true;
  });
}

function getMemoryCount(): number {
  if (!db) return 0;

  try {
    const result = db.exec(
      `SELECT COUNT(*) as count FROM long_term_memory WHERE is_archived = 0`
    );

    return Number(result[0]?.values[0][0]) || 0;
  } catch (error) {
    console.error("[MemorySQLite] Get memory count failed:", error);
    return 0;
  }
}

function findDuplicateOpenLoop(topic: string): { id: number } | null {
  if (!db) return null;

  try {
    const result = db.exec(
      `SELECT id, topic FROM open_loops WHERE is_closed = 0`
    );

    const rows = result[0]?.values || [];
    for (const row of rows) {
      const [id, existingTopic] = row;
      if (detectConflict(topic, existingTopic).type === "duplicate") {
        return { id: Number(id) };
      }
    }
    return null;
  } catch (error) {
    console.error("[MemorySQLite] Find duplicate open loop failed:", error);
    return null;
  }
}

/**
 * 사용자가 잊어달라고 해서 닫은 주제 중 같은 주제를 찾는다.
 *
 * `findDuplicateOpenLoop()`는 열린 주제만 본다 — 닫힌 주제는 중복으로 보지 않으므로
 * 표시가 없으면 잊은 주제가 **새 행으로** 다시 만들어진다. 자동 정리로 닫힌 주제는
 * 여기 걸리지 않는다(다시 이야기하면 되살아나는 게 맞다).
 */
function findForgottenOpenLoop(topic: string): { id: number } | null {
  if (!db) return null;

  try {
    const result = db.exec(
      `SELECT id, topic FROM open_loops WHERE is_closed = 1 AND is_forgotten = 1`
    );

    const rows = result[0]?.values || [];
    for (const row of rows) {
      const [id, existingTopic] = row;
      if (detectConflict(topic, existingTopic).type === "duplicate") {
        return { id: Number(id) };
      }
    }
    return null;
  } catch (error) {
    console.error("[MemorySQLite] Find forgotten open loop failed:", error);
    return null;
  }
}

/**
 * 사용자가 잊어달라고 한 미완료 주제를 닫는다. 자동 정리·해결 판정과 달리 "다시 만들지
 * 말라" 표시를 함께 세운다 — 그 이야기가 대화 이력에 남아 있는 동안 추출이 같은 주제를
 * 새 행으로 다시 만드는 것을 막는다.
 */
function forgetOpenLoop(loopId: number, resolutionNotes: string): boolean {
  if (!db) return false;

  return runPersistentMutation("Forget open loop", false, database => {
    database.run(
      `UPDATE open_loops SET is_closed = 1, closed_at = ?, resolution_notes = ?, is_forgotten = 1
       WHERE id = ?`,
      [new Date().toISOString(), resolutionNotes, loopId]
    );
    return true;
  });
}

// episode_id는 스키마가 INTEGER NOT NULL이라 필수다.
function insertOpenLoop(loopData: { episode_id: number; topic: string }): true | null {
  if (!db) return null;

  if (findForgottenOpenLoop(loopData.topic)) {
    // 성공으로 돌려준다 — 호출부에는 실패가 아니고, 만들 것이 없을 뿐이다.
    return true;
  }

  return runPersistentMutation("Insert open loop", null, database => {
    const now = new Date().toISOString();
    const duplicate = findDuplicateOpenLoop(loopData.topic);

    if (duplicate) {
      database.run(
        `UPDATE open_loops SET last_mentioned_at = ?, mention_count = mention_count + 1 WHERE id = ?`,
        [now, duplicate.id]
      );
      return true;
    }

    database.run(
      `INSERT INTO open_loops (
        episode_id, topic, mentioned_at, last_mentioned_at, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [loopData.episode_id, loopData.topic, now, now, now]
    );
    return true;
  });
}

function getOpenLoops(limit = 10): OpenLoopRow[] {
  if (!db) return [];

  try {
    const result = db.exec(
      `SELECT id, topic, mentioned_at, last_mentioned_at, is_closed
       FROM open_loops WHERE is_closed = 0 ORDER BY last_mentioned_at DESC LIMIT ?`,
      [limit]
    );

    const rows = result[0]?.values || [];
    return rows.map(row => ({
      id: Number(row[0]),
      topic: String(row[1]),
      mentioned_at: String(row[2]),
      last_mentioned_at: String(row[3]),
      is_closed: Number(row[4])
    }));
  } catch (error) {
    console.error("[MemorySQLite] Get open loops failed:", error);
    return [];
  }
}

function closeOpenLoop(loopId: number, resolutionNotes: string): boolean {
  if (!db) return false;

  return runPersistentMutation("Close open loop", false, database => {
    const now = new Date().toISOString();
    database.run(
      `UPDATE open_loops SET is_closed = 1, closed_at = ?, resolution_notes = ? WHERE id = ?`,
      [now, resolutionNotes, loopId]
    );
    return true;
  });
}

// 아주 오래 언급되지 않은 미완료 주제를 닫는 기준. 프롬프트 노출 상한
// (`OPEN_LOOP_PROMPT_MAX_AGE_DAYS`, 3일)과는 목적이 다르다 — 그쪽은 "펫이 스스로 꺼내지
// 않게", 이쪽은 "표가 무한정 쌓이지 않게"다. 그래서 더 길게 잡는다.
// 2026-08-21에 반년에서 2주로 줄였다(사용자 피드백: 쓸데없는 주제가 계속 쌓인다).
// 노출 상한이 3일이므로 그 사이 열린 주제는 어차피 펫이 먼저 꺼내지 않고, 사용자가
// 다시 언급하면 last_mentioned_at이 갱신돼 기준이 다시 밀린다 — 진행 중인 일은
// "이야기하는 동안" 살아 있고 잊힌 일만 닫힌다.
const OPEN_LOOP_ARCHIVE_AGE_DAYS = 14;

// 정리 대상을 세는 조건. 마지막 언급 시각을 못 읽는 행은 남긴다 — 프롬프트 필터와 같은 판단이다.
const STALE_OPEN_LOOP_CONDITION =
  "is_closed = 0 AND last_mentioned_at IS NOT NULL AND last_mentioned_at < ?";

/**
 * 기준일보다 오래 언급되지 않은 열린 주제를 닫는다. 이미 닫힌 주제는 건드리지 않으므로
 * 여러 번 불러도 안전하다(시작할 때와 기억 추출 뒤에 부른다). 닫은 개수를 돌려준다.
 *
 * **닫을 게 있는지 먼저 읽기 전용으로 확인하고, 있을 때만 트랜잭션에 들어간다.**
 * `runPersistentMutation()`은 롤백용 스냅샷을 위해 DB 전체를 export하고 성공하면 파일을
 * 통째로 다시 쓴다 — 아무것도 닫지 않는 호출까지 그 비용을 치르면 대화 몇 턴마다 DB를
 * 헛되게 저장한다(호출 빈도를 올린 2026-08-21에 드러났다).
 */
function archiveStaleOpenLoops(
  maxAgeDays = OPEN_LOOP_ARCHIVE_AGE_DAYS,
  language = "en"
): number {
  if (!db) return 0;

  const now = new Date();
  const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  let pendingCount = 0;
  try {
    const pending = db.exec(
      `SELECT COUNT(*) FROM open_loops WHERE ${STALE_OPEN_LOOP_CONDITION}`,
      [cutoff]
    );
    pendingCount = Number(pending[0]?.values[0][0]) || 0;
  } catch (error) {
    console.error("[MemorySQLite] Count stale open loops failed:", error);
    return 0;
  }
  if (pendingCount === 0) return 0;

  return runPersistentMutation("Archive stale open loops", 0, database => {
    database.run(
      `UPDATE open_loops SET is_closed = 1, closed_at = ?, resolution_notes = ?
       WHERE ${STALE_OPEN_LOOP_CONDITION}`,
      [
        now.toISOString(),
        t(language, "memory.openLoopAutoArchivedNote", { days: maxAgeDays }),
        cutoff
      ]
    );
    return pendingCount;
  });
}

function getOpenLoopsCount(): number {
  if (!db) return 0;

  try {
    const result = db.exec(
      `SELECT COUNT(*) as count FROM open_loops WHERE is_closed = 0`
    );

    return Number(result[0]?.values[0][0]) || 0;
  } catch (error) {
    console.error("[MemorySQLite] Get open loops count failed:", error);
    return 0;
  }
}

function insertEpisode(episodeData: EpisodeData): number | null {
  if (!db) return null;

  return runPersistentMutation("Insert episode", null, database => {
    const now = new Date().toISOString();
    database.run(
      `INSERT INTO episodes (
        session_id, date, summary, key_topics, importance, message_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        episodeData.session_id || `session-${Date.now()}`,
        episodeData.date || now.split("T")[0],
        episodeData.summary,
        JSON.stringify(episodeData.keyTopics || []),
        Math.min(1, Math.max(0, Number(episodeData.importance) || 0.5)),
        episodeData.messageCount || 0,
        now
      ]
    );
    const result = database.exec("SELECT last_insert_rowid() AS id");
    const episodeId = result[0]?.values[0]?.[0];
    if (typeof episodeId !== "number" || !Number.isSafeInteger(episodeId) || episodeId <= 0) {
      throw new Error("새 에피소드의 id를 읽지 못했다");
    }
    return episodeId;
  });
}

function getEpisodesCount(): number {
  if (!db) return 0;

  try {
    const result = db.exec(`SELECT COUNT(*) as count FROM episodes`);
    return Number(result[0]?.values[0][0]) || 0;
  } catch (error) {
    console.error("[MemorySQLite] Get episodes count failed:", error);
    return 0;
  }
}

function getAllMemories(limit = 100): MemoryRow[] {
  if (!db) return [];

  try {
    const result = db.exec(
      `SELECT id, category, memory_key, memory_label, memory_value, importance,
              last_updated_at, mention_count, is_verified, created_at
       FROM long_term_memory WHERE is_archived = 0 ORDER BY last_updated_at DESC LIMIT ?`,
      [limit]
    );

    const rows = result[0]?.values || [];
    return rows.map(row => ({
      id: Number(row[0]),
      category: String(row[1]),
      memory_key: String(row[2]),
      memory_label: String(row[3]),
      memory_value: String(row[4]),
      importance: Number(row[5]),
      last_updated_at: String(row[6]),
      mention_count: Number(row[7]),
      is_verified: !!row[8],
      created_at: String(row[9])
    }));
  } catch (error) {
    console.error("[MemorySQLite] Get all memories failed:", error);
    return [];
  }
}

function closeDatabase() {
  if (db) {
    try {
      saveDatabase();
      db.close();
    } catch {}
    db = null;
  }
  writeDatabaseFile = writeFileAtomicSync;
}

export {
  MEMORY_SCHEMA_VERSION,
  initializeDatabase,
  getMemoryDbPath,
  insertMemory,
  getMemoriesByCategory,
  searchMemories,
  deleteMemory,
  forgetMemory,
  restoreForgottenMemory,
  getForgottenMemories,
  getForgottenMemoryCount,
  setMemoryVerified,
  archiveAllMemories,
  getMemoryCount,
  insertOpenLoop,
  getOpenLoops,
  closeOpenLoop,
  forgetOpenLoop,
  archiveStaleOpenLoops,
  OPEN_LOOP_ARCHIVE_AGE_DAYS,
  getOpenLoopsCount,
  insertEpisode,
  getEpisodesCount,
  getAllMemories,
  closeDatabase,
  saveDatabase,
  getDb
};
export type { DatabaseWriter, EpisodeData, InitializeDatabaseOptions, MemoryData, MemoryRow, OpenLoopRow };

function getDb(): Database | null {
  return db;
}
