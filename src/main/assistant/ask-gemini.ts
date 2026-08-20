// 펫 질문(askGemini) 오케스트레이션 — 프롬프트 블록 조립, 토큰·타임아웃 결정, 타임아웃 시
// 1회 강등 재시도. 전송은 gemini-transport.js, 프롬프트 블록은 main의 래퍼(호출 시점에 최신
// settings·이력을 읽는다)를 콜백으로 주입받는다.

const { t } = require("../../shared/i18n.js");
import { isShortAssistantQuestion } from "./assistant-core.js";
import { extractResponseText } from "./gemini-transport.js";

// 2026-08-14부터 질문·펫대화도 안전 필터를 끈다(그전에는 안 보내서 API 기본 차단 수준이었다).
// 번역 경로와 같은 4종이지만 **상수를 공유하지 않는다** — 경로마다 정책이 다른 것이 이 코드의
// 전제라서(AGENTS.md), 한 곳을 고치면 다른 경로가 같이 바뀌는 배선을 만들지 않는다.
// 이 배열을 바꿀 때 번역·문서 요약 경로를 따라 바꿀 이유는 없다.
// 문서 요약은 여전히 안 보낸다.
const ASSISTANT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

const ASSISTANT_DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const ASSISTANT_SHORT_MAX_OUTPUT_TOKENS = 480;
const ASSISTANT_PRIMARY_TIMEOUT_MS = 22000;
const ASSISTANT_RETRY_TIMEOUT_MS = 12000;

// personalityOverride/systemPromptOverride는 분리 전부터 JSDoc에만 있고 본문 어디서도 읽지
// 않던 죽은 옵션이다 — 호환을 위해 타입에는 남기되 여기서도 읽지 않는다(활성화 금지).
type AskGeminiOptions = {
  personalityOverride?: string;
  systemPromptOverride?: string;
  shortQuestionMode?: boolean;
  includeMemory?: boolean;
  includeDateTime?: boolean;
  maxHistoryTurns?: number;
  historyCharBudget?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
  retryOnTimeout?: boolean;
};

type AskGeminiTurn = { question: string; answer: string };
type AskGeminiDeps = {
  generateContent: (body: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown>;
  getLanguage: () => string;
  instructionsBlock: (options: { includeDateTime: boolean }) => string;
  historyBlock: (options: { maxTurns?: number; totalBudget?: number }) => string;
  episodeBlock: () => string;
  memoryBlock: (question: string) => string;
  oneOffBlock: (extraTurns: AskGeminiTurn[]) => string;
};

function createAskGemini(deps: AskGeminiDeps) {
  async function askGemini(
    question: string,
    extraTurns: AskGeminiTurn[] = [],
    options: AskGeminiOptions = {}
  ): Promise<string> {
    const shortQuestionMode = options.shortQuestionMode === true || (
      options.shortQuestionMode !== false && isShortAssistantQuestion(question, extraTurns)
    );
    const history = options.includeMemory === false
      ? ""
      : deps.historyBlock({
        maxTurns: options.maxHistoryTurns,
        totalBudget: options.historyCharBudget
      });
    const episodeSummary = options.includeMemory === false ? "" : deps.episodeBlock();
    const memoryBlock = options.includeMemory === false ? "" : deps.memoryBlock(question);
    const language = deps.getLanguage();
    const prompt = `${deps.instructionsBlock({ includeDateTime: !shortQuestionMode })}${episodeSummary}${memoryBlock}${history}${deps.oneOffBlock(extraTurns)}\n\n${t(language, "assistant.languageReminder")}\n${t(language, "assistant.questionLabel")}: ${question}`;
    try {
      const data = await deps.generateContent(
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: Math.max(
              128,
              Number(options.maxOutputTokens) || (
                shortQuestionMode
                  ? ASSISTANT_SHORT_MAX_OUTPUT_TOKENS
                  : ASSISTANT_DEFAULT_MAX_OUTPUT_TOKENS
              )
            ),
            // languageDirective가 프롬프트 앞부분에 있는데, minimal 사고 수준에서는 모델이
            // 그 지시를 놓치고 기본 언어(한국어)로 답하는 사례가 보고됐다 — 다이어그램 생략과
            // 같은 이유(document-summary.ts 참고)로 여기도 한 단계 올린다.
            thinkingConfig: { thinkingLevel: "low" }
          },
          safetySettings: ASSISTANT_SAFETY_SETTINGS
        },
        { timeoutMs: Number(options.timeoutMs) || ASSISTANT_PRIMARY_TIMEOUT_MS }
      );
      return extractResponseText(data);
    } catch (error) {
      if ((error as { code?: string } | null | undefined)?.code === "REQUEST_TIMEOUT" && options.retryOnTimeout !== false) {
        return askGemini(question, extraTurns, {
          ...options,
          includeMemory: false,
          shortQuestionMode: true,
          maxHistoryTurns: 1,
          historyCharBudget: 400,
          maxOutputTokens: Math.min(
            Math.max(128, Number(options.maxOutputTokens) || ASSISTANT_SHORT_MAX_OUTPUT_TOKENS),
            256
          ),
          timeoutMs: ASSISTANT_RETRY_TIMEOUT_MS,
          retryOnTimeout: false
        });
      }
      throw error;
    }
  }

  return askGemini;
}

export { createAskGemini };
export type { AskGeminiOptions, AskGeminiDeps };
