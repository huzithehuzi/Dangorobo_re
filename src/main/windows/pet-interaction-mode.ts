// 펫 창이 마우스를 받을지 말지.
//
// 펫 창은 평소 클릭이 통과하는(click-through) 투명 창이라, 어떤 조건에서 마우스를 도로
// 받아야 하는지가 이 모듈의 전부다. 잘못되면 사용자가 펫 뒤의 앱을 못 누르거나(과하게
// 받음) 펫을 못 누른다(덜 받음) — 둘 다 바로 체감되는 버그다.
//
// **interactive와 focusable은 조건이 다르다.** 호버는 마우스만 받으면 되고 포커스까지
// 가져가면 안 된다 — 펫 위에 커서를 얹었다고 작업 중인 창의 포커스를 빼앗으면 타이핑이
// 끊긴다. 그래서 호버 두 가지는 interactive에만 들어간다.
//
// 실제 전환은 Windows에서 확장 스타일 `WS_EX_TRANSPARENT`로 밖에서 읽을 수 있고,
// `window-debug.log`의 applyMouseInteractionState 줄에도 남는다.
//
// **값이 바뀌지 않으면 네이티브 호출을 하지 않는다.** Electron의 Windows 구현에서
// `setFocusable()`은 값과 무관하게 내부적으로 `Deactivate()`를 부르는데, 그건
// `GetNextWindow(펫, GW_HWNDNEXT)`로 z-order 바로 아래 창을 찾아 `SetForegroundWindow()`를
// 거는 동작이다. 펫이 topmost로 맨 위에 있을 때는 아래 창이 곧 현재 포그라운드 창이라
// 사실상 무해하지만, 펫이 다른 창들 사이로 가라앉아 있으면 **엉뚱한 배경 창이 앞으로
// 끌려 나온다** — 전체화면 게임 중에 창 순서가 통째로 뒤섞인다는 리포트(2026-08-15)의
// 정체가 이것이다. apply()는 커서가 펫 위를 드나들 때마다(=자주) 불리는데 호버는
// interactive만 바꾸므로, 그때마다 focusable을 같은 값으로 다시 걸면서 이 부작용을
// 반복해 일으키고 있었다. 마지막으로 건 값을 기억해 실제 전환일 때만 호출한다.

/** 이 모듈이 창에 대해 실제로 쓰는 것만 추린 모양. */
type InteractiveWindow = {
  isDestroyed(): boolean;
  setFocusable(focusable: boolean): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
  setSkipTaskbar(skip: boolean): void;
  webContents: { send(channel: string, payload: unknown): void };
};

type PetInteractionModeDependencies = {
  petWindow: () => InteractiveWindow | null | undefined;
  /** 말풍선 다섯 개는 서로 배타적이라 "하나라도 떠 있는가"만 본다. */
  anyPanelActive: () => boolean;
  isCustomizeActive: () => boolean;
  isPetHoverInteractive: () => boolean;
  isMediaPlayerHoverInteractive: () => boolean;
  /** 클릭을 다시 받게 되면 창이 화면 밖에 있지 않은지 확인한다. */
  ensurePetVisible: () => void;
  logWindowOp: (op: string, detail?: unknown) => void;
  /** 기록에만 쓰는 부가 정보 — 판단에는 들어가지 않는다. */
  panelDetail: () => Record<string, boolean>;
};

function createPetInteractionMode(deps: PetInteractionModeDependencies) {
  let clickThrough = true;
  let restActive = false;
  // 마지막으로 네이티브에 건 값. 창을 새로 만들면(펫을 껐다 켜거나 렌더러가 죽어 재생성)
  // 네이티브 상태가 초기화되므로 창 객체가 바뀌면 캐시도 같이 버린다.
  let appliedWindow: InteractiveWindow | null = null;
  let appliedFocusable = false;
  let appliedInteractive = false;

  function apply(): void {
    const win = deps.petWindow();
    if (!win || win.isDestroyed()) return;
    const panelActive = deps.anyPanelActive();
    const customizeActive = deps.isCustomizeActive();
    const petHoverInteractive = deps.isPetHoverInteractive();
    const mediaPlayerHoverInteractive = deps.isMediaPlayerHoverInteractive();

    // 호버는 마우스만 받고 포커스는 넘기지 않는다(위 주석 참고).
    const interactive = restActive || panelActive || customizeActive
      || petHoverInteractive || mediaPlayerHoverInteractive || !clickThrough;
    const focusable = restActive || panelActive || customizeActive || !clickThrough;

    // 창이 새로 만들어졌으면 네이티브 상태를 모르므로 캐시를 버리고 둘 다 다시 건다.
    const fresh = appliedWindow !== win;
    if (fresh) appliedWindow = win;
    const focusableChanged = fresh || appliedFocusable !== focusable;
    const interactiveChanged = fresh || appliedInteractive !== interactive;

    deps.logWindowOp("applyMouseInteractionState", {
      interactive, focusable, restActive, customizeActive,
      petHoverInteractive, mediaPlayerHoverInteractive, clickThrough,
      focusableChanged, interactiveChanged,
      ...deps.panelDetail()
    });
    if (focusableChanged) {
      appliedFocusable = focusable;
      win.setFocusable(focusable);
      // Windows는 focusable을 켜는 순간(특히 휴식 알림처럼 포커스까지 받을 때) 생성 시
      // 설정한 skipTaskbar를 가끔 잊어버려 작업 표시줄에 아이콘이 다시 생긴다(피드백,
      // 2026-08) — 그 아이콘의 우클릭 메뉴(작업 표시줄 점프 목록)는 Windows 셸이 직접
      // 그려서 이 앱의 어떤 이벤트 훅으로도 못 막으므로, 그때마다 다시 건다.
      // (setFocusable을 부르지 않은 apply에서는 Windows가 잊을 계기 자체가 없다.)
      win.setSkipTaskbar(true);
    }
    if (interactiveChanged) {
      appliedInteractive = interactive;
      win.setIgnoreMouseEvents(!interactive, { forward: true });
    }
  }

  /** 이동 모드 토글. 펫 창에도 알려 커서 모양과 모드 카드를 맞춘다. */
  function setClickThrough(enabled: boolean): void {
    clickThrough = enabled;
    apply();
    deps.petWindow()?.webContents.send("pet:interaction-mode", { clickThrough: enabled });
    if (enabled) deps.ensurePetVisible();
  }

  /** 휴식 알림이 뜨고 사라질 때. 알림 동안에는 클릭을 받아야 확인 버튼을 누를 수 있다. */
  function setRestActive(active: boolean): void {
    restActive = active;
  }

  return {
    apply,
    setClickThrough,
    setRestActive,
    isClickThrough: () => clickThrough,
    isRestActive: () => restActive
  };
}

export { createPetInteractionMode };
export type { PetInteractionModeDependencies, InteractiveWindow };
