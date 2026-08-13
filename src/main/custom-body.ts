import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import {
  writeFileAtomicSync,
  quarantineCorruptFile,
  recoverInterruptedAtomicWriteSync
} from "./atomic-file.js";

// 커스텀 얼굴(custom-face.js)과 같은 원리지만, 몸은 표정이 없어서 이미지가 한 장뿐이다.
// 그래서 zip이 아니라 PNG 파일 하나를 그대로 골라 복사한다.
const CUSTOM_BODY_FILE_NAME = "custombody.png";
// 사용자가 실수로 거대한 이미지를 고르면 data URL로 렌더러에 넘길 때 메모리를 크게 먹는다.
// 몸 UV 텍스처로 쓰기엔 넉넉한 상한이라 실사용에 걸릴 일은 거의 없다.
const CUSTOM_BODY_MAX_BYTES = 16 * 1024 * 1024;

type CustomBodyImportResult =
  | { ok: true }
  | { ok: false; errorCode: "invalidImage" };

function isPng(data: Buffer): boolean {
  return data.length >= 8
    && data.readUInt32BE(0) === 0x89504e47
    && data.readUInt32BE(4) === 0x0d0a1a0a;
}

function customBodyDir(): string {
  return path.join(app.getPath("userData"), "custom-body");
}

function customBodyPngPath(): string {
  return path.join(customBodyDir(), CUSTOM_BODY_FILE_NAME);
}

// 저장된 커스텀 바디 PNG를 렌더러가 바로 쓸 수 있는 data URL로 읽어온다.
// 아직 안 불러왔으면 null을 돌려준다.
function readCustomBodyTexture(): string | null {
  const filePath = customBodyPngPath();
  try {
    recoverInterruptedAtomicWriteSync(filePath);
  } catch (error) {
    console.error("커스텀 바디의 중단된 저장을 복구하지 못했습니다:", error);
  }
  const candidates = [filePath, filePath + ".bak"];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const data = fs.readFileSync(candidate);
      if (!isPng(data)) {
        throw new Error("PNG 시그니처가 올바르지 않다");
      }
      return `data:image/png;base64,${data.toString("base64")}`;
    } catch {
      if (candidate === filePath) {
        quarantineCorruptFile(filePath);
      }
    }
  }
  return null;
}

// 고른 PNG 한 장을 userData/custom-body/custombody.png로 복사한다.
// 실패 사유는 문자열 대신 errorCode로 돌려준다 — 번역은 호출부(main.js)에서 t()로 처리.
function importCustomBodyImage(imageFilePath: string): CustomBodyImportResult {
  let data: Buffer;
  try {
    const stat = fs.statSync(imageFilePath);
    if (!stat.isFile() || stat.size > CUSTOM_BODY_MAX_BYTES) {
      return { ok: false, errorCode: "invalidImage" };
    }
    data = fs.readFileSync(imageFilePath);
  } catch {
    return { ok: false, errorCode: "invalidImage" };
  }
  // 확장자만 믿지 않고 PNG 시그니처를 직접 확인한다(다른 포맷을 png로 이름만 바꿔둔 경우,
  // 렌더러에서 텍스처 로드가 조용히 실패해서 원인을 찾기 어렵다).
  if (!isPng(data)) {
    return { ok: false, errorCode: "invalidImage" };
  }
  try {
    fs.mkdirSync(customBodyDir(), { recursive: true });
    writeFileAtomicSync(customBodyPngPath(), data, { backup: true });
  } catch {
    return { ok: false, errorCode: "invalidImage" };
  }
  return { ok: true };
}

export {
  customBodyDir,
  customBodyPngPath,
  readCustomBodyTexture,
  importCustomBodyImage
};
export type { CustomBodyImportResult };
