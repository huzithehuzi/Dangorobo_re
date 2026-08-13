const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PRESET_THUMBNAIL_MIN_SIZE,
  PRESET_THUMBNAIL_MAX_SIZE,
  PRESET_THUMBNAIL_PADDING,
  thumbnailCameraDistance,
  thumbnailRenderSize,
  unpremultiplyFlipped
} = require("../src/pet/thumbnail-image.js");

/** 펫 렌더러의 실제 카메라 화각. */
const FOV = 31;

/**
 * @param {number} actual
 * @param {number} expected
 * @param {string} [message]
 */
function near(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message || "값"}: ${actual}이(가) ${expected}에 가깝지 않다`
  );
}

test("상수는 분리 전 값 그대로다", () => {
  assert.equal(PRESET_THUMBNAIL_MIN_SIZE, 64);
  assert.equal(PRESET_THUMBNAIL_MAX_SIZE, 512);
  assert.equal(PRESET_THUMBNAIL_PADDING, 1.1);
});

test("카메라 거리는 가로·세로 중 큰 쪽이 여백까지 담기게 잡는다", () => {
  const halfExtent = (3 / 2) * PRESET_THUMBNAIL_PADDING;
  const expected = halfExtent / Math.tan((FOV * Math.PI / 180) / 2);
  // 세로가 더 크면 세로 기준, 가로가 더 크면 가로 기준으로 같은 거리가 나온다.
  near(thumbnailCameraDistance({ x: 1, y: 3, z: 0 }, FOV), expected, "세로가 큰 상자");
  near(thumbnailCameraDistance({ x: 3, y: 1, z: 0 }, FOV), expected, "가로가 큰 상자");
});

// 앞면이 카메라 뒤로 넘어가면 머리가 잘린다.
test("카메라 거리에 상자 깊이를 더한다", () => {
  const flat = thumbnailCameraDistance({ x: 2, y: 2, z: 0 }, FOV);
  near(thumbnailCameraDistance({ x: 2, y: 2, z: 1.5 }, FOV), flat + 1.5, "깊이 1.5");
});

test("화각이 좁을수록 더 멀리서 잡는다", () => {
  const narrow = thumbnailCameraDistance({ x: 2, y: 2, z: 0 }, 20);
  const wide = thumbnailCameraDistance({ x: 2, y: 2, z: 0 }, 60);
  assert.ok(narrow > wide, `좁은 화각 ${narrow}이 넓은 화각 ${wide}보다 멀어야 한다`);
});

// 라이브보다 카메라가 가까워진 비율만큼 해상도를 줄여야 외곽선 굵기·픽셀 아트 블록이
// 라이브에서 모델에 대해 갖던 비율 그대로 나온다.
test("해상도는 라이브 버퍼 높이에 카메라가 가까워진 비율을 곱한 값이다", () => {
  // 라이브 카메라가 7, 썸네일 카메라가 3.5면 절반.
  assert.equal(thumbnailRenderSize(400, 3.5, 7), 200);
  assert.equal(thumbnailRenderSize(400, 7, 7), 400, "같은 거리면 그대로");
  // 반올림한다.
  assert.equal(thumbnailRenderSize(300, 3.5, 7), 150);
  assert.equal(thumbnailRenderSize(301, 3.5, 7), 151);
});

test("해상도는 64~512로 잘린다", () => {
  assert.equal(thumbnailRenderSize(100, 0.01, 7), PRESET_THUMBNAIL_MIN_SIZE, "너무 작을 때");
  assert.equal(thumbnailRenderSize(4000, 7, 7), PRESET_THUMBNAIL_MAX_SIZE, "너무 클 때");
});

// 라이브 카메라가 원점에 붙어 있거나 버퍼 크기가 아직 0이면 0으로 나누거나 0이 곱해진다.
test("라이브 카메라 거리와 버퍼 높이가 0이어도 유효한 해상도를 준다", () => {
  const zeroCamera = thumbnailRenderSize(400, 3.5, 0);
  assert.ok(Number.isFinite(zeroCamera), "0으로 나누지 않는다");
  assert.equal(zeroCamera, PRESET_THUMBNAIL_MAX_SIZE);
  assert.equal(thumbnailRenderSize(0, 3.5, 7), PRESET_THUMBNAIL_MIN_SIZE);
  assert.equal(thumbnailRenderSize(400, 3.5, -5), PRESET_THUMBNAIL_MAX_SIZE, "음수 거리");
});

/**
 * @param {number[]} values
 * @returns {{pixels: Uint8Array, out: Uint8ClampedArray}}
 */
function buffers(values) {
  const size = Math.sqrt(values.length / 4);
  assert.ok(Number.isInteger(size), "정사각형이어야 한다");
  return { pixels: new Uint8Array(values), out: new Uint8ClampedArray(values.length) };
}

// WebGL은 좌하단이 원점이라 그대로 옮기면 위아래가 뒤집힌 썸네일이 나간다.
test("행 순서를 뒤집어 옮긴다", () => {
  // 2×2, 알파는 전부 불투명이라 색은 그대로 옮겨져야 한다.
  const { pixels, out } = buffers([
    10, 11, 12, 255, 20, 21, 22, 255, // GL 아래쪽 행
    30, 31, 32, 255, 40, 41, 42, 255 // GL 위쪽 행
  ]);
  unpremultiplyFlipped(pixels, out, 2);
  assert.deepEqual([...out], [
    30, 31, 32, 255, 40, 41, 42, 255, // 위쪽 행이 먼저 나온다
    10, 11, 12, 255, 20, 21, 22, 255
  ]);
});

// 되돌리지 않으면 반투명한 얼굴 데칼 가장자리에 밝은 띠가 생긴다.
test("곱해져 있던 알파를 되돌린다", () => {
  const { pixels, out } = buffers([64, 32, 16, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  unpremultiplyFlipped(pixels, out, 2);
  // 반투명 픽셀은 GL 아래쪽 행에 있으므로 뒤집혀서 마지막 행 첫 픽셀로 간다.
  assert.deepEqual([...out].slice(8, 12), [128, 64, 32, 128]);
});

test("되돌린 값이 255를 넘으면 잘라낸다", () => {
  const { pixels, out } = buffers([200, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  unpremultiplyFlipped(pixels, out, 2);
  assert.deepEqual([...out].slice(8, 12), [255, 0, 0, 100]);
});

// 완전히 투명한 픽셀은 색을 되돌릴 근거가 없다(0으로 나눈다). 색까지 비워야 확대·보간할 때
// 검은 테두리가 배어 나오지 않는다.
test("완전히 투명한 픽셀은 색까지 0으로 비운다", () => {
  const { pixels, out } = buffers([99, 88, 77, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  unpremultiplyFlipped(pixels, out, 2);
  assert.deepEqual([...out], new Array(16).fill(0));
});

test("불투명한 픽셀은 색이 바뀌지 않는다", () => {
  const { pixels, out } = buffers([13, 200, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  unpremultiplyFlipped(pixels, out, 2);
  assert.deepEqual([...out].slice(8, 12), [13, 200, 255, 255]);
});
