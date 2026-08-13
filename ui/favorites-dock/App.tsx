// 즐겨찾기 플로팅 독(파이 메뉴) — src/windows/favorites-dock/favorites-dock.js의 React 포팅.
// dock/cursor 두 표시 방식이 이 창 하나를 공유하며, 펼침·접힘은 main이 창 크기를 바꾼 뒤
// favoritesDock:expanded로 되돌려주는 신호를 따른다(렌더러가 혼자 결정하지 않음).
// 파이 라벨은 호버 시점에 실측(offsetWidth)해 창 밖으로 안 나가게 clamp해야 하므로
// React 상태가 아니라 ref로 바닐라와 동일하게 명령형으로 다룬다.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { applyWindowAppearance } from "../lib/appearance";
import { createIpcFeed } from "../lib/ipc-feed";

// 모듈 평가 시점 등록 — main이 did-finish-load 직후 보내는 payload를 놓치지 않는다.
const favoritesFeed = createIpcFeed<FavoritesPayload>((callback) => window.desktopPet.onFavoriteItems(callback));
const expandedFeed = createIpcFeed<{ expanded?: boolean; cursorMode?: boolean }>((callback) =>
  window.desktopPet.onFavoritesDockExpanded(callback)
);

// 반지름 표·간격 근거는 src/windows/favorites-dock/favorites-dock.js의 주석 참고
// (인접 항목 거리 = 2r·sin(180°/개수), 창 300px 기준 최대 반지름 116).
const RING_RADIUS_BY_COUNT = [70, 70, 70, 70, 70, 74, 74, 82, 82, 90, 98, 106, 114];
const LABEL_GAP = 34;
const DRAG_THRESHOLD_PX = 4;

function ringRadius(count: number): number {
  return RING_RADIUS_BY_COUNT[Math.min(count, RING_RADIUS_BY_COUNT.length - 1)] || 70;
}

function placeLabel(label: HTMLElement, angle: number, radius: number) {
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const distance = radius + LABEL_GAP;
  label.classList.add("visible");
  const halfWidth = label.offsetWidth / 2;
  const halfHeight = label.offsetHeight / 2;
  const targetX = centerX + Math.cos(angle) * distance;
  const targetY = centerY + Math.sin(angle) * distance;
  const x = Math.min(Math.max(targetX, halfWidth + 4), window.innerWidth - halfWidth - 4);
  const y = Math.min(Math.max(targetY, halfHeight + 4), window.innerHeight - halfHeight - 4);
  label.style.left = `${Math.round(x)}px`;
  label.style.top = `${Math.round(y)}px`;
}

function PieItemIcon({ item }: { item: FavoriteItemPayload }) {
  if (item.iconTemplate && window.FavoriteIcons) {
    // svgMarkup은 XSS 관점에서 안전: 내장 템플릿 고정 문자열 + 색상 화이트리스트(#rrggbb).
    const markup = window.FavoriteIcons.svgMarkup(item.iconTemplate, item.iconColor || "#ffffff");
    return <span className="pie-icon pie-icon-template" dangerouslySetInnerHTML={{ __html: markup }} />;
  }
  if (item.icon) {
    return <img className="pie-icon" src={item.icon} alt="" />;
  }
  return <span className="pie-fallback">{(item.name || "?").trim().slice(0, 1).toUpperCase()}</span>;
}

interface PieItemProps {
  item: FavoriteItemPayload;
  angle: number;
  radius: number;
  name: string;
  runFailedError: string;
}

function PieItem({ item, angle, radius, name, runFailedError }: PieItemProps) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const restoreTimerRef = useRef<number | undefined>(undefined);

  // 라벨 텍스트는 React가 소유하지 않는다 — 실행 실패 문구로 잠시 바꿨다가 되돌리는
  // 명령형 흐름(바닐라와 동일)과 React 재렌더가 싸우지 않게 한다.
  useEffect(() => {
    if (labelRef.current) labelRef.current.textContent = name;
    return () => window.clearTimeout(restoreTimerRef.current);
  }, [name]);

  const launch = async () => {
    const result = await window.desktopPet.activateFavorite({ type: "item", id: item.id });
    const label = labelRef.current;
    if (!result?.ok && label) {
      label.textContent = result?.error || runFailedError;
      placeLabel(label, angle, radius);
      restoreTimerRef.current = window.setTimeout(() => {
        label.textContent = name;
        label.classList.remove("visible");
      }, 2200);
    }
  };

  return (
    <>
      <button
        type="button"
        className="pie-item"
        style={{ "--x": `${Math.round(Math.cos(angle) * radius)}px`, "--y": `${Math.round(Math.sin(angle) * radius)}px` } as CSSProperties}
        title={name}
        onPointerEnter={() => labelRef.current && placeLabel(labelRef.current, angle, radius)}
        onPointerLeave={() => labelRef.current?.classList.remove("visible")}
        onClick={launch}
      >
        <PieItemIcon item={item} />
      </button>
      <span ref={labelRef} className="pie-label" />
    </>
  );
}

export default function App() {
  const [items, setItems] = useState<FavoriteItemPayload[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [cursorMode, setCursorMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [language, setLanguage] = useState(() => window.PetI18n.DEFAULT_LANGUAGE);
  const receivedEventRef = useRef(false);
  const expandedRef = useRef(false);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const ringRef = useRef<HTMLDivElement>(null);

  expandedRef.current = expanded;

  const tt = useCallback(
    (key: string, vars?: Record<string, string | number>) => window.PetI18n.t(language, key, vars),
    [language]
  );

  useEffect(() => {
    favoritesFeed.subscribe((payload) => {
      receivedEventRef.current = true;
      setItems(Array.isArray(payload?.items) ? payload.items : []);
    });
    expandedFeed.subscribe((payload) => {
      setCursorMode(payload?.cursorMode === true);
      setExpanded(payload?.expanded === true);
    });
    window.desktopPet.onSettingsUpdated((settings) => {
      setLanguage(applyWindowAppearance(settings, { zoom: false }));
    });
    Promise.all([
      window.desktopPet.getSettings(),
      window.desktopPet.listFavorites()
    ]).then(([settings, payload]) => {
      if (!receivedEventRef.current) {
        setItems(Array.isArray(payload?.items) ? payload.items : []);
      }
      setLanguage(applyWindowAppearance(settings, { zoom: false }));
      window.PetUiMotion?.markReady();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expandedRef.current) window.desktopPet.setFavoritesDockExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    document.title = tt("window.favoritesDockTitle");
  }, [tt]);

  // 접히면 보이던 라벨을 전부 숨긴다(바닐라 setExpandedClass와 동일).
  useEffect(() => {
    if (expanded || !ringRef.current) return;
    ringRef.current.querySelectorAll(".pie-label").forEach((label) => label.classList.remove("visible"));
  }, [expanded]);

  const fabTitle = tt(
    cursorMode ? "favorites.cursorCloseTitle" : expanded ? "favorites.dockCloseTitle" : "favorites.dockOpenTitle"
  );

  // 버튼 하나가 클릭과 드래그를 겸한다. -webkit-app-region: drag는 클릭을 삼키므로 직접
  // 구현하며, 창이 드래그 중 같이 움직이니 처음 누른 지점과의 절대 화면 좌표 차이를 보낸다.
  const onFabPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (cursorMode) return;
    dragOriginRef.current = { x: event.screenX, y: event.screenY };
    draggingRef.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 캡처 확보에 실패해도 드래그가 죽지 않게 자체 플래그로만 판정한다.
    }
  };

  const onFabPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const origin = dragOriginRef.current;
    if (!origin) return;
    const dx = event.screenX - origin.x;
    const dy = event.screenY - origin.y;
    if (!draggingRef.current) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
      setDragging(true);
      window.desktopPet.favoritesDockDragStart();
    }
    window.desktopPet.favoritesDockDragMove({ dx, dy });
  };

  const onFabPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (cursorMode) {
      window.desktopPet.setFavoritesDockExpanded(false);
      return;
    }
    if (!dragOriginRef.current) return;
    dragOriginRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 이미 해제된 경우
    }
    if (draggingRef.current) {
      draggingRef.current = false;
      setDragging(false);
      window.desktopPet.favoritesDockDragEnd();
      return;
    }
    window.desktopPet.setFavoritesDockExpanded(!expanded);
  };

  const onFabPointerCancel = () => {
    if (!dragOriginRef.current) return;
    dragOriginRef.current = null;
    if (draggingRef.current) {
      draggingRef.current = false;
      setDragging(false);
      window.desktopPet.favoritesDockDragEnd();
    }
  };

  const onFabContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (cursorMode) window.desktopPet.setFavoritesDockExpanded(false);
    else window.desktopPet.hideFavoritesDock();
  };

  const radius = ringRadius(items.length);

  return (
    <div
      className={`dock${expanded ? " expanded" : ""}${cursorMode ? " cursor-mode" : ""}${dragging ? " dragging" : ""}`}
    >
      <div className="backdrop" onClick={() => window.desktopPet.setFavoritesDockExpanded(false)} />
      <div ref={ringRef} className="ring">
        {items.length === 0 ? (
          <div className="pie-empty">{tt("favorites.emptyState")}</div>
        ) : (
          items.map((item, index) => {
            // 12시 방향에서 시작해 시계 방향으로 균등 배치한다.
            const angle = -Math.PI / 2 + (Math.PI * 2 * index) / items.length;
            return (
              <PieItem
                key={item.id}
                item={item}
                angle={angle}
                radius={radius}
                name={item.name || tt("favorites.defaultName")}
                runFailedError={tt("favorites.runFailedError")}
              />
            );
          })
        )}
      </div>
      <button
        type="button"
        className="fab"
        title={fabTitle}
        aria-label={fabTitle}
        onPointerDown={onFabPointerDown}
        onPointerMove={onFabPointerMove}
        onPointerUp={onFabPointerUp}
        onPointerCancel={onFabPointerCancel}
        onContextMenu={onFabContextMenu}
      >
        <span className="fab-glyph" aria-hidden="true">
          <i /><i /><i />
          <i /><i /><i />
          <i /><i /><i />
        </span>
      </button>
    </div>
  );
}
