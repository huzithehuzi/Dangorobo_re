// 종료 직전 에피소드 요약 실행부. before-quit의 preventDefault/재-quit 같은 앱 생명주기
// 제어는 main.js에 남기고, "요약을 받아 저장하되 어떤 실패로도 종료를 막지 않는다"는
// 실행 계약만 여기서 소유한다. LLM 호출·파싱·저장은 콜백 주입.

// askGemini 자체 timeout(5초)이 있지만, 혹시 그 경로에 버그가 있어도 앱이
// 영원히 안 꺼지는 일은 없도록 8초 상한을 한 번 더 건다.
const QUIT_SUMMARY_DEADLINE_MS = 8000;

type EpisodeSummaryAskOptions = {
  shortQuestionMode: boolean;
  maxHistoryTurns: number;
  includeMemory: boolean;
  maxOutputTokens: number;
  timeoutMs: number;
  retryOnTimeout: boolean;
};

type EpisodeSummaryRunnerDependencies<TEpisode> = {
  ask: (userPrompt: string, options: EpisodeSummaryAskOptions) => Promise<string | null | undefined>;
  parseSummary: (responseText: string) => TEpisode | null | undefined;
  appendEpisode: (episodeData: TEpisode) => unknown;
  setTimeoutFn?: typeof setTimeout;
};

type EpisodeSummaryPrompt = { userPrompt: string; maxTokens: number };

function createEpisodeSummaryRunner<TEpisode>(deps: EpisodeSummaryRunnerDependencies<TEpisode>) {
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;

  /**
   * 항상 resolve한다(reject 없음) — 호출자는 결과와 무관하게 종료를 이어가면 된다.
   */
  return async function runQuitEpisodeSummary(summaryPrompt: EpisodeSummaryPrompt) {
    try {
      await Promise.race([
        (async () => {
          const summaryResponse = await deps.ask(summaryPrompt.userPrompt, {
            shortQuestionMode: true,
            maxHistoryTurns: 0,
            includeMemory: false,
            maxOutputTokens: summaryPrompt.maxTokens,
            timeoutMs: 5000,
            retryOnTimeout: false
          });
          if (summaryResponse && summaryResponse.trim()) {
            const episodeData = deps.parseSummary(summaryResponse);
            if (episodeData) {
              deps.appendEpisode(episodeData);
            }
          }
        })(),
        new Promise<void>((resolve) => setTimeoutFn(resolve, QUIT_SUMMARY_DEADLINE_MS))
      ]);
    } catch (error) {
      console.error("[Memory] Failed to generate session summary:", error);
    }
  };
}

export { createEpisodeSummaryRunner };
