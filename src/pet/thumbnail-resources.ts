// 프리셋 썸네일이 재사용하는 오프스크린 렌더 자원 캐시.
//
// 렌더 타깃 둘·픽셀 버퍼·2D 캔버스·ImageData를 이 모듈이 소유하고, 크기가 바뀔 때만 다시
// 잡는다. 썸네일 렌더 자체(파츠 적용·카메라 이동·후처리 패스)는 라이브 scene·camera·
// material 상태를 너무 많이 봐서 렌더러에 남겨 두었다 — 여기 있는 건 "그 렌더가 쓰는 그릇"뿐이다.
//
// 해상도 산정과 픽셀 변환은 thumbnail-image.ts가, 실패 시 라이브 상태 복구는
// thumbnail-render-transaction.ts가 맡는다.

import * as THREE from "three";
import { unpremultiplyFlipped } from "./thumbnail-image.js";

type ThumbnailTargets = {
  sceneTarget: THREE.WebGLRenderTarget;
  outputTarget: THREE.WebGLRenderTarget;
};

type ThumbnailResourceDependencies = {
  renderer: THREE.WebGLRenderer;
};

function createThumbnailResources(deps: ThumbnailResourceDependencies) {
  let sceneTarget: THREE.WebGLRenderTarget | null = null;
  let outputTarget: THREE.WebGLRenderTarget | null = null;
  let pixels: Uint8Array | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let imageData: ImageData | null = null;

  /** 요청한 크기로 자원을 맞춘 뒤 렌더 타깃을 돌려준다. 호출부가 널 검사를 되풀이하지 않게 한다. */
  function ensure(size: number): ThumbnailTargets {
    if (!sceneTarget) {
      // 라이브 후처리 입력(sceneRenderTarget)과 같은 설정 — 셰이더가 선형 색공간을
      // 전제로 계산하므로 colorSpace도 똑같이 맞춰야 색이 어긋나지 않는다.
      sceneTarget = new THREE.WebGLRenderTarget(size, size, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false
      });
      sceneTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
      sceneTarget.texture.generateMipmaps = false;
      sceneTarget.samples = 4;
      // 최종 출력은 PNG로 나가야 하므로 캔버스와 같은 sRGB로 인코딩되게 한다
      // (three는 렌더 타깃의 colorSpace를 보고 colorspace_fragment 변환을 넣는다).
      // 여기서는 MSAA를 쓰지 않는다 — 계단현상 제거는 위 씬 타깃에서 이미 끝났고,
      // readRenderTargetPixels로 곧바로 읽어야 하는 대상이다.
      outputTarget = new THREE.WebGLRenderTarget(size, size, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false
      });
      outputTarget.texture.colorSpace = THREE.SRGBColorSpace;
      outputTarget.texture.generateMipmaps = false;
      canvas = document.createElement("canvas");
      context = canvas.getContext("2d");
    }
    if (!sceneTarget || !outputTarget || !canvas || !context) {
      throw new Error("프리셋 썸네일 렌더 자원을 만들 수 없다");
    }
    const scene = sceneTarget;
    const output = outputTarget;
    const canvasForSize = canvas;
    if (scene.width !== size || scene.height !== size) {
      scene.setSize(size, size);
      output.setSize(size, size);
    }
    if (canvasForSize.width !== size || canvasForSize.height !== size) {
      canvasForSize.width = size;
      canvasForSize.height = size;
      pixels = null;
      imageData = null;
    }
    if (!pixels) pixels = new Uint8Array(size * size * 4);
    if (!imageData) {
      imageData = context.createImageData(size, size);
    }
    return { sceneTarget: scene, outputTarget: output };
  }

  // 렌더 타깃에서 읽은 픽셀을 PNG data URL로 바꾼다(행 뒤집기와 알파 되돌리기는
  // thumbnail-image.ts의 unpremultiplyFlipped가 한다).
  function toDataUrl(size: number) {
    // ensure()가 먼저 채워 두는 자원들이다. 모듈 상태라 함수 경계를 넘으면 타입이 다시
    // 널 가능으로 돌아가므로, 이 함수가 쓰는 동안만 지역으로 받는다.
    if (!pixels || !imageData || !context || !canvas || !outputTarget) {
      throw new Error("프리셋 썸네일 렌더 자원이 준비되지 않았다");
    }
    const buffer = pixels;
    const image = imageData;
    const context2d = context;
    const canvasEl = canvas;
    const output = outputTarget;
    deps.renderer.readRenderTargetPixels(output, 0, 0, size, size, buffer);
    unpremultiplyFlipped(buffer, image.data, size);
    context2d.putImageData(image, 0, 0);
    return canvasEl.toDataURL("image/png");
  }

  return { ensure, toDataUrl };
}

export { createThumbnailResources };
export type { ThumbnailResourceDependencies, ThumbnailTargets };
