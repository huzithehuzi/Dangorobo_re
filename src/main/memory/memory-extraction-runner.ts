// 대화 배치에서 장기 기억·미완료 주제를 추출해 저장하는 러너.
// LLM 호출(ask)과 DB 접근은 콜백으로 주입받는다 — main.js의 재할당 가능한 상태를
// 여기서 붙잡지 않기 위해서다. 프롬프트 생성과 파싱은 순수 함수라 직접 require한다.

import {
  buildExtractionPrompt,
  parseExtractionResponse,
  validateExtractedMemory,
  detectCompletionSignals,
  buildOpenLoopsDetectionPrompt,
  parseOpenLoopsResponse,
  buildLoopResolutionPrompt,
  parseLoopResolutionResponse,
  EXISTING_MEMORIES_PROMPT_LIMIT
} from "./memory-extraction.js";
import type { OpenLoop, StoredMemory } from "./memory-extraction.js";
import type { ConversationTurn } from "./memory-persistence.js";
const { t } = require("../../shared/i18n.js");

type ExtractionAskOptions = {
  shortQuestionMode: boolean;
  maxHistoryTurns: number;
  includeMemory: boolean;
  maxOutputTokens: number;
  timeoutMs: number;
  retryOnTimeout: boolean;
};

type InsertableMemory = {
  category: string;
  memory_key: string;
  memory_label: string;
  memory_value: string;
  importance?: unknown;
};

type MemoryExtractionRunnerDeps = {
  ask: (
    userPrompt: string,
    options: ExtractionAskOptions
  ) => Promise<string | null | undefined>;
  getAllMemories: (limit: number) => StoredMemory[];
  insertMemory: (memory: InsertableMemory) => unknown;
  getOpenLoops: () => OpenLoop[];
  closeOpenLoop: (id: number, resolutionNote: string) => unknown;
  insertEpisode: (episodeData: { summary: string; keyTopics: string[] }) => number | null;
  insertOpenLoop: (loopData: { episode_id: number; topic: string }) => unknown;
};

function createMemoryExtractionRunner(deps: MemoryExtractionRunnerDeps) {
  return async function triggerMemoryExtraction(
    conversationHistory: ConversationTurn[],
    language = "en"
  ) {
    if (!conversationHistory || conversationHistory.length === 0) return;

    try {
      const existingMemories = deps.getAllMemories(EXISTING_MEMORIES_PROMPT_LIMIT);
      const extractionPrompt = buildExtractionPrompt(conversationHistory, language, existingMemories);

      const extractionResponse = await deps.ask(extractionPrompt.userPrompt, {
        shortQuestionMode: true,
        maxHistoryTurns: 0,
        includeMemory: false,
        maxOutputTokens: extractionPrompt.maxTokens,
        timeoutMs: 5000,
        retryOnTimeout: false
      });

      if (extractionResponse) {
        const extracted = parseExtractionResponse(extractionResponse);

        extracted.forEach((candidate: unknown) => {
          const validation = validateExtractedMemory(candidate);
          if (validation.valid && validation.normalized) {
            deps.insertMemory(validation.normalized);
          }
        });
      }

      const latestResponse = conversationHistory[conversationHistory.length - 1]?.answer;
      const hasCompletionSignal = latestResponse ? detectCompletionSignals(latestResponse) : false;

      if (hasCompletionSignal) {
        // 완료 신호가 있으면 새 주제를 만들기보다, 이미 열려있는 주제 중
        // 이번 대화로 해결된 게 있는지 LLM에게 물어보고 자동으로 닫는다.
        const openLoopsToResolve = deps.getOpenLoops();
        if (openLoopsToResolve.length > 0) {
          const resolutionPrompt = buildLoopResolutionPrompt(
            conversationHistory,
            openLoopsToResolve,
            language
          );
          const resolutionResponse = await deps.ask(resolutionPrompt.userPrompt, {
            shortQuestionMode: true,
            maxHistoryTurns: 0,
            includeMemory: false,
            maxOutputTokens: resolutionPrompt.maxTokens,
            timeoutMs: 5000,
            retryOnTimeout: false
          });

          if (resolutionResponse) {
            const resolvedIds = parseLoopResolutionResponse(resolutionResponse, openLoopsToResolve);
            resolvedIds.forEach((id: number) => {
              deps.closeOpenLoop(id, t(language, "memory.openLoopAutoResolvedNote"));
            });
          }
        }
      } else {
        const existingOpenLoops = deps.getOpenLoops();
        const loopsPrompt = buildOpenLoopsDetectionPrompt(
          conversationHistory,
          language,
          existingOpenLoops
        );
        const loopsResponse = await deps.ask(loopsPrompt.userPrompt, {
          shortQuestionMode: true,
          maxHistoryTurns: 0,
          includeMemory: false,
          maxOutputTokens: loopsPrompt.maxTokens,
          timeoutMs: 5000,
          retryOnTimeout: false
        });

        if (loopsResponse) {
          const openLoops = parseOpenLoopsResponse(loopsResponse);
          const episodeData = {
            summary: t(language, "memory.episodeBatchSummary", {
              when: new Date().toLocaleString(),
              turns: conversationHistory.length
            }),
            keyTopics: openLoops.map((loop: { topic: string }) => loop.topic)
          };
          const episodeId = deps.insertEpisode(episodeData);

          if (episodeId !== null) {
            openLoops.forEach((loop: { topic: string }) => {
              deps.insertOpenLoop({
                episode_id: episodeId,
                topic: loop.topic
              });
            });
          }
        }
      }
    } catch (error) {
      console.error("[Memory] Extraction trigger failed:", error);
      // 기억 추출 실패가 사용자 대화를 막아서는 안 된다.
    }
  };
}

export { createMemoryExtractionRunner };
export type { ExtractionAskOptions, MemoryExtractionRunnerDeps };
