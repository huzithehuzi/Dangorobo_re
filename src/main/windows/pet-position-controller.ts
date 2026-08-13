// 펫 창의 논리 위치 소유자 — 불러오기·저장·화면 경계 보정·드래그 디바운스.
//
// 순수 계산은 이미 갈려 있다. 파일 I/O는 `pet-position-store.ts`, 좌표를 작업 영역 안으로
// 조이는 계산은 `pet-window-layout.ts`가 한다. 여기 있는 것은 그 둘을 실제 창·화면에
// 붙이는 부분과, 언제 디스크에 쓸지 같은 수명주기 판단이다.
//
// `screen`·`app` 같은 Electron 경계는 주입받는다 — 다른 OS에서 실행되지 않아 그대로 두면
// 이 판단들을 자동으로 검증할 방법이 없다(`pet-pointer.ts`와 같은 이유).
//
// **논리 위치는 언제나 300px 창 기준의 좌상단 좌표다.** 커스터마이징 모드로 창이 넓어져도
// `setBounds()`가 x를 inset만큼 왼쪽으로 당겨 흡수하므로 펫의 화면상 위치는 1px도 움직이지
// 않는다. 반대로 창의 실제 x를 읽을 때는 inset을 다시 더해 논리 위치로 되돌린다.

import { loadPetPosition, savePetPosition } from "../pet-position-store.js";
import {
  DEFAULT_MODEL_TOP_LOCAL_Y,
  REST_WINDOW_EXTRA_TOP,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  clampCustomizePositionToWorkArea,
  clampPetPositionToWorkArea,
  defaultPetPosition
} from "./pet-window-layout.js";
import type { Point, WorkArea } from "./pet-window-layout.js";

/** 드래그가 멈춘 뒤에만 보정한다 — 매 move마다 되돌리면 OS 창 이동과 충돌해 덜걱거린다. */
const DRAG_CORRECTION_DELAY_MS = 120;
/** 드래그 중 매번 쓰지 않고 멈춘 뒤 한 번만 저장한다. */
const POSITION_SAVE_DEBOUNCE_MS = 250;

/** 이 모듈이 창에 대해 실제로 쓰는 것만 추린 모양. */
type PositionedWindow = {
  isDestroyed(): boolean;
  getPosition(): number[];
  setBounds(bounds: { x: number; y: number; width: number; height: number }, animate?: boolean): void;
};

type PetPositionControllerDependencies = {
  userDataPath: () => string;
  primaryWorkArea: () => WorkArea;
  displayNearestPoint: (point: Point) => { workArea: WorkArea };
  petWindow: () => PositionedWindow | null | undefined;
  petScalePercent: () => number;
  /** 커스터마이징 모드에 따라 창 폭이 바뀌므로 값이 아니라 호출로 받는다. */
  petWindowWidth: () => number;
  petWindowXInset: () => number;
  petWindowLogicalX: (actualX: number) => number;
  logWindowOp: (op: string, detail?: unknown) => void;
};

function createPetPositionController(deps: PetPositionControllerDependencies) {
  let savedPosition: Point | undefined;
  let modelTopLocalY = DEFAULT_MODEL_TOP_LOCAL_Y;
  let positionSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let dragCorrectionTimer: ReturnType<typeof setTimeout> | undefined;
  // 우리가 setBounds로 옮기는 동안 들어오는 move 이벤트는 무시한다(자기 자신에 반응하지 않게).
  let correctingPetPosition = false;

  function positionPath() {
    return `${deps.userDataPath()}/pet-position.json`;
  }

  function load() {
    const result = loadPetPosition(positionPath());
    savedPosition = result.position;
    if (result.recoveredFromBackup) {
      console.warn("[Position] 위치 파일이 손상돼 백업(.bak)에서 복구했다.");
    } else if (result.status === "corrupt") {
      console.error("[Position] 위치 파일과 백업이 모두 손상됐다. 기본 위치를 사용한다.");
    }
  }

  function save() {
    if (!savedPosition) return;
    savePetPosition(positionPath(), savedPosition);
  }

  function defaultPosition(): Point {
    return defaultPetPosition(deps.primaryWorkArea());
  }

  function clamp(position: Point): Point {
    const { workArea } = deps.displayNearestPoint(probePoint(position));
    const scale = deps.petScalePercent() / 100;
    return clampPetPositionToWorkArea(position, workArea, { scale, modelTopLocalY });
  }

  function probePoint(position: Point): Point {
    return { x: position.x + Math.round(WINDOW_WIDTH / 2), y: position.y + Math.round(WINDOW_HEIGHT / 2) };
  }

  function setBounds(position: Point): void {
    const win = deps.petWindow();
    if (!win || win.isDestroyed()) return;
    correctingPetPosition = true;
    win.setBounds({
      x: position.x - deps.petWindowXInset(),
      y: position.y - REST_WINDOW_EXTRA_TOP,
      width: deps.petWindowWidth(),
      height: WINDOW_HEIGHT + REST_WINDOW_EXTRA_TOP
    }, false);
    setImmediate(() => {
      correctingPetPosition = false;
    });
  }

  function place() {
    const win = deps.petWindow();
    if (!win || win.isDestroyed()) return;
    const position = clamp(savedPosition || defaultPosition());
    savedPosition = position;
    setBounds(position);
  }

  /** 창의 현재 실제 위치를 논리 위치로 되돌린다. */
  function currentWindowPosition(win: PositionedWindow): Point {
    const [x, windowY] = win.getPosition();
    return { x: deps.petWindowLogicalX(x), y: windowY + REST_WINDOW_EXTRA_TOP };
  }

  function ensureVisible() {
    const win = deps.petWindow();
    if (!win || win.isDestroyed()) return;
    const currentPosition = currentWindowPosition(win);
    const safePosition = clamp(currentPosition);
    savedPosition = safePosition;
    // 드래그로 인한 정상 이동은 handleMoved()가 별도로(250ms 디바운스) 저장한다.
    // 여기서는 실제로 화면 밖으로 벗어나 보정이 필요했을 때만 디스크에 쓴다 —
    // 30초 워치독에서 매번 무조건 fs.writeFileSync를 하던 것이 다른 창들의 z-order가
    // 간헐적으로 뒤섞이는 현상과 관련 있어 보여 최소화한다.
    if (safePosition.x !== currentPosition.x || safePosition.y !== currentPosition.y) {
      deps.logWindowOp("ensurePetVisible:correct", { from: currentPosition, to: safePosition });
      setBounds(safePosition);
      save();
    }
  }

  /** 창 `move` 이벤트. 우리가 옮기는 중이면 무시한다. */
  function handleMoved() {
    const win = deps.petWindow();
    if (!win || win.isDestroyed() || correctingPetPosition) return;
    const currentPosition = currentWindowPosition(win);
    const safePosition = clamp(currentPosition);
    savedPosition = safePosition;
    clearTimeout(dragCorrectionTimer);
    if (safePosition.x !== currentPosition.x || safePosition.y !== currentPosition.y) {
      dragCorrectionTimer = setTimeout(() => setBounds(safePosition), DRAG_CORRECTION_DELAY_MS);
    }
    clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(save, POSITION_SAVE_DEBOUNCE_MS);
  }

  // 커스터마이징 모드에서는 창이 넓어지는데, 펫이 화면 가장자리에 붙어 있으면 넓어진 쪽
  // 라벨이 화면 밖으로 나가버린다. 그래서 진입할 때만 "창 전체가 작업 영역 안에 다 들어오는"
  // 범위로 논리 위치를 한 번 더 조인다.
  // (일반 clamp는 펫 시각 경계 기준이라 투명 여백만큼 창이 화면 밖으로 나가는 걸 허용한다 —
  //  평소엔 그 여백이 비어 있어 문제가 없지만, 이 모드에서는 그 여백에 라벨과 하단 툴바가
  //  들어차 있어서 잘리거나 작업표시줄 뒤로 숨는다.)
  function clampForCustomize(position: Point): Point {
    const base = clamp(position);
    // base 좌표는 반올림하지 않고 그대로 probe에 쓴다(시각 inset 때문에 소수일 수 있다).
    const { workArea } = deps.displayNearestPoint(probePoint(base));
    return clampCustomizePositionToWorkArea(base, workArea, deps.petWindowXInset());
  }

  function dispose() {
    clearTimeout(positionSaveTimer);
    clearTimeout(dragCorrectionTimer);
  }

  return {
    load, save, place, ensureVisible, handleMoved, dispose,
    clamp, clampForCustomize, setBounds, defaultPosition,
    /** 지금 기억하고 있는 논리 위치. */
    current: () => savedPosition,
    /**
     * 커스터마이징 모드가 진입·복귀할 때 위치를 직접 옮긴다. 그 전환은 모드 쪽이 갖고
     * 있으므로 여기서는 값만 받는다 — 모드를 모듈로 뺄 때 함께 정리할 자리다.
     */
    setCurrent: (position: Point) => { savedPosition = position; },
    getModelTopLocalY: () => modelTopLocalY,
    setModelTopLocalY: (value: number) => { modelTopLocalY = value; }
  };
}

export { createPetPositionController, DRAG_CORRECTION_DELAY_MS, POSITION_SAVE_DEBOUNCE_MS };
export type { PetPositionControllerDependencies, PositionedWindow };
