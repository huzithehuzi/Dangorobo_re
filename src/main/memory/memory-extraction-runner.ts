// 대화 배치에서 장기 기억·미완료 주제를 추출해 저장하는 러너.
// LLM 호출(ask)과 DB 접근은 콜백으로 주입받는다 — main.js의 재할당 가능한 상태를
// 여기서 붙잡지 않기 위해서다. 프롬프트 생성과 파싱은 순수 함수라 직접 require한다.

import {
  buildExtractionPrompt,
  parseExtractionResponse,
  validateExtractedMemory,
  detectCompletionSignals,
  detectForgetSignals,
  buildForgetPrompt,
  parseForgetResponse,
  buildOpenLoopsDetectionPrompt,
  parseOpenLoopsResponse,
  buildLoopResolutionPrompt,
  parseLoopResolutionResponse,
  EXISTING_MEMORIES_PROMPT_LIMIT
} from "./memory-extraction.js";
import type { ForgettableMemory, OpenLoop, StoredMemory } from "./memory-extraction.js";
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
  // 잊기는 소프트 삭제·주제 닫기와 다른 함수다 — "되살리지 말라" 표시를 함께 세운다.
  getForgettableMemories: (limit: number) => ForgettableMemory[];
  forgetMemory: (id: number) => unknown;
  forgetOpenLoop: (id: number, resolutionNote: string) => unknown;
  insertEpisode: (episodeData: { summary: string; keyTopics: string[] }) => number | null;
  insertOpenLoop: (loopData: { episode_id: number; topic: string }) => unknown;
};

// 잊기 판정에 보여줄 후보 수. 기억 추출 프롬프트와 달리 사용자가 지목할 수 있는 범위를
// 넓게 두되, 목록이 길어질수록 모델이 엉뚱한 항목을 고를 여지도 커진다.
const FORGET_CANDIDATE_LIMIT = 40;

function createMemoryExtractionRunner(deps: MemoryExtractionRunnerDeps) {
  /**
   * 사용자가 잊어달라고 한 항목을 LLM에게 지목받아 지운다. 로컬 키워드 검사를 통과한
   * 대화에서만 부르므로 평소에는 추가 호출이 없다.
   */
  async function runForgetPass(conversationHistory: ConversationTurn[], language: string) {
    const memories = deps.getForgettableMemories(FORGET_CANDIDATE_LIMIT);
    const openLoops = deps.getOpenLoops();
    if (memories.length === 0 && openLoops.length === 0) return;

    const forgetPrompt = buildForgetPrompt(conversationHistory, memories, openLoops, language);
    const forgetResponse = await deps.ask(forgetPrompt.userPrompt, {
      shortQuestionMode: true,
      maxHistoryTurns: 0,
      includeMemory: false,
      maxOutputTokens: forgetPrompt.maxTokens,
      timeoutMs: 5000,
      retryOnTimeout: false
    });
    if (!forgetResponse) return;

    const { memoryIds, loopIds } = parseForgetResponse(forgetResponse, memories, openLoops);
    const note = t(language, "memory.forgottenNote");
    memoryIds.forEach((id) => deps.forgetMemory(id));
    loopIds.forEach((id) => deps.forgetOpenLoop(id, note));
    if (memoryIds.length + loopIds.length > 0) {
      console.log(
        `[Memory] 사용자 요청으로 기억 ${memoryIds.length}개, 미완료 주제 ${loopIds.length}개를 잊었다.`
      );
    }
  }

  return async function triggerMemoryExtraction(
    conversationHistory: ConversationTurn[],
    language = "en"
  ) {
    if (!conversationHistory || conversationHistory.length === 0) return;

    try {
      // 잊어달라는 요청이 있으면 이 배치에서는 잊기만 한다. 같은 대화에서 기억·주제를
      // 새로 추출하면 방금 잊은 것을 다른 표현으로 되만드는 경로가 생긴다 — 표시로 막히는
      // 것은 "같은 뜻으로 판정된" 행뿐이고, 추출 LLM이 키를 다르게 잡으면 새 행이 된다.
      // 완료 신호보다 먼저 본다: "그거 끝났으니 잊어줘"는 닫기가 아니라 잊기 요청이다.
      const latestQuestion = conversationHistory[conversationHistory.length - 1]?.question;
      if (latestQuestion && detectForgetSignals(latestQuestion)) {
        await runForgetPass(conversationHistory, language);
        return;
      }

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
