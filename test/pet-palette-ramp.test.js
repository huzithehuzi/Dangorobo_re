const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PALETTE_RAMP_WIDTH,
  PALETTE_CUSTOM_FALLBACK_STOPS,
  isPaletteStop,
  normalizeCustomStops,
  paletteRampSignature,
  buildPaletteRampPixels
} = require("../src/pet/palette-ramp.js");

/**
 * 공용 색 선택기(window.PetColorPicker)는 브라우저 전역이라 여기서는 같은 규칙의 대역을 넣는다.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) || 0);
  return [channels[0], channels[1], channels[2]];
}

/**
 * @param {Uint8Array} pixels
 * @param {number} x
 * @returns {number[]}
 */
function pixelAt(pixels, x) {
  assert.ok(Number.isInteger(x), `픽셀 번호는 정수여야 한다: ${x}`);
  return [pixels[x * 4], pixels[x * 4 + 1], pixels[x * 4 + 2], pixels[x * 4 + 3]];
}

test("정지점 모양 검사는 6자리 hex와 유한한 위치만 통과시킨다", () => {
  assert.equal(isPaletteStop({ position: 0, color: "#ff0000" }), true);
  assert.equal(isPaletteStop({ position: 0, color: "#F0A1b2" }), true);
  assert.equal(isPaletteStop({ position: 0, color: "#f00" }), false, "3자리 축약형");
  assert.equal(isPaletteStop({ position: 0, color: "ff0000" }), false, "# 없음");
  assert.equal(isPaletteStop({ position: "abc", color: "#ff0000" }), false, "위치가 숫자가 아님");
  assert.equal(isPaletteStop({ color: "#ff0000" }), false, "위치 없음");
  assert.equal(isPaletteStop(null), false);
  assert.equal(isPaletteStop("#ff0000"), false);
});

test("정지점은 위치 오름차순으로 정렬되고 색은 소문자로 통일된다", () => {
  assert.deepEqual(
    normalizeCustomStops([
      { position: 1, color: "#FFE6C4" },
      { position: 0, color: "#1B1B2A" },
      { position: 0.5, color: "#A0567A" }
    ]),
    [
      { position: 0, color: "#1b1b2a" },
      { position: 0.5, color: "#a0567a" },
      { position: 1, color: "#ffe6c4" }
    ]
  );
});

test("위치는 0~1로 잘리고 잘못된 항목은 버려진다", () => {
  assert.deepEqual(
    normalizeCustomStops([
      { position: -4, color: "#000000" },
      { position: 9, color: "#ffffff" },
      { position: 0.5, color: "nope" },
      "쓰레기"
    ]),
    [
      { position: 0, color: "#000000" },
      { position: 1, color: "#ffffff" }
    ]
  );
});

// 정지점이 2개 미만이면 셰이더에 넣을 램프를 만들 수 없어 화면이 통째로 검게 나온다.
test("쓸 수 있는 정지점이 2개 미만이면 기본 정지점으로 되돌린다", () => {
  assert.deepEqual(normalizeCustomStops([]), PALETTE_CUSTOM_FALLBACK_STOPS);
  assert.deepEqual(normalizeCustomStops(null), PALETTE_CUSTOM_FALLBACK_STOPS);
  assert.deepEqual(normalizeCustomStops("#ff0000"), PALETTE_CUSTOM_FALLBACK_STOPS);
  assert.deepEqual(
    normalizeCustomStops([{ position: 0.5, color: "#ff0000" }]),
    PALETTE_CUSTOM_FALLBACK_STOPS
  );
  assert.ok(PALETTE_CUSTOM_FALLBACK_STOPS.length >= 2);
});

test("지문은 정지점이 그대로면 같고 하나라도 달라지면 바뀐다", () => {
  const stops = normalizeCustomStops([
    { position: 0, color: "#000000" },
    { position: 1, color: "#ffffff" }
  ]);
  assert.equal(paletteRampSignature(stops), paletteRampSignature([...stops]));
  assert.notEqual(
    paletteRampSignature(stops),
    paletteRampSignature([{ position: 0, color: "#000001" }, { position: 1, color: "#ffffff" }])
  );
  assert.notEqual(
    paletteRampSignature(stops),
    paletteRampSignature([{ position: 0.1, color: "#000000" }, { position: 1, color: "#ffffff" }])
  );
});

test("램프는 폭만큼의 RGBA 픽셀이고 알파는 전부 불투명이다", () => {
  const pixels = buildPaletteRampPixels(
    [{ position: 0, color: "#000000" }, { position: 1, color: "#ffffff" }],
    hexToRgb
  );
  assert.equal(pixels.length, PALETTE_RAMP_WIDTH * 4);
  for (let x = 0; x < PALETTE_RAMP_WIDTH; x += 1) {
    assert.equal(pixels[x * 4 + 3], 255, `${x}번 픽셀의 알파`);
  }
});

test("양 끝은 첫 정지점과 마지막 정지점 색 그대로다", () => {
  const pixels = buildPaletteRampPixels(
    [{ position: 0, color: "#102030" }, { position: 1, color: "#a0b0c0" }],
    hexToRgb
  );
  assert.deepEqual(pixelAt(pixels, 0), [0x10, 0x20, 0x30, 255]);
  assert.deepEqual(pixelAt(pixels, PALETTE_RAMP_WIDTH - 1), [0xa0, 0xb0, 0xc0, 255]);
});

test("두 정지점 사이는 선형으로 보간된다", () => {
  const pixels = buildPaletteRampPixels(
    [{ position: 0, color: "#000000" }, { position: 1, color: "#ffffff" }],
    hexToRgb
  );
  // 램프 폭이 256이라 t는 x/255다 — 정확히 0.5인 픽셀은 없고 127과 128이 그 자리를 감싼다.
  assert.deepEqual(pixelAt(pixels, 64), [64, 64, 64, 255]);
  assert.deepEqual(pixelAt(pixels, 127), [127, 127, 127, 255]);
  assert.deepEqual(pixelAt(pixels, 128), [128, 128, 128, 255]);
  assert.deepEqual(pixelAt(pixels, 191), [191, 191, 191, 255]);
});

test("정지점이 셋이면 t가 속한 구간의 두 색으로 보간한다", () => {
  const pixels = buildPaletteRampPixels(
    [
      { position: 0, color: "#ff0000" },
      { position: 0.5, color: "#00ff00" },
      { position: 1, color: "#0000ff" }
    ],
    hexToRgb
  );
  // 가운데 정지점(t=0.5)을 감싸는 두 픽셀은 거의 순수한 초록이다.
  for (const x of [127, 128]) {
    const [r, g, b] = pixelAt(pixels, x);
    assert.ok(g >= 254 && r <= 1 && b <= 1, `${x}번 픽셀이 초록이 아니다: ${r},${g},${b}`);
  }
  // 첫 구간은 빨강↔초록만, 둘째 구간은 초록↔파랑만 섞여야 한다.
  const firstSegment = pixelAt(pixels, 64);
  assert.ok(firstSegment[0] > 0 && firstSegment[1] > 0, "첫 구간이 보간되지 않았다");
  assert.equal(firstSegment[2], 0, "첫 구간에 파랑이 섞였다");
  const secondSegment = pixelAt(pixels, 191);
  assert.ok(secondSegment[1] > 0 && secondSegment[2] > 0, "둘째 구간이 보간되지 않았다");
  assert.equal(secondSegment[0], 0, "둘째 구간에 빨강이 섞였다");
});

// 같은 자리에 정지점이 겹치면 구간 폭이 0이라 나눗셈이 NaN을 만들 수 있다.
test("같은 위치에 겹친 정지점도 NaN 없이 왼쪽 색을 쓴다", () => {
  const pixels = buildPaletteRampPixels(
    [{ position: 0.5, color: "#ff0000" }, { position: 0.5, color: "#00ff00" }],
    hexToRgb
  );
  for (let x = 0; x < PALETTE_RAMP_WIDTH; x += 1) {
    assert.deepEqual(pixelAt(pixels, x), [255, 0, 0, 255], `${x}번 픽셀`);
  }
});
