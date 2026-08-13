import type { IpcMain } from "electron";
import type { PetMenuItem } from "./pet-menu-model.js";

type PetShellIpcEvent = { sender: unknown };
type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type MediaPlayerRect = { left: number; top: number; width: number; height: number };

type PetShellIpcDependencies = {
  isPetSender: (sender: unknown) => boolean;
  isContextMenuSender: (sender: unknown) => boolean;
  getCursorPoint: () => Point;
  getPetWindowBounds: () => Rect | null;
  isClickThrough: () => boolean;
  /** 펫 창이 재는 모델 꼭대기의 로컬 y. 커서 히트 판정과 말풍선 배치가 이 값을 쓴다. */
  setModelTopLocalY: (value: number) => void;
  /** 미디어 플레이어가 펫 발밑에 겹쳐 뜨므로 그 위 클릭은 드래그로 삼지 않는다. */
  setMediaPlayerRect: (rect: MediaPlayerRect | null) => void;
  confirmRestAlert: () => void;
  sendMediaCommand: (action: string) => void;
  quit: () => void;
  currentPetMenuItems: () => PetMenuItem[];
  closePetContextMenu: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 하위 메뉴까지 훑어 id가 같은 항목을 찾는다. 즐겨찾기가 하위 메뉴로 들어간다. */
function findMenuItem(items: PetMenuItem[], id: unknown): PetMenuItem | null {
  for (const candidate of items) {
    if (candidate.id === id) return candidate;
    if (Array.isArray(candidate.items)) {
      const found = findMenuItem(candidate.items, id);
      if (found) return found;
    }
  }
  return null;
}

/** 렌더러가 보낸 값이 온전한 사각형일 때만 받는다. 하나라도 깨지면 통째로 버린다. */
function normalizeMediaPlayerRect(rect: unknown): MediaPlayerRect | null {
  if (!isRecord(rect)) return null;
  const { left, top, width, height } = rect;
  if (isFiniteNumber(left) && isFiniteNumber(top) && isFiniteNumber(width) && isFiniteNumber(height)) {
    return { left, top, width, height };
  }
  return null;
}

/**
 * 펫 창의 상태 조회·보고와 우클릭 메뉴 IPC. 실행 중 교체되는 창을 캡처하지 않고 getter와
 * 동작 콜백으로 main.js의 최신 값을 쓴다.
 */
function registerPetShellIpcHandlers(
  ipcMain: Pick<IpcMain, "handle" | "on">,
  deps: PetShellIpcDependencies
) {
  ipcMain.handle("pet:get-cursor", () => deps.getCursorPoint());
  ipcMain.handle("pet:get-window-bounds", () => deps.getPetWindowBounds());
  ipcMain.handle("pet:get-mode", () => ({ clickThrough: deps.isClickThrough() }));

  ipcMain.on("pet:report-visual-top", (_event: PetShellIpcEvent, value: unknown) => {
    const localY = Number(value);
    if (Number.isFinite(localY) && localY > 0) deps.setModelTopLocalY(localY);
  });

  ipcMain.on("pet:report-media-rect", (_event: PetShellIpcEvent, rect: unknown) => {
    deps.setMediaPlayerRect(normalizeMediaPlayerRect(rect));
  });

  ipcMain.on("pet:rest-confirm", () => deps.confirmRestAlert());
  ipcMain.on("media:command", (_event: PetShellIpcEvent, action: unknown) => {
    deps.sendMediaCommand(String(action ?? ""));
  });
  ipcMain.on("pet:quit", () => deps.quit());

  // 메뉴를 먼저 닫고 항목을 실행한다 — run()이 창을 띄우는 경우가 많아서, 순서가 뒤바뀌면
  // 새 창 위에 메뉴가 잠깐 남는다.
  ipcMain.on("context-menu:action", (event: PetShellIpcEvent, id: unknown) => {
    if (!deps.isContextMenuSender(event.sender)) return;
    const item = findMenuItem(deps.currentPetMenuItems(), id);
    deps.closePetContextMenu();
    if (item && typeof item.run === "function") item.run();
  });

  ipcMain.on("context-menu:close", (event: PetShellIpcEvent) => {
    if (!deps.isContextMenuSender(event.sender)) return;
    deps.closePetContextMenu();
  });
}

export { registerPetShellIpcHandlers, findMenuItem, normalizeMediaPlayerRect };
export type { PetShellIpcDependencies, PetShellIpcEvent };
