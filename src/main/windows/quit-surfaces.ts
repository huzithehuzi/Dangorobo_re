// 종료 신호를 받았을 때 "화면에서 먼저 사라지는" 부분만 소유한다.
//
// 종료는 즉시 끝나지 않는다 — before-quit이 에피소드 요약(Gemini 응답 대기, 상한 8초)을
// 기다리고, will-quit도 전역 훅 중지·DB 닫기·PowerShell 모니터 종료를 한다. 그동안 펫과
// 창·트레이 아이콘이 그대로 떠 있으면 사용자에게는 "종료가 안 먹는다"로 보인다
// ("펫 종료가 은근 느리다" 리포트). 뒷정리는 그대로 두고 눈에 보이는 것만 먼저 치운다.
//
// 창 목록과 트레이는 주입받는다 — Electron 없이 Node 테스트로 확인하기 위해서다.

/** 이 모듈이 창에 대해 실제로 쓰는 것만 추린 모양. BrowserWindow가 이를 만족한다. */
type HideableWindow = { isDestroyed(): boolean; isVisible(): boolean; hide(): void };
type DestroyableTray = { isDestroyed(): boolean; destroy(): void };

type QuitSurfacesDependencies = {
  windows: () => HideableWindow[];
  tray: () => DestroyableTray | null | undefined;
};

/**
 * 여러 번 불려도 안전하다 — 종료 경로가 재진입할 수 있고(before-quit은 재-quit으로 두 번
 * 돈다), 이미 숨겼거나 파괴된 대상은 건너뛴다.
 */
function hideSurfacesForQuit(deps: QuitSurfacesDependencies): void {
  for (const win of deps.windows()) {
    if (!win.isDestroyed() && win.isVisible()) win.hide();
  }
  // 트레이 아이콘까지 지워야 한다 — 창만 숨기면 아이콘이 남아 아직 살아 있는 것처럼 보인다.
  const trayIcon = deps.tray();
  if (trayIcon && !trayIcon.isDestroyed()) trayIcon.destroy();
}

export { hideSurfacesForQuit };
export type { QuitSurfacesDependencies, HideableWindow, DestroyableTray };
