const MAX_MEMORY_IMPORT_ITEMS = 100;

type MemoryIpcEvent = { sender: unknown };
type InsertableMemory = {
  category: string;
  memory_key: string;
  memory_label: string;
  memory_value: string;
  importance?: unknown;
};
type MemoryValidation = {
  valid: boolean;
  normalized?: InsertableMemory | null;
};
type MemoryIpcDependencies = {
  isAllowedSender: (event: MemoryIpcEvent) => boolean;
  getMemoryCount: () => number;
  getOpenLoopsCount: () => number;
  getEpisodesCount: () => number;
  getMemoriesByCategory: (category: string) => unknown[];
  getAllMemories: () => unknown[];
  getOpenLoops: () => unknown[];
  setMemoryVerified: (id: number, verified: boolean) => unknown;
  deleteMemory: (id: number) => unknown;
  closeOpenLoop: (id: number, notes: string) => unknown;
  insertMemory: (memory: InsertableMemory) => unknown;
  archiveAllMemories: () => unknown;
  validateExtractedMemory: (candidate: unknown) => MemoryValidation;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isAllowed(deps: MemoryIpcDependencies, event: MemoryIpcEvent) {
  try {
    return deps.isAllowedSender(event);
  } catch {
    return false;
  }
}

function registerMemoryIpcHandlers(
  ipcMain: Pick<import("electron").IpcMain, "handle">,
  deps: MemoryIpcDependencies
) {
  ipcMain.handle("memory:get-stats", async (event) => {
    if (!isAllowed(deps, event)) {
      return { memoryCount: 0, loopsCount: 0, episodesCount: 0 };
    }
    try {
      return {
        memoryCount: deps.getMemoryCount(),
        loopsCount: deps.getOpenLoopsCount(),
        episodesCount: deps.getEpisodesCount()
      };
    } catch (error) {
      console.error("[Memory] Get stats failed:", error);
      return { memoryCount: 0, loopsCount: 0, episodesCount: 0 };
    }
  });

  ipcMain.handle("memory:get-all", async (event, category: unknown) => {
    if (!isAllowed(deps, event)) return [];
    try {
      if (typeof category === "string" && category.length > 0) {
        return deps.getMemoriesByCategory(category);
      }
      return deps.getAllMemories();
    } catch (error) {
      console.error("[Memory] Get all memories failed:", error);
      return [];
    }
  });

  ipcMain.handle("memory:get-open-loops", async (event) => {
    if (!isAllowed(deps, event)) return [];
    try {
      return deps.getOpenLoops();
    } catch (error) {
      console.error("[Memory] Get open loops failed:", error);
      return [];
    }
  });

  ipcMain.handle("memory:verify", async (event, id: unknown) => {
    if (!isAllowed(deps, event) || !isPositiveInteger(id)) return false;
    try {
      return deps.setMemoryVerified(id, true);
    } catch (error) {
      console.error("[Memory] Verify memory failed:", error);
      return false;
    }
  });

  ipcMain.handle("memory:unverify", async (event, id: unknown) => {
    if (!isAllowed(deps, event) || !isPositiveInteger(id)) return false;
    try {
      return deps.setMemoryVerified(id, false);
    } catch (error) {
      console.error("[Memory] Unverify memory failed:", error);
      return false;
    }
  });

  ipcMain.handle("memory:delete", async (event, id: unknown) => {
    if (!isAllowed(deps, event) || !isPositiveInteger(id)) return false;
    try {
      return deps.deleteMemory(id);
    } catch (error) {
      console.error("[Memory] Delete memory failed:", error);
      return false;
    }
  });

  ipcMain.handle("memory:close-loop", async (event, id: unknown, notes: unknown) => {
    if (!isAllowed(deps, event) || !isPositiveInteger(id)) return false;
    try {
      return deps.closeOpenLoop(id, String(notes || "").slice(0, 500));
    } catch (error) {
      console.error("[Memory] Close open loop failed:", error);
      return false;
    }
  });

  ipcMain.handle("memory:import", async (event, memories: unknown) => {
    if (!isAllowed(deps, event) || !Array.isArray(memories)) return 0;

    let importedCount = 0;
    try {
      for (const candidate of memories.slice(0, MAX_MEMORY_IMPORT_ITEMS)) {
        const validation = deps.validateExtractedMemory(candidate);
        if (validation.valid && validation.normalized && deps.insertMemory(validation.normalized)) {
          importedCount += 1;
        }
      }
      return importedCount;
    } catch (error) {
      console.error("[Memory] Import memories failed:", error);
      return importedCount;
    }
  });

  // 채널 이름의 all은 장기 기억 목록 전체를 뜻한다. 미완료 주제와 에피소드는
  // 각자 별도 관리 UI와 수명 주기가 있어 이 동작의 대상이 아니다.
  ipcMain.handle("memory:clear-all", async (event) => {
    if (!isAllowed(deps, event)) return false;
    try {
      return deps.archiveAllMemories();
    } catch (error) {
      console.error("[Memory] Archive long-term memories failed:", error);
      return false;
    }
  });
}

export { MAX_MEMORY_IMPORT_ITEMS, registerMemoryIpcHandlers };
export type { MemoryIpcDependencies, MemoryIpcEvent };
