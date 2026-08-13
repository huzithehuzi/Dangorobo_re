// 펫 캔버스 후처리(팔레트 제한·디더링·외곽선·선 떨림) 셰이더 원본.
// renderer.ts는 이 문자열을 THREE.ShaderMaterial에 그대로 넘긴다. 유니폼 선언과 실제 값
// 대입은 renderer.ts의 postProcessUniforms가 짝을 이루므로, 여기서 uniform을 추가·삭제하면
// 그쪽도 함께 고친다. GLSL이 TypeScript 템플릿 리터럴 안에 있으므로 주석에 백틱을 쓰지 않는다.

const POST_PROCESS_VERTEX_SHADER = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

const POST_PROCESS_FRAGMENT_SHADER = `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uPaletteEnabled;
    uniform float uPaletteMode;
    uniform float uPaletteSteps;
    uniform sampler2D uPaletteRamp;
    uniform float uDitherPattern;
    uniform float uDitherAmount;
    uniform float uOutlineEnabled;
    uniform vec3 uOutlineColor;
    uniform float uOutlineThickness;
    uniform float uTime;
    uniform float uLineWobbleEnabled;
    uniform float uLineWobbleFrequency;
    uniform float uLineWobbleSpeed;
    uniform float uLineWobbleAmount;
    varying vec2 vUv;

    // 손그림 애니메이션 특유의 "선 떨림"(boiling lines) 효과 — 화면을 값-노이즈로
    // 살짝 도메인 워프(UV를 흔들어서 다시 샘플링)해서, 윤곽선과 색 경계가 프레임마다
    // 미세하게 다른 위치에서 그려지는 것처럼 보이게 한다. 별도 노이즈 텍스처 없이
    // 해시 기반 값-노이즈를 그 자리에서 계산한다(에셋 추가 없이 처리 가능).
    float wobbleHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float wobbleNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = wobbleHash(i);
      float b = wobbleHash(i + vec2(1.0, 0.0));
      float c = wobbleHash(i + vec2(0.0, 1.0));
      float d = wobbleHash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    vec2 wobbleOffset(vec2 uv) {
      // uResolution으로 나눠 종횡비를 보정해, 정사각형이 아닌 캔버스에서도 노이즈
      // 셀이 찌그러지지 않게 한다. "주기"(uLineWobbleFrequency)는 화면을 가로지르는
      // 노이즈 굴곡의 개수, "크기"(uLineWobbleAmount)는 흔들리는 폭(px)이다.
      //
      // 처음엔 시간을 연속으로 흘려보내 노이즈를 부드럽게 스크롤했는데, 그러면
      // "물결"처럼 매끄럽게 흐르는 느낌이라 만화 특유의 손떨림(boiling lines)과는
      // 달랐다("만화 느낌이 아니라 물결 같다" 피드백). 손그림 애니메이션은 매 프레임을
      // 완전히 다시 그리는 거라, 이전 프레임과 부드럽게 이어지지 않고 뚝뚝 끊어져
      // 보이는 게 핵심이다. 그래서 시간을 "속도"당 정수 스텝으로 끊어(floor) 그 스텝
      // 동안만 값을 고정하고, 스텝이 바뀌는 순간 노이즈 필드에서 완전히 다른 지점을
      // 새로 골라 값이 툭 튀게 한다(보간 없음).
      //
      // 처음엔 최종 이동량도 정수 픽셀 단위로 반올림해서 스냅했는데, 그러면 "크기"를
      // 조금만 올려도(예: 1) 항상 최소 1픽셀씩 통째로 튀어서 캔버스 전체가 덜컹거리는
      // 것처럼 과하게 느껴졌다("최솟값만해도 효과가 크다" 피드백) — 정수 스냅이 미세한
      // 크기 조절 자체를 없애버린 것이었다. 정수 스냅과 배율(*2.0)을 없애 서브픽셀
      // 단위로 세밀하게 조절되게 하고, 대신 시간 스텝(위)만으로 "뚝뚝 끊기는" 손떨림
      // 느낌은 그대로 유지한다.
      // 스텝이 계속 커지면 sin()에 들어가는 각도(dot 결과)가 수백만 단위로
      // 커져서 GPU sin() 근사의 정밀도가 무너지고 노이즈가 거의 고정값처럼
      // 나온다("장시간 사용 후 떨림이 멈춤" 버그, 2026-08-06 원인 규명·수정).
      // 노이즈 시드는 어차피 불연속적이라 주기적으로 감아도(mod) 눈에 띄는
      // 반복이 없으므로, 각도가 위험 구간에 들어가기 훨씬 전에 스텝을 감는다.
      float step = mod(floor(uTime * uLineWobbleSpeed), 10000.0);
      vec2 p = uv * uResolution * (uLineWobbleFrequency / max(uResolution.x, uResolution.y));
      float nx = wobbleNoise(p + vec2(step * 17.3, step * -9.1)) - 0.5;
      float ny = wobbleNoise(p + vec2(step * -9.1, step * 17.3) + vec2(19.3, 7.1)) - 0.5;
      vec2 offsetPx = vec2(nx, ny) * uLineWobbleAmount;
      return offsetPx / uResolution;
    }

    /* ── 디더링 ────────────────────────────────────────────────────────────
       계단화는 원래 "가장 가까운 단계로 반올림"(+0.5)이라 같은 밝기 구간이 통째로 한 색이
       되고 경계가 칼같이 떨어진다. 반올림 기준값 0.5를 **픽셀마다 다른 값**으로 바꾸면
       경계 부근 픽셀들이 두 단계 사이에서 섞이면서 패턴 무늬가 생긴다 — 이게 디더링이다.
       그래서 아래 함수들은 전부 "이 픽셀의 반올림 기준값(0~1)"을 돌려준다.

       좌표는 화면 픽셀 기준(vUv * uResolution)이라 펫이 움직여도 패턴이 화면에 고정된다.
       모델에 붙여 따라다니게 하려면 UV 기준으로 바꿔야 하지만, 레트로 디더링은 화면 고정이
       기본이고 그래야 픽셀 아트 효과와도 결이 맞는다.

       베이어(ordered) 행렬은 재귀 정의를 쓴다 — 4×4는 2×2를 반으로 축소해 겹친 것이고
       8×8은 다시 4×4를 겹친 것이다. 행렬을 배열로 들고 있는 것보다 짧고 분기도 없다. */
    float bayer2(vec2 p) {
      p = floor(p);
      return fract(p.x * 0.5 + p.y * p.y * 0.75);
    }
    float bayer4(vec2 p) { return bayer2(p * 0.5) * 0.25 + bayer2(p); }
    float bayer8(vec2 p) { return bayer4(p * 0.5) * 0.25 + bayer2(p); }

    float ditherHash(vec2 p) {
      return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453);
    }

    // uDitherPattern: 0 없음 / 1 베이어2 / 2 베이어4 / 3 베이어8 / 4 체커 / 5 가로줄 / 6 세로줄 / 7 노이즈
    float ditherThreshold(vec2 pixelPos) {
      if (uDitherPattern < 0.5) return 0.5;
      if (uDitherPattern < 1.5) return bayer2(pixelPos);
      if (uDitherPattern < 2.5) return bayer4(pixelPos);
      if (uDitherPattern < 3.5) return bayer8(pixelPos);
      if (uDitherPattern < 4.5) return mod(floor(pixelPos.x) + floor(pixelPos.y), 2.0) * 0.5 + 0.25;
      if (uDitherPattern < 5.5) return mod(floor(pixelPos.y), 2.0) * 0.5 + 0.25;
      if (uDitherPattern < 6.5) return mod(floor(pixelPos.x), 2.0) * 0.5 + 0.25;
      return ditherHash(pixelPos);
    }

    /* 계단화용 반올림 기준값. 강도 0이면 0.5(=디더링 없음), 1이면 패턴 값을 그대로 쓴다.
       계단화하는 곳(명도·그라디언트 맵)에서 +0.5 대신 이 값을 더한다.
       enabled는 호출부에서 디더링을 끄기 위한 스위치다 — 외곽선은 의도적으로 단색인
       선이라 여기에 패턴이 끼면 선이 얼룩덜룩해진다. */
    float ditherOffset(float enabled) {
      return mix(0.5, ditherThreshold(vUv * uResolution), uDitherAmount * enabled);
    }

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    // RGB 채널을 각각 반올림하면 채널마다 다르게 깎이면서 색상(Hue) 자체가 다른 색으로
    // 튀어버린다(파랑이 빨강·올리브색으로 보이는 원인, 특히 단계 수를 낮출수록 심해져서
    // 색이 "타는" 것처럼 과채도로 번쩍이는 원인이었다). 명도(V)는 사용자가 고른 단계
    // 수(steps)로 그대로 계단화해 팔레트 단계 설정이 체감되게 하고, 색상(Hue)은 그보다
    // 훨씬 촘촘한 고정 구간 수(hueLevels)로만 살짝 계단화한다 — 주광(따뜻한 색)과
    // 림라이트(찬 색)처럼 서로 다른 색 조명이 표면 위에서 섞이는 경계는 명도가 아니라
    // 색상 자체가 매끄럽게 이어지며 생기는 그라디언트라, V만 계단화해선 안 없어졌다.
    // 그렇다고 Hue를 steps 개수만큼(예: 2개)으로 거칠게 잘라버리면 색상환 절반씩이 한
    // 색으로 뭉개져서 원래 색과 전혀 다른 색으로 튀는, 처음 버그와 같은 증상이 재발한다.
    // 그래서 Hue만 따로 촘촘하게(48구간) 고정해, 색 정체성은 지키면서 조명 경계의 매끈한
    // 색상 보간만 눈에 띄지 않게 끊는다.
    //
    // 채도(S)는 명도와 똑같이 낮은 단계 수를 그대로 쓰면, 팔레트 단계를 세게 낮췄을 때
    // (예: 2단계) 중간 채도가 전부 0(무채색) 아니면 1(원색)로 양극화돼 "타는"(과채도)
    // 것처럼 보였다 — 이게 바로 낮은 단계에서 색이 타는 원인이었다. 채도는 최소한
    // SAT_MIN_LEVELS 단계는 항상 보장해서, 조명 경계 그라디언트는 여전히 끊어주면서도
    // (원래 채도 계단화를 넣은 목적) 중간 채도 자체가 사라지진 않게 한다.
    vec3 quantizeColor(vec3 color, float steps, float dither) {
      color = clamp(color, 0.0, 1.0);
      vec3 hsv = rgb2hsv(color);
      float levels = max(1.0, steps - 1.0);
      float hueLevels = 48.0;
      float satMinLevels = 6.0;
      float satLevels = max(levels, satMinLevels);
      // 어두운(V가 낮은) 부분은 주광·림라이트·앰비언트처럼 색이 다른 조명이 섞이면서
      // 생기는 채도·색상 변화가 절대 밝기 대비 상대적으로 커진다 — 같은 조명 혼색이라도
      // 밝은 곳에서는 눈에 안 띄지만, 어두운 커스텀 색상(예: 짙은 갈색)에서는 그 미세한
      // 색 변화가 그대로 양자화되면서 나무 나이테처럼 겹겹이 보이는 색 얼룩 무늬로 튀어나온다
      // (팔레트 제한 켜면 어두운 몸통에 이상한 색 층이 겹쳐 보이는 버그, 2026-08-06).
      // 임계값을 0.35로 뒀던 1차 수정은 실제 사용자 설정(짙은 몸통 색 + 채도 높은 보라색
      // 앰비언트 그림자 + paletteSteps=5)으로 재현하니 중간 밝기 영역(V 0.35~0.6)에서
      // 여전히 층이 남아 있었다 — 그 구간은 아직 hueLevels(48)이 satMinLevels(6)보다도
      // 밝기 단계 수(steps 낮을 때는 4 등)보다 촘촘해서 색상 경계가 밝기 경계와 안 맞고
      // 따로 논다. 임계값을 0.6으로 올려 중간 밝기까지 채도를 낮춰 Hue의 영향을 줄였다.
      float darkDesaturate = smoothstep(0.0, 0.6, hsv.z);
      hsv.y *= darkDesaturate;
      hsv.x = fract(floor(fract(hsv.x) * hueLevels + 0.5) / hueLevels);
      hsv.y = floor(hsv.y * satLevels + 0.5) / satLevels;
      /* 디더링은 **명도(V)에만** 건다. 사용자가 고른 단계 수가 실제로 체감되는 축이 V라
         디더링으로 얻는 "중간 톤이 섞여 보이는" 효과도 여기서 나온다. Hue(48구간)·채도
         (최소 6단계)는 원래 색 정체성을 지키려고 촘촘하게만 끊는 축이라, 여기에까지 디더를
         걸면 색상이 픽셀마다 튀어 무늬가 아니라 색 노이즈처럼 지저분해진다. */
      hsv.z = floor(hsv.z * levels + ditherOffset(dither)) / levels;
      return hsv2rgb(hsv);
    }

    vec3 applyPalette(vec3 linearColor, float dither) {
      vec3 color = linearColor;
      float maxChannel = max(max(color.r, color.g), color.b);
      if (maxChannel > 1.0) {
        color = color / maxChannel * 0.95;
      }
      color = sRGBTransferOETF(vec4(clamp(color, 0.0, 1.0), 1.0)).rgb;
      if (uPaletteMode > 4.5) {
        /* 사용자 지정 팔레트 = 그라디언트 맵. 픽셀의 원래 색상·채도는 버리고 **밝기만** 보고
           사용자 그라디언트에서 그 위치의 색을 그대로 가져온다. 밝기를 uPaletteSteps 단계로
           먼저 계단화한 뒤 뽑기 때문에 실제로 나오는 색이 딱 그 개수만큼으로 제한된다
           ("색상 제한 숫자입력").

           밝기는 다른 팔레트 모드와 **같은 color**(HDR 클램프 + sRGB 인코딩을 거친 값)에서
           뽑는다. 램프 텍스처도 sRGB 바이트를 그대로 담고 있어서 변환 없이 바로 대입된다. */
        float brightness = dot(color, vec3(0.299, 0.587, 0.114));
        float levels = max(1.0, uPaletteSteps - 1.0);
        float t = clamp(floor(brightness * levels + ditherOffset(dither)) / levels, 0.0, 1.0);
        color = texture2D(uPaletteRamp, vec2(t, 0.5)).rgb;
      } else if (uPaletteMode > 3.5) {
        float luminance = dot(color, vec3(0.299, 0.587, 0.114));
        if (luminance < 0.25) color = vec3(0.0588, 0.2196, 0.0588);
        else if (luminance < 0.5) color = vec3(0.1882, 0.3843, 0.1882);
        else if (luminance < 0.75) color = vec3(0.5451, 0.6745, 0.0588);
        else color = vec3(0.6078, 0.7373, 0.0588);
      } else {
        if (uPaletteMode > 2.5) {
          float luminance = dot(color, vec3(0.299, 0.587, 0.114));
          color = vec3(luminance);
        } else if (uPaletteMode > 1.5) {
          color = mix(color, clamp(color * vec3(0.82, 0.98, 1.12) + vec3(0.0, 0.012, 0.035), 0.0, 1.0), 0.58);
        } else if (uPaletteMode > 0.5) {
          color = mix(color, clamp(color * vec3(1.12, 0.98, 0.82) + vec3(0.035, 0.008, 0.0), 0.0, 1.0), 0.58);
        }
        color = quantizeColor(color, uPaletteSteps, dither);
      }
      return sRGBTransferEOTF(vec4(clamp(color, 0.0, 1.0), 1.0)).rgb;
    }

    float sampledAlpha(vec2 baseUv, vec2 direction, float radius) {
      return texture2D(tDiffuse, baseUv + direction * radius / uResolution).a;
    }

    float ringAlpha(vec2 baseUv, float radius) {
      float alpha = 0.0;
      alpha = max(alpha, sampledAlpha(baseUv, vec2(1.0, 0.0), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(-1.0, 0.0), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(0.0, 1.0), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(0.0, -1.0), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(0.7071, 0.7071), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(-0.7071, 0.7071), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(0.7071, -0.7071), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(-0.7071, -0.7071), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(0.9239, 0.3827), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(-0.9239, 0.3827), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(0.9239, -0.3827), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(-0.9239, -0.3827), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(0.3827, 0.9239), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(-0.3827, 0.9239), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(0.3827, -0.9239), radius));
      alpha = max(alpha, sampledAlpha(baseUv, vec2(-0.3827, -0.9239), radius));
      return alpha;
    }

    void main() {
      vec2 wobbledUv = vUv;
      if (uLineWobbleEnabled > 0.5) {
        wobbledUv += wobbleOffset(vUv);
      }
      vec4 center = texture2D(tDiffuse, wobbledUv);
      float centerAlpha = clamp(center.a, 0.0, 1.0);
      vec3 baseColor = centerAlpha > 0.0001
        ? center.rgb / max(centerAlpha, 0.0001)
        : vec3(0.0);
      if (uPaletteEnabled > 0.5 && centerAlpha > 0.0001) {
        baseColor = applyPalette(baseColor, 1.0);
      }

      float outlineLayerAlpha = 0.0;
      // centerAlpha가 1이면 아래 합성식의 (1.0 - centerAlpha)가 0이라 외곽선 기여분이
      // 정확히 0이다 — 실루엣 내부(캔버스에서 면적이 가장 큰 영역)에서 링 샘플링을
      // 통째로 건너뛴다. 결과는 완전히 동일하다(2026-08-07).
      if (uOutlineEnabled > 0.5 && centerAlpha < 1.0) {
        float radius = max(1.0, uOutlineThickness);
        float inner1 = max(1.0, radius * 0.66);
        float inner2 = max(1.0, radius * 0.33);
        // 굵기가 얇으면 세 반지름이 전부 1.0으로 뭉개져 같은 텍셀을 세 번 읽는다.
        // 안쪽 링이 실제로 더 작을 때만 돈다 — 이것도 결과는 동일하다.
        float nearbyAlpha = ringAlpha(wobbledUv, radius);
        if (inner1 < radius) nearbyAlpha = max(nearbyAlpha, ringAlpha(wobbledUv, inner1));
        if (inner2 < inner1) nearbyAlpha = max(nearbyAlpha, ringAlpha(wobbledUv, inner2));
        outlineLayerAlpha = clamp(nearbyAlpha, 0.0, 1.0);
      }

      // 외곽선 색은 사용자가 직접 고른 고정 색이라, 팔레트 제한을 켜도 지금까지는
      // 그 팔레트를 무시하고 원래 고른 색 그대로 나갔다 — 몸체는 제한된 색만 쓰는데
      // 외곽선만 팔레트 밖의 색으로 튀어 보이는 불일치가 있었다. 팔레트가 켜져 있으면
      // 외곽선 색도 같은 계단화를 거치게 한다.
      vec3 finalOutlineColor = uPaletteEnabled > 0.5 ? applyPalette(uOutlineColor, 0.0) : uOutlineColor;
      float finalAlpha = centerAlpha + outlineLayerAlpha * (1.0 - centerAlpha);
      vec3 premultipliedLinear = baseColor * centerAlpha +
        finalOutlineColor * outlineLayerAlpha * (1.0 - centerAlpha);
      vec3 finalColor = finalAlpha > 0.0001
        ? premultipliedLinear / finalAlpha
        : vec3(0.0);
      gl_FragColor = vec4(finalColor, finalAlpha);
      #include <colorspace_fragment>
      gl_FragColor.rgb *= gl_FragColor.a;
    }
  `;

export { POST_PROCESS_VERTEX_SHADER, POST_PROCESS_FRAGMENT_SHADER };
