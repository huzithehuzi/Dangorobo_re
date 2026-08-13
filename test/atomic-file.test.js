// @ts-check
// 원자적 저장/복구 헬퍼 회귀 테스트 (2026-08-10, P0-3).
// Electron 없이 순수 Node로 실행된다: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  writeFileAtomicSync,
  recoverInterruptedAtomicWriteSync,
  readJsonWithRecovery,
  quarantineCorruptFile
} = require("../src/main/atomic-file.js");

/** @param {string} name @returns {string} */
function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dangorobo-${name}-`));
}

/**
 * @param {(oldPath: import("node:fs").PathLike, newPath: import("node:fs").PathLike) => void} renameSync
 * @returns {import("../src/main/atomic-file.js").AtomicWriteFileSystem}
 */
function injectedFileSystem(renameSync) {
  return {
    writeFileSync: fs.writeFileSync.bind(fs),
    existsSync: fs.existsSync.bind(fs),
    copyFileSync: fs.copyFileSync.bind(fs),
    renameSync,
    rmSync: fs.rmSync.bind(fs)
  };
}

/** @param {string} code */
function fileSystemError(code) {
  const error = /** @type {NodeJS.ErrnoException} */ (new Error(`주입 오류: ${code}`));
  error.code = code;
  return error;
}

test("writeFileAtomicSync: 내용을 저장하고 임시 파일을 남기지 않는다", () => {
  const dir = tempDir("write");
  const filePath = path.join(dir, "data.json");
  writeFileAtomicSync(filePath, JSON.stringify({ a: 1 }));
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { a: 1 });
  assert.equal(fs.existsSync(filePath + ".tmp"), false);
});

test("writeFileAtomicSync: backup 옵션이 직전 정상본을 .bak으로 남긴다", () => {
  const dir = tempDir("backup");
  const filePath = path.join(dir, "data.json");
  writeFileAtomicSync(filePath, JSON.stringify({ version: 1 }), { backup: true });
  assert.equal(fs.existsSync(filePath + ".bak"), false);
  writeFileAtomicSync(filePath, JSON.stringify({ version: 2 }), { backup: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { version: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath + ".bak", "utf8")), { version: 1 });
});

test("writeFileAtomicSync: Buffer도 저장할 수 있다", () => {
  const dir = tempDir("buffer");
  const filePath = path.join(dir, "data.bin");
  const payload = Buffer.from([1, 2, 3, 4]);
  writeFileAtomicSync(filePath, payload, { backup: true });
  assert.deepEqual(fs.readFileSync(filePath), payload);
});

test("writeFileAtomicSync: Windows의 첫 교체 실패는 원본을 보존한 채 안전하게 재시도한다", () => {
  const dir = tempDir("windows-replace-retry");
  const filePath = path.join(dir, "data.json");
  fs.writeFileSync(filePath, "이전 내용", "utf8");
  let renameCount = 0;
  const fileSystem = injectedFileSystem((oldPath, newPath) => {
    renameCount += 1;
    if (renameCount === 1) {
      throw fileSystemError("EPERM");
    }
    fs.renameSync(oldPath, newPath);
  });

  writeFileAtomicSync(filePath, "새 내용", {}, {
    fileSystem,
    platform: "win32",
    createRollbackPath: target => target + ".rollback-test"
  });

  assert.equal(renameCount, 3);
  assert.equal(fs.readFileSync(filePath, "utf8"), "새 내용");
  assert.equal(fs.existsSync(filePath + ".tmp"), false);
  assert.equal(fs.existsSync(filePath + ".rollback-test"), false);
});

test("writeFileAtomicSync: 새 파일 설치 실패 시 backup 없이도 원본을 복원한다", () => {
  const dir = tempDir("windows-install-rollback");
  const filePath = path.join(dir, "keys.json");
  fs.writeFileSync(filePath, "이전 API 키", "utf8");
  let renameCount = 0;
  const fileSystem = injectedFileSystem((oldPath, newPath) => {
    renameCount += 1;
    if (renameCount === 1) {
      throw fileSystemError("EACCES");
    }
    if (renameCount === 3) {
      throw fileSystemError("EIO");
    }
    fs.renameSync(oldPath, newPath);
  });

  assert.throws(
    () => writeFileAtomicSync(filePath, "새 API 키", {}, {
      fileSystem,
      platform: "win32",
      createRollbackPath: target => target + ".rollback-test"
    }),
    /새 파일 설치에 실패해 원본을 복원했다/
  );
  assert.equal(renameCount, 4);
  assert.equal(fs.readFileSync(filePath, "utf8"), "이전 API 키");
  assert.equal(fs.existsSync(filePath + ".tmp"), false);
  assert.equal(fs.existsSync(filePath + ".rollback-test"), false);
});

test("writeFileAtomicSync: 원본 복원도 실패하면 모든 단계 오류와 복구 후보를 보고한다", () => {
  const dir = tempDir("windows-restore-failure");
  const filePath = path.join(dir, "keys.json");
  const rollbackPath = filePath + ".rollback-test";
  fs.writeFileSync(filePath, "이전 API 키", "utf8");
  let renameCount = 0;
  const fileSystem = injectedFileSystem((oldPath, newPath) => {
    renameCount += 1;
    if (renameCount === 1) {
      throw fileSystemError("EPERM");
    }
    if (renameCount === 3) {
      throw fileSystemError("EIO");
    }
    if (renameCount === 4) {
      throw fileSystemError("EBUSY");
    }
    fs.renameSync(oldPath, newPath);
  });

  assert.throws(
    () => writeFileAtomicSync(filePath, "새 API 키", {}, {
      fileSystem,
      platform: "win32",
      createRollbackPath: () => rollbackPath
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /새 파일 설치와 원본 복원에 모두 실패했다/);
      assert.match(error.message, /\.rollback-test/);
      assert.deepEqual(error.errors.map(item => item.code), ["EPERM", "EIO", "EBUSY"]);
      return true;
    }
  );
  assert.equal(renameCount, 4);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.readFileSync(rollbackPath, "utf8"), "이전 API 키");
  assert.equal(fs.readFileSync(filePath + ".tmp", "utf8"), "새 API 키");
});

test("writeFileAtomicSync: Windows가 아닌 플랫폼의 rename 오류에는 교체 폴백을 쓰지 않는다", () => {
  const dir = tempDir("non-windows-replace-error");
  const filePath = path.join(dir, "data.json");
  fs.writeFileSync(filePath, "이전 내용", "utf8");
  let renameCount = 0;
  const initialError = fileSystemError("EPERM");
  const fileSystem = injectedFileSystem(() => {
    renameCount += 1;
    throw initialError;
  });

  assert.throws(
    () => writeFileAtomicSync(filePath, "새 내용", {}, {
      fileSystem,
      platform: "darwin"
    }),
    error => error === initialError
  );
  assert.equal(renameCount, 1);
  assert.equal(fs.readFileSync(filePath, "utf8"), "이전 내용");
});

test("중단 복구: primary가 없으면 단일 rollback 원본을 복원하고 temp를 버린다", () => {
  const dir = tempDir("interrupted-restore");
  const filePath = path.join(dir, "data.json");
  const rollbackPath = filePath + ".rollback-100-200-1";
  fs.writeFileSync(rollbackPath, "이전 내용", "utf8");
  fs.writeFileSync(filePath + ".tmp", "새 내용", "utf8");

  assert.deepEqual(
    recoverInterruptedAtomicWriteSync(filePath),
    { status: "restored", rollbackPath }
  );
  assert.equal(fs.readFileSync(filePath, "utf8"), "이전 내용");
  assert.equal(fs.existsSync(rollbackPath), false);
  assert.equal(fs.existsSync(filePath + ".tmp"), false);
});

test("중단 복구: primary가 있으면 설치 완료로 보고 오래된 rollback과 temp를 정리한다", () => {
  const dir = tempDir("interrupted-cleanup");
  const filePath = path.join(dir, "data.json");
  fs.writeFileSync(filePath, "새 내용", "utf8");
  fs.writeFileSync(filePath + ".rollback-100-200-1", "이전 내용 1", "utf8");
  fs.writeFileSync(filePath + ".rollback-100-201-2", "이전 내용 2", "utf8");
  fs.writeFileSync(filePath + ".tmp", "중단된 다음 내용", "utf8");

  assert.deepEqual(recoverInterruptedAtomicWriteSync(filePath), { status: "cleaned" });
  assert.equal(fs.readFileSync(filePath, "utf8"), "새 내용");
  assert.deepEqual(fs.readdirSync(dir), ["data.json"]);
});

test("중단 복구: 최초 저장의 temp만 있으면 primary로 승격한다", () => {
  const dir = tempDir("interrupted-promote");
  const filePath = path.join(dir, "data.json");
  fs.writeFileSync(filePath + ".tmp", "첫 내용", "utf8");

  assert.deepEqual(recoverInterruptedAtomicWriteSync(filePath), { status: "promoted" });
  assert.equal(fs.readFileSync(filePath, "utf8"), "첫 내용");
  assert.equal(fs.existsSync(filePath + ".tmp"), false);
});

test("중단 복구: primary 없이 rollback 후보가 여러 개면 추측하지 않고 모두 보존한다", () => {
  const dir = tempDir("interrupted-ambiguous");
  const filePath = path.join(dir, "data.json");
  const firstRollback = filePath + ".rollback-100-200-1";
  const secondRollback = filePath + ".rollback-101-300-1";
  fs.writeFileSync(firstRollback, "후보 1", "utf8");
  fs.writeFileSync(secondRollback, "후보 2", "utf8");

  assert.throws(
    () => recoverInterruptedAtomicWriteSync(filePath),
    /rollback 후보가 여러 개라 자동 복구할 수 없다/
  );
  assert.equal(fs.readFileSync(firstRollback, "utf8"), "후보 1");
  assert.equal(fs.readFileSync(secondRollback, "utf8"), "후보 2");
  assert.equal(fs.existsSync(filePath), false);
});

test("중단 복구: 저장 디렉터리가 아직 없어도 정상적인 미저장 상태로 처리한다", () => {
  const dir = tempDir("interrupted-missing-directory");
  const filePath = path.join(dir, "not-created", "data.json");

  assert.deepEqual(recoverInterruptedAtomicWriteSync(filePath), { status: "none" });
});

test("readJsonWithRecovery: 정상 파일은 그대로 읽는다", () => {
  const dir = tempDir("read-ok");
  const filePath = path.join(dir, "data.json");
  writeFileAtomicSync(filePath, JSON.stringify({ ok: true }));
  const result = readJsonWithRecovery(filePath);
  assert.equal(result.status, "ok");
  assert.equal(result.recoveredFromBackup, false);
  assert.deepEqual(result.data, { ok: true });
});

test("readJsonWithRecovery: 파일 없음은 missing으로 구분한다", () => {
  const dir = tempDir("read-missing");
  const result = readJsonWithRecovery(path.join(dir, "none.json"));
  assert.equal(result.status, "missing");
});

test("readJsonWithRecovery: 본 파일 손상 시 격리하고 .bak에서 복구한다", () => {
  const dir = tempDir("read-recover");
  const filePath = path.join(dir, "data.json");
  fs.writeFileSync(filePath + ".bak", JSON.stringify({ from: "backup" }), "utf8");
  fs.writeFileSync(filePath, "{ 잘린 JSON", "utf8");
  const result = readJsonWithRecovery(filePath);
  assert.equal(result.status, "ok");
  assert.equal(result.recoveredFromBackup, true);
  assert.deepEqual(result.data, { from: "backup" });
  // 손상 원본은 사라지지 않고 .corrupt-*로 격리돼 있어야 한다.
  assert.equal(fs.existsSync(filePath), false);
  const quarantined = fs.readdirSync(dir).filter((name) => name.includes(".corrupt-"));
  assert.equal(quarantined.length, 1);
});

test("readJsonWithRecovery: 본 파일과 백업이 모두 손상이면 corrupt를 돌려준다", () => {
  const dir = tempDir("read-corrupt");
  const filePath = path.join(dir, "data.json");
  fs.writeFileSync(filePath, "깨진 내용", "utf8");
  fs.writeFileSync(filePath + ".bak", "이것도 깨짐", "utf8");
  const result = readJsonWithRecovery(filePath);
  assert.equal(result.status, "corrupt");
  const quarantined = fs.readdirSync(dir).filter((name) => name.includes(".corrupt-"));
  assert.equal(quarantined.length, 1);
});

test("readJsonWithRecovery: JSON 구조가 잘못된 본 파일도 격리하고 검증된 백업을 읽는다", () => {
  const dir = tempDir("read-invalid-shape");
  const filePath = path.join(dir, "data.json");
  fs.writeFileSync(filePath, JSON.stringify({}), "utf8");
  fs.writeFileSync(filePath + ".bak", JSON.stringify({ items: [] }), "utf8");
  const result = readJsonWithRecovery(filePath, {
    validate: (value) => Boolean(
      value && typeof value === "object" && Array.isArray(/** @type {any} */ (value).items)
    )
  });
  assert.equal(result.status, "ok");
  assert.equal(result.recoveredFromBackup, true);
  assert.deepEqual(result.data, { items: [] });
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes(".corrupt-")).length, 1);
});

test("readJsonWithRecovery: 백업도 구조 검증에 실패하면 corrupt를 돌려준다", () => {
  const dir = tempDir("read-invalid-shapes");
  const filePath = path.join(dir, "data.json");
  fs.writeFileSync(filePath, JSON.stringify({}), "utf8");
  fs.writeFileSync(filePath + ".bak", JSON.stringify([]), "utf8");
  const result = readJsonWithRecovery(filePath, {
    validate: (value) => Boolean(
      value && typeof value === "object" && Array.isArray(/** @type {any} */ (value).items)
    )
  });
  assert.equal(result.status, "corrupt");
});

test("quarantineCorruptFile: 원본을 .corrupt-<시각>으로 옮긴다", () => {
  const dir = tempDir("quarantine");
  const filePath = path.join(dir, "bad.json");
  fs.writeFileSync(filePath, "x", "utf8");
  const quarantinePath = quarantineCorruptFile(filePath);
  assert.ok(quarantinePath && quarantinePath.startsWith(filePath + ".corrupt-"));
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.readFileSync(quarantinePath, "utf8"), "x");
});

test("저장-로드 왕복: 저장한 값이 그대로 돌아온다", () => {
  const dir = tempDir("roundtrip");
  const filePath = path.join(dir, "settings.json");
  const value = { language: "ko", paletteSteps: 6, nested: { list: [1, 2, 3] } };
  writeFileAtomicSync(filePath, JSON.stringify(value, null, 2), { backup: true });
  const result = readJsonWithRecovery(filePath);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.data, value);
});
