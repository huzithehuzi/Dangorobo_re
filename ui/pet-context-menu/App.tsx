// 펫 우클릭 / 트레이 팝업 메뉴 — src/windows/pet-context-menu/pet-context-menu.js의 React 포팅.
// 항목은 main.js가 만들어 보내며(label은 이미 번역돼 있음), 창 크기도 main이 항목 수로
// 계산한다. 그래서 이 창은 uiScalePercent zoom을 적용하지 않는다(zoom: false).
import { useEffect, useState } from "react";
import { applyWindowAppearance } from "../lib/appearance";
import { createIpcFeed } from "../lib/ipc-feed";
import { FavoriteIcon } from "../lib/FavoriteIcon";

// 모듈 평가 시점에 등록해야 main이 did-finish-load 직후 보내는 항목을 놓치지 않는다.
const itemsFeed = createIpcFeed<ContextMenuItem[]>((callback) => window.desktopPet.onContextMenuItems(callback));

const itemButtonBase =
  "flex-none flex items-center gap-1.5 w-full h-7 px-2 border-0 rounded-md text-inherit bg-transparent [font:inherit] fs-12 text-left cursor-pointer hover:enabled:bg-soft disabled:text-muted disabled:cursor-default";

export default function App() {
  const [items, setItems] = useState<ContextMenuItem[]>([]);

  useEffect(() => {
    itemsFeed.subscribe(setItems);
    window.desktopPet.getSettings().then((settings) => {
      applyWindowAppearance(settings, { zoom: false });
      window.PetUiMotion?.markReady();
    });
    window.desktopPet.onSettingsUpdated((settings) => applyWindowAppearance(settings, { zoom: false }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.desktopPet.closeContextMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ul className="flex flex-col h-screen overflow-hidden m-0 p-1.5 list-none border border-line rounded-[10px] bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] shadow-[0_10px_26px_rgba(0,0,0,0.34)] backdrop-blur-[10px]">
      {items.map((item, index) => {
        if (item.type === "favorite-grid") {
          const hideLabels = item.hideLabel === true;
          return (
            <li key={index} className="flex-none px-1 pt-1 pb-1.5">
              <div className="grid grid-cols-4 gap-[5px]">
                {(item.items || []).map((favorite) => (
                  <button
                    key={favorite.id}
                    type="button"
                    disabled={favorite.enabled === false}
                    title={favorite.label}
                    onClick={() => window.desktopPet.sendContextMenuAction(favorite.id!)}
                    className={`flex flex-col items-center justify-center gap-1 min-w-0 px-[3px] py-[5px] border-0 rounded-[7px] text-inherit bg-transparent [font:inherit] cursor-pointer hover:enabled:bg-soft disabled:text-muted disabled:cursor-default ${
                      hideLabels ? "h-[46px]" : "h-14"
                    }`}
                  >
                    <FavoriteIcon
                      iconDataUrl={favorite.iconDataUrl}
                      iconTemplate={favorite.iconTemplate}
                      iconColor={favorite.iconColor}
                      className={`flex items-center justify-center text-accent [&_svg]:block ${
                        hideLabels
                          ? "w-7 h-7 [&_svg]:w-7 [&_svg]:h-7"
                          : "w-[22px] h-[22px] [&_svg]:w-[22px] [&_svg]:h-[22px]"
                      }`}
                    />
                    {!hideLabels && (
                      <span className="w-full overflow-hidden text-inherit fs-10 leading-[1.1] text-center text-ellipsis whitespace-nowrap">
                        {favorite.label}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </li>
          );
        }
        if (item.type === "separator") {
          return <li key={index} className="flex-none h-px my-[5px] mx-1.5 bg-line" />;
        }
        return (
          <li key={index}>
            <button
              type="button"
              disabled={item.enabled === false}
              onClick={() => window.desktopPet.sendContextMenuAction(item.id!)}
              className={itemButtonBase}
            >
              {item.type === "checkbox" && (
                <span className="flex-none w-3.5 text-center text-accent font-bold">{item.checked ? "✓" : ""}</span>
              )}
              <FavoriteIcon
                iconDataUrl={item.iconDataUrl}
                iconTemplate={item.iconTemplate}
                iconColor={item.iconColor}
                className="flex-none inline-flex items-center justify-center w-4 h-4 text-accent [&_svg]:w-[15px] [&_svg]:h-[15px] [&_svg]:block"
              />
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{item.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
