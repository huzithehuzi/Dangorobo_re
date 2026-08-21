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

// ── 프리셋마다 별도 파일로 보관되는 커스텀 이미지 (2026-08-20) ──────────────
const {
  presetAssetZipPath,
  capturePresetAssets,
  deletePresetAssets,
  activatePresetAssets,
  readPresetFaceTextureDataUrl,
  seedLegacyPresetAssets,
  exportPresetSet,
  importPresetSet
} = require("../src/main/custom-preset-assets.js");

/** @param {string} label */
function png(label) {
  return Buffer.concat([pngSignature, Buffer.from(label)]);
}

test("프리셋 저장은 지금 활성 이미지를 그 프리셋 파일로 굳히고, 적용하면 되돌린다", () => {
  const faceA = png("faceA");
  const bodyA = png("bodyA");
  importCustomFaceZip(writeZip("a.zip", [["customface_normal.png", faceA]]));
  fs.writeFileSync(path.join(userDataDir, "a.png"), bodyA);
  importCustomBodyImage(path.join(userDataDir, "a.png"));
  assert.equal(capturePresetAssets("p1"), true);
  assert.ok(fs.existsSync(presetAssetZipPath("p1")));

  const faceB = png("faceB");
  importCustomFaceZip(writeZip("b.zip", [["customface_normal.png", faceB]]));
  assert.deepEqual(fs.readFileSync(customFacePngPath("normal")), faceB);

  assert.deepEqual(activatePresetAssets("p1"), { faceKeys: ["normal"], hasBody: true });
  assert.deepEqual(fs.readFileSync(customFacePngPath("normal")), faceA);
  assert.deepEqual(fs.readFileSync(customBodyPngPath()), bodyA);
});

test("이미지가 없으면 프리셋 파일을 만들지 않고, 없는 프리셋 적용은 활성 이미지를 두고 null", () => {
  assert.equal(capturePresetAssets("p1"), false);
  assert.equal(fs.existsSync(presetAssetZipPath("p1")), false);

  const face = png("face");
  importCustomFaceZip(writeZip("only.zip", [["customface_normal.png", face]]));
  assert.equal(activatePresetAssets("p1"), null);
  assert.deepEqual(fs.readFileSync(customFacePngPath("normal")), face);
});

test("프리셋 삭제는 그 프리셋 파일만 지운다", () => {
  importCustomFaceZip(writeZip("c.zip", [["customface_normal.png", png("face")]]));
  capturePresetAssets("p1");
  capturePresetAssets("p2");
  deletePresetAssets("p1");
  assert.equal(fs.existsSync(presetAssetZipPath("p1")), false);
  assert.equal(fs.existsSync(presetAssetZipPath("p2")), true);
});

test("프리셋 id는 파일명에 안전한 문자만 남긴다", () => {
  const zipPath = presetAssetZipPath("../../evil id");
  assert.equal(path.basename(zipPath), "evilid.zip");
  assert.equal(path.dirname(zipPath), path.join(userDataDir, "custom-presets"));
  assert.equal(presetAssetZipPath("/../"), "");
});

test("내보낸 세트 파일에는 프리셋 값과 그 프리셋의 이미지가 함께 들어간다", () => {
  const face = png("faceSet");
  const body = png("bodySet");
  importCustomFaceZip(writeZip("d.zip", [["customface_normal.png", face]]));
  fs.writeFileSync(path.join(userDataDir, "d.png"), body);
  importCustomBodyImage(path.join(userDataDir, "d.png"));
  capturePresetAssets("p1");

  // 내보낸 뒤 활성 이미지를 바꿔 둬야 "세트에서 되돌아왔는지"를 구분할 수 있다.
  const setPath = path.join(userDataDir, "set.zip");
  exportPresetSet("p1", { id: "p1", name: "여우" }, setPath);
  importCustomFaceZip(writeZip("e.zip", [["customface_normal.png", png("other")]]));

  const imported = importPresetSet(setPath);
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.preset, { id: "p1", name: "여우" });
  assert.deepEqual(imported.faceKeys, ["normal"]);
  assert.equal(imported.hasBody, true);
  assert.deepEqual(fs.readFileSync(customFacePngPath("normal")), face);
  assert.deepEqual(fs.readFileSync(customBodyPngPath()), body);
});

test("이미지가 없는 옛 프리셋을 내보내면 지금 활성 이미지를 담는다", () => {
  const face = png("legacy");
  importCustomFaceZip(writeZip("f.zip", [["customface_normal.png", face]]));
  const setPath = path.join(userDataDir, "legacy.zip");
  exportPresetSet("없는프리셋", { id: "old", name: "옛것" }, setPath);
  assert.deepEqual(
    new AdmZip(setPath).getEntries().map((entry) => entry.entryName).sort(),
    ["customface_normal.png", "preset.json"]
  );
});

test("예전 버전이 내보낸 JSON 파일도 계속 읽는다(이미지 없음)", () => {
  const jsonPath = path.join(userDataDir, "old-preset.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ id: "old", name: "옛것" }), "utf8");
  assert.deepEqual(importPresetSet(jsonPath), {
    ok: true,
    preset: { id: "old", name: "옛것" },
    faceKeys: [],
    hasBody: false
  });
  assert.deepEqual(importPresetSet(path.join(userDataDir, "없는파일.zip")), { ok: false, errorCode: "invalidFile" });
});

test("preset.json이 없는 zip은 세트 파일로 인정하지 않는다", () => {
  const zipPath = writeZip("no-preset.zip", [["customface_normal.png", png("x")]]);
  assert.deepEqual(importPresetSet(zipPath), { ok: false, errorCode: "invalidFile" });
});

test("옛 프리셋에는 지금 활성 이미지를 한 번 채워 준다(있으면 건드리지 않는다)", () => {
  const face = png("legacySeed");
  importCustomFaceZip(writeZip("seed.zip", [["customface_normal.png", face]]));
  capturePresetAssets("hasOwn");
  const other = png("other");
  importCustomFaceZip(writeZip("seed2.zip", [["customface_normal.png", other]]));

  const presets = [
    { id: "hasOwn", customFaceEnabled: true },
    { id: "needsSeed", customFaceEnabled: true },
    { id: "noCustom" }
  ];
  assert.equal(seedLegacyPresetAssets(presets), 1);
  // 이미 자기 파일이 있는 프리셋은 덮어쓰지 않는다.
  assert.equal(readPresetFaceTextureDataUrl("hasOwn"), `data:image/png;base64,${face.toString("base64")}`);
  assert.equal(readPresetFaceTextureDataUrl("needsSeed"), `data:image/png;base64,${other.toString("base64")}`);
  assert.equal(fs.existsSync(presetAssetZipPath("noCustom")), false);
  // 두 번 불러도 아무것도 더 만들지 않는다.
  assert.equal(seedLegacyPresetAssets(presets), 0);
});

test("활성 이미지가 없으면 옛 프리셋 채우기는 아무 일도 하지 않는다", () => {
  assert.equal(seedLegacyPresetAssets([{ id: "p1", customFaceEnabled: true }]), 0);
  assert.equal(readPresetFaceTextureDataUrl("p1"), null);
});
