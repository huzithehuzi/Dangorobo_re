import * as path from "node:path";
import { app } from "electron";
import { readJsonWithRecovery, writeFileAtomicSync } from "../atomic-file.js";

// 즐겨찾기 독립 창/플로팅 독의 위치·크기·열림 여부는 설정창의 저장·취소 흐름과 무관하게
// 즉시 유지돼야 하므로 pet-settings.json이 아니라 자체 파일(favorites-panels.json)에 넣는다.
const FAVORITES_WINDOW_WIDTH = 264;
const FAVORITES_WINDOW_HEIGHT = 340;
const FAVORITES_WINDOW_MIN_WIDTH = 200;
const FAVORITES_WINDOW_MIN_HEIGHT = 200;

function favoritesPanelsPath() {
  return path.join(app.getPath("userData"), "favorites-panels.json");
}

type PanelPosition = { x: number; y: number };
type PanelSize = { width: number; height: number };
type FavoritesPanelsState = {
  window: { open: boolean; position: PanelPosition | null; size: PanelSize | null };
  dock: { open: boolean; position: PanelPosition | null };
};
type StoredFavoritesPanelsState = {
  window?: {
    open?: unknown;
    position?: { x?: unknown; y?: unknown } | null;
    size?: { width?: unknown; height?: unknown } | null;
  } | null;
  dock?: {
    open?: unknown;
    position?: { x?: unknown; y?: unknown } | null;
  } | null;
};

// 인자는 favorites-panels.json에서 갓 파싱해 온 값이라 무엇이든 들어올 수 있다.
function normalizeFavoritesPanelPosition(
  value: { x?: unknown; y?: unknown } | null | undefined
): PanelPosition | null {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function normalizeFavoritesWindowSize(
  value: { width?: unknown; height?: unknown } | null | undefined
): PanelSize | null {
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    width: Math.round(Math.min(700, Math.max(FAVORITES_WINDOW_MIN_WIDTH, width))),
    height: Math.round(Math.min(900, Math.max(FAVORITES_WINDOW_MIN_HEIGHT, height)))
  };
}

function loadFavoritesPanels(): FavoritesPanelsState {
  try {
    const result = readJsonWithRecovery(favoritesPanelsPath(), {
      validate: (value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const stored = value as StoredFavoritesPanelsState;
        return Boolean(
          stored.window && typeof stored.window === "object" && !Array.isArray(stored.window)
          && stored.dock && typeof stored.dock === "object" && !Array.isArray(stored.dock)
        );
      }
    });
    if (result.status !== "ok") {
      return {
        window: { open: false, position: null, size: null },
        dock: { open: false, position: null }
      };
    }
    const stored = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as StoredFavoritesPanelsState
      : null;
    return {
      window: {
        open: stored?.window?.open === true,
        position: normalizeFavoritesPanelPosition(stored?.window?.position),
        size: normalizeFavoritesWindowSize(stored?.window?.size)
      },
      dock: {
        open: stored?.dock?.open === true,
        position: normalizeFavoritesPanelPosition(stored?.dock?.position)
      }
    };
  } catch {
    return {
      window: { open: false, position: null, size: null },
      dock: { open: false, position: null }
    };
  }
}

function saveFavoritesPanels(state: FavoritesPanelsState) {
  try {
    writeFileAtomicSync(favoritesPanelsPath(), JSON.stringify(state, null, 2), { backup: true });
  } catch (error) {
    console.error("즐겨찾기 창 상태를 저장하지 못했습니다:", error);
  }
}

export {
  FAVORITES_WINDOW_WIDTH,
  FAVORITES_WINDOW_HEIGHT,
  FAVORITES_WINDOW_MIN_WIDTH,
  FAVORITES_WINDOW_MIN_HEIGHT,
  favoritesPanelsPath,
  normalizeFavoritesPanelPosition,
  normalizeFavoritesWindowSize,
  loadFavoritesPanels,
  saveFavoritesPanels
};
export type { PanelPosition, PanelSize, FavoritesPanelsState };
