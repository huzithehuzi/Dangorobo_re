// 프리셋마다 커스텀 얼굴·바디 이미지를 따로 보관한다(2026-08-20).
//
// 활성 슬롯(userData/custom-face/, custom-body/)은 "지금 펫에 적용된 이미지"라는 뜻을 그대로
// 유지한다 — 렌더러·IPC 경로와 기존 사용자 데이터를 건드리지 않기 위해서다. 프리셋을 저장할
// 때 활성 이미지를 프리셋 파일 하나(zip)로 굳히고, 프리셋을 적용할 때 그 zip을 활성 슬롯으로
// 되돌린다.
//
// 보관 형태가 zip인 것은 내보내기 형식과 같기 때문이다 — 프리셋 파일에 preset.json만 더하면
// 그대로 "세트" 파일이 되고, 불러올 때도 `importCustomFaceZip()`의 검증·원자적 교체를 그대로
// 쓴다(얼굴 이미지 검증 규칙이 두 벌로 갈리지 않는다).
//
// 이 기능 이전에 저장된 프리셋에는 zip이 없다. 그때는 활성 이미지를 그대로 둔다 — 예전 동작
// (모든 프리셋이 활성 이미지 한 벌을 공유)이 유지되고, 사용자가 넣어 둔 그림이 사라지지 않는다.
import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import AdmZip = require("adm-zip");
import { writeFileAtomicSync } from "./atomic-file.js";
import {
  CUSTOM_FACE_EXPRESSION_KEYS,
  customFacePngPath,
  importCustomFaceZip
} from "./custom-face.js";
import { customBodyDir, customBodyPngPath } from "./custom-body.js";

const CUSTOM_BODY_ENTRY_NAME = "custombody.png";
const PRESET_JSON_ENTRY_NAME = "preset.json";

type PresetAssetActivation = { faceKeys: string[]; hasBody: boolean };
type PresetSetImport =
  | { ok: true; preset: unknown; faceKeys: string[]; hasBody: boolean }
  | { ok: false; errorCode: "invalidFile" };

function presetAssetDir(): string {
  return path.join(app.getPath("userData"), "custom-presets");
}

// 프리셋 id는 정규화를 거쳐도 "파일에서 읽은 임의의 문자열"일 수 있으므로 경로로 쓰기 전에
// 파일명에 안전한 문자만 남긴다.
function presetAssetZipPath(id: string): string {
  const safeId = String(id || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeId) return "";
  return path.join(presetAssetDir(), `${safeId}.zip`);
}

function faceEntryName(key: string): string {
  return `customface_${key}.png`;
}

/** 활성 슬롯에 있는 커스텀 이미지들을 zip 항목 목록으로 모은다. */
function collectActiveAssets(): Array<{ name: string; data: Buffer }> {
  const files: Array<{ name: string; data: Buffer }> = [];
  for (const key of CUSTOM_FACE_EXPRESSION_KEYS) {
    const filePath = customFacePngPath(key);
    if (!fs.existsSync(filePath)) continue;
    try {
      files.push({ name: faceEntryName(key), data: fs.readFileSync(filePath) });
    } catch {}
  }
  const bodyPath = customBodyPngPath();
  if (fs.existsSync(bodyPath)) {
    try {
      files.push({ name: CUSTOM_BODY_ENTRY_NAME, data: fs.readFileSync(bodyPath) });
    } catch {}
  }
  return files;
}

function readZip(filePath: string): AdmZip | null {
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    return new AdmZip(filePath);
  } catch {
    return null;
  }
}

function zipEntryData(zip: AdmZip, name: string): Buffer | null {
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (path.basename(entry.entryName).toLowerCase() !== name) continue;
    try {
      return entry.getData();
    } catch {
      return null;
    }
  }
  return null;
}

function isPng(data: Buffer | null): data is Buffer {
  return Boolean(data)
    && (data as Buffer).length >= 8
    && (data as Buffer).readUInt32BE(0) === 0x89504e47
    && (data as Buffer).readUInt32BE(4) === 0x0d0a1a0a;
}

function writeActiveBody(data: Buffer): boolean {
  if (!isPng(data)) return false;
  try {
    fs.mkdirSync(customBodyDir(), { recursive: true });
    writeFileAtomicSync(customBodyPngPath(), data, { backup: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 지금 활성 슬롯에 있는 커스텀 이미지를 프리셋 파일로 굳힌다(프리셋 저장 시점).
 * 이미지가 하나도 없으면 남아 있던 프리셋 파일을 지우고 false를 돌려준다.
 */
function capturePresetAssets(id: string): boolean {
  const zipPath = presetAssetZipPath(id);
  if (!zipPath) return false;
  const files = collectActiveAssets();
  if (!files.length) {
    deletePresetAssets(id);
    return false;
  }
  try {
    const zip = new AdmZip();
    for (const file of files) zip.addFile(file.name, file.data);
    fs.mkdirSync(presetAssetDir(), { recursive: true });
    writeFileAtomicSync(zipPath, zip.toBuffer());
    return true;
  } catch {
    return false;
  }
}

function deletePresetAssets(id: string): void {
  const zipPath = presetAssetZipPath(id);
  if (!zipPath) return;
  try {
    fs.rmSync(zipPath, { force: true });
  } catch {}
}

/**
 * 프리셋 파일의 이미지를 활성 슬롯으로 되돌린다(프리셋 적용 시점).
 * 파일이 없으면 활성 이미지를 건드리지 않는다(이 기능 전에 저장한 프리셋).
 */
function activatePresetAssets(id: string): PresetAssetActivation | null {
  const zipPath = presetAssetZipPath(id);
  if (!zipPath || !fs.existsSync(zipPath)) return null;
  return applyAssetZip(zipPath);
}

/** zip 하나(프리셋 보관 파일 또는 내보낸 세트 파일)의 이미지를 활성 슬롯에 적용한다. */
function applyAssetZip(zipPath: string): PresetAssetActivation {
  const zip = readZip(zipPath);
  if (!zip) return { faceKeys: [], hasBody: false };
  const hasFaceEntry = zip.getEntries().some(
    (entry) => !entry.isDirectory && /^customface_.+\.png$/i.test(path.basename(entry.entryName))
  );
  // 얼굴은 검증·원자적 교체가 이미 있는 zip 가져오기 경로를 그대로 쓴다.
  const faceResult = hasFaceEntry ? importCustomFaceZip(zipPath) : { ok: false as const };
  const bodyData = zipEntryData(zip, CUSTOM_BODY_ENTRY_NAME);
  return {
    faceKeys: faceResult.ok ? faceResult.keys : [],
    hasBody: bodyData ? writeActiveBody(bodyData) : false
  };
}

/**
 * 프리셋 파일에 든 기본 표정(normal) 얼굴 이미지를 data URL로 읽는다.
 * 프리셋 갤러리 썸네일을 그 프리셋의 얼굴로 그리기 위한 것이다(썸네일은 머리만, 표정은 normal).
 */
function readPresetFaceTextureDataUrl(id: string): string | null {
  const zipPath = presetAssetZipPath(id);
  if (!zipPath || !fs.existsSync(zipPath)) return null;
  const zip = readZip(zipPath);
  const data = zip ? zipEntryData(zip, faceEntryName("normal")) : null;
  return isPng(data) ? `data:image/png;base64,${data.toString("base64")}` : null;
}

/**
 * 이 기능(2026-08-20) 전에 저장된 프리셋에는 자기 이미지 파일이 없다. 그때는 모든 프리셋이
 * 활성 이미지 한 벌을 공유했으므로, **커스텀 이미지를 쓰는 프리셋**에 한해 지금 활성 이미지를
 * 그 프리셋의 파일로 한 번 복사해 준다 — 이걸 안 하면 옛 프리셋들만 계속 이미지를 공유해서
 * "프리셋마다 따로 저장된다"는 규칙이 프리셋에 따라 다르게 보인다.
 * 이미 파일이 있는 프리셋은 건드리지 않으므로 여러 번 불러도 안전하다.
 */
function seedLegacyPresetAssets(
  presets: Array<{ id?: unknown; customFaceEnabled?: unknown; customBodyEnabled?: unknown }>
): number {
  if (!collectActiveAssets().length) return 0;
  let seeded = 0;
  for (const preset of Array.isArray(presets) ? presets : []) {
    if (preset?.customFaceEnabled !== true && preset?.customBodyEnabled !== true) continue;
    const zipPath = presetAssetZipPath(String(preset?.id ?? ""));
    if (!zipPath || fs.existsSync(zipPath)) continue;
    if (capturePresetAssets(String(preset.id))) seeded += 1;
  }
  return seeded;
}

/**
 * 프리셋 하나를 "세트" 파일로 내보낸다 — preset.json + 그 프리셋의 커스텀 이미지.
 * 프리셋 파일이 없으면(옛 프리셋) 지금 활성 이미지를 담는다 — 예전에는 모든 프리셋이
 * 활성 이미지를 공유했으므로 그것이 그 프리셋의 이미지다.
 */
function exportPresetSet(id: string, preset: unknown, targetPath: string): void {
  const zipPath = presetAssetZipPath(id);
  const stored = zipPath && fs.existsSync(zipPath) ? readZip(zipPath) : null;
  const zip = new AdmZip();
  if (stored) {
    for (const entry of stored.getEntries()) {
      if (entry.isDirectory) continue;
      const name = path.basename(entry.entryName);
      if (name.toLowerCase() === PRESET_JSON_ENTRY_NAME) continue;
      zip.addFile(name, entry.getData());
    }
  } else {
    for (const file of collectActiveAssets()) zip.addFile(file.name, file.data);
  }
  zip.addFile(PRESET_JSON_ENTRY_NAME, Buffer.from(JSON.stringify(preset, null, 2), "utf8"));
  zip.writeZip(targetPath);
}

/**
 * 세트 파일을 읽어 프리셋 값(raw JSON)을 돌려주고, 딸린 이미지는 활성 슬롯에 적용한다.
 * 예전에 내보낸 JSON 파일도 그대로 읽는다(이미지 없음).
 */
function importPresetSet(filePath: string): PresetSetImport {
  const isJson = path.extname(filePath).toLowerCase() === ".json";
  if (isJson) {
    try {
      return { ok: true, preset: JSON.parse(fs.readFileSync(filePath, "utf8")), faceKeys: [], hasBody: false };
    } catch {
      return { ok: false, errorCode: "invalidFile" };
    }
  }
  const zip = readZip(filePath);
  const presetJson = zip ? zipEntryData(zip, PRESET_JSON_ENTRY_NAME) : null;
  if (!zip || !presetJson) return { ok: false, errorCode: "invalidFile" };
  let preset: unknown;
  try {
    preset = JSON.parse(presetJson.toString("utf8"));
  } catch {
    return { ok: false, errorCode: "invalidFile" };
  }
  const activation = applyAssetZip(filePath);
  return { ok: true, preset, faceKeys: activation.faceKeys, hasBody: activation.hasBody };
}

export {
  CUSTOM_BODY_ENTRY_NAME,
  PRESET_JSON_ENTRY_NAME,
  presetAssetDir,
  presetAssetZipPath,
  capturePresetAssets,
  deletePresetAssets,
  activatePresetAssets,
  readPresetFaceTextureDataUrl,
  seedLegacyPresetAssets,
  exportPresetSet,
  importPresetSet
};
export type { PresetAssetActivation, PresetSetImport };
