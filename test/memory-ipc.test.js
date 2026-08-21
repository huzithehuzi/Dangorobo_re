const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { registerMemoryIpcHandlers } = require("../src/main/memory/memory-ipc.js");

const MEMORY_CHANNELS = [
  "memory:get-stats",
  "memory:get-all",
  "memory:get-open-loops",
  "memory:get-forgotten",
  "memory:restore-forgotten",
  "memory:verify",
  "memory:unverify",
  "memory:delete",
  "memory:close-loop",
  "memory:import",
  "memory:clear-all"
];

/**
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
function createDependencies(overrides = {}) {
  return {
    isAllowedSender: () => true,
    getMemoryCount: () => 3,
    getOpenLoopsCount: () => 2,
    getEpisodesCount: () => 1,
    getMemoriesByCategory: (/** @type {string} */ category) => [{ category }],
    getAllMemories: () => [{ category: "all" }],
    getOpenLoops: () => [{ id: 1, topic: "후속 주제" }],
    getForgottenMemories: () => [{ id: 9, memory_label: "잊은 것" }],
    restoreForgottenMemory: () => true,
    setMemoryVerified: () => true,
    deleteMemory: () => true,
    closeOpenLoop: () => true,
    insertMemory: () => true,
    archiveAllMemories: () => true,
    validateExtractedMemory: (/** @type {any} */ candidate) => ({
      valid: candidate?.valid === true,
      normalized: candidate?.normalized || null
    }),
    ...overrides
  };
}

/** @param {Record<string, any>} [overrides] */
function createHarness(overrides = {}) {
  /** @type {Map<string, (...args: any[]) => any>} */
  const handlers = new Map();
  const ipcMain = {
    /**
     * @param {string} channel
     * @param {(...args: any[]) => any} listener
     */
    handle(channel, listener) {
      assert.equal(handlers.has(channel), false, `중복 IPC 채널: ${channel}`);
      handlers.set(channel, listener);
    }
  };
  registerMemoryIpcHandlers(/** @type {any} */ (ipcMain), createDependencies(overrides));

  return {
    handlers,
    /**
     * @param {string} channel
     * @param {...any} args
     */
    async invoke(channel, ...args) {
      const handler = handlers.get(channel);
      assert.ok(handler, `등록되지 않은 IPC 채널: ${channel}`);
      return handler({ sender: {} }, ...args);
    },
    /**
     * @param {unknown} sender
     * @param {string} channel
     * @param {...any} args
     */
    async invokeFrom(sender, channel, ...args) {
      const handler = handlers.get(channel);
      assert.ok(handler, `등록되지 않은 IPC 채널: ${channel}`);
      return handler({ sender }, ...args);
    }
  };
}

test("메모리 IPC 9개를 모두 handle로 한 번씩 등록한다", () => {
  const { handlers } = createHarness();
  assert.deepEqual([...handlers.keys()], MEMORY_CHANNELS);
});

test("설정창이 아닌 sender는 9개 채널 모두 거부하고 저장소에 접근하지 않는다", async () => {
  const allowedSender = {};
  let dependencyCalls = 0;
  const forbiddenCall = () => {
    dependencyCalls += 1;
    throw new Error("허용되지 않은 sender가 저장소에 접근함");
  };
  const harness = createHarness({
    isAllowedSender: (/** @type {{ sender: unknown }} */ event) => event.sender === allowedSender,
    getMemoryCount: forbiddenCall,
    getOpenLoopsCount: forbiddenCall,
    getEpisodesCount: forbiddenCall,
    getMemoriesByCategory: forbiddenCall,
    getAllMemories: forbiddenCall,
    getOpenLoops: forbiddenCall,
    setMemoryVerified: forbiddenCall,
    deleteMemory: forbiddenCall,
    closeOpenLoop: forbiddenCall,
    insertMemory: forbiddenCall,
    archiveAllMemories: forbiddenCall,
    validateExtractedMemory: forbiddenCall
  });
  const forbiddenSender = {};

  assert.deepEqual(await harness.invokeFrom(forbiddenSender, "memory:get-stats"), {
    memoryCount: 0,
    loopsCount: 0,
    episodesCount: 0
  });
  assert.deepEqual(await harness.invokeFrom(forbiddenSender, "memory:get-all", "fact"), []);
  assert.deepEqual(await harness.invokeFrom(forbiddenSender, "memory:get-open-loops"), []);
  assert.equal(await harness.invokeFrom(forbiddenSender, "memory:verify", 1), false);
  assert.equal(await harness.invokeFrom(forbiddenSender, "memory:unverify", 1), false);
  assert.equal(await harness.invokeFrom(forbiddenSender, "memory:delete", 1), false);
  assert.equal(await harness.invokeFrom(forbiddenSender, "memory:close-loop", 1, "완료"), false);
  assert.equal(await harness.invokeFrom(forbiddenSender, "memory:import", [{}]), 0);
  assert.equal(await harness.invokeFrom(forbiddenSender, "memory:clear-all"), false);
  assert.equal(dependencyCalls, 0);
});

test("통계 조회는 세 값을 함께 반환하고 하나라도 실패하면 전부 0으로 폴백한다", async () => {
  const success = createHarness();
  assert.deepEqual(await success.invoke("memory:get-stats"), {
    memoryCount: 3,
    loopsCount: 2,
    episodesCount: 1
  });

  const failure = createHarness({
    getOpenLoopsCount: () => {
      throw new Error("통계 실패");
    }
  });
  assert.deepEqual(await failure.invoke("memory:get-stats"), {
    memoryCount: 0,
    loopsCount: 0,
    episodesCount: 0
  });
});

test("분류 유무에 따라 분류 조회와 전체 조회를 나누고 조회 실패는 빈 배열로 폴백한다", async () => {
  /** @type {string[]} */
  const categories = [];
  let allCalls = 0;
  const success = createHarness({
    getMemoriesByCategory: (/** @type {string} */ category) => {
      categories.push(category);
      return [`분류:${category}`];
    },
    getAllMemories: () => {
      allCalls += 1;
      return ["전체"];
    }
  });

  assert.deepEqual(await success.invoke("memory:get-all", "preference"), ["분류:preference"]);
  assert.deepEqual(await success.invoke("memory:get-all", ""), ["전체"]);
  assert.deepEqual(await success.invoke("memory:get-all", null), ["전체"]);
  assert.deepEqual(categories, ["preference"]);
  assert.equal(allCalls, 2);

  const failure = createHarness({
    getAllMemories: () => {
      throw new Error("기억 조회 실패");
    },
    getOpenLoops: () => {
      throw new Error("미완료 주제 조회 실패");
    }
  });
  assert.deepEqual(await failure.invoke("memory:get-all", ""), []);
  assert.deepEqual(await failure.invoke("memory:get-open-loops"), []);
});

test("검증·삭제·미완료 주제 종료·전체 보관을 저장소 연산에 그대로 위임한다", async () => {
  /** @type {Array<[number, boolean]>} */
  const verificationCalls = [];
  /** @type {number[]} */
  const deletedIds = [];
  /** @type {Array<[number, string]>} */
  const closedLoops = [];
  let archiveCalls = 0;
  const harness = createHarness({
    setMemoryVerified: (/** @type {number} */ id, /** @type {boolean} */ verified) => {
      verificationCalls.push([id, verified]);
      return true;
    },
    deleteMemory: (/** @type {number} */ id) => {
      deletedIds.push(id);
      return true;
    },
    closeOpenLoop: (/** @type {number} */ id, /** @type {string} */ notes) => {
      closedLoops.push([id, notes]);
      return true;
    },
    archiveAllMemories: () => {
      archiveCalls += 1;
      return true;
    }
  });

  assert.equal(await harness.invoke("memory:verify", 11), true);
  assert.equal(await harness.invoke("memory:unverify", 12), true);
  assert.equal(await harness.invoke("memory:delete", 13), true);
  assert.equal(await harness.invoke("memory:close-loop", 14, "완료함"), true);
  assert.equal(await harness.invoke("memory:clear-all"), true);
  assert.deepEqual(verificationCalls, [[11, true], [12, false]]);
  assert.deepEqual(deletedIds, [13]);
  assert.deepEqual(closedLoops, [[14, "완료함"]]);
  assert.equal(archiveCalls, 1);

  const failure = createHarness({
    setMemoryVerified: () => { throw new Error("검증 실패"); },
    deleteMemory: () => { throw new Error("삭제 실패"); },
    closeOpenLoop: () => { throw new Error("종료 실패"); },
    archiveAllMemories: () => { throw new Error("전체 보관 실패"); }
  });
  assert.equal(await failure.invoke("memory:verify", 1), false);
  assert.equal(await failure.invoke("memory:unverify", 1), false);
  assert.equal(await failure.invoke("memory:delete", 1), false);
  assert.equal(await failure.invoke("memory:close-loop", 1, ""), false);
  assert.equal(await failure.invoke("memory:clear-all"), false);
});

test("기억과 미완료 주제의 변경 id는 양의 안전한 정수만 허용한다", async () => {
  let mutationCalls = 0;
  const harness = createHarness({
    setMemoryVerified: () => {
      mutationCalls += 1;
      return true;
    },
    deleteMemory: () => {
      mutationCalls += 1;
      return true;
    },
    closeOpenLoop: () => {
      mutationCalls += 1;
      return true;
    }
  });
  const invalidIds = [0, -1, 1.5, NaN, Infinity, "1", null, undefined, Number.MAX_SAFE_INTEGER + 1];

  for (const id of invalidIds) {
    assert.equal(await harness.invoke("memory:verify", id), false);
    assert.equal(await harness.invoke("memory:unverify", id), false);
    assert.equal(await harness.invoke("memory:delete", id), false);
    assert.equal(await harness.invoke("memory:close-loop", id, "완료"), false);
  }
  assert.equal(mutationCalls, 0);
});

test("가져오기는 유효하고 저장에 성공한 항목만 세며 입력을 최대 100개로 제한한다", async () => {
  /** @type {any[]} */
  const inserted = [];
  let validationCalls = 0;
  const harness = createHarness({
    validateExtractedMemory: (/** @type {any} */ candidate) => {
      validationCalls += 1;
      return { valid: candidate.valid, normalized: candidate.normalized ?? null };
    },
    insertMemory: (/** @type {any} */ normalized) => {
      inserted.push(normalized);
      return normalized.save !== false;
    }
  });
  const first = { memory_key: "first", save: true };
  const rejectedByStore = { memory_key: "rejected", save: false };
  const duplicateUpdate = { memory_key: "duplicate", save: true };

  assert.equal(await harness.invoke("memory:import", [
    { valid: true, normalized: first },
    { valid: false, normalized: { memory_key: "invalid" } },
    { valid: true, normalized: rejectedByStore },
    { valid: true, normalized: null },
    { valid: true, normalized: duplicateUpdate }
  ]), 2);
  assert.deepEqual(inserted, [first, rejectedByStore, duplicateUpdate]);
  assert.equal(validationCalls, 5);

  assert.equal(await harness.invoke("memory:import", { valid: true }), 0);
  assert.equal(validationCalls, 5);

  let cappedValidationCalls = 0;
  let cappedInsertCalls = 0;
  const capped = createHarness({
    validateExtractedMemory: (/** @type {any} */ candidate) => {
      cappedValidationCalls += 1;
      return { valid: true, normalized: candidate };
    },
    insertMemory: () => {
      cappedInsertCalls += 1;
      return true;
    }
  });
  const oversized = Array.from({ length: 105 }, (_, index) => ({
    category: "fact",
    memory_key: `memory_${index}`,
    memory_label: `기억 ${index}`,
    memory_value: `값 ${index}`
  }));
  assert.equal(await capped.invoke("memory:import", oversized), 100);
  assert.equal(cappedValidationCalls, 100);
  assert.equal(cappedInsertCalls, 100);
});

test("가져오기 중 예외가 나면 그 전에 실제 저장한 개수를 반환한다", async () => {

  let insertCalls = 0;
  const exception = createHarness({
    validateExtractedMemory: (/** @type {any} */ candidate) => {
      if (candidate === "boom") throw new Error("가져오기 실패");
      return { valid: true, normalized: { memory_key: candidate } };
    },
    insertMemory: () => {
      insertCalls += 1;
      return true;
    }
  });
  assert.equal(await exception.invoke("memory:import", ["saved-first", "boom"]), 1);
  assert.equal(insertCalls, 1);
});

test("저장소 검증 변경과 전체 보관은 기존 성공 의미와 대상 범위를 유지한다", async (t) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-memory-ipc-store-"));
  const electronPath = require.resolve("electron");
  const previousElectron = require.cache[electronPath];
  require.cache[electronPath] = /** @type {any} */ ({
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => userDataDir, getLocale: () => "en-US" } }
  });
  const memorySqlitePath = require.resolve("../src/main/memory/memory-sqlite.js");
  delete require.cache[memorySqlitePath];
  const memoryStore = require("../src/main/memory/memory-sqlite.js");

  t.after(() => {
    memoryStore.closeDatabase();
    delete require.cache[memorySqlitePath];
    if (previousElectron) require.cache[electronPath] = previousElectron;
    else delete require.cache[electronPath];
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  assert.equal(memoryStore.setMemoryVerified(999, true), false);
  assert.equal(memoryStore.archiveAllMemories(), false);
  assert.equal(await memoryStore.initializeDatabase(), true);

  assert.equal(memoryStore.setMemoryVerified(999, true), true);
  assert.equal(memoryStore.insertMemory({
    category: "preference",
    memory_key: "coffee",
    memory_label: "커피 취향",
    memory_value: "라떼를 좋아함"
  }), true);
  const episodeId = memoryStore.insertEpisode({
    session_id: "archive-scope",
    date: "2026-08-11",
    summary: "전체 보관 범위 확인"
  });
  assert.ok(episodeId !== null);
  assert.equal(memoryStore.insertOpenLoop({ episode_id: episodeId, topic: "시험 결과 확인" }), true);

  const database = memoryStore.getDb();
  assert.ok(database);
  const memoryId = database.exec("SELECT id FROM long_term_memory WHERE memory_key = 'coffee'")[0]?.values[0][0];
  if (typeof memoryId !== "number") assert.fail("저장한 기억의 숫자 id를 읽지 못했다");
  assert.equal(memoryStore.setMemoryVerified(memoryId, true), true);
  assert.deepEqual(
    database.exec("SELECT is_verified FROM long_term_memory WHERE id = ?", [memoryId])[0]?.values,
    [[1]]
  );
  assert.equal(memoryStore.setMemoryVerified(memoryId, false), true);
  assert.deepEqual(
    database.exec("SELECT is_verified FROM long_term_memory WHERE id = ?", [memoryId])[0]?.values,
    [[0]]
  );

  assert.equal(memoryStore.getMemoryCount(), 1);
  assert.equal(memoryStore.getOpenLoopsCount(), 1);
  assert.equal(memoryStore.getEpisodesCount(), 1);
  assert.equal(memoryStore.archiveAllMemories(), true);
  assert.equal(memoryStore.getMemoryCount(), 0);
  assert.deepEqual(memoryStore.getAllMemories(), []);
  assert.equal(memoryStore.getOpenLoopsCount(), 1);
  assert.equal(memoryStore.getEpisodesCount(), 1);
  assert.deepEqual(database.exec("SELECT is_archived FROM long_term_memory")[0]?.values, [[1]]);
  assert.deepEqual(database.exec("SELECT is_closed FROM open_loops")[0]?.values, [[0]]);
});

// ── 잊은 기억 조회·되살리기 (2026-08-21) ──────────────────────────────────────────

test("잊은 기억 목록을 돌려준다", async () => {
  const harness = createHarness();
  assert.deepEqual(
    await harness.invoke("memory:get-forgotten"),
    [{ id: 9, memory_label: "잊은 것" }]
  );
});

test("잊은 기억 되살리기는 양의 정수 id만 받는다", async () => {
  /** @type {number[]} */
  const restored = [];
  const harness = createHarness({
    restoreForgottenMemory: (/** @type {number} */ id) => {
      restored.push(id);
      return true;
    }
  });

  assert.equal(await harness.invoke("memory:restore-forgotten", 4), true);
  assert.equal(await harness.invoke("memory:restore-forgotten", 0), false);
  assert.equal(await harness.invoke("memory:restore-forgotten", -1), false);
  assert.equal(await harness.invoke("memory:restore-forgotten", "4"), false);
  assert.equal(await harness.invoke("memory:restore-forgotten", 1.5), false);
  assert.deepEqual(restored, [4], "검증을 통과한 호출만 내려간다");
});

test("잊은 기억 채널도 설정창이 아닌 sender를 막는다", async () => {
  const harness = createHarness({ isAllowedSender: () => false });
  assert.deepEqual(await harness.invoke("memory:get-forgotten"), []);
  assert.equal(await harness.invoke("memory:restore-forgotten", 4), false);
});

test("가져오기는 잊은 기억도 되살리도록 요청한다", async () => {
  // 자동 추출만 is_forgotten에 막힌다 — 사용자가 직접 고른 파일은 되살려야 한다.
  /** @type {unknown[]} */
  const insertOptions = [];
  const harness = createHarness({
    insertMemory: (/** @type {unknown} */ _memory, /** @type {unknown} */ options) => {
      insertOptions.push(options);
      return true;
    }
  });
  const imported = await harness.invoke("memory:import", [
    { valid: true, normalized: { category: "fact", memory_key: "k", memory_label: "l", memory_value: "v" } }
  ]);
  assert.equal(imported, 1);
  assert.deepEqual(insertOptions, [{ allowForgotten: true }]);
});
