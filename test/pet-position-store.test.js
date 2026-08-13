const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  loadPetPosition,
  normalizePetPosition,
  savePetPosition
} = require("../src/main/pet-position-store.js");

function makeFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-position-"));
  return {
    directory,
    filePath: path.join(directory, "pet-position.json")
  };
}

test("위치 정규화는 유한 좌표만 반올림한다", () => {
  assert.deepEqual(normalizePetPosition({ x: 10.4, y: -20.6 }), { x: 10, y: -21 });
  assert.equal(normalizePetPosition({ x: Infinity, y: 1 }), undefined);
  assert.equal(normalizePetPosition({ x: 1 }), undefined);
  assert.equal(normalizePetPosition(null), undefined);
});

test("위치 저장은 직전 정상본을 백업하고 정상 파일을 다시 읽는다", (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

  savePetPosition(fixture.filePath, { x: 10, y: 20 });
  savePetPosition(fixture.filePath, { x: 30, y: 40 });

  assert.deepEqual(loadPetPosition(fixture.filePath), {
    position: { x: 30, y: 40 },
    status: "ok",
    recoveredFromBackup: false
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(fixture.filePath + ".bak", "utf8")), {
    x: 10,
    y: 20
  });
});

test("손상된 위치 파일은 격리하고 백업 위치를 복구한다", (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  fs.writeFileSync(fixture.filePath, "{broken", "utf8");
  fs.writeFileSync(fixture.filePath + ".bak", JSON.stringify({ x: 12.2, y: 33.8 }), "utf8");

  assert.deepEqual(loadPetPosition(fixture.filePath), {
    position: { x: 12, y: 34 },
    status: "ok",
    recoveredFromBackup: true
  });
  assert.equal(fs.existsSync(fixture.filePath), false);
  assert.equal(
    fs.readdirSync(fixture.directory).filter((name) => name.includes(".corrupt-")).length,
    1
  );
});

test("위치 파일이 없거나 형식이 잘못되면 저장 위치를 사용하지 않는다", (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
  assert.deepEqual(loadPetPosition(fixture.filePath), {
    status: "missing",
    recoveredFromBackup: false
  });

  fs.writeFileSync(fixture.filePath, JSON.stringify({ x: "10", y: 20 }), "utf8");
  assert.deepEqual(loadPetPosition(fixture.filePath), {
    status: "corrupt",
    recoveredFromBackup: false
  });
  assert.equal(fs.existsSync(fixture.filePath), false);
  assert.equal(
    fs.readdirSync(fixture.directory).filter((name) => name.includes(".corrupt-")).length,
    1
  );
});
