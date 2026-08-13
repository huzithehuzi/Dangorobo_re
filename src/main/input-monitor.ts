// 전역 입력 훅(uIOhook)이 주는 키보드·마우스 이벤트를 앱 동작으로 옮긴다 — 스퀴시,
// 클릭 사운드, 캡스락 표시, 우클릭 메뉴 열고 닫기, 펫 드래그, 호버 시 마우스 통과 해제,
// 타이핑 강도.
//
// 훅에 직접 붙지 않고 핸들러를 내보낸다. 배선은 main.js가 uiohook-napi의 타입 그대로 하고,
// 테스트는 같은 핸들러에 합성 이벤트를 넣는다 — uiohook은 Windows 실기가 있어야 실제 입력이
// 들어오므로 이렇게 해야 판단 로직을 Node에서 확인할 수 있다.
// 입력에서 파생되는 호버·CapsLock·유휴 상태와 그 타이머는 이 모듈이 함께 소유한다.

type KeyInputEvent = { keycode: number };
type MouseInputEvent = { button?: unknown; x: number; y: number };
type InputEvent = KeyInputEvent | MouseInputEvent;

/** 창인지 확인만 하면 되는 자리. BrowserWindow가 이 모양을 만족한다. */
type WindowLike = { isDestroyed: () => boolean };

type Point = { x: number; y: number };

/** 말풍선·모드가 떠 있는지. 호버 토글과 우클릭 판정이 이 조합을 본다. */
type UiState = {
  clickThrough: boolean;
  restActive: boolean;
  customizeActive: boolean;
  assistantPanelActive: boolean;
  favoritesPanelActive: boolean;
  imageResizePanelActive: boolean;
  translatePanelActive: boolean;
  documentSummaryPanelActive: boolean;
};

type PetPointerApi = {
  isPointOverWindowBounds(win: WindowLike | null | undefined, x: number, y: number): boolean;
  isPointOverPet(x: number, y: number): boolean;
  isPointOverMediaPlayer(x: number, y: number): boolean;
  isPointOverFloatingPanel(x: number, y: number): boolean;
  alwaysDragEnabled(): boolean;
  isDragging(): boolean;
  startPetDrag(x: number, y: number): void;
  updatePetDrag(x: number, y: number): void;
  endPetDrag(): void;
  updateHeadPetting(x: number, y: number): void;
};

type InputMonitorDependencies = {
  pointer: PetPointerApi;
  sendToPet: (channel: string, payload: unknown) => void;
  getSettings: () => {
    keyboardSquishEnabled?: boolean;
    keyboardClickEnabled?: boolean;
    mouseSquishEnabled?: boolean;
    mouseClickEnabled?: boolean;
    sleepAfterMinutes: number;
    mediaPlayer?: { enabled?: boolean };
  };
  getUiState: () => UiState;
  isDndActive: () => boolean;
  /** Windows의 실제 CapsLock 상태를 비동기로 읽는다. 지원하지 않는 OS는 undefined를 준다. */
  readCapsLockState: () => Promise<boolean | undefined>;
  contextMenuWindow: () => WindowLike | null | undefined;
  closePetContextMenu: () => void;
  openPetContextMenu: (cursorPoint: Point) => void;
  getCursorPoint: () => Point;
  dispatchMouseShortcut(event: MouseInputEvent): void;
  applyMouseInteractionState: () => void;
  /** 테스트에서 시간을 고정하려고 받는다. 기본은 Date.now. */
  now?: () => number;
};

const UIOHOOK_CAPS_LOCK_KEYCODE = 58;
const MOUSE_BUTTON_LEFT = 1;
const MOUSE_BUTTON_RIGHT = 2;
const HOVER_LEAVE_DELAY_MS = 120;
const TYPING_SAMPLE_WINDOW_MS = 1500;
const TYPING_TICK_MS = 100;

/**
 * 최근 입력 기록으로 타이핑 강도(0~1.1)를 낸다. 1.5초 창의 초당 타수를 6.5로 나눈 값이라
 * 아주 빠르게 치면 1을 살짝 넘긴다 — 렌더러가 그 여유분을 반응 곡선에 쓴다.
 */
function typingIntensityFrom(recentKeyTimes: number[], now: number): number {
  const cutoff = now - TYPING_SAMPLE_WINDOW_MS;
  const recent = recentKeyTimes.filter((timestamp) => timestamp >= cutoff);
  const keysPerSecond = recent.length / (TYPING_SAMPLE_WINDOW_MS / 1000);
  return Math.min(1.1, Math.max(0, keysPerSecond / 6.5));
}

function createInputMonitor(deps: InputMonitorDependencies) {
  const now = deps.now ?? Date.now;
  const { pointer } = deps;

  let recentKeyTimes: number[] = [];
  const heldKeycodes = new Set<number>();
  let hoverDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let mediaHoverDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let typingTimer: ReturnType<typeof setInterval> | undefined;
  let petHoverInteractive = false;
  let mediaPlayerHoverInteractive = false;
  let capsLockActive = false;
  let capsLockSynchronized = false;
  let capsLockReadRevision = 0;
  let lastInputAt = now();
  let idleActive = false;

  function contextMenuOpen(): boolean {
    const menu = deps.contextMenuWindow();
    return Boolean(menu && !menu.isDestroyed());
  }

  function sendCapsLockState(): void {
    deps.sendToPet("pet:caps-lock", { active: capsLockActive });
  }

  async function synchronizeCapsLockState(): Promise<void> {
    const readRevision = ++capsLockReadRevision;
    try {
      const active = await deps.readCapsLockState();
      if (active === undefined || readRevision !== capsLockReadRevision) return;
      capsLockActive = active;
      capsLockSynchronized = true;
      sendCapsLockState();
    } catch (error) {
      if (readRevision === capsLockReadRevision) {
        console.error("캡스락 상태를 읽지 못했습니다:", error);
      }
    }
  }

  function initializeCapsLockState(): Promise<void> {
    return synchronizeCapsLockState();
  }

  function markUserInput(): void {
    lastInputAt = now();
    if (!idleActive) return;
    idleActive = false;
    deps.sendToPet("pet:idle", { idle: false });
  }

  function updateIdleState(): void {
    if (idleActive) return;
    if (now() - lastInputAt < deps.getSettings().sleepAfterMinutes * 60000) return;
    idleActive = true;
    deps.sendToPet("pet:idle", { idle: true });
  }

  function handleKeyDown(event: KeyInputEvent): void {
    markUserInput();
    recentKeyTimes.push(now());
    const keycode = Number(event.keycode);
    // 자동 반복(키를 누르고 있는 동안)에는 잠금이 한 번만 바뀌므로 첫 입력에서만 토글한다.
    if (keycode === UIOHOOK_CAPS_LOCK_KEYCODE && !heldKeycodes.has(keycode)) {
      capsLockActive = !capsLockActive;
      sendCapsLockState();
      // 초기 조회와 입력이 겹치거나 연속 입력이 들어와도, 실제 키 상태를 마지막 입력 뒤에
      // 다시 읽은 최신 결과로 수렴시킨다. PowerShell 응답 순서는 read revision으로 가린다.
      if (!capsLockSynchronized) void synchronizeCapsLockState();
    }
    if (heldKeycodes.has(keycode)) return;
    heldKeycodes.add(keycode);
    const settings = deps.getSettings();
    if (settings.keyboardSquishEnabled) deps.sendToPet("pet:squish-pulse", "keyboard");
    // 키를 처음 누를 때만 클릭 사운드를 재생한다(자동 반복 중에는 울리지 않음).
    // 너무 겹쳐 들리지 않게 하는 간격 조절은 실제 재생 쪽(renderer.ts의 playClickSound,
    // 소리 길이 기반 스로틀)에서 처리한다.
    // 방해 금지(전체화면) 중에는 펫도 숨어 있으니 클릭 사운드도 울리면 안 된다.
    if (settings.keyboardClickEnabled && !deps.isDndActive()) {
      deps.sendToPet("pet:click-sound", "keyboard");
    }
  }

  function handleKeyUp(event: KeyInputEvent): void {
    heldKeycodes.delete(Number(event.keycode));
  }

  function handleMouseDown(event: MouseInputEvent): void {
    markUserInput();
    // 마우스 측면 버튼(뒤로가기/앞으로가기)에 등록된 단축키 처리. 키보드 전역 단축키와
    // 달리 Electron globalShortcut을 못 쓰므로 이 훅에서 직접 매칭한다.
    deps.dispatchMouseShortcut(event);
    const settings = deps.getSettings();
    if (settings.mouseSquishEnabled) deps.sendToPet("pet:squish-pulse", "mouse");
    if (settings.mouseClickEnabled && !deps.isDndActive()) {
      deps.sendToPet("pet:click-sound", "mouse");
    }
    // 우클릭 메뉴가 떠 있으면 이 클릭은 메뉴 조작(안쪽) 아니면 닫기(바깥쪽)로만 쓴다.
    // `contextMenuWindow.on("blur")`만으로는 부족했다 — 펫 창은 상황에 따라
    // setFocusable(false)라, 메뉴 바깥이면서 펫 위인 지점을 왼클릭하면 Windows가 펫 창을
    // 활성화하지 않고 클릭만 삼켜서 메뉴가 포커스를 잃지 않는다(=blur가 안 온다).
    // 메뉴는 커서 자리에 뜨니까 거의 항상 펫과 겹쳐서, 실사용에서는 이 경우가 대부분이었다
    // ("메뉴 바깥에 왼클릭해도 안 사라짐", 2026-08-08 리포트). 포커스에 기대지 말고
    // 전역 훅 좌표로 직접 판정한다.
    // 안쪽 클릭에서도 return하는 게 중요하다 — 안 그러면 메뉴 항목을 누르는 클릭이
    // 아래 startPetDrag()에 걸려서 펫이 같이 끌려온다(메뉴가 펫 위에 겹쳐 있으므로).
    if (contextMenuOpen()) {
      if (!pointer.isPointOverWindowBounds(deps.contextMenuWindow(), event.x, event.y)) {
        deps.closePetContextMenu();
      }
      return;
    }
    const ui = deps.getUiState();
    // 펫 우클릭 = 자체 팝업 메뉴(pet-context-menu.html). tray.popUpContextMenu()는 이
    // 앱의 클릭스루/전역 마우스훅/always-on-top 오버레이 조합과 맞물려 조용히(에러 없이)
    // 렌더링에 실패하는 것이 로그로 확인돼(호출은 성공하지만 화면에 아무것도 안 뜸,
    // 2026-08-02), 네이티브 트레이 메뉴 대신 우리가 직접 그리는 BrowserWindow 메뉴로
    // 대체했다.
    if (Number(event.button) === MOUSE_BUTTON_RIGHT && ui.clickThrough && !ui.restActive &&
        !ui.customizeActive && pointer.isPointOverPet(event.x, event.y)) {
      const cursorPoint = deps.getCursorPoint();
      setImmediate(() => deps.openPetContextMenu(cursorPoint));
    }
    // 미디어 플레이어는 펫 발밑에 겹쳐 뜨므로, 그 위 클릭은 드래그로 삼지 않는다
    // (재생 버튼을 누를 때 펫이 따라 움직이면 안 된다).
    // 커스터마이징 모드 중에는 드래그 이동을 받지 않는다. 색 팔레트가 펫 위로 겹쳐 열리기
    // 때문에, 팔레트 칸을 클릭하는 게 펫 드래그로 잡혀 펫이 따라 움직였다(2026-08-06).
    // 휴식 알람/AI 질문·답변/즐겨찾기/이미지 리사이징/번역/문서 요약 말풍선은 전부
    // updateBubblePosition()이 머리 꼭대기보다 위에 배치해서 몸통(isPointOverPet 판정 범위)과
    // 겹치지 않는다 — 예전엔 이 상태들도 통째로 드래그를 막았는데, 좌표가 안 겹치니 몸통을
    // 정확히 클릭해도 이동이 씹히는 버그였다(2026-08-06 수정). 겹치는 UI가 아니라면 이
    // 좌표 검사만으로 충분하다.
    if (Number(event.button) === MOUSE_BUTTON_LEFT && pointer.alwaysDragEnabled() &&
        ui.clickThrough && !ui.customizeActive &&
        !pointer.isPointOverMediaPlayer(event.x, event.y) &&
        !pointer.isPointOverFloatingPanel(event.x, event.y) &&
        pointer.isPointOverPet(event.x, event.y)) {
      pointer.startPetDrag(event.x, event.y);
    }
  }

  function handleMouseUp(): void {
    pointer.endPetDrag();
  }

  /**
   * 진입은 즉시, 이탈은 늦춘다. 경계를 넘나들 때마다 setIgnoreMouseEvents/setFocusable로
   * 창 확장 스타일을 반복 변경하면, always-on-top 창 특성상 드물게 다른 창들의 z-order가
   * 뒤섞이는 현상을 유발할 수 있어 토글 빈도를 줄인다.
   */
  function applyHoverToggle(
    current: boolean,
    next: boolean,
    timer: ReturnType<typeof setTimeout> | undefined,
    setValue: (value: boolean) => void,
    setTimer: (value: ReturnType<typeof setTimeout> | undefined) => void
  ): void {
    if (current === next) {
      clearTimeout(timer);
      setTimer(undefined);
      return;
    }
    if (next) {
      // 진입은 즉시 반영 — 우클릭(트레이 메뉴)·드래그 시작이 늦어지면 안 된다.
      clearTimeout(timer);
      setTimer(undefined);
      setValue(true);
      deps.applyMouseInteractionState();
      return;
    }
    if (timer) return;
    setTimer(setTimeout(() => {
      setTimer(undefined);
      setValue(false);
      deps.applyMouseInteractionState();
    }, HOVER_LEAVE_DELAY_MS));
  }

  function handleMouseMove(event: MouseInputEvent): void {
    markUserInput();
    // 우클릭 팝업 메뉴가 떠 있는 동안은 펫의 호버 상태(setFocusable/setIgnoreMouseEvents)를
    // 건드리지 않는다 — 이 always-on-top 오버레이 창의 네이티브 스타일을 매 마우스 이동마다
    // 바꾸면 contextMenuWindow가 (같은 always-on-top "floating" 레벨이라) 포커스를 잃어
    // 메뉴가 곧바로 닫혀버렸다(2026-08-02 확인).
    if (contextMenuOpen()) return;
    if (pointer.isDragging()) {
      pointer.updatePetDrag(event.x, event.y);
      return;
    }
    pointer.updateHeadPetting(event.x, event.y);

    const ui = deps.getUiState();
    // 펫 위에 커서가 있으면 창이 마우스를 받아야 한다 — 우클릭(트레이 메뉴)과 상시 드래그
    // 이동 모두에 필요하다(마우스를 무시하는 상태면 클릭이 뒤쪽 창으로 새어나간다).
    // 우클릭은 AI 질문 설정과 무관하게 항상 메뉴를 열어야 하므로 조건에서 뺐다.
    // 커스터마이징 모드에서는 창이 이미 상시 interactive/focusable이라 호버 토글이 무의미한데,
    // 매 마우스 이동마다 건드리면 창 확장 스타일이 계속 바뀌어 색 팔레트 같은 위에 뜬 UI가
    // 포커스를 잃는다(우클릭 팝업에서 겪은 것과 같은 문제).
    const canHoverPet = ui.clickThrough && !ui.restActive && !ui.assistantPanelActive && !ui.customizeActive;
    // 체크리스트 창이 펫에 겹쳐 있으면 그 영역에선 펫 창이 마우스를 가로채지 않게 둔다
    // (안 그러면 겹친 부분의 체크리스트 조작이 막힌다).
    const shouldInteract = Boolean(canHoverPet &&
      !pointer.isPointOverFloatingPanel(event.x, event.y) &&
      pointer.isPointOverPet(event.x, event.y));
    applyHoverToggle(
      petHoverInteractive, shouldInteract, hoverDebounceTimer,
      (value) => { petHoverInteractive = value; },
      (value) => { hoverDebounceTimer = value; }
    );

    const canUseMediaPlayer = Boolean(deps.getSettings().mediaPlayer?.enabled) && ui.clickThrough &&
      !ui.customizeActive && !ui.restActive && !ui.assistantPanelActive && !ui.favoritesPanelActive &&
      !ui.imageResizePanelActive && !ui.translatePanelActive && !ui.documentSummaryPanelActive;
    const shouldMediaInteract = Boolean(canUseMediaPlayer && pointer.isPointOverMediaPlayer(event.x, event.y));
    applyHoverToggle(
      mediaPlayerHoverInteractive, shouldMediaInteract, mediaHoverDebounceTimer,
      (value) => { mediaPlayerHoverInteractive = value; },
      (value) => { mediaHoverDebounceTimer = value; }
    );
  }

  function tickTyping(): void {
    const cutoff = now() - TYPING_SAMPLE_WINDOW_MS;
    recentKeyTimes = recentKeyTimes.filter((timestamp) => timestamp >= cutoff);
    deps.sendToPet("pet:typing-intensity", typingIntensityFrom(recentKeyTimes, now()));
    updateIdleState();
  }

  /** 타이핑 강도를 주기적으로 보낸다. 훅 배선이 끝난 뒤 main.js가 부른다. */
  function start(): void {
    if (typingTimer) return;
    typingTimer = setInterval(tickTyping, TYPING_TICK_MS);
  }

  function resetPetHover(): void {
    clearTimeout(hoverDebounceTimer);
    hoverDebounceTimer = undefined;
    petHoverInteractive = false;
  }

  function resetMediaHover(): void {
    clearTimeout(mediaHoverDebounceTimer);
    mediaHoverDebounceTimer = undefined;
    mediaPlayerHoverInteractive = false;
  }

  function stop(): void {
    clearInterval(typingTimer);
    typingTimer = undefined;
    capsLockReadRevision += 1;
    resetPetHover();
    resetMediaHover();
    heldKeycodes.clear();
    recentKeyTimes = [];
  }

  return {
    onKeyDown: handleKeyDown,
    onKeyUp: handleKeyUp,
    onMouseDown: handleMouseDown,
    onMouseUp: handleMouseUp,
    onMouseMove: handleMouseMove,
    initializeCapsLockState,
    sendCapsLockState,
    capsLockActive: () => capsLockActive,
    idleActive: () => idleActive,
    isPetHoverInteractive: () => petHoverInteractive,
    isMediaPlayerHoverInteractive: () => mediaPlayerHoverInteractive,
    resetPetHover,
    resetMediaHover,
    start,
    stop,
    tickTyping
  };
}

export { createInputMonitor, typingIntensityFrom, UIOHOOK_CAPS_LOCK_KEYCODE };
export type {
  InputMonitorDependencies, InputEvent, KeyInputEvent, MouseInputEvent,
  UiState, PetPointerApi, WindowLike
};
