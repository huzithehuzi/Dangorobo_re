import { clipboard, nativeImage } from "electron";
const { Jimp, ResizeStrategy } = require("jimp");

type ImageResizeResult =
  | { ok: true; percent: number }
  | { ok: false; errorCode: "notDetected" }
  | { ok: false; errorCode: "failed"; detail: string };

// 클립보드의 비트맵 이미지를 읽어 배율만큼 리사이즈한 뒤 다시 클립보드에 써넣는다.
// 번역 문자열은 다루지 않는다 — 실패 사유는 errorCode(/detail)로만 돌려주고, 번역은
// 호출부(main.js)에서 t()로 처리한다.
async function resizeClipboardImage(scale: number, filter: string): Promise<ImageResizeResult> {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return { ok: false, errorCode: "notDetected" };
    }

    const buffer = image.toPNG();
    const jimpImage = await Jimp.fromBuffer(buffer);

    const newWidth = Math.round(jimpImage.width * scale);
    const newHeight = Math.round(jimpImage.height * scale);
    const resizeMode = filter === "bilinear" ? ResizeStrategy.BILINEAR : ResizeStrategy.NEAREST_NEIGHBOR;

    jimpImage.resize({ w: newWidth, h: newHeight, mode: resizeMode });

    const resizedBuffer = await jimpImage.getBuffer("image/png");
    const resizedImage = nativeImage.createFromBuffer(resizedBuffer);
    clipboard.writeImage(resizedImage);

    return { ok: true, percent: Math.round(scale * 100) };
  } catch (error) {
    return { ok: false, errorCode: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

export { resizeClipboardImage };
export type { ImageResizeResult };
