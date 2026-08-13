const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  runThumbnailRenderTransaction
} = require("../src/pet/thumbnail-render-transaction.js");

const projectRoot = path.resolve(__dirname, "..");

test("정상 렌더 결과를 유지하면서 모든 라이브 상태를 복구한다", () => {
  const state = { camera: "live", target: "screen", appearance: "current" };
  /** @type {string[]} */
  const calls = [];
  const result = runThumbnailRenderTransaction(() => {
    state.camera = "thumbnail";
    state.target = "offscreen";
    state.appearance = "preset";
    return { cherry: "data:image/png;base64,result" };
  }, [
    () => { calls.push("camera"); state.camera = "live"; },
    () => { calls.push("target"); state.target = "screen"; },
    () => { calls.push("appearance"); state.appearance = "current"; }
  ]);

  assert.deepEqual(result, { cherry: "data:image/png;base64,result" });
  assert.deepEqual(state, { camera: "live", target: "screen", appearance: "current" });
  assert.deepEqual(calls, ["camera", "target", "appearance"]);
});

test("렌더가 실패해도 라이브 상태를 전부 복구하고 원래 오류를 던진다", () => {
  const renderError = new Error("readRenderTargetPixels 실패");
  const state = { camera: "live", target: "screen", appearance: "current" };

  assert.throws(() => runThumbnailRenderTransaction(() => {
    state.camera = "thumbnail";
    state.target = "offscreen";
    state.appearance = "preset";
    throw renderError;
  }, [
    () => { state.camera = "live"; },
    () => { state.target = "screen"; },
    () => { state.appearance = "current"; }
  ]), (error) => error === renderError);

  assert.deepEqual(state, { camera: "live", target: "screen", appearance: "current" });
});

test("복구 하나가 실패해도 나머지 복구를 계속한다", () => {
  const restoreError = new Error("외형 복구 실패");
  /** @type {string[]} */
  const calls = [];

  assert.throws(() => runThumbnailRenderTransaction(() => "done", [
    () => { calls.push("first"); },
    () => { calls.push("broken"); throw restoreError; },
    () => { calls.push("last"); }
  ]), (error) => error === restoreError);
  assert.deepEqual(calls, ["first", "broken", "last"]);
});

test("정상 렌더 뒤 복구가 여러 개 실패하면 오류를 모두 보존한다", () => {
  const firstRestoreError = new Error("카메라 복구 실패");
  const secondRestoreError = new Error("외형 복구 실패");

  assert.throws(() => runThumbnailRenderTransaction(() => "done", [
    () => { throw firstRestoreError; },
    () => { throw secondRestoreError; }
  ]), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [firstRestoreError, secondRestoreError]);
    return true;
  });
});

test("렌더와 복구가 함께 실패하면 렌더 오류를 첫 원인으로 보존한다", () => {
  const renderError = new Error("render 실패");
  const firstRestoreError = new Error("카메라 복구 실패");
  const secondRestoreError = new Error("외형 복구 실패");

  assert.throws(() => runThumbnailRenderTransaction(() => {
    throw renderError;
  }, [
    () => { throw firstRestoreError; },
    () => { throw secondRestoreError; }
  ]), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [renderError, firstRestoreError, secondRestoreError]);
    assert.equal(error.cause, renderError);
    return true;
  });
});

test("undefined를 던진 렌더 실패도 정상 반환으로 오인하지 않는다", () => {
  let restored = false;
  assert.throws(() => runThumbnailRenderTransaction(() => {
    throw undefined;
  }, [
    () => { restored = true; }
  ]), (error) => error === undefined);
  assert.equal(restored, true);
});

test("renderer는 썸네일 트랜잭션에서 WebGL 내부 상태와 외형을 함께 복구한다", () => {
  const rendererSource = fs.readFileSync(
    path.join(projectRoot, "src", "pet", "renderer.ts"),
    "utf8"
  );
  const functionStart = rendererSource.indexOf("function renderPresetThumbnails(");
  const functionEnd = rendererSource.indexOf("\nwindow.desktopPet.onRenderPresetThumbnails", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart, "썸네일 렌더 함수 범위를 찾는다");
  const source = rendererSource.slice(functionStart, functionEnd);
  const transactionStart = source.indexOf("return runThumbnailRenderTransaction(");
  const restoreStart = source.indexOf("  }, [", transactionStart);
  assert.ok(transactionStart >= 0 && restoreStart > transactionStart, "트랜잭션 복구 경계를 찾는다");
  const snapshotSource = source.slice(0, transactionStart);
  const restoreSource = source.slice(restoreStart);

  assert.match(
    rendererSource,
    /function setFaceExpressionKey\([^)]*\) \{\s*const key = [^;]+;\s*currentFaceExpressionKey = key;/,
    "현재 표정 키는 실제 표정 적용 함수가 소유한다"
  );
  assert.match(source, /return runThumbnailRenderTransaction\(\(\) => \{/);
  assert.match(snapshotSource, /const savedRenderTarget = renderer\.getRenderTarget\(\);/);
  assert.match(snapshotSource, /const savedAutoClear = renderer\.autoClear;/);
  assert.match(snapshotSource, /const savedCameraLayerMask = camera\.layers\.mask;/);
  assert.match(snapshotSource, /const savedOverrideMaterial = scene\.overrideMaterial;/);
  assert.match(snapshotSource, /const savedDiffuse = postProcessUniforms\.tDiffuse\.value;/);
  assert.match(snapshotSource, /const savedResolution = postProcessUniforms\.uResolution\.value\.clone\(\);/);
  assert.match(snapshotSource, /const savedFaceExpressionKey = currentFaceExpressionKey;/);
  assert.match(snapshotSource, /const settingsToRestore = latestSettings;/);
  assert.match(restoreSource, /renderer\.setRenderTarget\(savedRenderTarget\)/);
  assert.match(restoreSource, /renderer\.autoClear = savedAutoClear/);
  assert.match(restoreSource, /camera\.layers\.mask = savedCameraLayerMask/);
  assert.match(restoreSource, /scene\.overrideMaterial = savedOverrideMaterial/);
  assert.match(restoreSource, /postProcessUniforms\.tDiffuse\.value = savedDiffuse/);
  assert.match(restoreSource, /postProcessUniforms\.uResolution\.value\.copy\(savedResolution\)/);
  assert.match(restoreSource, /camera\.updateProjectionMatrix\(\)/);
  assert.match(restoreSource, /camera\.updateMatrixWorld\(true\)/);
  assert.match(restoreSource, /applyBodyColors\(settingsToRestore\)/);
  assert.match(
    restoreSource,
    /\(\) => applyBodyColors\(settingsToRestore\),\s*\(\) => applyPartVariations\(settingsToRestore\),\s*\(\) => applyFaceCustomization\(settingsToRestore\),\s*\(\) => applyBodyCustomization\(settingsToRestore\)/,
    "외형 복구는 각 단계를 독립 실행해야 한다"
  );
  assert.ok(
    restoreSource.indexOf("applyBodyCustomization(settingsToRestore)")
      < restoreSource.indexOf("bodyPlates.costume.visible = savedCostumeVisible"),
    "정확한 바디 플레이트 visibility를 외형 적용 뒤에 복구한다"
  );
  assert.ok(
    restoreSource.indexOf("applyBodyCustomization(settingsToRestore)")
      < restoreSource.indexOf("bodyPlates.customBody.visible = savedCustomBodyVisible"),
    "커스텀 바디 visibility도 외형 적용 뒤에 복구한다"
  );
  assert.match(restoreSource, /setFaceExpressionKey\(savedFaceExpressionKey\)/);
});
