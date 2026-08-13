// 사용자 지정 팔레트(그라디언트 맵)의 정지점 정규화와 1D 램프 픽셀 계산. renderer.ts에서
// 떼어냈다. GPU 자원(DataTexture) 생성과 캐시는 렌더러가 그대로 들고 있고, 여기에는 인자만
// 보는 계산을 둔다 — 색 경계는 캡처로 눈여겨보기 어려워 테스트로 고정한다.
//
// import 지정자에 `.js`를 붙이는 이유는 src/pet/tsconfig.build.json 주석 참고(noResolve 단일 파일 변환).
import * as THREE from "three";

const PALETTE_RAMP_WIDTH = 256;

/* 정규화는 main이 하지만, 렌더러도 최소한의 방어를 한다 — 설정 파일이 손상됐거나 예전
   버전에서 넘어와 이 키가 아예 없을 수 있고, 그때 셰이더에 null 텍스처가 들어가면
   화면이 통째로 검게 나온다. */
const PALETTE_CUSTOM_FALLBACK_STOPS: PaletteStop[] = [
  { position: 0, color: "#1b1b2a" },
  { position: 0.5, color: "#a0567a" },
  { position: 1, color: "#ffe6c4" }
];

type PaletteStop = { position: number; color: string };
/** `#rrggbb` 문자열을 0~255 채널 튜플로 바꾼다(공용 색 선택기의 hexToRgb를 그대로 받는다). */
type HexToRgb = (hex: string) => [number, number, number];

function isPaletteStop(value: unknown): value is { position: unknown, color: unknown } {
  return typeof value === "object" && value !== null &&
    "color" in value && "position" in value &&
    /^#[0-9a-fA-F]{6}$/.test(String(value.color || "")) &&
    Number.isFinite(Number(value.position));
}

function normalizeCustomStops(value: unknown): PaletteStop[] {
  const stops = (Array.isArray(value) ? value : [])
    .filter(isPaletteStop)
    .map((stop) => ({
      position: THREE.MathUtils.clamp(Number(stop.position), 0, 1),
      color: String(stop.color).toLowerCase()
    }))
    .sort((a, b) => a.position - b.position);
  return stops.length >= 2 ? stops : PALETTE_CUSTOM_FALLBACK_STOPS;
}

/** 정지점이 그대로면 램프를 다시 굽지 않도록 렌더러가 비교하는 지문이다. */
function paletteRampSignature(stops: PaletteStop[]): string {
  return stops.map((stop) => `${stop.position}:${stop.color}`).join(",");
}

/**
 * 정지점을 256픽셀 RGBA 램프로 굽는다. 셰이더에서 정지점 배열을 직접 보간할 수도 있지만,
 * 정지점 개수가 가변이라 uniform 배열 길이를 고정해야 하고 GLSL 쪽 루프도 늘어난다. 여기서
 * 한 번 구워두면 셰이더는 texture2D 한 번으로 끝난다(정지점이 바뀔 때만 다시 굽는다).
 * 정지점은 normalizeCustomStops를 거쳐 위치 오름차순이고 2개 이상이라고 가정한다.
 */
function buildPaletteRampPixels(stops: PaletteStop[], hexToRgb: HexToRgb): Uint8Array {
  const data = new Uint8Array(PALETTE_RAMP_WIDTH * 4);
  const rgb = stops.map((stop) => hexToRgb(stop.color));
  for (let x = 0; x < PALETTE_RAMP_WIDTH; x += 1) {
    const t = x / (PALETTE_RAMP_WIDTH - 1);
    // t를 감싸는 두 정지점을 찾아 선형 보간한다.
    let index = 0;
    while (index < stops.length - 2 && stops[index + 1].position < t) index += 1;
    const left = stops[index];
    const right = stops[index + 1];
    const span = right.position - left.position;
    // 같은 자리에 정지점이 겹쳐 있으면 0으로 나누게 되므로 왼쪽 색을 그대로 쓴다.
    const ratio = span > 0 ? Math.min(1, Math.max(0, (t - left.position) / span)) : 0;
    const offset = x * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = Math.round(rgb[index][channel] + (rgb[index + 1][channel] - rgb[index][channel]) * ratio);
    }
    data[offset + 3] = 255;
  }
  return data;
}

export {
  PALETTE_RAMP_WIDTH,
  PALETTE_CUSTOM_FALLBACK_STOPS,
  isPaletteStop,
  normalizeCustomStops,
  paletteRampSignature,
  buildPaletteRampPixels
};
export type { PaletteStop, HexToRgb };
