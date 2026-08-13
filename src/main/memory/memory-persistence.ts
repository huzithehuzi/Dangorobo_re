import * as path from "node:path";
import { app } from "electron";
import { readJsonWithRecovery, writeFileAtomicSync } from "../atomic-file.js";

const RESERVED_MEMORY_KEYS = new Set([
  "user_name",
  "pet_name",
  "assistant_name",
  "character_name",
  "owner_name"
]);

const MAX_CONVERSATION_HISTORY_TURNS = 20;
const MAX_EPISODE_SUMMARIES = 30;
const EPISODE_RETENTION_DAYS = 90;

type ConversationTurn = {
  question: string;
  answer: string;
  timestamp?: string;
  modelUsed?: string;
  personality?: string;
};

type EpisodeSummary = {
  id: string;
  date: string;
  summary: string;
  keyTopics: string[];
  importance: number;
  messageCount: number;
  createdAt: string;
};

type StoredConversationTurn = {
  question?: unknown;
  answer?: unknown;
  timestamp?: unknown;
  modelUsed?: unknown;
  personality?: unknown;
};

type StoredEpisodeSummary = {
  id?: unknown;
  date?: unknown;
  summary?: unknown;
  keyTopics?: unknown;
  importance?: unknown;
  messageCount?: unknown;
  createdAt?: unknown;
};

type StoredConversationHistory = {
  version?: unknown;
  currentSessionStarted?: unknown;
  conversationHistory: StoredConversationTurn[];
};

type StoredEpisodes = {
  version?: unknown;
  episodes: StoredEpisodeSummary[];
};

function assistantMemoryPath() {
  return path.join(app.getPath("userData"), "assistant-memory.json");
}

function assistantEpisodesPath() {
  return path.join(app.getPath("userData"), "assistant-episodes.json");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStoredConversationHistory(value: unknown): value is StoredConversationHistory {
  return isObjectRecord(value)
    && Array.isArray(value.conversationHistory)
    && value.conversationHistory.every(isObjectRecord);
}

function isStoredEpisodes(value: unknown): value is StoredEpisodes {
  return isObjectRecord(value)
    && Array.isArray(value.episodes)
    && value.episodes.every(isObjectRecord);
}

function isReservedMemoryKey(key: unknown) {
  if (!key || typeof key !== "string") return false;
  const normalized = key.trim().toLowerCase();
  return RESERVED_MEMORY_KEYS.has(normalized);
}

function validateMemoryKey(key: unknown) {
  if (!key || typeof key !== "string") return false;
  const normalized = key.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 100) return false;
  return !RESERVED_MEMORY_KEYS.has(normalized);
}

function sanitizeMemoryText(text: unknown, maxChars?: number) {
  if (!text || typeof text !== "string") return "";
  return text.trim().slice(0, Math.max(1, maxChars || 500));
}

function loadConversationHistoryFromDisk(): ConversationTurn[] {
  try {
    const filePath = assistantMemoryPath();
    const result = readJsonWithRecovery(filePath, { validate: isStoredConversationHistory });
    if (result.status !== "ok") {
      return [];
    }
    const data = result.data as StoredConversationHistory;
    return data.conversationHistory.map(turn => ({
      question: sanitizeMemoryText(turn.question, 180),
      answer: sanitizeMemoryText(turn.answer, 320),
      timestamp: typeof turn.timestamp === "string" && turn.timestamp
        ? turn.timestamp
        : new Date().toISOString(),
      modelUsed: typeof turn.modelUsed === "string" && turn.modelUsed
        ? turn.modelUsed
        : "unknown",
      personality: typeof turn.personality === "string" && turn.personality
        ? turn.personality
        : "normal"
    }));
  } catch (error) {
    console.error("[Memory] Failed to load conversation history:", error);
    return [];
  }
}

function saveConversationHistoryToDisk(
  conversationHistory: ConversationTurn[],
  maxTurns = MAX_CONVERSATION_HISTORY_TURNS
) {
  try {
    if (!conversationHistory || conversationHistory.length === 0) {
      return;
    }
    const truncated = conversationHistory.slice(-maxTurns);
    const data = {
      version: 1,
      currentSessionStarted: new Date().toISOString(),
      conversationHistory: truncated
    };
    writeFileAtomicSync(assistantMemoryPath(), JSON.stringify(data, null, 2), { backup: true });
  } catch (error) {
    console.error("[Memory] Failed to save conversation history:", error);
  }
}

function appendConversationTurnToHistory(
  question: string,
  answer: string,
  maxTurns = MAX_CONVERSATION_HISTORY_TURNS
) {
  try {
    const filePath = assistantMemoryPath();
    let data: StoredConversationHistory = {
      version: 1,
      currentSessionStarted: new Date().toISOString(),
      conversationHistory: []
    };
    const result = readJsonWithRecovery(filePath, { validate: isStoredConversationHistory });
    if (result.status === "ok") {
      data = result.data as StoredConversationHistory;
    }
    data.conversationHistory.push({
      question: sanitizeMemoryText(question, 180),
      answer: sanitizeMemoryText(answer, 320),
      timestamp: new Date().toISOString(),
      modelUsed: "gemini",
      personality: "normal"
    });
    data.conversationHistory = data.conversationHistory.slice(-maxTurns);
    writeFileAtomicSync(filePath, JSON.stringify(data, null, 2), { backup: true });
  } catch (error) {
    console.error("[Memory] Failed to append conversation turn:", error);
  }
}

function loadEpisodeSummariesFromDisk(): EpisodeSummary[] {
  try {
    const filePath = assistantEpisodesPath();
    const result = readJsonWithRecovery(filePath, { validate: isStoredEpisodes });
    if (result.status !== "ok") {
      return [];
    }
    const data = result.data as StoredEpisodes;
    const now = Date.now();
    const maxAgeMs = EPISODE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return data.episodes.filter(ep => {
      try {
        const epTime = new Date(String(ep.createdAt || "")).getTime();
        return (now - epTime) < maxAgeMs;
      } catch {
        return false;
      }
    }).map(ep => ({
      id: typeof ep.id === "string" && ep.id ? ep.id : `ep-${Date.now()}`,
      date: typeof ep.date === "string" && ep.date
        ? ep.date
        : new Date().toISOString().split("T")[0],
      summary: sanitizeMemoryText(ep.summary, 500),
      keyTopics: Array.isArray(ep.keyTopics)
        ? ep.keyTopics.filter((topic): topic is string => typeof topic === "string").slice(0, 5)
        : [],
      importance: Math.min(1, Math.max(0, Number(ep.importance) || 0.5)),
      messageCount: Number(ep.messageCount) || 0,
      createdAt: typeof ep.createdAt === "string" && ep.createdAt
        ? ep.createdAt
        : new Date().toISOString()
    }));
  } catch (error) {
    console.error("[Memory] Failed to load episode summaries:", error);
    return [];
  }
}

function saveEpisodeSummariesToDisk(episodes: EpisodeSummary[]) {
  try {
    if (!Array.isArray(episodes)) {
      return;
    }
    const data = {
      version: 1,
      episodes: episodes.slice(-MAX_EPISODE_SUMMARIES)
    };
    writeFileAtomicSync(assistantEpisodesPath(), JSON.stringify(data, null, 2), { backup: true });
  } catch (error) {
    console.error("[Memory] Failed to save episode summaries:", error);
  }
}

function appendEpisodeMemory(episodeData: Partial<EpisodeSummary>) {
  try {
    const filePath = assistantEpisodesPath();
    let data: StoredEpisodes = { version: 1, episodes: [] };
    const result = readJsonWithRecovery(filePath, { validate: isStoredEpisodes });
    if (result.status === "ok") {
      data = result.data as StoredEpisodes;
    }
    const newEpisode: EpisodeSummary = {
      id: episodeData.id || `ep-${Date.now()}`,
      date: episodeData.date || new Date().toISOString().split("T")[0],
      summary: sanitizeMemoryText(episodeData.summary, 500),
      keyTopics: Array.isArray(episodeData.keyTopics) ? episodeData.keyTopics.slice(0, 5) : [],
      importance: Math.min(1, Math.max(0, Number(episodeData.importance) || 0.5)),
      messageCount: Number(episodeData.messageCount) || 0,
      createdAt: new Date().toISOString()
    };
    data.episodes.push(newEpisode);
    data.episodes = data.episodes.slice(-MAX_EPISODE_SUMMARIES);
    // 에피소드 요약은 되돌릴 수 없는 사용자 기억이라 직전 정상본(.bak)도 함께 남긴다.
    writeFileAtomicSync(filePath, JSON.stringify(data, null, 2), { backup: true });
  } catch (error) {
    console.error("[Memory] Failed to append episode memory:", error);
  }
}

function generateEpisodeSummaryPrompt(conversationHistory: ConversationTurn[], language = "en") {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return null;
  }
  const turns = conversationHistory
    .map((turn, idx) => `Q${idx + 1}: ${turn.question}\nA${idx + 1}: ${turn.answer}`)
    .join("\n\n");

  return {
    systemPrompt: language === "ko"
      ? "당신은 사용자와의 대화를 분석하는 AI입니다. 대화 요약과 주요 주제를 추출합니다."
      : "You are an AI that analyzes conversations. Extract key topics and summarize.",
    userPrompt: language === "ko"
      ? `다음 대화를 분석해주세요:\n\n${turns}\n\n1-2 문장으로 요약하세요. 주요 주제는 쉼표로 구분해 나열하세요. 중요도는 0-1 사이의 숫자로 표시하세요.\n\n형식:\n요약: ...\n주제: ...\n중요도: ...`
      : `Analyze this conversation:\n\n${turns}\n\nProvide a 1-2 sentence summary. List key topics comma-separated. Rate importance 0-1.\n\nFormat:\nSummary: ...\nTopics: ...\nImportance: ...`,
    maxTokens: 150
  };
}

export {
  RESERVED_MEMORY_KEYS,
  MAX_CONVERSATION_HISTORY_TURNS,
  MAX_EPISODE_SUMMARIES,
  EPISODE_RETENTION_DAYS,
  assistantMemoryPath,
  assistantEpisodesPath,
  isReservedMemoryKey,
  validateMemoryKey,
  sanitizeMemoryText,
  loadConversationHistoryFromDisk,
  saveConversationHistoryToDisk,
  appendConversationTurnToHistory,
  loadEpisodeSummariesFromDisk,
  saveEpisodeSummariesToDisk,
  appendEpisodeMemory,
  generateEpisodeSummaryPrompt
};

export type { ConversationTurn, EpisodeSummary };
