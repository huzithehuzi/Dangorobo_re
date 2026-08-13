// 시스템 트레이와 펫 우클릭 팝업은 같은 메뉴 모델을 쓰며, 팝업이 떠 있는 동안에는
// Windows Shell 툴팁 갱신도 함께 멈춘다. 두 생명주기를 한 소유자에 두어 창이 닫힐 때
// 밀린 툴팁 갱신을 다시 예약하는 규칙이 main.js에 흩어지지 않게 한다.

import { nativeImage, screen, Tray } from "electron";
import type { BrowserWindow } from "electron";
import type { Settings } from "../settings-schema.js";
import {
  buildPetMenuItems,
  contextMenuHeight,
  serializeMenuItems
} from "./pet-menu-model.js";
import type {
  PetMenuActions,
  PetMenuItem,
  PetMenuModelOptions
} from "./pet-menu-model.js";
import { buildPetContextMenuWindow } from "./window-factory.js";
import type { WindowChrome } from "./window-factory.js";

type Point = { x: number; y: number };
type PetMenuState = Omit<PetMenuModelOptions, "settings" | "actions"> & {
  settings: Settings;
};

type PetMenuControllerDependencies = {
  chrome: WindowChrome;
  argv: readonly string[];
  loadUiWindow: (win: BrowserWindow, name: string) => void;
  getMenuState: () => PetMenuState;
  actions: PetMenuActions;
  hydrateFavoriteMenuItems: (items: PetMenuItem[]) => Promise<PetMenuItem[]>;
  translate: (language: string, key: string, vars?: Record<string, string | number>) => string;
  logWindowOp: (op: string, detail?: unknown) => void;
  writeCaptureFile: (filePath: string, contents: Buffer) => void;
  quit: () => void;
};

const CONTEXT_MENU_WIDTH = 250;
const TRAY_REBUILD_DEBOUNCE_MS = 400;

function createPetMenuController(deps: PetMenuControllerDependencies) {
  let tray: Tray | null | undefined;
  let menuWindow: BrowserWindow | null | undefined;
  let lastTrayFingerprint: string | undefined;
  let trayRebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let captureTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function alive(win: BrowserWindow | null | undefined): win is BrowserWindow {
    return Boolean(win && !win.isDestroyed());
  }

  function captureOutputPath(): string | null {
    const argument = deps.argv.find((value) => value.startsWith("--capture-context-menu="));
    return argument ? argument.slice("--capture-context-menu=".length) : null;
  }

  function currentItems(): PetMenuItem[] {
    return buildPetMenuItems({
      ...deps.getMenuState(),
      actions: deps.actions
    });
  }

  function performTrayRebuild(): void {
    trayRebuildTimer = undefined;
    if (disposed) return;
    if (!tray || tray.isDestroyed()) return;
    // setToolTip()도 실제 Windows Shell 포커스를 흔들 수 있어 팝업이 닫힌 뒤로 미룬다.
    if (alive(menuWindow)) return;
    const state = deps.getMenuState();
    const fingerprint = JSON.stringify([state.countdown, state.settings.language]);
    if (fingerprint === lastTrayFingerprint) return;
    lastTrayFingerprint = fingerprint;
    deps.logWindowOp("rebuildTrayMenu:rebuild");
    tray.setToolTip(deps.translate(state.settings.language, "tray.tooltip", {
      countdown: state.countdown
    }));
  }

  function rebuild(): void {
    if (disposed) return;
    clearTimeout(trayRebuildTimer);
    trayRebuildTimer = setTimeout(performTrayRebuild, TRAY_REBUILD_DEBOUNCE_MS);
  }

  function createTray(): void {
    if (disposed) return;
    const icon = nativeImage.createFromPath(deps.chrome.iconPath).resize({
      width: 20,
      height: 20,
      quality: "best"
    });
    if (icon.isEmpty()) throw new Error("App icon could not be loaded.");

    tray = new Tray(icon);
    tray.setToolTip("Dangorobo");
    // 네이티브 메뉴는 전역 훅·투명 topmost 창과 포커스가 충돌하므로 자체 팝업만 연다.
    tray.on("right-click", () => {
      open(screen.getCursorScreenPoint());
    });
    rebuild();
  }

  function close(): void {
    if (alive(menuWindow)) menuWindow.close();
  }

  function sendItems(win: BrowserWindow, items: PetMenuItem[]): void {
    if (disposed || menuWindow !== win || win.isDestroyed()) return;
    const hideLabels = deps.getMenuState().settings.favoriteGridLabelsHidden;
    win.webContents.send("context-menu:items", serializeMenuItems(items, hideLabels));
  }

  function refresh(): void {
    if (disposed) return;
    const win = menuWindow;
    if (!alive(win)) return;
    deps.hydrateFavoriteMenuItems(currentItems()).then((items) => {
      sendItems(win, items);
    });
  }

  function captureAfterLoad(win: BrowserWindow): void {
    if (disposed) return;
    const outputPath = captureOutputPath();
    if (outputPath === null) return;
    clearTimeout(captureTimer);
    captureTimer = setTimeout(async () => {
      captureTimer = undefined;
      if (disposed || menuWindow !== win || win.isDestroyed()) return;
      const image = await win.webContents.capturePage();
      if (disposed || menuWindow !== win || win.isDestroyed()) return;
      deps.writeCaptureFile(outputPath, image.toPNG());
      deps.quit();
    }, 400);
  }

  function open(cursorPoint: Point): void {
    if (disposed) return;
    close();
    const items = currentItems();
    const height = contextMenuHeight(items);
    const { workArea } = screen.getDisplayNearestPoint(cursorPoint);
    const x = Math.min(
      Math.max(cursorPoint.x, workArea.x),
      workArea.x + workArea.width - CONTEXT_MENU_WIDTH
    );
    const y = Math.min(
      Math.max(cursorPoint.y, workArea.y),
      workArea.y + workArea.height - height
    );
    const state = deps.getMenuState();

    menuWindow = buildPetContextMenuWindow({
      chrome: deps.chrome,
      title: deps.translate(state.settings.language, "window.contextMenuTitle"),
      bounds: { x, y, width: CONTEXT_MENU_WIDTH, height },
      loadUiWindow: deps.loadUiWindow,
      onReadyToShow: (win) => {
        if (disposed || menuWindow !== win || win.isDestroyed()) return;
        win.show();
        win.focus();
      },
      onDidFinishLoad: (win) => {
        if (disposed || menuWindow !== win || win.isDestroyed()) return;
        deps.hydrateFavoriteMenuItems(items).then((hydratedItems) => {
          sendItems(win, hydratedItems);
          if (menuWindow === win && !win.isDestroyed()) captureAfterLoad(win);
        });
      },
      onBlur: (win) => {
        if (captureOutputPath() !== null) return;
        if (menuWindow === win) close();
      },
      onClosed: (win) => {
        if (menuWindow !== win) return;
        menuWindow = undefined;
        clearTimeout(captureTimer);
        captureTimer = undefined;
        // 팝업 때문에 건너뛴 툴팁 갱신이 있으면 닫힌 뒤 반영한다.
        rebuild();
      }
    });
  }

  function dispose(): void {
    disposed = true;
    clearTimeout(trayRebuildTimer);
    trayRebuildTimer = undefined;
    clearTimeout(captureTimer);
    captureTimer = undefined;
  }

  return {
    tray: () => tray,
    contextMenuWindow: () => menuWindow,
    isContextMenuSender: (sender: unknown) => Boolean(
      alive(menuWindow) && sender === menuWindow.webContents
    ),
    currentItems,
    createTray,
    rebuild,
    open,
    close,
    refresh,
    dispose
  };
}

export { createPetMenuController };
export type { PetMenuControllerDependencies, PetMenuState };
