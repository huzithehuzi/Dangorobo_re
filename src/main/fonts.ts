// main.js에서 분리 — Windows에 설치된 폰트 목록을 PowerShell로 조회하는 순수 유틸리티.
// 공유 상태(petWindow, settings 등)를 전혀 참조하지 않는다.
import { execFileSync } from "node:child_process";
import * as path from "node:path";

function getPowershellExePath(): string {
  const windowsDirectory = process.env.SystemRoot || "C:\\Windows";
  return path.join(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function listInstalledFonts(): string[] {
  if (process.platform !== "win32") return [];
  const powershellPath = getPowershellExePath();
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new()",
    "Add-Type -AssemblyName PresentationCore",
    "@([System.Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $_.Source } | Sort-Object -Unique) | ConvertTo-Json -Compress"
  ].join("; ");
  try {
    const output = execFileSync(
      powershellPath,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
        timeout: 8000,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      }
    ).trim();
    return normalizeFontList(output ? JSON.parse(output) : []);
  } catch (error) {
    console.error("Installed fonts could not be listed:", error);
    return [];
  }
}

/**
 * PowerShell이 준 JSON을 폰트 이름 목록으로 정리한다. 폰트가 하나뿐이면 ConvertTo-Json이
 * 배열이 아니라 값 하나를 주므로 두 모양을 모두 받는다. 이름은 설정에 저장돼 CSS
 * font-family로 나가므로 제어 문자가 섞인 값과 비정상적으로 긴 값은 버린다.
 */
function normalizeFontList(parsed: unknown): string[] {
  const values: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return [...new Set(
    values
      .map((value) => String(value ?? "").trim())
      .filter((value) => value && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value))
  )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export { getPowershellExePath, listInstalledFonts, normalizeFontList };
