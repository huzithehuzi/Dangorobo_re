// 즐겨찾기 독립 창과 플로팅 독(dock·cursor 두 방식)의 창 핸들·기하·생명주기.
//
// 창 두 개와 독의 펼침/드래그 상태를 이 모듈이 소유하고, 밖에서는 getter로 읽는다.
// 설정과 저장 상태(favoritesPanelsState)는 main.js가 재대입하는 바인딩이라 값이 아니라
// getter로 받는다.
//
// 배치 계산 자체는 favorites-layout.ts의 순수 함수가 하고, 여기서는 screen에서 얻은
// workArea를 넘겨주는 일만 한다. IPC(windows/favorites-ipc.ts)는 보낸 창 검사와 델타
// 정규화만 하고 실제 창 조작은 전부 여기로 온다.

import { screen } from "electron";
import type { BrowserWindow } from "electron";
import type { Settings } from "../settings-schema.js";
import { WINDOW_WIDTH, SCREEN_MARGIN } from "./pet-window-layout.js";
import {
  FAVORITES_WINDOW_WIDTH,
  FAVORITES_WINDOW_HEIGHT
} from "./favorites-panels.js";
import type { FavoritesPanelsState } from "./favorites-panels.js";
import {
  FAVORITES_DOCK_COLLAPSED,
  defaultFavoritesWindowPosition as calculateDefaultFavoritesWindowPosition,
  defaultFavoritesDockPosition as calculateDefaultFavoritesDockPosition,
  favoritesPanelDisplayProbe,
  clampFavoritesPanelPosition,
  favoritesDockCenter,
  favoritesPieDisplayProbe,
  favoritesPieExpandedBounds as calculateFavoritesPieExpandedBounds,
  favoritesDockCollapsedBounds,
  favoritesDockExpandedLayout
} from "./favorites-layout.js";
import { buildFavoritesWindow, buildFavoritesDockWindow } from "./window-factory.js";
import type { WindowChrome } from "./window-factory.js";
import type { FavoriteLaunchItem } from "./favorite-icon-service.js";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

type FavoritesWindowDependencies = {
  chrome: WindowChrome;
  loadUiWindow: (win: BrowserWindow, name: string) => void;
  translate: (key: string) => string;
  getSettings: () => Settings;
  /** 시작 시 디스크에서 읽어 통째로 교체되므로 값이 아니라 getter로 받는다. */
  getPanelsState: () => FavoritesPanelsState;
  savePanelsState: () => void;
  schedulePanelsSave: () => void;
  isAppQuitting: () => boolean;
  rebuildTrayMenu: () => void;
  buildFavoriteLaunchItems: () => Promise<FavoriteLaunchItem[]>;
};

function createFavoritesWindowController(deps: FavoritesWindowDependencies) {
  let favoritesWindow: BrowserWindow | null | undefined;
  let dockWindow: BrowserWindow | null | undefined;
  let dockExpanded = false;
  let dockDragOrigin: Point | null = null;
  // 마지막으로 반영한 표시 방식을 기억해두는 이유: 독은 "방식을 고르는 순간" 한 번만
  // 자동으로 띄워야 한다. 매번 띄우면 사용자가 단축키로 숨겨둔 독이 설정을 저장할 때마다
  // 되살아난다.
  let lastSyncedMode: Settings["favoritesDisplayMode"] | null = null;
  let lastSyncedEnabled = false;

  const alive = (win: BrowserWindow | null | undefined): win is BrowserWindow => (
    !!win && !win.isDestroyed()
  );

  function pieCursorMode() {
    return deps.getSettings().favoritesDisplayMode === "cursor";
  }

  // ── 독립 창 ────────────────────────────────────────────────────────────────
  function defaultWindowPosition() {
    const { workArea } = screen.getPrimaryDisplay();
    return calculateDefaultFavoritesWindowPosition(
      workArea,
      FAVORITES_WINDOW_WIDTH,
      SCREEN_MARGIN,
      WINDOW_WIDTH
    );
  }

  function createWindow() {
    if (alive(favoritesWindow)) {
      favoritesWindow.show();
      favoritesWindow.focus();
      return;
    }
    const panels = deps.getPanelsState();
    const size = panels.window.size || { width: FAVORITES_WINDOW_WIDTH, height: FAVORITES_WINDOW_HEIGHT };
    const stored = panels.window.position || defaultWindowPosition();
    const { workArea } = screen.getDisplayNearestPoint(favoritesPanelDisplayProbe(stored, size));
    const position = clampFavoritesPanelPosition(stored, size, workArea);
    favoritesWindow = buildFavoritesWindow({
      chrome: deps.chrome,
      title: deps.translate("window.favoritesTitle"),
      bounds: { ...position, ...size },
      loadUiWindow: deps.loadUiWindow,
      onMoved: (moved) => {
        deps.getPanelsState().window.position = moved;
        deps.schedulePanelsSave();
      },
      onResized: (resized) => {
        deps.getPanelsState().window.size = resized;
        deps.schedulePanelsSave();
      },
      onClosed: () => {
        favoritesWindow = undefined;
        // Alt+F4로 닫아도 "닫힘"으로 기억해야 다음 실행 때 되살아나지 않는다.
        if (!deps.isAppQuitting() && deps.getPanelsState().window.open) {
          deps.getPanelsState().window.open = false;
          deps.savePanelsState();
          deps.rebuildTrayMenu();
        }
      }
    });
  }

  function openWindow() {
    if (!deps.getSettings().favoritesEnabled) return;
    createWindow();
    if (deps.getPanelsState().window.open) return;
    deps.getPanelsState().window.open = true;
    deps.savePanelsState();
    deps.rebuildTrayMenu();
  }

  function closeWindow() {
    if (alive(favoritesWindow)) favoritesWindow.close();
    if (!deps.getPanelsState().window.open) return;
    deps.getPanelsState().window.open = false;
    deps.savePanelsState();
    deps.rebuildTrayMenu();
  }

  // ── 플로팅 독 기하 ─────────────────────────────────────────────────────────
  // resizable:false 창은 Windows에서 프로그램적 리사이즈도 막힐 수 있다 — 커스터마이징
  // 모드의 펫 창과 똑같이 잠깐 풀어줬다 되돌린다(AGENTS.md의 창 크기 계약 참고).
  function setDockBounds(bounds: Rect): void {
    if (!alive(dockWindow)) return;
    dockWindow.setResizable(true);
    dockWindow.setBounds(bounds);
    dockWindow.setResizable(false);
  }

  function defaultDockPosition() {
    const { workArea } = screen.getPrimaryDisplay();
    return calculateDefaultFavoritesDockPosition(workArea, SCREEN_MARGIN, WINDOW_WIDTH);
  }

  function dockCollapsedPosition() {
    const stored = deps.getPanelsState().dock.position || defaultDockPosition();
    const { workArea } = screen.getDisplayNearestPoint(favoritesDockCenter(stored));
    return clampFavoritesPanelPosition(
      stored,
      { width: FAVORITES_DOCK_COLLAPSED, height: FAVORITES_DOCK_COLLAPSED },
      workArea
    );
  }

  // 펼친 창의 정사각형을 어디에 놓을지 계산한다. 중심(dock이면 버튼, cursor면 커서)을
  // 그대로 유지하되 작업 영역을 벗어나면 안쪽으로 민다.
  function pieExpandedBounds(centerX: number, centerY: number) {
    const { workArea } = screen.getDisplayNearestPoint(favoritesPieDisplayProbe(centerX, centerY));
    return calculateFavoritesPieExpandedBounds(centerX, centerY, workArea);
  }

  // dock 방식: 펼칠 때 버튼(=창 중앙)이 작업 영역 보정으로 움직일 수 있으므로 저장
  // 위치도 함께 옮긴다 — 안 옮기면 접을 때 화면 밖 원래 자리로 되돌아간다. 결과적으로
  // 화면 구석에서 처음 펼치면 독이 한 번 안쪽으로 물러나고 그 자리에 머문다.
  function applyDockBounds(expanded: boolean): void {
    if (!alive(dockWindow)) return;
    const collapsed = dockCollapsedPosition();
    if (!expanded) {
      deps.getPanelsState().dock.position = collapsed;
      setDockBounds(favoritesDockCollapsedBounds(collapsed));
      return;
    }
    const center = favoritesDockCenter(collapsed);
    const { workArea } = screen.getDisplayNearestPoint(favoritesPieDisplayProbe(center.x, center.y));
    const layout = favoritesDockExpandedLayout(collapsed, workArea);
    deps.getPanelsState().dock.position = layout.collapsedPosition;
    setDockBounds(layout.bounds);
  }

  function setDockExpanded(expanded: boolean): void {
    if (!alive(dockWindow)) return;
    // cursor 방식에서 "접기"는 크기를 줄이는 게 아니라 창을 숨기는 것이다.
    if (pieCursorMode()) {
      if (expanded !== true) closeCursorPie();
      return;
    }
    dockExpanded = expanded === true;
    applyDockBounds(dockExpanded);
    deps.schedulePanelsSave();
    dockWindow.webContents.send("favoritesDock:expanded", { expanded: dockExpanded, cursorMode: false });
  }

  // 독 버튼 드래그의 창 기하. IPC 쪽(windows/favorites-ipc.ts)은 보낸 창 검사와 델타
  // 정규화만 하고, 작업 영역 클램프와 위치 저장은 창을 들고 있는 여기서 처리한다.
  function beginDockDrag(): void {
    if (!alive(dockWindow)) return;
    if (dockExpanded) setDockExpanded(false);
    const bounds = dockWindow.getBounds();
    dockDragOrigin = { x: bounds.x, y: bounds.y };
  }

  function moveDockBy(dx: number, dy: number): void {
    if (!alive(dockWindow)) return;
    if (!dockDragOrigin) return;
    const next = { x: Math.round(dockDragOrigin.x + dx), y: Math.round(dockDragOrigin.y + dy) };
    const { workArea } = screen.getDisplayNearestPoint(favoritesDockCenter(next));
    const clamped = clampFavoritesPanelPosition(
      next,
      { width: FAVORITES_DOCK_COLLAPSED, height: FAVORITES_DOCK_COLLAPSED },
      workArea
    );
    dockWindow.setPosition(clamped.x, clamped.y);
    deps.getPanelsState().dock.position = clamped;
  }

  function endDockDrag(): void {
    dockDragOrigin = null;
    deps.savePanelsState();
  }

  // cursor 방식: 단축키를 누른 순간의 커서 위치에 파이 메뉴를 띄운다. 창은 한 번
  // 만들어두고 숨김/보임만 토글해서 두 번째 호출부터는 즉시 뜨게 한다.
  function openCursorPie() {
    if (!deps.getSettings().favoritesEnabled) return;
    createDockWindow({ show: false });
    if (!alive(dockWindow)) return;
    // getCursorScreenPoint()는 **이미 DIP 좌표**다. 전역 훅(uIOhook) 좌표에 쓰는
    // screenToDipPoint()를 여기에 또 적용하면 배율만큼 한 번 더 나눠져서, 다중 모니터
    // 환경에서 창이 엉뚱한 화면(음수 좌표)으로 날아가고 크기도 함께 어긋난다.
    const cursor = screen.getCursorScreenPoint();
    const bounds = pieExpandedBounds(cursor.x, cursor.y);
    setDockBounds(bounds);
    dockExpanded = true;
    dockWindow.show();
    // 바깥을 클릭하면 blur로 닫으므로 포커스를 가져와야 한다(단축키로 명시적으로 부른 UI).
    dockWindow.focus();
    // 표시 후 한 번 더 건다: 숨어 있는 창에 건 bounds는 배율이 다른 모니터로 옮겨가는
    // 순간 Windows가 다시 환산해버려서 크기가 어긋난다(다중 모니터 실측, 300 → 250px).
    setDockBounds(bounds);
    dockWindow.webContents.send("favoritesDock:expanded", { expanded: true, cursorMode: true });
  }

  /**
   * cursor 방식 파이가 지금 실제로 떠 있는가.
   *
   * `dockExpanded` 플래그가 아니라 **창의 표시 상태**를 본다. 플래그는 화면과 어긋날 수 있고
   * (blur 경합, 렌더러가 못 받은 이벤트, 모드 전환 중 창 재사용), 한 번 어긋나면 아래
   * closeCursorPie()가 조용히 돌아가 **가운데 닫기 버튼·Esc·바깥 클릭이 전부 아무 일도
   * 안 하는** 상태가 된다("닫기 버튼이 동작을 안 함" 리포트). 화면에 떠 있는지는 창에게 묻는 게
   * 언제나 맞다.
   */
  function isCursorPieOpen(): boolean {
    return pieCursorMode() && alive(dockWindow) && dockWindow.isVisible();
  }

  function closeCursorPie() {
    // 플래그는 먼저 내린다 — 창이 이미 없어도 상태는 맞춰 둔다.
    dockExpanded = false;
    if (!alive(dockWindow)) return;
    // 이미 숨어 있으면 중복 통지만 건너뛴다. 판단 기준이 플래그가 아니라 창이라는 점이 중요하다.
    if (!dockWindow.isVisible()) return;
    dockWindow.webContents.send("favoritesDock:expanded", { expanded: false, cursorMode: true });
    dockWindow.hide();
  }

  function createDockWindow({ show = true } = {}) {
    if (alive(dockWindow)) {
      if (show) dockWindow.showInactive();
      return;
    }
    const position = dockCollapsedPosition();
    if (!pieCursorMode()) deps.getPanelsState().dock.position = position;
    dockExpanded = false;
    dockWindow = buildFavoritesDockWindow({
      chrome: deps.chrome,
      title: deps.translate("window.favoritesDockTitle"),
      position,
      show,
      loadUiWindow: deps.loadUiWindow,
      onBlur: () => {
        if (pieCursorMode()) closeCursorPie();
      },
      onClosed: () => {
        dockWindow = undefined;
        dockExpanded = false;
        dockDragOrigin = null;
        if (!deps.isAppQuitting() && deps.getPanelsState().dock.open) {
          deps.getPanelsState().dock.open = false;
          deps.savePanelsState();
          deps.rebuildTrayMenu();
        }
      }
    });
  }

  function openDockWindow() {
    if (!deps.getSettings().favoritesEnabled) return;
    createDockWindow();
    if (deps.getPanelsState().dock.open) return;
    deps.getPanelsState().dock.open = true;
    deps.savePanelsState();
    deps.rebuildTrayMenu();
  }

  function closeDockWindow() {
    // destroy()를 쓰는 이유: 표시 방식을 dock ↔ cursor로 바꿀 때 닫자마자 곧바로 다시
    // 만드는데, close()는 창이 실제로 파괴되는 시점이 나중이라 그 사이에
    // createDockWindow()가 "이미 있다"고 보고 닫히는 중인 창을 재사용한다.
    if (alive(dockWindow)) dockWindow.destroy();
    dockWindow = undefined;
    dockExpanded = false;
    if (!deps.getPanelsState().dock.open) return;
    deps.getPanelsState().dock.open = false;
    deps.savePanelsState();
    deps.rebuildTrayMenu();
  }

  /**
   * 시작 시점의 표시 방식을 기준선으로 잡아둔다. 안 잡으면 첫 저장 때 방식이 바뀐 것으로
   * 보고 독을 한 번 띄운다.
   */
  function primeSyncBaseline(): void {
    const settings = deps.getSettings();
    lastSyncedMode = settings.favoritesDisplayMode;
    lastSyncedEnabled = settings.favoritesEnabled === true;
  }

  // 표시 방식이 바뀌거나 즐겨찾기 기능 자체가 꺼지면, 지금 방식에 맞지 않는 창을 닫는다.
  function syncToSettings() {
    const settings = deps.getSettings();
    const mode = settings.favoritesDisplayMode;
    // 방식을 바꿨거나, 즐겨찾기 기능 자체를 방금 켠 경우만 자동으로 띄운다.
    const modeChanged = lastSyncedMode !== null && lastSyncedMode !== mode;
    const justEnabled = settings.favoritesEnabled && !lastSyncedEnabled;
    lastSyncedMode = mode;
    lastSyncedEnabled = settings.favoritesEnabled === true;
    if (!settings.favoritesEnabled || mode !== "window") closeWindow();
    // dock과 cursor는 같은 창을 쓰지만 동작이 달라서, 방식이 바뀌면 창을 아예 새로 만든다.
    const pieMode = mode === "dock" || mode === "cursor";
    if (!settings.favoritesEnabled || !pieMode || modeChanged) closeDockWindow();
    // 독은 상시 떠 있는 런처라 방식을 고르는 순간 바로 보여주는 게 자연스럽다.
    // 독립 창은 단축키로 부르는 팝업이라 자동으로 열지 않는다.
    if (settings.favoritesEnabled && mode === "dock" && (modeChanged || justEnabled)) openDockWindow();
    // cursor 방식은 창을 숨긴 채 미리 만들어둔다 — 단축키를 눌렀을 때 바로 뜨게 하기 위해서다.
    if (settings.favoritesEnabled && mode === "cursor") createDockWindow({ show: false });
    broadcastToPanels();
  }

  // 즐겨찾기 독립 창·플로팅 독 두 곳에 같은 메시지를 보낸다(테마·언어 변경 등).
  function sendToPanels(channel: string, payload: unknown): void {
    for (const win of [favoritesWindow, dockWindow]) {
      if (alive(win)) win.webContents.send(channel, payload);
    }
  }

  // 즐겨찾기 목록·테마가 바뀌면 열려 있는 두 창을 다시 그린다.
  function broadcastToPanels() {
    const targets = [favoritesWindow, dockWindow].filter(alive);
    if (!targets.length) return;
    deps.buildFavoriteLaunchItems().then((items) => {
      const settings = deps.getSettings();
      const payload = {
        items,
        layout: settings.favoritesLayout,
        hideLabels: settings.favoriteGridLabelsHidden === true
      };
      for (const win of targets) {
        if (alive(win)) win.webContents.send("favorites:items", payload);
      }
    });
  }

  return {
    window: () => favoritesWindow,
    dockWindow: () => dockWindow,
    isDockExpanded: () => dockExpanded,
    isCursorPieOpen,
    pieCursorMode,
    createWindow,
    openWindow,
    closeWindow,
    createDockWindow,
    openDockWindow,
    closeDockWindow,
    setDockExpanded,
    beginDockDrag,
    moveDockBy,
    endDockDrag,
    openCursorPie,
    closeCursorPie,
    primeSyncBaseline,
    syncToSettings,
    sendToPanels,
    broadcastToPanels
  };
}

export { createFavoritesWindowController };
export type { FavoritesWindowDependencies };
