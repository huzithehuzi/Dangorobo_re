// 커스터마이징 프리셋 썸네일의 해상도 산정과 픽셀 변환. renderer.ts에서 떼어냈다.
// 오프스크린 렌더 타깃·씬 조작·복구는 렌더러가 그대로 들고 있고, 여기에는 인자만 보는
// 계산을 둔다 — 둘 다 어긋나도 "썸네일이 좀 이상한데" 수준으로만 보여 눈으로 잡기 어렵다.
//
// import 지정자에 `.js`를 붙이는 이유는 src/pet/tsconfig.build.json 주석 참고(noResolve 단일 파일 변환).
import * as THREE from "three";

const PRESET_THUMBNAIL_MIN_SIZE = 64;
const PRESET_THUMBNAIL_MAX_SIZE = 512;
// 머리 경계 상자에 주는 여백(1.0이면 딱 맞게 잘림).
const PRESET_THUMBNAIL_PADDING = 1.1;

type BoxExtent = { x: number; y: number; z: number };

/**
 * 머리 경계 상자가 정사각 프레임에 꽉 차도록 카메라를 얼마나 떨어뜨릴지 정한다.
 * 가로·세로 중 큰 쪽을 기준으로 잡아야 어느 방향으로도 잘리지 않고, 상자 깊이(z)를 더해
 * 앞쪽 면이 카메라 뒤로 넘어가지 않게 한다.
 */
function thumbnailCameraDistance(extent: BoxExtent, cameraFovDeg: number): number {
  const halfExtent = Math.max(extent.x, extent.y) / 2 * PRESET_THUMBNAIL_PADDING;
  return halfExtent / Math.tan(THREE.MathUtils.degToRad(cameraFovDeg) / 2) + extent.z;
}

/**
 * 라이브 렌더와 "월드 단위당 픽셀 수"가 같아지는 썸네일 해상도.
 *
 * 해상도를 임의로 정하면 안 된다 — 외곽선 굵기·선 떨림 크기는 픽셀 단위고 픽셀 아트는
 * 렌더 버퍼 비율이라, 전부 월드 단위당 픽셀 수에 딸려 있다. 썸네일은 머리를 꽉 채워 찍으니
 * 라이브보다 훨씬 확대된 상태인데 같은 해상도로 그리면 외곽선이 머리에 비해 훨씬 얇아지고
 * 픽셀 아트도 덜 뭉개져 보인다. 카메라가 가까워진 비율만큼 해상도도 같이 줄이면 세 효과가
 * 모두 라이브에서 모델에 대해 갖던 비율 그대로 나온다. 라이브 버퍼는 이미 픽셀 아트 비율이
 * 반영된 크기라(renderer.ts의 resize 참고) 따로 곱하지 않는다.
 */
function thumbnailRenderSize(
  liveBufferHeight: number,
  cameraDistance: number,
  liveCameraDistance: number
): number {
  // 라이브 카메라가 원점에 붙어 있으면 0으로 나눈다. 그 경우 해상도는 상한으로 잘린다.
  const liveDistance = Math.max(0.001, liveCameraDistance);
  return THREE.MathUtils.clamp(
    Math.round(Math.max(1, liveBufferHeight) * cameraDistance / liveDistance),
    PRESET_THUMBNAIL_MIN_SIZE,
    PRESET_THUMBNAIL_MAX_SIZE
  );
}

/**
 * 렌더 타깃에서 읽은 픽셀을 2D 캔버스 ImageData 바이트로 옮긴다.
 * - WebGL은 좌하단 원점이라 행 순서를 뒤집어야 한다.
 * - 후처리 셰이더 마지막 줄이 알파를 곱해 내보내는데(캔버스가 premultipliedAlpha라
 *   그게 맞다) 2D 캔버스의 ImageData는 곱하지 않은 값을 기대한다 — 되돌리지 않으면
 *   반투명한 얼굴 데칼 가장자리에 흰 테두리처럼 밝은 띠가 생긴다.
 */
function unpremultiplyFlipped(
  pixels: Uint8Array,
  out: Uint8ClampedArray,
  size: number
): void {
  for (let y = 0; y < size; y += 1) {
    const source = (size - 1 - y) * size * 4;
    const target = y * size * 4;
    for (let x = 0; x < size * 4; x += 4) {
      const alpha = pixels[source + x + 3];
      if (alpha === 0) {
        // 완전히 투명한 픽셀은 색을 되돌릴 근거가 없다(0으로 나눈다). 색까지 비워야
        // 나중에 이미지를 확대·보간할 때 검은 테두리가 배어 나오지 않는다.
        out[target + x] = 0;
        out[target + x + 1] = 0;
        out[target + x + 2] = 0;
        out[target + x + 3] = 0;
        continue;
      }
      const scale = 255 / alpha;
      out[target + x] = Math.min(255, Math.round(pixels[source + x] * scale));
      out[target + x + 1] = Math.min(255, Math.round(pixels[source + x + 1] * scale));
      out[target + x + 2] = Math.min(255, Math.round(pixels[source + x + 2] * scale));
      out[target + x + 3] = alpha;
    }
  }
}

export {
  PRESET_THUMBNAIL_MIN_SIZE,
  PRESET_THUMBNAIL_MAX_SIZE,
  PRESET_THUMBNAIL_PADDING,
  thumbnailCameraDistance,
  thumbnailRenderSize,
  unpremultiplyFlipped
};
export type { BoxExtent };
