import type { AssistantLogEntry } from "./assistant-logs.js";
type AssistantLogsIpcDependencies = {
  getLogs: () => AssistantLogEntry[];
  setLogs: (logs: AssistantLogEntry[]) => void;
  isLogWindowSender: (sender: unknown) => boolean;
  save: () => void;
};

function registerAssistantLogsIpcHandlers(
  ipcMain: Pick<import("electron").IpcMain, "handle">,
  deps: AssistantLogsIpcDependencies
) {
  ipcMain.handle("assistant-logs:get", () => deps.getLogs().slice().reverse());

  ipcMain.handle("assistant-logs:delete", (event, id) => {
    if (!deps.isLogWindowSender(event.sender)) return false;
    const currentLogs = deps.getLogs();
    const nextLogs = currentLogs.filter((entry) => entry.id !== id);
    if (nextLogs.length === currentLogs.length) return false;
    deps.setLogs(nextLogs);
    deps.save();
    return true;
  });

  ipcMain.handle("assistant-logs:clear", (event) => {
    if (!deps.isLogWindowSender(event.sender)) return false;
    deps.setLogs([]);
    deps.save();
    return true;
  });
}

export { registerAssistantLogsIpcHandlers };
export type { AssistantLogsIpcDependencies };
