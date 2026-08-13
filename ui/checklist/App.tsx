// 체크리스트 창 — src/windows/checklist/checklist.js의 React 포팅.
// frameless + transparent 창. 순서 바꾸기는 네이티브 HTML5 드래그 대신 mousedown/mousemove를
// 직접 추적한다 — 투명 frameless 창에서 크로미움 네이티브 드래그의 고스트 이미지가 조용히
// 실패하는 문제를 피하기 위한 바닐라 구현과 같은 방식. 고정 크기 창이라 zoom은 걸지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { applyWindowAppearance } from "../lib/appearance";

export default function App() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [language, setLanguage] = useState(() => window.PetI18n.DEFAULT_LANGUAGE);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; before: boolean } | null>(null);
  const confirmTimerRef = useRef<number | undefined>(undefined);
  const confirmingRef = useRef(false);
  const dragStateRef = useRef<{ id: string; overId?: string; before?: boolean } | null>(null);
  const itemsRef = useRef<ChecklistItem[]>([]);

  confirmingRef.current = confirming;
  itemsRef.current = items;

  const tt = useCallback(
    (key: string, vars?: Record<string, string | number>) => window.PetI18n.t(language, key, vars),
    [language]
  );

  const resetClearConfirm = useCallback(() => {
    window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = undefined;
    setConfirming(false);
  }, []);

  useEffect(() => {
    window.desktopPet.onSettingsUpdated((settings) => {
      setLanguage(applyWindowAppearance(settings, { zoom: false }));
    });
    Promise.all([
      window.desktopPet.getSettings(),
      window.desktopPet.getChecklist()
    ]).then(([settings, checklistItems]) => {
      setLanguage(applyWindowAppearance(settings, { zoom: false }));
      setItems(Array.isArray(checklistItems) ? checklistItems : []);
      window.PetUiMotion?.markReady();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 확인 대기 중이면 Esc는 전체 삭제 취소로만 쓰고 창은 닫지 않는다.
      if (confirmingRef.current) {
        window.clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = undefined;
        setConfirming(false);
        return;
      }
      window.desktopPet.closeChecklist();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    document.title = tt("window.checklistTitle");
  }, [tt]);

  useEffect(() => {
    if (items.length === 0) resetClearConfirm();
  }, [items.length, resetClearConfirm]);

  const handleDragMove = useCallback((event: MouseEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    const target = (document.elementFromPoint(event.clientX, event.clientY) as Element | null)?.closest(
      "[data-item-id]"
    ) as HTMLElement | null;
    if (!target || target.dataset.itemId === dragState.id) {
      dragState.overId = undefined;
      setDragOver(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    dragState.overId = target.dataset.itemId;
    dragState.before = before;
    setDragOver({ id: target.dataset.itemId!, before });
  }, []);

  const handleDragEnd = useCallback(async () => {
    document.removeEventListener("mousemove", handleDragMove);
    document.removeEventListener("mouseup", handleDragEnd);
    const dragState = dragStateRef.current;
    dragStateRef.current = null;
    setDraggingId(null);
    setDragOver(null);
    if (!dragState) return;
    const { id: fromId, overId, before } = dragState;
    if (!overId || overId === fromId) return;
    const current = itemsRef.current;
    const fromIndex = current.findIndex((entry) => entry.id === fromId);
    if (fromIndex === -1) return;
    const next = current.slice();
    const [moved] = next.splice(fromIndex, 1);
    let insertAt = next.findIndex((entry) => entry.id === overId);
    if (insertAt === -1) return;
    if (!before) insertAt += 1;
    next.splice(insertAt, 0, moved);
    const reordered = await window.desktopPet.reorderChecklist(next.map((item) => item.id));
    setItems(reordered);
  }, [handleDragMove]);

  const startDrag = (id: string) => {
    dragStateRef.current = { id };
    setDraggingId(id);
    document.addEventListener("mousemove", handleDragMove);
    document.addEventListener("mouseup", handleDragEnd);
  };

  const submitDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setItems(await window.desktopPet.addChecklistItem(text));
    setDraft("");
  };

  const clearAll = async () => {
    if (items.length === 0) return;
    // 전체 삭제는 되돌릴 수 없으니 두 번 눌러야 실행된다(첫 클릭은 "정말?"로 2.5초 대기).
    if (!confirming) {
      setConfirming(true);
      confirmTimerRef.current = window.setTimeout(() => setConfirming(false), 2500);
      return;
    }
    resetClearConfirm();
    setItems(await window.desktopPet.clearChecklist());
  };

  const remaining = items.filter((item) => !item.done).length;
  const headerButton =
    "h-[22px] border border-line rounded-md text-muted bg-transparent leading-none cursor-pointer hover:text-ink hover:bg-[color-mix(in_srgb,var(--accent)_30%,transparent)]";

  return (
    <div className="flex flex-col h-screen overflow-hidden border border-line rounded-xl bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] shadow-[0_10px_26px_rgba(0,0,0,0.34)] backdrop-blur-[10px]">
      <header className="flex flex-none items-center justify-between gap-2 pl-3 pr-2.5 py-[9px] border-b border-line bg-soft [-webkit-app-region:drag]">
        <h1 className="m-0 fs-13 font-bold">{tt("window.checklistTitle")}</h1>
        <div className="flex items-center gap-1.5 [-webkit-app-region:no-drag]">
          {items.length > 0 && (
            <button
              type="button"
              title={tt("checklist.clearButtonTitle")}
              onClick={clearAll}
              className={
                confirming
                  ? "h-[22px] px-[7px] border rounded-md text-[10px] leading-none cursor-pointer text-white border-accent bg-accent font-bold"
                  : `${headerButton} px-[7px] text-[10px]`
              }
            >
              {confirming ? tt("checklist.clearConfirm") : tt("checklist.clearButton")}
            </button>
          )}
          <span className="min-w-5 px-[7px] py-0.5 rounded-full text-white bg-accent fs-11 font-bold text-center">
            {remaining}
          </span>
          <button
            type="button"
            title={tt("checklist.closeButtonTitle")}
            aria-label={tt("checklist.closeButtonTitle")}
            onClick={() => window.desktopPet.closeChecklist()}
            className={`${headerButton} w-[22px] p-0 text-sm`}
          >
            ×
          </button>
        </div>
      </header>
      {items.length === 0 && (
        <div className="flex-none mx-2 mt-2.5 mb-0.5 px-2.5 py-3.5 border border-dashed border-line rounded-[10px] text-muted text-center fs-11">
          {tt("checklist.emptyState")}
        </div>
      )}
      <ul className="flex-1 m-0 p-1.5 overflow-y-auto list-none">
        {items.map((item) => (
          <li
            key={item.id}
            data-item-id={item.id}
            className={`checklist-item group flex items-center gap-2 px-[7px] py-1.5 rounded-lg hover:bg-surface [&+&]:mt-[3px] mt-[3px] first:mt-0 ${
              draggingId === item.id ? "opacity-40" : ""
            } ${
              dragOver?.id === item.id
                ? dragOver.before
                  ? "shadow-[inset_0_2px_0_var(--accent)]"
                  : "shadow-[inset_0_-2px_0_var(--accent)]"
                : ""
            }`}
          >
            <button
              type="button"
              title={item.done ? tt("checklist.itemUndo") : tt("checklist.itemDone")}
              onClick={async () => setItems(await window.desktopPet.toggleChecklistItem(item.id))}
              className={`flex-none w-[19px] h-[19px] p-0 border-[1.5px] rounded-[5px] fs-12 leading-none cursor-pointer ${
                item.done ? "text-white border-accent bg-accent" : "text-transparent border-line bg-transparent hover:border-accent"
              }`}
            >
              ✓
            </button>
            <span
              title={tt("checklist.dragHandle")}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                startDrag(item.id);
              }}
              className={`flex items-center self-stretch flex-1 [overflow-wrap:anywhere] fs-12 leading-[1.4] cursor-grab active:cursor-grabbing select-none ${
                item.done ? "text-muted line-through" : ""
              }`}
            >
              {item.text}
            </span>
            <button
              type="button"
              title={tt("checklist.itemDelete")}
              onClick={async () => setItems(await window.desktopPet.deleteChecklistItem(item.id))}
              className="flex-none w-5 h-5 p-0 border-0 rounded-[5px] text-muted bg-transparent text-[13px] leading-none cursor-pointer opacity-0 group-hover:opacity-100 hover:text-[color-mix(in_srgb,#d7566b_42%,var(--text))] hover:bg-[color-mix(in_srgb,var(--accent)_32%,transparent)]"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form autoComplete="off" onSubmit={submitDraft} className="flex flex-none gap-1.5 p-2 border-t border-line">
        <input
          type="text"
          maxLength={80}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={tt("checklist.addPlaceholder")}
          aria-label={tt("checklist.addPlaceholder")}
          className="flex-1 min-w-0 px-2 py-1.5 border border-line rounded-[7px] text-inherit bg-surface fs-12 focus:border-accent focus:outline-none focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_30%,transparent)]"
        />
        <button
          type="submit"
          title={tt("checklist.addButtonTitle")}
          aria-label={tt("checklist.addButtonTitle")}
          className="flex-none w-[30px] p-0 border-0 rounded-[7px] text-white bg-accent text-base leading-none cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_82%,white)]"
        >
          +
        </button>
      </form>
    </div>
  );
}
