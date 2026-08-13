// AI 대화가 남기는 세 가지 기록의 소유자 — 화면 로그, 대화 이력, 에피소드 요약.
//
// 셋을 한 모듈에 두는 이유는 수명주기가 같기 때문이다. 기억을 끄면 이력과 에피소드가 함께
// 비고, 턴 상한이 바뀌면 이력을 함께 자른다. 반면 화면 로그는 기억 설정과 무관하게 남는다 —
// 그 차이가 이 모듈 안에서만 갈리도록 모아 두었다.
//
// 디스크 형식과 경로는 `assistant-logs.ts`·`memory-persistence.ts`가 갖고, 여기서는
// "지금 무엇을 들고 있고 언제 쓰는가"만 맡는다.

import {
  loadAssistantLogs,
  saveAssistantLogs
} from "./assistant-logs.js";
import type { AssistantLogEntry } from "./assistant-logs.js";
import {
  loadConversationHistoryFromDisk,
  loadEpisodeSummariesFromDisk,
  saveConversationHistoryToDisk
} from "../memory/memory-persistence.js";
import type { ConversationTurn, EpisodeSummary } from "../memory/memory-persistence.js";

/** 화면 로그는 이 개수만 남긴다. 오래된 것부터 잘린다. */
const ASSISTANT_LOG_LIMIT = 300;

// 마지막 추출 이후 이 턴 수마다 장기 기억 추출을 돌린다. 이력 배열 길이로 재면
// assistantMemoryTurns 상한에 걸려 3의 배수가 아닌 값에 멈춰 영영 안 돈다.
const MEMORY_EXTRACTION_TURN_INTERVAL = 3;

type AssistantHistoryDependencies = {
  /** 새 로그가 붙으면 기록 창에 알린다(창이 없으면 아무 일도 하지 않는다). */
  onLogAdded: (entry: AssistantLogEntry) => void;
};

function createAssistantHistory(deps: AssistantHistoryDependencies) {
  let logs: AssistantLogEntry[] = [];
  let conversationHistory: ConversationTurn[] = [];
  let episodeSummaries: EpisodeSummary[] = [];
  let turnsSinceLastExtraction = 0;

  function loadLogs() {
    logs = loadAssistantLogs();
  }

  /** 기억 기능이 켜져 있을 때만 부른다 — 꺼져 있으면 디스크를 읽지 않는다. */
  function loadMemory() {
    conversationHistory = loadConversationHistoryFromDisk();
    episodeSummaries = loadEpisodeSummariesFromDisk();
  }

  /** 질문 로그와 펫 대화 로그가 공유하는 경로. 상한을 넘기면 오래된 것부터 자른다. */
  function appendLog(entry: AssistantLogEntry) {
    logs.push(entry);
    logs = logs.slice(-ASSISTANT_LOG_LIMIT);
    saveAssistantLogs(logs);
    deps.onLogAdded(entry);
  }

  function pushTurn(turn: ConversationTurn, maxTurns: number) {
    conversationHistory.push(turn);
    conversationHistory = conversationHistory.slice(-maxTurns);
  }

  /**
   * 추출 카운터를 올리고 이번 턴에 추출해야 하는지 알려준다.
   * 세는 쪽과 돌리는 쪽을 갈라 두어야 "돌릴 조건"을 테스트할 수 있다.
   */
  function countTurnForExtraction(): boolean {
    turnsSinceLastExtraction += 1;
    if (turnsSinceLastExtraction < MEMORY_EXTRACTION_TURN_INTERVAL) return false;
    turnsSinceLastExtraction = 0;
    return true;
  }

  /** 기억을 끄면 이력과 에피소드를 함께 비운다(로그는 남는다). */
  function clearMemory() {
    conversationHistory = [];
    episodeSummaries = [];
  }

  /** 턴 상한이 줄어든 설정을 저장했을 때 이력도 맞춰 자른다. */
  function trimHistory(maxTurns: number) {
    conversationHistory = conversationHistory.slice(-maxTurns);
  }

  /** 종료 시 이력을 디스크에 남긴다. 비어 있으면 쓰지 않는다. */
  function saveHistory(maxTurns: number) {
    if (conversationHistory.length === 0) return;
    saveConversationHistoryToDisk(conversationHistory, maxTurns);
  }

  return {
    loadLogs, loadMemory, appendLog, pushTurn, countTurnForExtraction,
    clearMemory, trimHistory, saveHistory,
    getLogs: () => logs,
    setLogs: (next: AssistantLogEntry[]) => { logs = next; },
    saveLogs: () => saveAssistantLogs(logs),
    getHistory: () => conversationHistory,
    getEpisodeSummaries: () => episodeSummaries
  };
}

export { createAssistantHistory, ASSISTANT_LOG_LIMIT, MEMORY_EXTRACTION_TURN_INTERVAL };
export type { AssistantHistoryDependencies };
