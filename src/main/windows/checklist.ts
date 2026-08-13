import * as path from "node:path";
import { app } from "electron";
import { readJsonWithRecovery, writeFileAtomicSync } from "../atomic-file.js";

// 체크리스트는 설정(pet-settings.json)이 아니라 자체 파일에 저장한다 — 항목/창 위치/열림
// 여부가 설정창의 저장·취소 흐름과 무관하게 즉시 반영·유지되어야 하기 때문이다.
const CHECKLIST_MAX_ITEMS = 100;
const CHECKLIST_WINDOW_WIDTH = 250;
const CHECKLIST_WINDOW_HEIGHT = 330;
const CHECKLIST_WINDOW_MIN_WIDTH = 200;
const CHECKLIST_WINDOW_MIN_HEIGHT = 220;

function checklistPath() {
  return path.join(app.getPath("userData"), "checklist.json");
}

type ChecklistItem = { id: string; text: string; done: boolean };
type ChecklistState = {
  open: boolean;
  position: { x: number; y: number } | null;
  size: { width: number; height: number } | null;
  items: ChecklistItem[];
};
type StoredChecklistState = {
  open?: unknown;
  position?: { x?: unknown; y?: unknown } | null;
  size?: { width?: unknown; height?: unknown } | null;
  items?: unknown;
};

// 정규화 함수들의 인자는 checklist.json에서 갓 파싱해 온 값이라 무엇이든 들어올 수 있다.
function normalizeChecklistItem(
  entry: { id?: unknown; text?: unknown; done?: unknown } | null | undefined
): ChecklistItem | null {
  if (!entry || typeof entry !== "object") return null;
  const text = String(entry.text || "").trim().slice(0, 80);
  if (!text) return null;
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    done: entry.done === true
  };
}

function normalizeChecklistPosition(
  value: { x?: unknown; y?: unknown } | null | undefined
): { x: number; y: number } | null {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

// 사용자가 창 꼭지점을 드래그해 크기를 바꿀 수 있게 됐다(2026-08-02) — 위치처럼
// 마지막 크기도 기억해뒀다가 다음에 열 때 그대로 복원한다.
function normalizeChecklistSize(
  value: { width?: unknown; height?: unknown } | null | undefined
): { width: number; height: number } | null {
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    width: Math.round(Math.min(700, Math.max(CHECKLIST_WINDOW_MIN_WIDTH, width))),
    height: Math.round(Math.min(900, Math.max(CHECKLIST_WINDOW_MIN_HEIGHT, height)))
  };
}

function loadChecklist(): ChecklistState {
  try {
    const result = readJsonWithRecovery(checklistPath(), {
      validate: (value: unknown) => Boolean(
        value && typeof value === "object" && !Array.isArray(value)
        && typeof (value as StoredChecklistState).open === "boolean"
        && Array.isArray((value as StoredChecklistState).items)
      )
    });
    if (result.status !== "ok") {
      return { open: false, position: null, size: null, items: [] };
    }
    const stored = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as StoredChecklistState
      : null;
    return {
      open: stored?.open === true,
      position: normalizeChecklistPosition(stored?.position),
      size: normalizeChecklistSize(stored?.size),
      items: (Array.isArray(stored?.items) ? stored.items : [])
        .map(normalizeChecklistItem)
        .filter((item): item is ChecklistItem => item !== null)
        .slice(0, CHECKLIST_MAX_ITEMS)
    };
  } catch {
    return { open: false, position: null, size: null, items: [] };
  }
}

function saveChecklist(state: ChecklistState) {
  try {
    writeFileAtomicSync(checklistPath(), JSON.stringify(state, null, 2), { backup: true });
  } catch (error) {
    console.error("체크리스트를 저장하지 못했습니다:", error);
  }
}

export {
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_WINDOW_WIDTH,
  CHECKLIST_WINDOW_HEIGHT,
  CHECKLIST_WINDOW_MIN_WIDTH,
  CHECKLIST_WINDOW_MIN_HEIGHT,
  checklistPath,
  normalizeChecklistItem,
  normalizeChecklistPosition,
  normalizeChecklistSize,
  loadChecklist,
  saveChecklist
};
export type { ChecklistItem, ChecklistState };
