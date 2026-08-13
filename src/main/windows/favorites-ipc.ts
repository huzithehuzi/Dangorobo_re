import type { IpcMain } from "electron";
import * as path from "node:path";
import { normalizeFavoriteItems } from "../settings-schema.js";
import type { Settings } from "../settings-schema.js";
import type { FavoriteLaunchItem } from "./favorite-icon-service.js";

type FavoritesIpcEvent = { sender: unknown };
type DialogFilter = { name: string; extensions: string[] };
type OpenDialogResult = { canceled: boolean; filePaths: string[] };
type ActivateResult = { ok: boolean; error?: string };

const ICON_EXTENSIONS = ["png", "jpg", "jpeg", "ico", "bmp", "webp"];
const TARGET_EXTENSIONS = ["exe", "lnk", "url", "appref-ms", "bat", "cmd", "com"];

type FavoritesIpcDependencies = {
  getSettings: () => Settings;
  translate: (language: string, key: string) => string;
  isSettingsSender: (sender: unknown) => boolean;
  /** 독립 창과 플로팅 독을 함께 본다(둘 다 목록을 채우고 항목을 실행한다). */
  isFavoritesPanelSender: (sender: unknown) => boolean;
  isFavoritesWindowSender: (sender: unknown) => boolean;
  isFavoritesDockSender: (sender: unknown) => boolean;
  /** 펫 말풍선으로 열린 즐겨찾기가 떠 있는지. 패널에서 온 요청은 이것과 무관하게 허용한다. */
  isFavoritesPanelActive: () => boolean;
  showOpenDialog: (options: { title: string; properties: string[]; filters: DialogFilter[] }) => Promise<OpenDialogResult>;
  customIconDataUrl: (iconPath: string) => Promise<string | null>;
  buildLaunchItems: () => Promise<FavoriteLaunchItem[]>;
  activateFavoriteItem: (id: string) => Promise<ActivateResult>;
  setDockExpanded: (expanded: boolean) => void;
  closeFavoritesPanel: () => void;
  closeFavoritesWindow: () => void;
  closeFavoritesDockWindow: () => void;
  // 독 드래그의 창 기하(작업 영역 클램프, 위치 저장)는 main.js가 들고 있다.
  beginDockDrag: () => void;
  moveDockBy: (dx: number, dy: number) => void;
  endDockDrag: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 즐겨찾기 IPC. 실행 중 교체되는 창·설정을 캡처하지 않고 호출할 때마다 getter와 동작
 * 콜백으로 main.js의 최신 값을 쓴다.
 *
 * 항목 실행은 펫 말풍선·독립 창·플로팅 독 세 곳에서 들어오며, 어디서 왔는지에 따라
 * 실행 뒤 처리가 다르다 — 독은 접고, 독립 창은 그대로 두고(연달아 실행하는 게
 * 자연스럽다), 말풍선은 닫는다.
 */
function registerFavoritesIpcHandlers(
  ipcMain: Pick<IpcMain, "handle" | "on">,
  deps: FavoritesIpcDependencies
) {
  ipcMain.handle("favorites:pick-icon", async (event: FavoritesIpcEvent) => {
    const { language } = deps.getSettings();
    if (!deps.isSettingsSender(event.sender)) {
      return { ok: false, error: deps.translate(language, "favorites.settingsOnlyError") };
    }
    const result = await deps.showOpenDialog({
      title: deps.translate(language, "favorites.iconPickerTitle"),
      properties: ["openFile"],
      filters: [
        { name: deps.translate(language, "favorites.iconPickerFilterName"), extensions: ICON_EXTENSIONS }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false };
    const iconPath = result.filePaths[0];
    const iconDataUrl = await deps.customIconDataUrl(iconPath);
    return iconDataUrl
      ? { ok: true, iconPath, iconDataUrl }
      : { ok: false, error: deps.translate(language, "favorites.unsupportedIconError") };
  });

  ipcMain.handle("favorites:pick-target", async (event: FavoritesIpcEvent) => {
    const { language } = deps.getSettings();
    if (!deps.isSettingsSender(event.sender)) {
      return { ok: false, error: deps.translate(language, "favorites.settingsOnlyError") };
    }
    const result = await deps.showOpenDialog({
      title: deps.translate(language, "favorites.pickerTitle"),
      properties: ["openFile"],
      filters: [
        { name: deps.translate(language, "favorites.pickerFilterName"), extensions: TARGET_EXTENSIONS }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const target = result.filePaths[0];
    const normalized = normalizeFavoriteItems([{
      id: `favorite-${Date.now()}`,
      name: path.basename(target, path.extname(target)),
      target
    }], language)[0];
    return normalized
      ? { ok: true, ...normalized }
      : { ok: false, error: deps.translate(language, "favorites.unsupportedError") };
  });

  ipcMain.handle("favorites:activate", async (event: FavoritesIpcEvent, selection: unknown) => {
    // 말풍선(펫 창) 외에 독립 창·플로팅 독에서도 실행할 수 있다.
    const { language, favoritesEnabled } = deps.getSettings();
    const fromPanel = deps.isFavoritesPanelSender(event.sender);
    if ((!deps.isFavoritesPanelActive() && !fromPanel) || !favoritesEnabled) {
      return { ok: false, error: deps.translate(language, "favorites.closedError") };
    }
    const selected = isRecord(selection) ? selection : {};
    if (String(selected.type || "") !== "item") {
      return { ok: false, error: deps.translate(language, "favorites.unknownError") };
    }
    const result = await deps.activateFavoriteItem(typeof selected.id === "string" ? selected.id : "");
    if (!result.ok) return result;
    if (fromPanel) {
      // 독은 실행하면 파이 메뉴를 접는다(런처를 눌렀으니 할 일이 끝났다).
      // 독립 창은 그대로 열어둔다 — 여러 개를 연달아 실행하는 게 자연스럽다.
      if (deps.isFavoritesDockSender(event.sender)) deps.setDockExpanded(false);
    } else {
      deps.closeFavoritesPanel();
    }
    return result;
  });

  // 독립 창·플로팅 독이 자기 목록을 채울 때 쓴다(아이콘 추출 포함).
  ipcMain.handle("favorites:list", async (event: FavoritesIpcEvent) => {
    if (!deps.isFavoritesPanelSender(event.sender)) {
      return { items: [], layout: "list", hideLabels: false };
    }
    const settings = deps.getSettings();
    return {
      items: await deps.buildLaunchItems(),
      layout: settings.favoritesLayout,
      hideLabels: settings.favoriteGridLabelsHidden === true
    };
  });

  ipcMain.on("favorites:close", () => deps.closeFavoritesPanel());

  ipcMain.on("favoritesWindow:close", (event: FavoritesIpcEvent) => {
    if (!deps.isFavoritesWindowSender(event.sender)) return;
    deps.closeFavoritesWindow();
  });

  ipcMain.on("favoritesDock:set-expanded", (event: FavoritesIpcEvent, expanded: unknown) => {
    if (!deps.isFavoritesDockSender(event.sender)) return;
    deps.setDockExpanded(expanded === true);
  });

  ipcMain.on("favoritesDock:hide", (event: FavoritesIpcEvent) => {
    if (!deps.isFavoritesDockSender(event.sender)) return;
    deps.closeFavoritesDockWindow();
  });

  // 독 버튼 드래그: 창이 접힌(68px) 상태에서만 일어나며, 렌더러가 마우스를 누른
  // 시점의 화면 좌표를 기준으로 누적 델타를 보낸다. 창을 옮기면 렌더러의 좌표계도
  // 같이 움직이므로 movementX 같은 상대값이 아니라 **절대 화면 좌표 차이**를 써야
  // 위치가 튀지 않는다.
  ipcMain.on("favoritesDock:drag-start", (event: FavoritesIpcEvent) => {
    if (!deps.isFavoritesDockSender(event.sender)) return;
    deps.beginDockDrag();
  });

  ipcMain.on("favoritesDock:drag-move", (event: FavoritesIpcEvent, delta: unknown) => {
    if (!deps.isFavoritesDockSender(event.sender)) return;
    const dragDelta = isRecord(delta) ? delta : {};
    const dx = Number(dragDelta.dx);
    const dy = Number(dragDelta.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    deps.moveDockBy(dx, dy);
  });

  ipcMain.on("favoritesDock:drag-end", (event: FavoritesIpcEvent) => {
    if (!deps.isFavoritesDockSender(event.sender)) return;
    deps.endDockDrag();
  });
}

export { registerFavoritesIpcHandlers };
export type { FavoritesIpcDependencies, FavoritesIpcEvent };
