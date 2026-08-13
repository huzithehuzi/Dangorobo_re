// @ts-check
// 썸네일 오프스크린 자원 캐시. WebGL 컨텍스트 없이도 WebGLRenderTarget은 만들어지고
// 크기 계산·버퍼 재할당은 그대로 돌아가므로, 2D 캔버스만 스텁으로 끼워 Node에서 검증한다.
const test = require("node:test");
const assert = require("node:assert/strict");

const THREE = require("three");
const { createThumbnailResources } = require("../src/pet/thumbnail-resources.js");

/** 만들어진 캔버스 스텁을 밖에서 들여다볼 수 있게 모아 둔다. */
function installCanvasStub() {
  /** @type {any[]} */
  const created = [];
  const previous = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    /** @param {string} tag */
    createElement(tag) {
      assert.equal(tag, "canvas");
      /** @type {any} */
      const canvas = {
        width: 0,
        height: 0,
        imageDataCalls: 0,
        putCalls: 0,
        toDataUrlCalls: 0,
        getContext: () => ({
          /** @param {number} w @param {number} h */
          createImageData(w, h) {
            canvas.imageDataCalls += 1;
            return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
          },
          /** @param {any} image */
          putImageData(image) {
            canvas.putCalls += 1;
            canvas.lastPut = image;
          }
        }),
        toDataURL: () => {
          canvas.toDataUrlCalls += 1;
          return "data:image/png;base64,STUB";
        }
      };
      created.push(canvas);
      return canvas;
    }
  };
  return {
    created,
    restore: () => { /** @type {any} */ (globalThis).document = previous; }
  };
}

function stubRenderer() {
  /** @type {any[]} */
  const reads = [];
  return {
    reads,
    renderer: /** @type {any} */ ({
      /**
       * @param {any} target @param {number} x @param {number} y
       * @param {number} w @param {number} h @param {Uint8Array} buffer
       */
      readRenderTargetPixels(target, x, y, w, h, buffer) {
        reads.push({ target, x, y, w, h, length: buffer.length });
        buffer.fill(255);
      }
    })
  };
}

test("첫 ensure는 렌더 타깃 둘을 라이브 후처리와 같은 색공간 설정으로 만든다", (context) => {
  const canvasStub = installCanvasStub();
  context.after(canvasStub.restore);
  const resources = createThumbnailResources({ renderer: stubRenderer().renderer });

  const { sceneTarget, outputTarget } = resources.ensure(64);

  // 씬 타깃은 셰이더가 전제하는 선형 색공간 + MSAA, 출력 타깃은 PNG로 나갈 sRGB.
  assert.equal(sceneTarget.texture.colorSpace, THREE.LinearSRGBColorSpace);
  assert.equal(sceneTarget.samples, 4);
  assert.equal(sceneTarget.depthBuffer, true);
  assert.equal(outputTarget.texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(outputTarget.samples, 0);
  assert.equal(outputTarget.depthBuffer, false);
  for (const target of [sceneTarget, outputTarget]) {
    assert.equal(target.width, 64);
    assert.equal(target.height, 64);
    assert.equal(target.texture.generateMipmaps, false);
  }
  assert.equal(canvasStub.created.length, 1);
  assert.equal(canvasStub.created[0].width, 64);
});

test("같은 크기로 다시 부르면 타깃도 캔버스도 다시 만들지 않는다", (context) => {
  const canvasStub = installCanvasStub();
  context.after(canvasStub.restore);
  const resources = createThumbnailResources({ renderer: stubRenderer().renderer });

  const first = resources.ensure(48);
  const second = resources.ensure(48);

  assert.equal(first.sceneTarget, second.sceneTarget);
  assert.equal(first.outputTarget, second.outputTarget);
  assert.equal(canvasStub.created.length, 1);
  // ImageData도 한 번만 만든다 — 매 프리셋마다 다시 잡으면 그게 곧 프레임당 할당이다.
  assert.equal(canvasStub.created[0].imageDataCalls, 1);
});

test("크기가 바뀌면 타깃을 리사이즈하고 픽셀 버퍼와 ImageData를 다시 잡는다", (context) => {
  const canvasStub = installCanvasStub();
  context.after(canvasStub.restore);
  const stub = stubRenderer();
  const resources = createThumbnailResources({ renderer: stub.renderer });

  const first = resources.ensure(32);
  resources.toDataUrl(32);
  const second = resources.ensure(80);
  resources.toDataUrl(80);

  // 타깃 객체는 그대로 두고 크기만 바꾼다(재생성하면 GPU 자원이 샌다).
  assert.equal(first.sceneTarget, second.sceneTarget);
  assert.equal(second.sceneTarget.width, 80);
  assert.equal(second.outputTarget.height, 80);
  assert.equal(canvasStub.created.length, 1);
  assert.equal(canvasStub.created[0].width, 80);
  assert.equal(canvasStub.created[0].imageDataCalls, 2);
  // 픽셀 버퍼도 새 크기로 다시 잡혀야 한다 — 옛 버퍼로 읽으면 길이가 안 맞는다.
  assert.deepEqual(stub.reads.map((read) => read.length), [32 * 32 * 4, 80 * 80 * 4]);
  assert.deepEqual(stub.reads.map((read) => read.w), [32, 80]);
});

test("toDataUrl은 출력 타깃에서 읽어 캔버스에 그린 뒤 PNG로 돌려준다", (context) => {
  const canvasStub = installCanvasStub();
  context.after(canvasStub.restore);
  const stub = stubRenderer();
  const resources = createThumbnailResources({ renderer: stub.renderer });

  const { outputTarget } = resources.ensure(16);
  const dataUrl = resources.toDataUrl(16);

  assert.equal(dataUrl, "data:image/png;base64,STUB");
  assert.equal(stub.reads.length, 1);
  // 씬 타깃이 아니라 후처리를 거친 출력 타깃에서 읽어야 한다.
  assert.equal(stub.reads[0].target, outputTarget);
  assert.deepEqual([stub.reads[0].x, stub.reads[0].y], [0, 0]);
  assert.equal(canvasStub.created[0].putCalls, 1);
  assert.equal(canvasStub.created[0].toDataUrlCalls, 1);
  // 알파 되돌리기가 실제로 돌았는지 — 전부 255로 채운 버퍼는 그대로 255로 남는다.
  assert.equal(canvasStub.created[0].lastPut.data.length, 16 * 16 * 4);
  assert.equal(canvasStub.created[0].lastPut.data[0], 255);
});

test("ensure 전에 toDataUrl을 부르면 조용히 빈 이미지를 주지 않고 던진다", (context) => {
  const canvasStub = installCanvasStub();
  context.after(canvasStub.restore);
  const resources = createThumbnailResources({ renderer: stubRenderer().renderer });

  assert.throws(() => resources.toDataUrl(32), /렌더 자원이 준비되지 않았다/);
});
