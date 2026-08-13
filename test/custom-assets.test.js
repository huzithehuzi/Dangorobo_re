const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-custom-assets-"));
const electronPath = require.resolve("electron");
require.cache[electronPath] = /** @type {any} */ ({
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getPath: () => userDataDir } }
});

const {
  CUSTOM_FACE_MAX_ENTRIES,
  customFaceDir,
  customFacePngPath,
  importCustomFaceZip,
  readCustomFaceTextures
} = require("../src/main/custom-face.js");
const {
  customBodyPngPath,
  importCustomBodyImage,
  readCustomBodyTexture
} = require("../src/main/custom-body.js");

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function resetUserData() {
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
}

/**
 * @param {string} name
 * @param {Array<[string, Buffer]>} entries
 */
function writeZip(name, entries) {
  const zip = new AdmZip();
  for (const [entryName, data] of entries) {
    zip.addFile(entryName, data);
  }
  const zipPath = path.join(userDataDir, name);
  zip.writeZip(zipPath);
  return zipPath;
}

test.beforeEach(resetUserData);
test.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));

test("커스텀 얼굴 ZIP은 허용된 PNG만 가져오고 이전 세트를 완전히 교체한다", () => {
  fs.mkdirSync(customFaceDir(), { recursive: true });
  fs.writeFileSync(customFacePngPath("sad"), Buffer.concat([pngSignature, Buffer.from("old")]));
  const normal = Buffer.concat([pngSignature, Buffer.from("normal")]);
  const happy = Buffer.concat([pngSignature, Buffer.from("happy")]);
  const zipPath = writeZip("faces.zip", [
    ["nested/customface_normal.png", normal],
    ["customface_happy.PNG", happy],
    ["ignored.txt", Buffer.from("ignore")]
  ]);

  assert.deepEqual(importCustomFaceZip(zipPath), { ok: true, keys: ["normal", "happy"] });
  assert.deepEqual(fs.readFileSync(customFacePngPath("normal")), normal);
  assert.deepEqual(fs.readFileSync(customFacePngPath("happy")), happy);
  assert.equal(fs.existsSync(customFacePngPath("sad")), false);
  assert.deepEqual(Object.keys(readCustomFaceTextures()).sort(), ["happy", "normal"]);
  assert.deepEqual(
    fs.readdirSync(userDataDir).filter((name) => name.startsWith("custom-face-import-") || name === "custom-face.bak"),
    []
  );
});

test("커스텀 얼굴 ZIP의 잘못된 PNG는 기존 세트를 보존한다", () => {
  const existing = Buffer.concat([pngSignature, Buffer.from("existing")]);
  fs.mkdirSync(customFaceDir(), { recursive: true });
  fs.writeFileSync(customFacePngPath("normal"), existing);
  const zipPath = writeZip("bad-face.zip", [["customface_happy.png", Buffer.from("not png")]]);

  assert.deepEqual(importCustomFaceZip(zipPath), { ok: false, errorCode: "invalidZip" });
  assert.deepEqual(fs.readFileSync(customFacePngPath("normal")), existing);
});

test("커스텀 얼굴 ZIP은 중복 표정과 과도한 엔트리를 거부한다", () => {
  const duplicateZip = writeZip("duplicate.zip", [
    ["a/customface_normal.png", pngSignature],
    ["b/customface_normal.png", pngSignature]
  ]);
  assert.deepEqual(importCustomFaceZip(duplicateZip), { ok: false, errorCode: "invalidZip" });

  /** @type {Array<[string, Buffer]>} */
  const entries = Array.from({ length: CUSTOM_FACE_MAX_ENTRIES + 1 }, (_, index) => [
    `ignored-${index}.txt`,
    Buffer.from("x")
  ]);
  const crowdedZip = writeZip("crowded.zip", entries);
  assert.deepEqual(importCustomFaceZip(crowdedZip), { ok: false, errorCode: "invalidZip" });
});

test("커스텀 얼굴 ZIP 지연 파싱 실패를 오류 결과로 바꾸고 남은 staging을 청소한다", () => {
  const zipPath = writeZip("delayed-error.zip", [["customface_normal.png", pngSignature]]);
  assert.deepEqual(importCustomFaceZip(zipPath, {
    createZip: () => ({
      getEntries: () => {
        throw new Error("지연 파싱 실패");
      }
    })
  }), { ok: false, errorCode: "invalidZip" });

  const staleDir = fs.mkdtempSync(path.join(userDataDir, "custom-face-import-"));
  fs.writeFileSync(path.join(staleDir, "partial.png"), pngSignature);
  const validZip = writeZip("after-crash.zip", [["customface_normal.png", pngSignature]]);
  assert.deepEqual(importCustomFaceZip(validZip), { ok: true, keys: ["normal"] });
  assert.equal(fs.existsSync(staleDir), false);
});

test("커스텀 얼굴 교체가 중간에 실패하면 이전 세트를 복원한다", () => {
  const existing = Buffer.concat([pngSignature, Buffer.from("existing")]);
  fs.mkdirSync(customFaceDir(), { recursive: true });
  fs.writeFileSync(customFacePngPath("normal"), existing);
  const zipPath = writeZip("replacement.zip", [["customface_happy.png", pngSignature]]);
  const originalRename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (path.basename(String(source)).startsWith("custom-face-import-")
        && String(destination) === customFaceDir()) {
      throw new Error("교체 실패 시뮬레이션");
    }
    return originalRename(source, destination);
  };
  try {
    assert.deepEqual(importCustomFaceZip(zipPath), { ok: false, errorCode: "invalidZip" });
  } finally {
    fs.renameSync = originalRename;
  }

  assert.deepEqual(fs.readFileSync(customFacePngPath("normal")), existing);
  assert.equal(fs.existsSync(customFacePngPath("happy")), false);
  assert.equal(fs.existsSync(customFaceDir() + ".bak"), false);
});

test("커스텀 바디는 PNG만 원자 저장하고 직전 파일을 백업한다", () => {
  const firstPath = path.join(userDataDir, "first.png");
  const secondPath = path.join(userDataDir, "second.png");
  const first = Buffer.concat([pngSignature, Buffer.from("first")]);
  const second = Buffer.concat([pngSignature, Buffer.from("second")]);
  fs.writeFileSync(firstPath, first);
  fs.writeFileSync(secondPath, second);

  assert.deepEqual(importCustomBodyImage(firstPath), { ok: true });
  assert.deepEqual(importCustomBodyImage(secondPath), { ok: true });
  assert.deepEqual(fs.readFileSync(customBodyPngPath()), second);
  assert.deepEqual(fs.readFileSync(customBodyPngPath() + ".bak"), first);
  assert.equal(readCustomBodyTexture(), `data:image/png;base64,${second.toString("base64")}`);

  const invalidPath = path.join(userDataDir, "invalid.png");
  fs.writeFileSync(invalidPath, Buffer.from("not png"));
  assert.deepEqual(importCustomBodyImage(invalidPath), { ok: false, errorCode: "invalidImage" });
  assert.deepEqual(fs.readFileSync(customBodyPngPath()), second);
});

test("커스텀 바디 주 파일이 손상되거나 사라지면 직전 PNG 백업을 읽는다", () => {
  const firstPath = path.join(userDataDir, "first.png");
  const secondPath = path.join(userDataDir, "second.png");
  const first = Buffer.concat([pngSignature, Buffer.from("first")]);
  const second = Buffer.concat([pngSignature, Buffer.from("second")]);
  fs.writeFileSync(firstPath, first);
  fs.writeFileSync(secondPath, second);
  assert.deepEqual(importCustomBodyImage(firstPath), { ok: true });
  assert.deepEqual(importCustomBodyImage(secondPath), { ok: true });

  fs.writeFileSync(customBodyPngPath(), Buffer.from("broken"));
  assert.equal(readCustomBodyTexture(), `data:image/png;base64,${first.toString("base64")}`);
  assert.equal(fs.existsSync(customBodyPngPath()), false);
  assert.equal(
    fs.readdirSync(path.dirname(customBodyPngPath())).filter((name) => name.includes(".corrupt-")).length,
    1
  );

  for (const name of fs.readdirSync(path.dirname(customBodyPngPath()))) {
    if (name.includes(".corrupt-")) {
      fs.rmSync(path.join(path.dirname(customBodyPngPath()), name), { force: true });
    }
  }
  assert.equal(readCustomBodyTexture(), `data:image/png;base64,${first.toString("base64")}`);
});

test("커스텀 바디 원자 교체 중 종료되면 rollback PNG를 복원한다", () => {
  const original = Buffer.concat([pngSignature, Buffer.from("original")]);
  const pending = Buffer.concat([pngSignature, Buffer.from("pending")]);
  const filePath = customBodyPngPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath + ".rollback-100-200-1", original);
  fs.writeFileSync(filePath + ".tmp", pending);

  assert.equal(readCustomBodyTexture(), `data:image/png;base64,${original.toString("base64")}`);
  assert.deepEqual(fs.readFileSync(filePath), original);
  assert.equal(fs.existsSync(filePath + ".tmp"), false);
  assert.equal(fs.existsSync(filePath + ".rollback-100-200-1"), false);
});
