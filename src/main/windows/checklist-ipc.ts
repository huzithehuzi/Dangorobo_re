import type { IpcMain } from "electron";
import type { ChecklistItem, normalizeChecklistItem } from "./checklist.js";

type ChecklistIpcEvent = { sender: unknown };
type ChecklistIpcDependencies = {
  getItems: () => ChecklistItem[];
  setItems: (items: ChecklistItem[]) => void;
  isChecklistSender: (sender: unknown) => boolean;
  normalizeItem: typeof normalizeChecklistItem;
  maxItems: number;
  save: () => void;
  celebrate: () => void;
  close: () => void;
};

/**
 * 체크리스트 IPC는 실행 중 교체되는 상태와 창을 직접 캡처하지 않고, 호출할 때마다
 * getter와 동작 콜백을 통해 main.js의 최신 값을 사용한다.
 */
function registerChecklistIpcHandlers(
  ipcMain: Pick<IpcMain, "handle" | "on">,
  deps: ChecklistIpcDependencies
) {
  ipcMain.handle("checklist:get", () => deps.getItems());

  ipcMain.handle("checklist:add", (event: ChecklistIpcEvent, text) => {
    const currentItems = deps.getItems();
    if (!deps.isChecklistSender(event.sender)) return currentItems;
    const item = deps.normalizeItem({ text, done: false });
    if (!item) return currentItems;
    const nextItems = [...currentItems, item].slice(-deps.maxItems);
    deps.setItems(nextItems);
    deps.save();
    return nextItems;
  });

  ipcMain.handle("checklist:toggle", (event: ChecklistIpcEvent, id) => {
    const currentItems = deps.getItems();
    if (!deps.isChecklistSender(event.sender)) return currentItems;
    let justCompleted = false;
    const nextItems = currentItems.map((item) => {
      if (item.id !== id) return item;
      if (!item.done) justCompleted = true;
      return { ...item, done: !item.done };
    });
    deps.setItems(nextItems);
    deps.save();
    if (justCompleted) deps.celebrate();
    return nextItems;
  });

  ipcMain.handle("checklist:delete", (event: ChecklistIpcEvent, id) => {
    const currentItems = deps.getItems();
    if (!deps.isChecklistSender(event.sender)) return currentItems;
    const nextItems = currentItems.filter((item) => item.id !== id);
    deps.setItems(nextItems);
    deps.save();
    return nextItems;
  });

  ipcMain.handle("checklist:clear", (event: ChecklistIpcEvent) => {
    const currentItems = deps.getItems();
    if (!deps.isChecklistSender(event.sender)) return currentItems;
    const nextItems: ChecklistItem[] = [];
    deps.setItems(nextItems);
    deps.save();
    return nextItems;
  });

  ipcMain.handle("checklist:reorder", (event: ChecklistIpcEvent, orderedIds) => {
    const currentItems = deps.getItems();
    if (!deps.isChecklistSender(event.sender) || !Array.isArray(orderedIds)) return currentItems;
    const byId = new Map(currentItems.map((item) => [item.id, item]));
    const reordered = orderedIds
      .map((id: string) => byId.get(id))
      .filter((item) => item !== undefined);
    for (const item of currentItems) {
      if (!orderedIds.includes(item.id)) reordered.push(item);
    }
    if (reordered.length !== currentItems.length) return currentItems;
    deps.setItems(reordered);
    deps.save();
    return reordered;
  });

  ipcMain.on("checklist:close", (event: ChecklistIpcEvent) => {
    if (deps.isChecklistSender(event.sender)) deps.close();
  });
}

export { registerChecklistIpcHandlers };
export type { ChecklistIpcDependencies };
