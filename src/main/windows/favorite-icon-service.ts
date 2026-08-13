import * as fs from "node:fs";
import * as path from "node:path";

// .lnk의 "아이콘 위치"는 실행 대상(target)과 별개로 저장되고, 그 안의 아이콘
// 인덱스(iconIndex)까지 지정할 수 있다. Electron의 getFileIcon()은 인덱스를 받을 수
// 없으므로 Windows의 ExtractIconEx를 PowerShell에서 호출한다.
const ICON_EXTRACT_SCRIPT = [
  "Add-Type -AssemblyName System.Drawing",
  "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class RbIconExtract{[DllImport(\"shell32.dll\",CharSet=CharSet.Auto)]public static extern int ExtractIconEx(string szFileName,int nIconIndex,IntPtr[] phiconLarge,IntPtr[] phiconSmall,int nIcons);}'",
  "$path = $env:RB_ICON_PATH",
  "$index = [int]$env:RB_ICON_INDEX",
  "$large = New-Object IntPtr[] 1",
  "$small = New-Object IntPtr[] 1",
  "$count = [RbIconExtract]::ExtractIconEx($path, $index, $large, $small, 1)",
  "if ($count -le 0 -or $large[0] -eq [IntPtr]::Zero) { exit 1 }",
  "$icon = [System.Drawing.Icon]::FromHandle($large[0])",
  "$bitmap = $icon.ToBitmap()",
  "$ms = New-Object System.IO.MemoryStream",
  "$bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
  "[Convert]::ToBase64String($ms.ToArray())"
].join("; ");

type FavoriteIconExecOptions = {
  encoding: "utf8";
  timeout: number;
  windowsHide: boolean;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
};
type FavoriteIconExecFile = (
  file: string,
  args: string[],
  options: FavoriteIconExecOptions,
  callback: (error: unknown, stdout: unknown) => void
) => unknown;
type FavoriteShortcutDetails = { icon?: string; iconIndex?: number; target?: string };
type FavoriteNativeImage = { isEmpty: () => boolean; toDataURL: () => string };
type FavoriteFileIconOptions = { size: "normal" };
type FavoriteIconServiceDeps = {
  platform: string;
  powershellPath: () => string;
  execFile: FavoriteIconExecFile;
  readShortcutLink: (target: string) => FavoriteShortcutDetails;
  getFileIcon: (target: string, options: FavoriteFileIconOptions) => Promise<FavoriteNativeImage>;
};
type FavoriteSourceItem = {
  id: string;
  name: string;
  target: string;
  iconTemplate?: string | null;
  iconColor?: string | null;
  customIcon?: string | null;
};
type FavoriteLaunchItem = {
  id: string;
  name: string;
  icon: string | null;
  iconTemplate: string | null;
  iconColor: string | null | undefined;
};
type FavoriteMenuItem = {
  target?: string | null;
  customIcon?: string | null;
  iconTemplate?: string | null;
  iconDataUrl?: string | null;
  items?: FavoriteMenuItem[];
};

/**
 * 즐겨찾기 아이콘의 추출·폴백·캐시만 관리한다. Electron 객체와 설정 상태는 직접 알지
 * 않고, 플랫폼별 기능은 composition root인 main.js가 주입한다.
 */
function createFavoriteIconService({
  platform,
  powershellPath,
  execFile,
  readShortcutLink,
  getFileIcon
}: FavoriteIconServiceDeps) {
  const autoIconCache = new Map<string, string | null>();

  function extractIconViaPowerShell(iconPath: string, iconIndex: number): Promise<string | null> {
    if (platform !== "win32") return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      execFile(
        powershellPath(),
        ["-NoProfile", "-NonInteractive", "-Command", ICON_EXTRACT_SCRIPT],
        {
          encoding: "utf8",
          timeout: 8000,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
          // 경로에 따옴표·특수문자가 있어도 안전하도록 스크립트에 끼워 넣지 않는다.
          env: { ...process.env, RB_ICON_PATH: iconPath, RB_ICON_INDEX: String(iconIndex ?? 0) }
        },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          const trimmed = String(stdout).trim();
          resolve(trimmed ? `data:image/png;base64,${trimmed}` : null);
        }
      );
    });
  }

  async function customIconDataUrl(iconPath: string): Promise<string | null> {
    const extension = path.extname(iconPath).toLowerCase();
    if (!fs.existsSync(iconPath)) return null;
    if (extension === ".ico") {
      // getFileIcon()은 .ico 내용이 아니라 셸의 문서 아이콘을 줄 수 있어 ExtractIconEx를
      // 먼저 쓰고, 실패하면 Chromium이 읽을 수 있도록 원본 파일을 그대로 넘긴다.
      const extracted = await extractIconViaPowerShell(iconPath, 0);
      if (extracted) return extracted;
      try {
        return `data:image/x-icon;base64,${fs.readFileSync(iconPath).toString("base64")}`;
      } catch {
        return null;
      }
    }
    const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
      : extension === ".bmp" ? "image/bmp"
        : extension === ".webp" ? "image/webp"
          : "image/png";
    try {
      return `data:${mime};base64,${fs.readFileSync(iconPath).toString("base64")}`;
    } catch {
      return null;
    }
  }

  function parseUrlShortcutIcon(target: string) {
    try {
      const body = fs.readFileSync(target, "utf8");
      const iconFile = (/^IconFile=(.*)$/im.exec(body)?.[1] || "").trim();
      if (!iconFile) return null;
      const rawIndex = (/^IconIndex=(.*)$/im.exec(body)?.[1] || "").trim();
      return { iconFile, iconIndex: Number.parseInt(rawIndex, 10) || 0 };
    } catch {
      return null;
    }
  }

  async function iconDataUrl(target: string): Promise<string | null> {
    if (path.extname(target).toLowerCase() === ".url") {
      const parsed = parseUrlShortcutIcon(target);
      if (!parsed || !fs.existsSync(parsed.iconFile)) return null;
      return extractIconViaPowerShell(parsed.iconFile, parsed.iconIndex);
    }
    if (path.extname(target).toLowerCase() === ".lnk") {
      try {
        const shortcut = readShortcutLink(target);
        if (shortcut?.icon) {
          const extracted = await extractIconViaPowerShell(shortcut.icon, shortcut.iconIndex || 0);
          if (extracted) return extracted;
        }
        if (shortcut?.target) {
          try {
            const icon = await getFileIcon(shortcut.target, { size: "normal" });
            if (!icon.isEmpty()) return icon.toDataURL();
          } catch {
            // 아래에서 .lnk 경로 자체로 마지막 시도한다.
          }
        }
      } catch {
        // 바로가기 해석에 실패하면 아래에서 .lnk 경로 자체로 마지막 시도한다.
      }
    }
    try {
      const icon = await getFileIcon(target, { size: "normal" });
      return icon.isEmpty() ? null : icon.toDataURL();
    } catch {
      return null;
    }
  }

  function clearCache() {
    autoIconCache.clear();
  }

  async function autoIconDataUrl(target: string): Promise<string | null> {
    if (autoIconCache.has(target)) return autoIconCache.get(target) ?? null;
    const dataUrl = await iconDataUrl(target);
    autoIconCache.set(target, dataUrl);
    return dataUrl;
  }

  /**
   * 말풍선·독립 창·플로팅 독이 함께 쓰는 항목을 만든다. 커스텀 아이콘이 템플릿보다
   * 우선하며, 둘 중 하나라도 있으면 자동 추출을 하지 않는다.
   */
  async function buildLaunchItems(favoriteItems: FavoriteSourceItem[]): Promise<FavoriteLaunchItem[]> {
    return Promise.all(favoriteItems.map(async ({ id, name, target, iconTemplate, iconColor, customIcon }) => ({
      id,
      name,
      icon: customIcon ? await customIconDataUrl(customIcon) : iconTemplate ? null : await autoIconDataUrl(target),
      iconTemplate: customIcon ? null : iconTemplate || null,
      iconColor: !customIcon && iconTemplate ? iconColor : null
    })));
  }

  /**
   * 트레이 메뉴의 중첩 그리드까지 순회하며 아이콘을 병렬로 채운다. 기존 호출부가 같은
   * 객체에 붙은 iconDataUrl을 읽으므로 입력 배열을 그대로 수정하고 반환한다.
   */
  async function hydrateMenuItems<T extends FavoriteMenuItem>(items: T[]): Promise<T[]> {
    const jobs: Promise<void>[] = [];
    const collect = (list: FavoriteMenuItem[]) => {
      for (const item of list) {
        if (item.customIcon) {
          jobs.push(customIconDataUrl(item.customIcon).then((url) => { item.iconDataUrl = url; }));
        } else if (!item.iconTemplate && item.target) {
          jobs.push(autoIconDataUrl(item.target).then((url) => { item.iconDataUrl = url; }));
        }
        if (Array.isArray(item.items)) collect(item.items);
      }
    };
    collect(items);
    await Promise.all(jobs);
    return items;
  }

  return {
    customIconDataUrl,
    autoIconDataUrl,
    buildLaunchItems,
    hydrateMenuItems,
    clearCache
  };
}

export { createFavoriteIconService };
export type {
  FavoriteIconExecOptions,
  FavoriteIconExecFile,
  FavoriteShortcutDetails,
  FavoriteNativeImage,
  FavoriteFileIconOptions,
  FavoriteIconServiceDeps,
  FavoriteSourceItem,
  FavoriteLaunchItem,
  FavoriteMenuItem
};
