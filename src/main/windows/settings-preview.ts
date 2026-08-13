// 설정창의 즉시 미리보기 상태.
//
// 설정창에서 값을 바꾸면 저장 전에도 펫에 바로 반영한다. 그래서 "지금 화면에 보이는 설정"이
// 저장된 설정과 다를 수 있고, 저장 없이 창을 닫으면 되돌려야 한다.
//
// **되돌릴지 판단하는 플래그와 미리보기 값은 함께 움직인다.** 따로 두면 "값은 남았는데
// 되돌리지 않는" 상태가 생겨, 다음에 설정창을 열 때 옛 미리보기가 되살아난다.
//
// 미리보기 값은 저장된 설정 위에 patch를 **누적**한 것이다. 매번 새로 만들면 앞서 바꾼
// 항목이 사라져, 색을 고른 뒤 크기를 바꾸면 색이 원래대로 돌아간다.

import type { Settings } from "../settings-schema.js";

/** 설정창·펫 창에 보내는 공개 스냅샷. main.ts의 publicSettings()가 만드는 모양이다. */
type PublicSettings = Settings & { assistantKeyConfigured: boolean };

type SettingsPreviewDependencies = {
  /** 저장된 설정의 공개 스냅샷. 미리보기의 바탕이 된다. */
  publicSettings: () => PublicSettings;
  /** 펫·체크리스트·즐겨찾기 패널에 모두 보낸다(테마를 함께 따르는 창들이다). */
  broadcast: (settings: PublicSettings) => void;
  /** 펫 창에만 보낸다. */
  sendToPet: (settings: PublicSettings) => void;
};

function createSettingsPreview(deps: SettingsPreviewDependencies) {
  let active = false;
  let preview: PublicSettings | null = null;

  /** 설정창이 값을 바꿀 때마다. patch를 이전 미리보기 위에 누적한다. */
  function apply(patch: Record<string, unknown>): void {
    preview = { ...(preview || deps.publicSettings()), ...patch };
    active = true;
    deps.broadcast(preview);
  }

  /**
   * 설정창이 닫혔다. 미리보기 중이었으면 true를 돌려주고 상태를 지운다 —
   * 호출부는 그때만 저장된 설정으로 되돌린다.
   */
  function takeRestoreNeeded(): boolean {
    const shouldRestore = active;
    active = false;
    preview = null;
    return shouldRestore;
  }

  /** 저장이 끝났다. 미리보기 값이 곧 저장된 값이므로 되돌릴 것이 없다. */
  function clear(): void {
    active = false;
    preview = null;
  }

  /**
   * 펫 쪽 편집기가 색을 즉시 확정했을 때. 미리보기 스냅샷에도 반영해야 설정창을
   * 저장 없이 닫아도 여기서 고른 색이 되돌려지지 않는다.
   */
  function syncBodyColors(bodyColors: Settings["bodyColors"]): void {
    if (preview) preview = { ...preview, bodyColors };
    deps.sendToPet(preview || deps.publicSettings());
  }

  return {
    apply, takeRestoreNeeded, clear, syncBodyColors,
    isActive: () => active,
    current: () => preview
  };
}

export { createSettingsPreview };
export type { SettingsPreviewDependencies, PublicSettings };
