const { t } = require("../../shared/i18n.js");

const ASSISTANT_PERSONALITY_KEYS = {
  friend: "assistant.personality.friend",
  polite: "assistant.personality.polite",
  concise: "assistant.personality.concise",
  playful: "assistant.personality.playful"
};

const ASSISTANT_EXPRESSIONS = ["normal", "happy", "angry", "sad", "alarm", "shocked"];
const ASSISTANT_EXPRESSION_TAG_PATTERN = /\n?\[expression:\s*(normal|happy|angry|sad|alarm|shocked)\]\s*$/i;
const ASSISTANT_MEMORY_QUESTION_MAX_CHARS = 180;
const ASSISTANT_MEMORY_ANSWER_MAX_CHARS = 320;
const ASSISTANT_HISTORY_CHAR_BUDGET = 2200;

type AssistantCoreSettings = {
  language: string;
  assistantPersonality: string;
  assistantCustomPersonality: string;
  assistantMemoryEnabled: boolean;
  assistantUserNickname: string;
  assistantPetNickname: string;
  assistantMemoryTurns: number;
};
type AssistantConversationTurn = { question: string; answer: string };
type AssistantEpisodeSummary = { date: string; summary: string };

function normalizeOptionalLine(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function assistantPersonalityInstruction(settings: AssistantCoreSettings) {
  const lang = settings.language;
  if (settings.assistantPersonality === "custom") {
    const custom = normalizeOptionalLine(settings.assistantCustomPersonality, 300);
    if (custom) return t(lang, "assistant.customPersonalityPrefix", { text: custom });
  }
  const key = (ASSISTANT_PERSONALITY_KEYS as Record<string, string>)[settings.assistantPersonality]
    || ASSISTANT_PERSONALITY_KEYS.friend;
  return t(lang, key);
}

function buildAssistantInstructions(
  settings: AssistantCoreSettings,
  dateTimeContext: string,
  options: { includeDateTime?: boolean } = {}
) {
  const lang = settings.language;
  const personality = assistantPersonalityInstruction(settings);
  const includeDateTime = options.includeDateTime !== false;
  const memoryNote = settings.assistantMemoryEnabled ? t(lang, "assistant.memoryNote") : "";
  const nickname = settings.assistantUserNickname;
  const nicknameNote = nickname ? t(lang, "assistant.nicknameNote", { nickname }) : "";
  const petNickname = settings.assistantPetNickname;
  const petNicknameNote = petNickname ? t(lang, "assistant.petNicknameNote", { nickname: petNickname }) : "";
  const commonStyle = t(lang, "assistant.commonStyle");
  const main = t(lang, "assistant.instructionsMain", { personality, nicknameNote, petNicknameNote, commonStyle });
  // 앱 언어로 고정하지 않고 실제 질문이나 최근 대화의 언어를 모델이 감지하게 한다. 앱 언어는
  // 참고할 사용자 언어가 전혀 없을 때만 쓰이는 폴백이다.
  const languageDirective = t(lang, "assistant.languageDirective");
  const dateTimeBlock = includeDateTime
    ? `\n\n${dateTimeContext}\n${t(lang, "assistant.dateTimeInstruction")}${memoryNote}`
    : memoryNote
      ? `\n\n${memoryNote}`
      : "";
  return `${languageDirective} ${main}${dateTimeBlock}

${t(lang, "assistant.expressionTagInstruction")}`;
}

function compactAssistantMemoryText(value: unknown, maxChars: number) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function rememberedAssistantQuestion(question: string) {
  return compactAssistantMemoryText(question, ASSISTANT_MEMORY_QUESTION_MAX_CHARS);
}

function rememberedAssistantAnswer(answer: string) {
  return compactAssistantMemoryText(answer, ASSISTANT_MEMORY_ANSWER_MAX_CHARS);
}

function isShortAssistantQuestion(question: string, extraTurns: AssistantConversationTurn[] = []) {
  const normalized = String(question || "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 &&
    normalized.length <= 24 &&
    !normalized.includes("\n") &&
    (!Array.isArray(extraTurns) || extraTurns.length === 0);
}

function buildAssistantHistoryBlock(
  settings: AssistantCoreSettings,
  conversationHistory: AssistantConversationTurn[],
  options: { maxTurns?: number; totalBudget?: number } = {}
) {
  if (!settings.assistantMemoryEnabled || conversationHistory.length === 0) return "";
  const lang = settings.language;
  const maxTurns = Math.max(1, Math.min(settings.assistantMemoryTurns, Number(options.maxTurns) || settings.assistantMemoryTurns));
  const totalBudget = Math.max(400, Number(options.totalBudget) || ASSISTANT_HISTORY_CHAR_BUDGET);
  const recentTurns = conversationHistory.slice(-maxTurns);
  const lines: string[] = [];
  let usedChars = 0;
  for (let index = recentTurns.length - 1; index >= 0; index -= 1) {
    const turn = recentTurns[index];
    const line = t(lang, "assistant.historyTurnLine", {
      index: index + 1,
      question: compactAssistantMemoryText(turn.question, ASSISTANT_MEMORY_QUESTION_MAX_CHARS),
      answer: compactAssistantMemoryText(turn.answer, ASSISTANT_MEMORY_ANSWER_MAX_CHARS)
    });
    if (lines.length > 0 && usedChars + line.length > totalBudget) break;
    lines.unshift(line);
    usedChars += line.length;
  }
  if (lines.length === 0 && recentTurns.length > 0) {
    const turn = recentTurns[recentTurns.length - 1];
    lines.push(t(lang, "assistant.historyTurnLine", {
      index: recentTurns.length,
      question: compactAssistantMemoryText(turn.question, 90),
      answer: compactAssistantMemoryText(turn.answer, 140)
    }));
  }
  const turns = lines.join("\n");
  return `\n\n${t(lang, "assistant.historyBlockHeader")}\n${turns}\n`;
}

/**
 * options는 기존 함수도 받기만 하고 사용하지 않았다. 호출 계약을 유지하기 위해 그대로 둔다.
 */
function buildRecentEpisodeSummaryBlock(
  settings: AssistantCoreSettings,
  episodeSummaries: AssistantEpisodeSummary[],
  options: Record<string, unknown> = {}
) {
  void options;
  if (!settings.assistantMemoryEnabled || episodeSummaries.length === 0) return "";
  const lang = settings.language;
  const maxEpisodes = Math.min(3, episodeSummaries.length);
  const recent = episodeSummaries.slice(0, maxEpisodes);
  const lines = recent.map((ep) => {
    const dateStr = new Date(ep.date + "T00:00:00").toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US");
    return t(lang, "assistant.episodeMemoryLine", { date: dateStr, summary: ep.summary });
  });
  if (lines.length === 0) return "";
  return `\n\n${t(lang, "assistant.episodeMemoryHeader")}\n${lines.join("\n")}\n`;
}

function extractAssistantExpression(rawAnswer: string) {
  const match = rawAnswer.match(ASSISTANT_EXPRESSION_TAG_PATTERN);
  if (!match) return { text: rawAnswer, expression: "normal" };
  const expression = match[1].toLowerCase();
  return {
    text: rawAnswer.slice(0, match.index).trim(),
    expression: ASSISTANT_EXPRESSIONS.includes(expression) ? expression : "normal"
  };
}

function buildOneOffHistoryBlock(language: string, extraTurns: AssistantConversationTurn[]) {
  if (!Array.isArray(extraTurns) || extraTurns.length === 0) return "";
  const turns = extraTurns
    .map((turn, index) => t(language, "assistant.oneOffHistoryLine", {
      index: index + 1,
      question: turn.question,
      answer: turn.answer
    }))
    .join("\n");
  return `\n\n${t(language, "assistant.oneOffHistoryHeader")}\n${turns}\n`;
}

function parseEpisodeSummaryResponse(responseText: unknown, now: Date, messageCount: number) {
  try {
    const lines = String(responseText || "").split("\n");
    let summary = "";
    let topics: string[] = [];
    let importance = 0.5;

    for (const line of lines) {
      if (line.toLowerCase().startsWith("summary:") || line.toLowerCase().startsWith("요약:")) {
        summary = line.split(":").slice(1).join(":").trim();
      } else if (line.toLowerCase().startsWith("topics:") || line.toLowerCase().startsWith("주제:")) {
        const topicsStr = line.split(":").slice(1).join(":").trim();
        topics = topicsStr.split(",").map((topic) => topic.trim()).filter((topic) => topic.length > 0).slice(0, 5);
      } else if (line.toLowerCase().startsWith("importance:") || line.toLowerCase().startsWith("중요도:")) {
        const importanceStr = line.split(":").slice(1).join(":").trim();
        const parsed = parseFloat(importanceStr);
        if (!Number.isNaN(parsed)) {
          importance = Math.min(1, Math.max(0, parsed));
        }
      }
    }

    if (!summary || summary.length === 0) return null;

    return {
      summary,
      keyTopics: topics,
      importance,
      date: now.toISOString().split("T")[0],
      messageCount
    };
  } catch (error) {
    console.error("[Memory] Failed to parse episode summary:", error);
    return null;
  }
}

// Error가 아닌 값도 던질 수 있으므로 catch 값에서 메시지만 안전하게 꺼낸다.
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

function mapAssistantErrorMessage(error: unknown, language: string) {
  const message = String((error instanceof Error && error.message) || t(language, "assistant.unknownError"));
  if (/401|403|api key|authentication|permission/i.test(message)) {
    return t(language, "assistant.apiKeyError");
  }
  if (/429|quota|resource_exhausted|rate limit/i.test(message)) {
    return t(language, "assistant.quotaError");
  }
  if (/fetch failed|network|enotfound|econn/i.test(message)) {
    return t(language, "assistant.networkError");
  }
  return message.slice(0, 240);
}

export {
  buildAssistantInstructions,
  compactAssistantMemoryText,
  rememberedAssistantQuestion,
  rememberedAssistantAnswer,
  isShortAssistantQuestion,
  buildAssistantHistoryBlock,
  buildRecentEpisodeSummaryBlock,
  extractAssistantExpression,
  buildOneOffHistoryBlock,
  parseEpisodeSummaryResponse,
  errorMessage,
  mapAssistantErrorMessage
};
export type { AssistantCoreSettings, AssistantConversationTurn, AssistantEpisodeSummary };
