// 즐겨찾기 독립 창 — src/windows/favorites-window/favorites-window.js의 React 포팅.
// frameless + transparent + alwaysOnTop 창. 헤더를 잡고 옮긴다(-webkit-app-region: drag).
// 작은 창이라 uiScalePercent zoom은 걸지 않는다(내용이 잘림) — 바닐라와 동일.
import { useCallback, useEffect, useRef, useState } from "react";
import { applyWindowAppearance } from "../lib/appearance";
import { createIpcFeed } from "../lib/ipc-feed";
import { LaunchIcon } from "../lib/LaunchIcon";

// 모듈 평가 시점에 등록해야 main이 did-finish-load 직후 보내는 초기 payload를 놓치지 않는다.
const favoritesFeed = createIpcFeed<FavoritesPayload>((callback) => window.desktopPet.onFavoriteItems(callback));

interface FavoritesState {
  items: FavoriteItemPayload[];
  layout: "list" | "grid";
  hideLabels: boolean;
}

function normalizePayload(payload: FavoritesPayload | undefined): FavoritesState {
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    layout: payload?.layout === "grid" ? "grid" : "list",
    hideLabels: payload?.hideLabels === true
  };
}

export default function App() {
  const [state, setState] = useState<FavoritesState>({ items: [], layout: "list", hideLabels: false });
  const [status, setStatus] = useState("");
  const [language, setLanguage] = useState(() => window.PetI18n.DEFAULT_LANGUAGE);
  const receivedEventRef = useRef(false);

  const tt = useCallback(
    (key: string, vars?: Record<string, string | number>) => window.PetI18n.t(language, key, vars),
    [language]
  );

  useEffect(() => {
    favoritesFeed.subscribe((payload) => {
      receivedEventRef.current = true;
      setStatus("");
      setState(normalizePayload(payload));
    });
    window.desktopPet.onSettingsUpdated((settings) => {
      setLanguage(applyWindowAppearance(settings, { zoom: false }));
    });
    Promise.all([
      window.desktopPet.getSettings(),
      window.desktopPet.listFavorites()
    ]).then(([settings, payload]) => {
      // listFavorites는 첫 화면용 스냅샷일 뿐이다 — 그 사이 이벤트로 최신 payload가
      // 이미 도착했다면(예: QA 캡처의 샘플 주입) 스냅샷이 그걸 덮어쓰면 안 된다.
      if (!receivedEventRef.current) {
        setState(normalizePayload(payload));
      }
      setLanguage(applyWindowAppearance(settings, { zoom: false }));
      window.PetUiMotion?.markReady();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.desktopPet.closeFavoritesWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    document.title = tt("window.favoritesTitle");
  }, [tt]);

  const launch = async (item: FavoriteItemPayload) => {
    const label = item.name || tt("favorites.defaultName");
    setStatus(tt("favorites.openingLabel", { label }));
    const result = await window.desktopPet.activateFavorite({ type: "item", id: item.id });
    setStatus(result?.ok ? "" : result?.error || tt("favorites.runFailedError"));
  };

  const isGrid = state.layout === "grid";
  const gridLabelsHidden = isGrid && state.hideLabels;

  return (
    <div className="flex flex-col h-screen overflow-hidden border border-line rounded-xl bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] shadow-[0_10px_26px_rgba(0,0,0,0.34)] backdrop-blur-[10px]">
      <header className="flex flex-none items-center justify-between gap-2 pl-3 pr-2.5 py-[9px] border-b border-line bg-soft [-webkit-app-region:drag]">
        <h1 className="m-0 fs-13 font-bold">{tt("window.favoritesTitle")}</h1>
        <div className="flex items-center gap-1.5 [-webkit-app-region:no-drag]">
          <button
            type="button"
            title={tt("favorites.closeButtonTitle")}
            aria-label={tt("favorites.closeButtonTitle")}
            onClick={() => window.desktopPet.closeFavoritesWindow()}
            className="w-[22px] h-[22px] p-0 border border-line rounded-md text-muted bg-transparent text-sm leading-none cursor-pointer hover:text-ink hover:bg-[color-mix(in_srgb,var(--accent)_30%,transparent)]"
          >
            ×
          </button>
        </div>
      </header>
      {state.items.length === 0 && (
        <div className="flex-none mx-2 mt-2.5 mb-0.5 px-2.5 py-3.5 border border-dashed border-line rounded-[10px] text-muted text-center fs-11 leading-normal">
          {tt("favorites.emptyState")}
        </div>
      )}
      <div
        className={`favorites-list flex-1 p-2 overflow-y-auto ${
          isGrid ? "grid grid-cols-3 gap-1.5 content-start" : "flex flex-col gap-1"
        }`}
      >
        {state.items.map((item) => {
          const label = item.name || tt("favorites.defaultName");
          return (
            <button
              key={item.id}
              type="button"
              title={label}
              onClick={() => launch(item)}
              className={`flex items-center w-full border border-transparent rounded-[9px] text-inherit bg-white/6 cursor-pointer hover:border-[color-mix(in_srgb,var(--accent)_55%,transparent)] hover:bg-white/14 ${
                isGrid ? "flex-col gap-1.5 px-1 py-2.5 text-center fs-12" : "gap-[9px] px-[9px] py-[7px] text-left fs-12"
              }`}
            >
              <LaunchIcon item={item} sizeClassName={isGrid ? "w-7 h-7" : "w-5 h-5"} />
              {!gridLabelsHidden && (
                <span className={`overflow-hidden text-ellipsis whitespace-nowrap ${isGrid ? "max-w-full fs-10" : ""}`}>
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="flex-none m-0 px-2.5 pb-2 text-muted fs-11 min-h-[15px]">
        {status}
      </p>
    </div>
  );
}
