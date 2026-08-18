"use strict";

// 소개 페이지(docs/index.html)에 넣는 이미지를 다시 뽑을 때 쓰는 도구.
// 절차 전체는 docs/SITE.md의 "이미지 다시 찍기"를 따른다.
//
//   node scripts/site-media.js profiles <출력폴더>
//     내장 프리셋마다 임시 프로필 폴더를 만들고 그 외형을 top-level로 올린
//     pet-settings.json을 쓴다. 그 폴더를 --user-data-dir로 주고 --capture 하면
//     프리셋별 펫이 찍힌다.
//
//   node scripts/site-media.js crop <입력폴더> <출력폴더> [파일...]
//     캡처 PNG의 투명 여백을 잘라낸다. 파일을 안 주면 폴더의 모든 .png를 처리한다.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");

// 잘라낸 뒤 남겨두는 여백(px). 그림자가 잘려 네모나 보이지 않을 만큼만 둔다.
const CROP_PADDING = 12;
// 이보다 투명한 픽셀은 배경으로 본다. 0으로 두면 거의 안 보이는 그림자 끝까지 살아남는다.
const ALPHA_FLOOR = 8;

// 프리셋이 담는 외형 키. 설정창에서 프리셋을 "적용"할 때 top-level로 올라가는 값들이다.
const APPEARANCE_KEYS = Object.freeze([
  "bodyColors",
  "partVariations",
  "facePattern",
  "faceCosmetic",
  "faceEyeStyle",
  "faceMouthStyle",
  "customFaceEnabled",
  "bodyCostume",
  "customBodyEnabled"
]);

// settings-schema는 모듈 평가 중 electron의 app만 건드린다(app.getLocale·getPath).
// test/settings-normalize.test.js와 같은 방식으로 최소 스텁을 캐시에 심어 순수 Node에서 읽는다.
function loadDefaultSettings() {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = /** @type {any} */ ({
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: {
        getLocale: () => "ko-KR",
        getPath: () => path.join(REPO_ROOT, "release")
      }
    }
  });
  return require(path.join(REPO_ROOT, "src", "main", "settings-schema.js")).DEFAULT_SETTINGS;
}

/** @param {string} outRoot */
function writeProfiles(outRoot) {
  const defaults = loadDefaultSettings();
  if (!defaults.customizationPresets.length) {
    throw new Error("DEFAULT_SETTINGS에 내장 프리셋이 없다 — settings-schema를 확인할 것");
  }
  for (const preset of defaults.customizationPresets) {
    // 설정 전체를 DEFAULT_SETTINGS에서 파생한다. 키를 손으로 골라 담으면 빠진 키 때문에
    // 멀쩡한 앱이 고장난 것처럼 찍힌다.
    const settings = JSON.parse(JSON.stringify(defaults));
    const source = /** @type {Record<string, unknown>} */ (preset);
    for (const key of APPEARANCE_KEYS) {
      if (source[key] !== undefined) settings[key] = JSON.parse(JSON.stringify(source[key]));
    }
    settings.language = "ko";
    const dir = path.join(outRoot, preset.id);
    fs.mkdirSync(dir, { recursive: true });
    // Node의 writeFileSync는 BOM을 붙이지 않는다. PowerShell의 Out-File -Encoding utf8은
    // BOM을 붙여 JSON.parse가 조용히 실패하므로 설정 파일을 그쪽으로 쓰지 말 것.
    fs.writeFileSync(path.join(dir, "pet-settings.json"), JSON.stringify(settings, null, 2), "utf8");
    console.log(`${preset.name}\t${dir}`);
  }
}

/**
 * @param {string} inDir
 * @param {string} outDir
 * @param {string[]} names
 */
async function cropDirectory(inDir, outDir, names) {
  const { Jimp } = require("jimp");
  const targets = names.length ? names : fs.readdirSync(inDir).filter((name) => name.endsWith(".png"));
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of targets) {
    const image = await Jimp.read(path.join(inDir, name));
    const { width, height, data } = image.bitmap;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] <= ALPHA_FLOOR) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) {
      console.log(`${name}: 불투명 픽셀이 없다 — 건너뜀`);
      continue;
    }
    const x = Math.max(0, minX - CROP_PADDING);
    const y = Math.max(0, minY - CROP_PADDING);
    const w = Math.min(width - x, maxX - minX + 1 + CROP_PADDING * 2);
    const h = Math.min(height - y, maxY - minY + 1 + CROP_PADDING * 2);
    image.crop({ x, y, w, h });
    // jimp의 write는 확장자가 있는 경로 리터럴 타입을 요구한다 — .png만 다루므로 캐스트한다.
    await image.write(/** @type {`${string}.${string}`} */ (path.join(outDir, name)));
    console.log(`${name}: ${width}x${height} → ${w}x${h}`);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "profiles") {
    if (!rest[0]) throw new Error("사용법: node scripts/site-media.js profiles <출력폴더>");
    writeProfiles(path.resolve(rest[0]));
    return;
  }
  if (command === "crop") {
    if (!rest[0] || !rest[1]) {
      throw new Error("사용법: node scripts/site-media.js crop <입력폴더> <출력폴더> [파일...]");
    }
    await cropDirectory(path.resolve(rest[0]), path.resolve(rest[1]), rest.slice(2));
    return;
  }
  throw new Error("명령은 profiles 또는 crop이다. 자세한 절차는 docs/SITE.md 참고.");
}

main().catch((error) => {
  console.error(String(error.message || error));
  process.exitCode = 1;
});
