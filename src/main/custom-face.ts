import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import AdmZip = require("adm-zip");
import { writeFileAtomicSync } from "./atomic-file.js";

// 표정 키는 renderer.ts의 FACE_EXPRESSION_KEYS와 반드시 같아야 한다(하나만
// 어긋나도 그 표정에서만 조용히 커스텀 이미지가 안 뜬다).
const CUSTOM_FACE_EXPRESSION_KEYS = ["normal", "normal_blink", "happy", "angry", "sad", "alarm", "shocked"];
const CUSTOM_FACE_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const CUSTOM_FACE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const CUSTOM_FACE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const CUSTOM_FACE_MAX_ENTRIES = 128;

type ZipEntry = ReturnType<InstanceType<typeof AdmZip>["getEntries"]>[number];
type ZipArchive = { getEntries: () => ZipEntry[] };
type CustomFaceImportOptions = {
  createZip?: (filePath: string) => ZipArchive;
};
type CustomFaceImportResult =
  | { ok: true; keys: string[] }
  | { ok: false; errorCode: "invalidZip" | "noMatchingFiles" };

function isPng(data: Buffer): boolean {
  return data.length >= 8
    && data.readUInt32BE(0) === 0x89504e47
    && data.readUInt32BE(4) === 0x0d0a1a0a;
}

function customFaceDir(): string {
  return path.join(app.getPath("userData"), "custom-face");
}

function customFacePngPath(key: string): string {
  return path.join(customFaceDir(), `customface_${key}.png`);
}

function recoverInterruptedImport(): void {
  const dir = customFaceDir();
  const backupDir = dir + ".bak";
  if (!fs.existsSync(dir) && fs.existsSync(backupDir)) {
    try {
      fs.renameSync(backupDir, dir);
    } catch {}
  }
}

function cleanupStaleImports(parentDir: string): void {
  if (!fs.existsSync(parentDir)) return;
  for (const name of fs.readdirSync(parentDir)) {
    if (!name.startsWith("custom-face-import-")) continue;
    try {
      fs.rmSync(path.join(parentDir, name), { recursive: true, force: true });
    } catch {}
  }
}

// 저장된 커스텀 얼굴 PNG들을 렌더러가 바로 쓸 수 있는 data URL로 읽어온다.
// 파일이 하나도 없으면 빈 객체를 돌려준다(기능 자체를 안 켜뒀거나 아직 안 불러온 상태).
function readCustomFaceTextures(): Record<string, string> {
  recoverInterruptedImport();
  const result: Record<string, string> = {};
  for (const key of CUSTOM_FACE_EXPRESSION_KEYS) {
    const filePath = customFacePngPath(key);
    if (!fs.existsSync(filePath)) continue;
    try {
      result[key] = `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;
    } catch {}
  }
  return result;
}

// zip 파일 하나에서 customface_(표정이름).png 항목만 골라 userData/custom-face/에 반영한다.
// 성공/실패 사유는 문자열 대신 errorCode로 돌려준다 — 번역은 호출부(main.js)에서 t()로 처리.
function importCustomFaceZip(
  zipFilePath: string,
  options: CustomFaceImportOptions = {}
): CustomFaceImportResult {
  let zip: ZipArchive;
  let entries: ZipEntry[];
  try {
    const stat = fs.statSync(zipFilePath);
    if (!stat.isFile() || stat.size > CUSTOM_FACE_MAX_ARCHIVE_BYTES) {
      return { ok: false, errorCode: "invalidZip" };
    }
    zip = options.createZip ? options.createZip(zipFilePath) : new AdmZip(zipFilePath);
    entries = zip.getEntries();
  } catch {
    return { ok: false, errorCode: "invalidZip" };
  }
  if (entries.length > CUSTOM_FACE_MAX_ENTRIES) {
    return { ok: false, errorCode: "invalidZip" };
  }
  // zip 안의 폴더 구조는 무시하고 파일명(customface_(표정이름).png)만 본다.
  const matches: Record<string, Buffer> = {};
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const match = /^customface_(.+)\.png$/i.exec(path.basename(entry.entryName));
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (!CUSTOM_FACE_EXPRESSION_KEYS.includes(key)) continue;
    if (matches[key] || entry.header.size > CUSTOM_FACE_MAX_ENTRY_BYTES) {
      return { ok: false, errorCode: "invalidZip" };
    }
    let data: Buffer;
    try {
      data = entry.getData();
    } catch {
      return { ok: false, errorCode: "invalidZip" };
    }
    totalBytes += data.length;
    if (data.length > CUSTOM_FACE_MAX_ENTRY_BYTES
        || totalBytes > CUSTOM_FACE_MAX_TOTAL_BYTES
        || !isPng(data)) {
      return { ok: false, errorCode: "invalidZip" };
    }
    matches[key] = data;
  }
  const keys = CUSTOM_FACE_EXPRESSION_KEYS.filter(key => matches[key]);
  if (keys.length === 0) {
    return { ok: false, errorCode: "noMatchingFiles" };
  }
  const dir = customFaceDir();
  const parentDir = path.dirname(dir);
  const backupDir = dir + ".bak";
  let stagingDir = "";
  let movedPrevious = false;
  try {
    recoverInterruptedImport();
    fs.mkdirSync(parentDir, { recursive: true });
    cleanupStaleImports(parentDir);
    stagingDir = fs.mkdtempSync(path.join(parentDir, "custom-face-import-"));
    for (const key of keys) {
      writeFileAtomicSync(path.join(stagingDir, `customface_${key}.png`), matches[key]);
    }

    if (fs.existsSync(dir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
      fs.renameSync(dir, backupDir);
      movedPrevious = true;
    }
    try {
      fs.renameSync(stagingDir, dir);
      stagingDir = "";
    } catch (error) {
      if (movedPrevious && !fs.existsSync(dir)) {
        fs.renameSync(backupDir, dir);
        movedPrevious = false;
      }
      throw error;
    }
    if (movedPrevious) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {}
    }
  } catch {
    if (stagingDir) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    if (movedPrevious && !fs.existsSync(dir)) {
      try {
        fs.renameSync(backupDir, dir);
      } catch {}
    }
    return { ok: false, errorCode: "invalidZip" };
  }
  return { ok: true, keys };
}

export {
  CUSTOM_FACE_EXPRESSION_KEYS,
  CUSTOM_FACE_MAX_ARCHIVE_BYTES,
  CUSTOM_FACE_MAX_ENTRY_BYTES,
  CUSTOM_FACE_MAX_TOTAL_BYTES,
  CUSTOM_FACE_MAX_ENTRIES,
  customFaceDir,
  customFacePngPath,
  readCustomFaceTextures,
  importCustomFaceZip
};
export type {
  CustomFaceImportOptions,
  CustomFaceImportResult,
  ZipArchive
};
