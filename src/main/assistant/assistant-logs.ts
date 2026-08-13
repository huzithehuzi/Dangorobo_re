import * as path from "node:path";
import * as crypto from "node:crypto";
import { app } from "electron";
import {
  DEFAULT_SETTINGS,
  normalizeAssistantModel,
  normalizeAssistantPersonality
} from "../settings-schema.js";
import { readJsonWithRecovery, writeFileAtomicSync } from "../atomic-file.js";

const MAX_ASSISTANT_LOGS = 300;

function assistantLogsPath() {
  return path.join(app.getPath("userData"), "assistant-logs.json");
}

// 저장되는 기록 한 줄. petChat(펫이 먼저 건 말)만 type/petMessage를 추가로 갖는다.
type AssistantLogEntry = {
  id: string;
  timestamp: string;
  question: string;
  answer: string;
  model: string;
  personality: string;
  type?: "petChat";
  petMessage?: string;
};

type AssistantLogInput = {
  id?: unknown;
  timestamp?: string;
  type?: unknown;
  petMessage?: unknown;
  question?: unknown;
  answer?: unknown;
  model?: unknown;
  personality?: unknown;
};

// 인자는 assistant-logs.json에서 갓 파싱해 온 값이라 필드가 없거나 엉뚱한 것도 들어온다.
function normalizeAssistantLogEntry(
  entry: AssistantLogInput | null | undefined
): AssistantLogEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const parsedTime = Date.parse(entry.timestamp ?? "");
  const timestamp = Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : new Date().toISOString();
  const model = normalizeAssistantModel(entry.model, DEFAULT_SETTINGS.assistantGeminiModel);
  const personality = normalizeAssistantPersonality(entry.personality);
  const id = typeof entry.id === "string" && entry.id ? entry.id : crypto.randomUUID();

  // petChat 항목은 펫이 먼저 건 말(petMessage)이 핵심이고, 사용자가 답장을 안 했을 수도 있어
  // question/answer(사용자 답장·펫의 그 답장)가 비어 있는 것도 허용한다.
  if (entry.type === "petChat") {
    const petMessage = String(entry.petMessage || "").trim().slice(0, 4000);
    if (!petMessage) return null;
    return {
      id,
      timestamp,
      type: "petChat",
      petMessage,
      question: String(entry.question || "").trim().slice(0, 1000),
      answer: String(entry.answer || "").trim().slice(0, 4000),
      model,
      personality
    };
  }

  const question = String(entry.question || "").trim().slice(0, 1000);
  const answer = String(entry.answer || "").trim().slice(0, 4000);
  if (!question || !answer) return null;
  return { id, timestamp, question, answer, model, personality };
}

function loadAssistantLogs() {
  try {
    const result = readJsonWithRecovery(assistantLogsPath(), {
      validate: (value: unknown) => Array.isArray(value)
    });
    if (result.status !== "ok") return [];
    const stored = result.data;
    return (Array.isArray(stored) ? stored : [])
      .map(normalizeAssistantLogEntry)
      .filter((entry) => entry !== null)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      .slice(-MAX_ASSISTANT_LOGS);
  } catch {
    return [];
  }
}

function saveAssistantLogs(logs: AssistantLogEntry[]) {
  try {
    writeFileAtomicSync(assistantLogsPath(), JSON.stringify(logs, null, 2), { backup: true });
  } catch (error) {
    console.error("Assistant log could not be saved:", error);
  }
}

function buildAssistantLogEntry(
  question: string,
  answer: string,
  model: string,
  personality: string
) {
  return normalizeAssistantLogEntry({
    timestamp: new Date().toISOString(),
    question,
    answer,
    model,
    personality
  });
}

function buildPetChatLogEntry(
  petMessage: string,
  userReply: string,
  petReply: string,
  model: string,
  personality: string
) {
  return normalizeAssistantLogEntry({
    timestamp: new Date().toISOString(),
    type: "petChat",
    petMessage,
    question: userReply,
    answer: petReply,
    model,
    personality
  });
}

export {
  MAX_ASSISTANT_LOGS,
  assistantLogsPath,
  normalizeAssistantLogEntry,
  loadAssistantLogs,
  saveAssistantLogs,
  buildAssistantLogEntry,
  buildPetChatLogEntry
};
export type { AssistantLogEntry };
