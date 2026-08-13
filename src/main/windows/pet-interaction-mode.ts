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

/** 이 모듈이 창에 대해 실제로 쓰는 것만 추린 모양. */
type InteractiveWindow = {
  isDestroyed(): boolean;
  setFocusable(focusable: boolean): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
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

    deps.logWindowOp("applyMouseInteractionState", {
      interactive, focusable, restActive, customizeActive,
      petHoverInteractive, mediaPlayerHoverInteractive, clickThrough,
      ...deps.panelDetail()
    });
    win.setFocusable(focusable);
    win.setIgnoreMouseEvents(!interactive, { forward: true });
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
