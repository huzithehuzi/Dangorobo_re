// 앱이 만드는 BrowserWindow 7종의 생성 옵션과 창 자체에 붙는 이벤트 배선을 모은다.
//
// 창 핸들 바인딩과 지속 상태(위치·크기 저장, 열림 여부, 미리보기 복원)는 호출자인
// main.js나 각 창 컨트롤러가 가진다. 이 모듈은 그 바인딩을 캡처하지 않고 창을 만들어
// 돌려주며, 상태를 바꿔야 하는 자리는 콜백으로 넘긴다 — IPC 모듈이 getter·동작 콜백만
// 받는 것과 같은 규약이다.
//
// 경로(preload, 아이콘, 펫 HTML)는 main.js의 __dirname 기준이라 이 모듈이 자기 위치로
// 계산하지 않고 주입받는다.

import { BrowserWindow } from "electron";
import type { IpcMain } from "electron";
import { WINDOW_HEIGHT, REST_WINDOW_EXTRA_TOP } from "./pet-window-layout.js";
import {
  CHECKLIST_WINDOW_MIN_WIDTH,
  CHECKLIST_WINDOW_MIN_HEIGHT
} from "./checklist.js";
import {
  FAVORITES_WINDOW_MIN_WIDTH,
  FAVORITES_WINDOW_MIN_HEIGHT
} from "./favorites-panels.js";
import { FAVORITES_DOCK_COLLAPSED } from "./favorites-layout.js";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Rect = Point & Size;

// Electron 타입 정의에서 빠진 구식 이벤트("crashed", "app-command")를 그 자리만 느슨하게 받는다.
type LegacyEventSource<TEvent = unknown, TDetail = unknown> = {
  on: (eventName: string, listener: (event: TEvent, detail: TDetail) => void) => unknown;
};
type LegacyAppCommandEvent = { preventDefault: () => void };

/** main.js의 __dirname으로만 계산할 수 있는 공통 경로. */
type WindowChrome = {
  preloadPath: string;
  iconPath: string;
};

function baseWebPreferences(chrome: WindowChrome) {
  return {
    preload: chrome.preloadPath,
    contextIsolation: true,
    nodeIntegration: false
  };
}

type PetWindowDependencies = {
  chrome: WindowChrome;
  petPagePath: string;
  /** 커스터마이징 모드에서 창이 넓어지므로 값이 아니라 호출로 읽는다. */
  windowWidth: () => number;
  devToolsRequested: boolean;
  /**
   * 창을 만든 직후 main.js의 petWindow 바인딩을 채운다. 이어지는 placePetWindow()와
   * setClickThrough()가 그 바인딩을 읽으므로 순서를 바꾸면 배치가 통째로 건너뛰어진다.
   */
  attach: (win: BrowserWindow) => void;
  logWindowOp: (op: string, detail?: unknown) => void;
  placePetWindow: () => void;
  setClickThrough: (enabled: boolean) => void;
  sendCapsLockState: () => void;
  onMoved: () => void;
  onClosed: () => void;
};

function buildPetWindow(deps: PetWindowDependencies): BrowserWindow {
  const win = new BrowserWindow({
    width: deps.windowWidth(),
    height: WINDOW_HEIGHT + REST_WINDOW_EXTRA_TOP,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    icon: deps.chrome.iconPath,
    backgroundColor: "#00000000",
    webPreferences: {
      ...baseWebPreferences(deps.chrome),
      // 펫은 포커스가 없는 투명 always-on-top 창이라 Electron이 배경 창으로 판단해
      // requestAnimationFrame을 절전/스로틀하면 손그림 선 떨림이 가끔 멈춘 것처럼 보인다.
      // 렌더 루프가 계속 살아 있어야 표정·꼬리·라인 떨림이 자연스럽게 유지된다.
      backgroundThrottling: false
    }
  });
  deps.attach(win);

  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  deps.logWindowOp("createPetWindow:setup");
  deps.placePetWindow();
  deps.setClickThrough(true);

  win.loadFile(deps.petPagePath);
  win.once("ready-to-show", () => {
    win.showInactive();
    // 창이 새로 만들어졌을 때(또는 시작 시 상태 조회가 먼저 끝났을 때) 현재 캡스락 상태를 맞춘다.
    deps.sendCapsLockState();
    // 빌드된 exe에서 문제를 진단할 때만 --pet-devtools 플래그로 켠다. 평소엔 안 뜬다.
    // (--debug는 Node/Electron 예약 스위치와 겹쳐 디버거 대기 상태로 멈출 수 있어 피한다.)
    if (deps.devToolsRequested) win.webContents.openDevTools({ mode: "detach" });
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("💥 petWindow renderer 프로세스 종료:", details);
    // "펫 창이 통째로 사라짐" 리포트(전체화면 게임 중 GPU 경합 의심, 2026-08-08)의 실제
    // 원인인지 다음 재현 때 window-debug.log로 확인하기 위해 추가 — 이전엔 console.error뿐이라
    // 사용자가 터미널 없이 실행하는 포터블 EXE에서는 이 정보가 아예 남지 않았다.
    deps.logWindowOp("petWindow:render-process-gone", details);
  });
  win.webContents.on("unresponsive", () => {
    console.error("💥 petWindow renderer 응답 없음 (unresponsive)");
    deps.logWindowOp("petWindow:unresponsive");
  });
  (win.webContents as unknown as LegacyEventSource).on("crashed", (_event, killed) => {
    console.error("💥 petWindow renderer crashed. killed:", killed);
    deps.logWindowOp("petWindow:crashed", { killed });
  });
  win.on("move", deps.onMoved);
  win.on("closed", deps.onClosed);
  return win;
}

type SettingsWindowDependencies = {
  chrome: WindowChrome;
  title: string;
  /** 작업 영역 높이에서 구한 창 높이. screen 접근은 main.js가 한다. */
  height: number;
  loadUiWindow: (win: BrowserWindow, name: string) => void;
  logWindowOp: (op: string, detail?: unknown) => void;
  openExternal: (url: string) => void;
  ipcMain: Pick<IpcMain, "once">;
  /** 저장하지 않은 변경이 있을 때 묻는다. true면 그대로 닫는다. */
  confirmDiscardChanges: (win: BrowserWindow) => Promise<boolean>;
  isAppQuitting: () => boolean;
  onClosed: () => void;
};

function buildSettingsWindow(deps: SettingsWindowDependencies): BrowserWindow {
  const win = new BrowserWindow({
    // 탭이 좌측 사이드바(168px)로 바뀌면서(2026-08-06) 그만큼 본문이 좁아지므로
    // 기본 너비를 사이드바 폭만큼 넓혀 예전과 비슷한 본문 폭을 유지한다.
    width: 848,
    height: deps.height,
    minWidth: 520,
    minHeight: 600,
    show: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    title: deps.title,
    icon: deps.chrome.iconPath,
    autoHideMenuBar: true,
    webPreferences: baseWebPreferences(deps.chrome)
  });

  deps.logWindowOp("createSettingsWindow");
  // 설정창 안의 외부 링크(예: Gemini API 키 발급 페이지)는 이 창 안에서 열지 않고
  // 사용자의 기본 브라우저로 연다(target="_blank"로 만든 링크가 새 Electron 창으로
  // 열리는 걸 막고 shell.openExternal로 대신 보낸다).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) deps.openExternal(url);
    return { action: "deny" };
  });
  // 마우스 측면 버튼을 단축키로 쓸 수 있게 되면서(2026-08-08), Windows가 그 버튼을
  // "브라우저 뒤로가기/앞으로가기"(WM_APPCOMMAND)로도 해석해 webContents가 탐색을
  // 시도한다. 설정창은 로컬 파일 하나뿐이라 실제로 이동할 곳은 없지만, 그래도 막아둔다.
  (win.webContents as unknown as LegacyEventSource<LegacyAppCommandEvent, string>)
    .on("app-command", (event, cmd) => {
      if (cmd === "browser-backward" || cmd === "browser-forward") event.preventDefault();
    });
  let closeConfirmed = false;
  deps.loadUiWindow(win, "settings");
  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    if (closeConfirmed || deps.isAppQuitting()) return;
    event.preventDefault();
    // "settings:unsaved-reply" 리스너를 닫기 시도마다 새로 등록한다. 예전엔
    // 창을 만들 때 한 번만 등록했었는데, 그러면 첫 응답(취소든 확인이든) 후 리스너가
    // 사라져서 그다음부터는 닫기를 눌러도 영영 안 닫혔다.
    deps.ipcMain.once("settings:unsaved-reply", async (_event, isDirty: unknown) => {
      if (win.isDestroyed()) return;
      if (!isDirty) {
        closeConfirmed = true;
        win.close();
        return;
      }
      if (await deps.confirmDiscardChanges(win) && !win.isDestroyed()) {
        closeConfirmed = true;
        win.close();
      }
    });
    win.webContents.send("settings:query-unsaved");
  });
  win.on("closed", deps.onClosed);
  return win;
}

type AssistantLogWindowDependencies = {
  chrome: WindowChrome;
  title: string;
  loadUiWindow: (win: BrowserWindow, name: string) => void;
  onClosed: () => void;
};

function buildAssistantLogWindow(deps: AssistantLogWindowDependencies): BrowserWindow {
  const win = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 460,
    minHeight: 520,
    show: false,
    title: deps.title,
    icon: deps.chrome.iconPath,
    autoHideMenuBar: true,
    webPreferences: baseWebPreferences(deps.chrome)
  });

  deps.loadUiWindow(win, "logs");
  win.once("ready-to-show", () => win.show());
  win.on("closed", deps.onClosed);
  return win;
}

type PetContextMenuWindowDependencies = {
  chrome: WindowChrome;
  title: string;
  bounds: Rect;
  loadUiWindow: (win: BrowserWindow, name: string) => void;
  onReadyToShow: (win: BrowserWindow) => void;
  onDidFinishLoad: (win: BrowserWindow) => void;
  onBlur: (win: BrowserWindow) => void;
  onClosed: (win: BrowserWindow) => void;
};

function buildPetContextMenuWindow(deps: PetContextMenuWindowDependencies): BrowserWindow {
  const win = new BrowserWindow({
    width: deps.bounds.width,
    height: deps.bounds.height,
    x: deps.bounds.x,
    y: deps.bounds.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: deps.title,
    backgroundColor: "#00000000",
    webPreferences: baseWebPreferences(deps.chrome)
  });

  win.setAlwaysOnTop(true, "floating");
  deps.loadUiWindow(win, "pet-context-menu");
  win.once("ready-to-show", () => deps.onReadyToShow(win));
  win.webContents.once("did-finish-load", () => deps.onDidFinishLoad(win));
  win.on("blur", () => deps.onBlur(win));
  win.on("closed", () => deps.onClosed(win));
  return win;
}

type ChecklistWindowDependencies = {
  chrome: WindowChrome;
  title: string;
  /** 저장된 값을 지금 모니터 구성에 맞춰 보정한 결과. 보정은 main.js가 한다. */
  bounds: Rect;
  loadUiWindow: (win: BrowserWindow, name: string) => void;
  onMoved: (position: Point) => void;
  onResized: (size: Size) => void;
  onClosed: () => void;
};

function buildChecklistWindow(deps: ChecklistWindowDependencies): BrowserWindow {
  const win = new BrowserWindow({
    width: deps.bounds.width,
    height: deps.bounds.height,
    minWidth: CHECKLIST_WINDOW_MIN_WIDTH,
    minHeight: CHECKLIST_WINDOW_MIN_HEIGHT,
    x: deps.bounds.x,
    y: deps.bounds.y,
    show: false,
    frame: false,
    transparent: true,
    // 꼭지점을 드래그해 크기를 조절할 수 있게(2026-08-02) — 헤더에만
    // -webkit-app-region: drag가 걸려있어(checklist.css) 나머지 가장자리는
    // OS가 정상적으로 리사이즈 핸들로 인식한다.
    resizable: true,
    maximizable: false,
    minimizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: deps.title,
    icon: deps.chrome.iconPath,
    backgroundColor: "#00000000",
    webPreferences: baseWebPreferences(deps.chrome)
  });

  win.setAlwaysOnTop(true, "floating");
  deps.loadUiWindow(win, "checklist");
  win.once("ready-to-show", () => win.show());
  // 헤더를 잡고 옮긴 위치를 기억한다(펫 위치 저장과 같은 디바운스 방식).
  win.on("move", () => {
    if (win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    deps.onMoved({ x, y });
  });
  // 크기 조절도 위치와 같은 방식으로 디바운스 저장한다.
  win.on("resize", () => {
    if (win.isDestroyed()) return;
    const [width, height] = win.getSize();
    deps.onResized({ width, height });
  });
  win.on("closed", deps.onClosed);
  return win;
}

type FavoritesWindowDependencies = {
  chrome: WindowChrome;
  title: string;
  bounds: Rect;
  loadUiWindow: (win: BrowserWindow, name: string) => void;
  onMoved: (position: Point) => void;
  onResized: (size: Size) => void;
  onClosed: () => void;
};

function buildFavoritesWindow(deps: FavoritesWindowDependencies): BrowserWindow {
  const win = new BrowserWindow({
    width: deps.bounds.width,
    height: deps.bounds.height,
    minWidth: FAVORITES_WINDOW_MIN_WIDTH,
    minHeight: FAVORITES_WINDOW_MIN_HEIGHT,
    x: deps.bounds.x,
    y: deps.bounds.y,
    show: false,
    frame: false,
    transparent: true,
    // 체크리스트 창과 같다 — 헤더에만 -webkit-app-region: drag가 걸려 있어서
    // 나머지 가장자리는 OS가 리사이즈 핸들로 인식한다.
    resizable: true,
    maximizable: false,
    minimizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: deps.title,
    icon: deps.chrome.iconPath,
    backgroundColor: "#00000000",
    webPreferences: baseWebPreferences(deps.chrome)
  });

  win.setAlwaysOnTop(true, "floating");
  deps.loadUiWindow(win, "favorites-window");
  win.once("ready-to-show", () => win.show());
  win.on("move", () => {
    if (win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    deps.onMoved({ x, y });
  });
  win.on("resize", () => {
    if (win.isDestroyed()) return;
    const [width, height] = win.getSize();
    deps.onResized({ width, height });
  });
  win.on("closed", deps.onClosed);
  return win;
}

type FavoritesDockWindowDependencies = {
  chrome: WindowChrome;
  title: string;
  position: Point;
  /** cursor 방식은 미리 만들어만 두고 단축키를 누를 때 보여준다. */
  show: boolean;
  loadUiWindow: (win: BrowserWindow, name: string) => void;
  onBlur: () => void;
  onClosed: () => void;
};

function buildFavoritesDockWindow(deps: FavoritesDockWindowDependencies): BrowserWindow {
  const win = new BrowserWindow({
    width: FAVORITES_DOCK_COLLAPSED,
    height: FAVORITES_DOCK_COLLAPSED,
    x: deps.position.x,
    y: deps.position.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: deps.title,
    icon: deps.chrome.iconPath,
    backgroundColor: "#00000000",
    webPreferences: baseWebPreferences(deps.chrome)
  });

  win.setAlwaysOnTop(true, "floating");
  deps.loadUiWindow(win, "favorites-dock");
  // showInactive: 독은 상시 떠 있는 런처라 포커스를 가져가면 작업 중인 창을 뺏는다.
  win.once("ready-to-show", () => {
    if (deps.show && !win.isDestroyed()) win.showInactive();
  });
  // cursor 방식은 바깥을 클릭해 포커스를 잃으면 닫는다(파이 메뉴의 일반적인 동작).
  win.on("blur", deps.onBlur);
  win.on("closed", deps.onClosed);
  return win;
}

export {
  buildPetWindow,
  buildSettingsWindow,
  buildAssistantLogWindow,
  buildPetContextMenuWindow,
  buildChecklistWindow,
  buildFavoritesWindow,
  buildFavoritesDockWindow
};
export type {
  WindowChrome,
  PetWindowDependencies,
  SettingsWindowDependencies,
  AssistantLogWindowDependencies,
  PetContextMenuWindowDependencies,
  ChecklistWindowDependencies,
  FavoritesWindowDependencies,
  FavoritesDockWindowDependencies
};
