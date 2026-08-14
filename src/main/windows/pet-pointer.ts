// 전역 마우스 훅이 주는 화면 좌표로 "지금 커서가 무엇 위에 있는가"를 판정하고, 펫 상시
// 드래그와 머리 쓰다듬기를 처리한다.
//
// uIOhook은 원(raw) 화면 좌표를 주므로 DIP로 옮긴 뒤에 판정하고, 기하 판정 자체는
// pet-hit-area.ts의 순수 함수에 맡긴다. 창 핸들과 설정은 main.js가 계속 소유하므로 getter로
// 받는다 — 드래그 중 만들어지는 상태(드래그 여부와 잡은 지점)만 이 모듈이 갖는다.
//
// 좌표 변환은 screen을 직접 부르지 않고 주입받는다. screenToDipPoint()가 Windows 전용이라
// 다른 OS에서는 Electron을 띄우는 것만으로 이 경로를 확인할 수 없고, 주입해두면 Node
// 테스트에서 배율을 흉내 내 드래그·히트 판정을 그대로 검증할 수 있다.

import type { BrowserWindow, Tray } from "electron";
import type { Settings } from "../settings-schema.js";
import { REST_WINDOW_EXTRA_TOP } from "./pet-window-layout.js";
import {
  isPointOverPetVisual,
  isPointOverPetHeadVisual,
  isPointOverWindowRect,
  isPointOverTrayRect,
  isPointOverMediaPlayerRect
} from "./pet-hit-area.js";
import { createPettingTracker } from "../petting-tracker.js";

type Point = { x: number; y: number };
type MediaPlayerRect = { left: number; top: number; width: number; height: number };
type WindowRef = () => BrowserWindow | null | undefined;

type PetPointerDependencies = {
  petWindow: WindowRef;
  checklistWindow: WindowRef;
  favoritesWindow: WindowRef;
  favoritesDockWindow: WindowRef;
  tray: () => Tray | null | undefined;
  getSettings: () => Settings;
  /** 펫 창이 보고한 모델 꼭대기의 로컬 y. 히트 영역 높이가 이 값으로 정해진다. */
  getModelTopLocalY: () => number;
  isMediaPlayerVisible: () => boolean;
  getMediaPlayerRect: () => MediaPlayerRect | null;
  isRestActive: () => boolean;
  petWindowLogicalX: (actualX: number) => number;
  clampPetPosition: (position: Point) => Point;
  setPetBounds: (position: Point) => void;
  setSavedPosition: (position: Point) => void;
  savePosition: () => void;
  onPettingChat: () => void;
  /** Windows 전용 API라 직접 부르지 않고 받는다(main.js가 screen.screenToDipPoint를 넘긴다). */
  screenToDipPoint: (point: Point) => Point;
};

function createPetPointer(deps: PetPointerDependencies) {
  const {
    petWindow, checklistWindow, favoritesWindow, favoritesDockWindow, tray,
    getSettings, getModelTopLocalY, isMediaPlayerVisible, getMediaPlayerRect,
    isRestActive, petWindowLogicalX, clampPetPosition, setPetBounds,
    setSavedPosition, savePosition, screenToDipPoint
  } = deps;

  function inputDipPoint(x: number, y: number) {
    return screenToDipPoint({ x: Math.round(x), y: Math.round(y) });
  }

  function petVisual() {
    return { scale: getSettings().petScalePercent / 100, modelTopLocalY: getModelTopLocalY() };
  }

  function isPointOverPet(x: number, y: number): boolean {
    const win = petWindow();
    if (!win || win.isDestroyed()) return false;
    // 진짜 시스템 트레이 아이콘과 겹치는 좌표는 절대 "펫 위"로 치지 않는다 — 펫을 트레이
    // 아이콘 근처로 옮겨둔 사용자가 실제 트레이 아이콘을 클릭했을 때, 우클릭 팝업/드래그
    // 시작/호버 캡처 등 펫 관련 로직이 같이 반응해 진짜 트레이 메뉴를 방해하지 않도록 한다
    // (isPointOverTrayIcon 주석 참고, 2026-08-02).
    if (isPointOverTrayIcon(x, y)) return false;
    return isPointOverPetVisual(inputDipPoint(x, y), win.getBounds(), petVisual());
  }

  // 펫 상시 드래그 이동. "always"(기본)면 펫을 그냥 좌클릭 드래그해서 언제든 옮길 수 있고,
  // "toggle"이면 예전처럼 트레이/단축키로 이동 모드를 켜야 옮길 수 있다.
  // 드래그 처리를 렌더러가 아니라 main의 전역 훅(uIOhook)에서 하는 이유: 커서가 창 밖으로
  // 빠르게 벗어나도 이벤트가 끊기지 않고, -webkit-app-region: drag를 상시로 걸었을 때
  // 생길 수 있는 우클릭(질문) 동작 충돌도 피할 수 있다.
  function alwaysDragEnabled() {
    return getSettings().petDragMode !== "toggle";
  }

  let petDragging = false;
  let petDragOffset: { dx: number; dy: number } | null = null;
  // 렌더러의 진자 기울임(가로 관성) 계산용 — 직전 이벤트의 논리 x. startPetDrag에서 잡고
  // updatePetDrag마다 갱신하며, 그 차이만 "pet:drag-move"로 흘려보낸다.
  let petDragLastLogicalX = 0;

  function startPetDrag(x: number, y: number): void {
    const win = petWindow();
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const dip = screenToDipPoint({ x: Math.round(x), y: Math.round(y) });
    // dx는 updatePetDrag가 setPetBounds에 그대로 넘길 수 있도록 "논리 위치" 기준으로 잡는다.
    petDragOffset = { dx: dip.x - petWindowLogicalX(bounds.x), dy: dip.y - bounds.y };
    petDragging = true;
    petDragLastLogicalX = dip.x;
    pettingTracker.reset();
    win.webContents.send("pet:drag-state", { dragging: true });
  }

  function updatePetDrag(x: number, y: number): void {
    const win = petWindow();
    if (!petDragging || !petDragOffset || !win || win.isDestroyed()) return;
    const dip = screenToDipPoint({ x: Math.round(x), y: Math.round(y) });
    // setPetBounds는 "논리 위치"(y = 창 y + REST_WINDOW_EXTRA_TOP)를 받는다.
    setPetBounds({
      x: Math.round(dip.x - petDragOffset.dx),
      y: Math.round(dip.y - petDragOffset.dy) + REST_WINDOW_EXTRA_TOP
    });
    const dx = dip.x - petDragLastLogicalX;
    petDragLastLogicalX = dip.x;
    if (dx !== 0) win.webContents.send("pet:drag-move", { dx });
  }

  function endPetDrag() {
    if (!petDragging) return;
    petDragging = false;
    petDragOffset = null;
    const win = petWindow();
    win?.webContents.send("pet:drag-state", { dragging: false });
    if (!win || win.isDestroyed()) return;
    // 드래그 중에는 setPetBounds가 correctingPetPosition을 세워 move 리스너가 건너뛰므로,
    // 화면 밖 보정과 위치 저장을 여기서 한 번만 처리한다.
    const [x, windowY] = win.getPosition();
    const safePosition = clampPetPosition({ x: petWindowLogicalX(x), y: windowY + REST_WINDOW_EXTRA_TOP });
    setSavedPosition(safePosition);
    setPetBounds(safePosition);
    savePosition();
  }

  // 체크리스트 창도 alwaysOnTop이라 펫과 겹칠 수 있다. 전역 훅으로 드래그를 판정하므로
  // 이 영역을 빼주지 않으면 체크리스트를 조작할 때 펫이 같이 끌려온다.
  function isPointOverChecklist(x: number, y: number): boolean {
    return isPointOverWindowBounds(checklistWindow(), x, y);
  }

  // 즐겨찾기 독립 창·플로팅 독도 체크리스트와 똑같이 펫 위에 겹칠 수 있다.
  function isPointOverWindowBounds(
    win: BrowserWindow | null | undefined,
    x: number,
    y: number
  ): boolean {
    if (!win || win.isDestroyed() || !win.isVisible()) return false;
    return isPointOverWindowRect(inputDipPoint(x, y), win.getBounds());
  }

  // 펫 위에 겹쳐 뜨는 별도 창들(체크리스트·즐겨찾기 창·즐겨찾기 독) 공통 판정.
  // 이 영역에서는 펫 드래그·머리 쓰다듬기·펫 창 호버 활성화를 모두 막아야 한다.
  function isPointOverFloatingPanel(x: number, y: number): boolean {
    return isPointOverChecklist(x, y) ||
      isPointOverWindowBounds(favoritesWindow(), x, y) ||
      isPointOverWindowBounds(favoritesDockWindow(), x, y);
  }

  // 실제 Windows 작업표시줄 트레이 아이콘의 화면 영역. 펫을 트레이 아이콘 근처(주로
  // 화면 오른쪽 아래 구석)로 옮겨둔 사용자가 진짜 트레이 아이콘을 우클릭하면, 그 클릭
  // 좌표가 펫의 히트 영역과도 겹쳐서 우리 쪽 호버/우클릭 로직이 같이 반응했다 — 그 결과
  // petWindow의 setFocusable()/setIgnoreMouseEvents() 호출이 z-order를 건드려 Windows가
  // 방금 띄운 네이티브 트레이 메뉴가 포커스를 잃고 곧바로 닫혀버렸다("트레이 메뉴가 갑자기
  // 빠르게 닫히는 현상 — 펫을 우클릭해서 띄우는 메뉴가 아님", 2026-08-02). 여백을 살짝
  // 두어 아이콘 바로 옆도 겹침으로 본다.
  function isPointOverTrayIcon(x: number, y: number): boolean {
    const trayIcon = tray();
    if (!trayIcon || trayIcon.isDestroyed()) return false;
    const bounds = trayIcon.getBounds();
    if (!bounds || (bounds.width === 0 && bounds.height === 0)) return false;
    return isPointOverTrayRect(inputDipPoint(x, y), bounds);
  }

  function isPointOverPetHead(x: number, y: number): boolean {
    const win = petWindow();
    if (!win || win.isDestroyed()) return false;
    return isPointOverPetHeadVisual(inputDipPoint(x, y), win.getBounds(), petVisual());
  }

  // 머리 위에서 커서를 좌우로 왕복시키면(방향 전환 2회 이상) 쓰다듬는 것으로 보고
  // 펫이 기뻐하며 고개를 살짝 숙인다. 마지막 왕복 후 일정 시간이 지나거나 머리 영역을
  // 벗어나면 해제된다. 왕복 판정은 petting-tracker.ts가 하고, 여기서는 "지금 쓰다듬을 수
  // 있는 상태인가"만 판정해 머리 위 x 좌표를 흘려보낸다.
  const pettingTracker = createPettingTracker({
    onActiveChange: (active) => petWindow()?.webContents.send("pet:petting", { active }),
    onPettingChat: deps.onPettingChat
  });

  function updateHeadPetting(x: number, y: number): void {
    if (getSettings().headPettingEnabled === false || isRestActive() ||
        isPointOverFloatingPanel(x, y) || !isPointOverPetHead(x, y)) {
      pettingTracker.reset();
      return;
    }
    pettingTracker.track(inputDipPoint(x, y).x);
  }

  function isPointOverMediaPlayer(x: number, y: number): boolean {
    const win = petWindow();
    const rect = getMediaPlayerRect();
    if (!win || win.isDestroyed() || !isMediaPlayerVisible() || !rect) return false;
    return isPointOverMediaPlayerRect(inputDipPoint(x, y), win.getBounds(), rect);
  }

  return {
    isPointOverPet,
    isPointOverPetHead,
    isPointOverTrayIcon,
    isPointOverChecklist,
    isPointOverFloatingPanel,
    isPointOverWindowBounds,
    isPointOverMediaPlayer,
    alwaysDragEnabled,
    isDragging: () => petDragging,
    startPetDrag,
    updatePetDrag,
    endPetDrag,
    updateHeadPetting,
    resetPetting: () => pettingTracker.reset()
  };
}

export { createPetPointer };
export type { PetPointerDependencies };
