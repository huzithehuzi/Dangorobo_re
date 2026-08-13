// 방해 금지(전체화면 감지) 상태에 따른 창 숨김·복구.
//
// 감지는 `dnd-monitor.ts`가 하고 이 모듈은 "그래서 어떤 창을 숨길지"만 정한다. 둘을 가른
// 이유는 감지가 PowerShell 프로세스에 붙어 있어 다른 OS에서 돌지 않기 때문이다 — 판단은
// 여기 모아 두면 창 객체만 흉내 내서 Node로 검증할 수 있다.
//
// 핵심 규칙: **우리가 숨긴 창만 되살린다.** 사용자가 직접 숨겨 둔 창까지 복구하면
// "방해 금지가 풀렸더니 숨겨 둔 펫이 다시 나타나는" 문제가 된다. 그래서 창별로
// "이건 우리가 숨겼다"는 표시를 따로 들고 있다가 그것만 되돌린다.

import type { BrowserWindow } from "electron";
import type { DndReason } from "../dnd-monitor.js";

/** 이 모듈이 창에 대해 실제로 쓰는 것만 추린 모양 — 테스트에서 흉내 내기 쉽게 한다. */
type HideableWindow = Pick<BrowserWindow, "isDestroyed" | "isVisible" | "hide" | "showInactive">;

type DndVisibilityDependencies = {
  petWindow: () => HideableWindow | null | undefined;
  checklistWindow: () => HideableWindow | null | undefined;
  favoritesWindows: {
    window: () => HideableWindow | null | undefined;
    dockWindow: () => HideableWindow | null | undefined;
  };
  /** 방해 금지 동안 밀어 둔 알람을 해제 뒤에 보여준다. */
  alarmQueue: { tryShowNext: () => void };
  /** 펫을 다시 보이기 전에 화면 밖으로 나가 있지 않은지 확인한다. */
  ensurePetVisible: () => void;
  logWindowOp: (op: string, detail?: unknown) => void;
};

function createDndVisibility(deps: DndVisibilityDependencies) {
  let dndActive = false;
  let petHiddenByDnd = false;
  let checklistHiddenByDnd = false;
  const favoritesPanelsHiddenByDnd = new Set<HideableWindow>();

  /** 같은 값으로 여러 번 불릴 수 있으므로 여기서 중복을 걸러낸다. */
  function apply(active: boolean, reason: DndReason = { state: 0, foreground: "" }): void {
    if (dndActive === active) return;
    dndActive = active;
    deps.logWindowOp("applyDndState", { active, state: reason.state, foreground: reason.foreground });

    if (active) {
      // 전체화면 중에는 펫도 같이 숨긴다. 사용자가 직접 숨겨둔 경우를 되살리지 않도록,
      // "우리가 숨긴 것"만 표시해두고 나중에 그것만 복구한다.
      const pet = deps.petWindow();
      if (pet && !pet.isDestroyed() && pet.isVisible()) {
        petHiddenByDnd = true;
        pet.hide();
      }
      // 체크리스트도 같은 이유로 같이 숨긴다 — 전체화면 게임/발표 중에 화면 위에 떠 있으면
      // 방해 금지 취지에 안 맞는다("체크리스트 방해금지모드에서도 보임", 2026-08-02).
      const checklist = deps.checklistWindow();
      if (checklist && !checklist.isDestroyed() && checklist.isVisible()) {
        checklistHiddenByDnd = true;
        checklist.hide();
      }
      // 즐겨찾기 독립 창·플로팅 독도 같은 이유로 숨긴다.
      for (const win of [deps.favoritesWindows.window(), deps.favoritesWindows.dockWindow()]) {
        if (win && !win.isDestroyed() && win.isVisible()) {
          favoritesPanelsHiddenByDnd.add(win);
          win.hide();
        }
      }
      return;
    }

    const pet = deps.petWindow();
    if (petHiddenByDnd && pet && !pet.isDestroyed()) {
      petHiddenByDnd = false;
      deps.ensurePetVisible();
      pet.showInactive();
    }
    const checklist = deps.checklistWindow();
    if (checklistHiddenByDnd && checklist && !checklist.isDestroyed()) {
      checklistHiddenByDnd = false;
      checklist.showInactive();
    }
    for (const win of favoritesPanelsHiddenByDnd) {
      if (win && !win.isDestroyed()) win.showInactive();
    }
    favoritesPanelsHiddenByDnd.clear();
    // 방해 금지 동안 밀어둔 알람을 이제 보여준다(큐에 그대로 남아 있다).
    deps.alarmQueue.tryShowNext();
  }

  return {
    apply,
    isActive: () => dndActive
  };
}

export { createDndVisibility };
export type { DndVisibilityDependencies, HideableWindow };
