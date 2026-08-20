// 펫이 먼저 말을 거는 기능(자동 주기·부르기 버튼·쓰다듬기 반응)의 상태와 파이프라인.
// LLM 호출(ask)과 main의 재할당 가능한 상태(설정·패널 상태·API 키)는 콜백으로 주입받고,
// 세션 상태(최근 오프너·화제·답장)는 이 모듈이 소유한다. 타이머와 난수는 테스트를 위해
// 주입 가능하지만 기본값은 전역 그대로다.

const { t } = require("../../shared/i18n.js");
import { extractAssistantExpression } from "./assistant-core.js";

// 오프너는 "지난 대화를 소재로 삼는" 경로가 있어서 질문 답변보다 이력을 넉넉히 본다 —
// 두 턴만 보면 모델이 참조할 대화가 사실상 직전 한 마디뿐이라 이어가기 화제를 줘도
// 구체적으로 말할 재료가 없다.
const PET_CHAT_HISTORY_TURNS = 6;
const PET_CHAT_HISTORY_CHAR_BUDGET = 1800;
const PET_CHAT_RECENT_OPENERS_MAX = 8;
const PET_CHAT_RECENT_OPENER_MAX_CHARS = 240;
const PET_CHAT_RECENT_TOPIC_KEYS_MAX = 3;

// 매번 같은(시간대 언급) 화제로 흐르는 걸 막기 위해, 어떤 화제로 말을 걸지 코드에서 직접 무작위로 골라 지정한다.
const PET_CHAT_TOPIC_HINT_KEYS = [
  "petChat.hint.joke",
  "petChat.hint.hobby",
  "petChat.hint.checkIn",
  "petChat.hint.randomThought",
  "petChat.hint.smallStory",
  "petChat.hint.encourage",
  "petChat.hint.thisOrThat",
  "petChat.hint.imagination",
  "petChat.hint.discovery",
  "petChat.hint.miniGame",
  "petChat.hint.recommendation",
  "petChat.hint.curiosity"
];

// 여태 나눈 대화·기억을 소재로 삼는 화제. 위 랜덤 목록은 개수가 정해져 있어서 몇 번
// 돌면 "아까 한 말을 또 한다"는 느낌이 나는데, 이쪽은 소재가 사용자와의 실제 이력이라
// 쓸수록 늘어난다. 그래서 재료가 하나라도 있으면 이쪽을 먼저 높은 확률로 고른다
// (2026-08-14 사용자 피드백. 그전에는 이어가기가 13개 중 하나라 약 8%였다).
// 항목마다 재료가 따로라 available()로 있는 것만 후보에 넣는다 — 없는 걸 소재로 주면
// 모델이 지난 대화를 지어낸다.
const PET_CHAT_CONTINUITY_CHANCE = 0.6;
const PET_CHAT_CONTINUITY_HINTS: Array<{ key: string; available: (deps: PetChatServiceDeps) => boolean }> = [
  { key: "petChat.hint.continueTopic", available: (deps) => deps.hasConversationHistory() },
  { key: "petChat.hint.pastEpisode", available: (deps) => deps.hasConversationHistory() },
  { key: "petChat.hint.rememberedDetail", available: (deps) => deps.hasLongTermMemory() },
  { key: "petChat.hint.openLoopFollowUp", available: (deps) => deps.hasOpenLoops() }
];

type PetChatSettings = {
  language: string;
  petChatEnabled: boolean;
  pettingChatEnabled: boolean;
  assistantEnabled: boolean;
  petChatMinMinutes: number;
  petChatMaxMinutes: number;
};

type PetChatAskOptions = {
  maxHistoryTurns: number;
  historyCharBudget: number;
  maxOutputTokens: number;
};

type PetChatServiceDeps = {
  ask: (prompt: string, options: PetChatAskOptions) => Promise<string | null | undefined>;
  getSettings: () => PetChatSettings;
  hasApiKey: () => boolean;
  isAutoChatBlocked: () => boolean;
  hasConversationHistory: () => boolean;
  hasLongTermMemory: () => boolean;
  hasOpenLoops: () => boolean;
  openPanel: (message: string, expression: string | null) => void;
  logSession: (openingMessage: string, replyText: string, replyAnswer: string) => void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  random?: () => number;
};

type PetChatOpener = { topicKey: string; prompt: string };
type PetChatTopic = { key: string; hint: string; continuity: boolean };

function createPetChatService(deps: PetChatServiceDeps) {
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;
  const random = deps.random || Math.random;

  // 3~20분(설정 가능) 범위 랜덤 주기로 한 번 말을 걸고, 사용자가 답장하거나 닫기 전까지는
  // 다음 주기를 세지 않는다(sessionActive로 그 기간을 표시).
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sessionActive = false;
  let openingMessage: string | null = null;
  let replyText = "";
  let replyAnswer = "";
  let recentOpeners: string[] = [];
  let recentTopicKeys: string[] = [];

  /** 최근에 쓴 화제를 뺀 뒤 하나를 고른다. 전부 최근에 썼으면 목록 전체에서 고른다. */
  function pickUnusedKey(keys: string[]) {
    const unusedKeys = keys.filter((key) => !recentTopicKeys.includes(key));
    const pool = unusedKeys.length ? unusedKeys : keys;
    return pool[Math.floor(random() * pool.length)];
  }

  function pickTopicHint(): PetChatTopic {
    const lang = deps.getSettings().language;
    const continuityKeys = PET_CHAT_CONTINUITY_HINTS
      .filter((hint) => hint.available(deps))
      .map((hint) => hint.key);
    // 재료가 있을 때만 확률을 쓴다 — 첫 실행처럼 이력·기억이 비었으면 랜덤 소재밖에 없다.
    const continuity = continuityKeys.length > 0 && random() < PET_CHAT_CONTINUITY_CHANCE;
    const key = pickUnusedKey(continuity ? continuityKeys : PET_CHAT_TOPIC_HINT_KEYS);
    return { key, hint: t(lang, key), continuity };
  }

  function recentOpenersNote() {
    const lang = deps.getSettings().language;
    return recentOpeners.length > 0
      ? `\n\n${t(lang, "petChat.recentOpenersNote", {
        list: recentOpeners.map((msg, index) => `${index + 1}. ${msg}`).join("\n")
      })}`
      : "";
  }

  function buildOpenerPrompt() {
    const lang = deps.getSettings().language;
    const topic = pickTopicHint();
    // 이어가기 화제에는 다른 지시문을 쓴다. 랜덤 소재용 varietyInstruction은 "최근 문장과
    // 같은 소재를 되풀이하지 말라"고 하는데, 지난 대화를 이어가라는 지시와 정면으로 부딪친다.
    const instructionKey = topic.continuity ? "petChat.continuityInstruction" : "petChat.varietyInstruction";
    return {
      topicKey: topic.key,
      // 펫이 먼저 거는 말에는 "사용자가 방금 쓴 언어"가 없다 — 앱 언어로 못박지 않으면
      // 모델이 이력이나 프롬프트에 섞인 다른 언어를 골라잡는다(2026-08-20 재발 리포트).
      prompt: `${t(lang, "petChat.intro")} ${t(lang, instructionKey)} ${topic.hint}) ${t(lang, "petChat.languageInstruction")}${recentOpenersNote()}`
    };
  }

  // 랜덤 주제 대신 "방금 쓰다듬어졌다"는 상황에 반응하는 오프너. 화제 힌트를 고르지 않고
  // 고정된 인트로만 쓰지만, 최근 오프너 목록은 그대로 공유해 표현이 겹치지 않게 한다.
  function buildPettingOpenerPrompt() {
    const lang = deps.getSettings().language;
    return {
      topicKey: "petChat.pettedTopic",
      prompt: `${t(lang, "petChat.pettedIntro")} ${t(lang, "petChat.varietyInstruction")} ${t(lang, "petChat.languageInstruction")}${recentOpenersNote()}`
    };
  }

  function delayMs() {
    const settings = deps.getSettings();
    const min = Math.min(settings.petChatMinMinutes, settings.petChatMaxMinutes);
    const max = Math.max(settings.petChatMinMinutes, settings.petChatMaxMinutes);
    const minutes = min + random() * (max - min);
    return minutes * 60 * 1000;
  }

  function schedule() {
    clearTimeoutFn(timer);
    const settings = deps.getSettings();
    if (!settings.petChatEnabled || !settings.assistantEnabled || !deps.hasApiKey()) return;
    timer = setTimeoutFn(firePetChat, delayMs());
  }

  // firePetChat()(자동 주기 실행)과 callNow()(사용자가 "부르기" 버튼으로 즉시 실행) 둘 다
  // 이 부분을 공유한다 — Gemini에게 오프너 문장을 받아와 세션 상태를 채우고 렌더러에 열라고
  // 보내는, 성공했을 때의 실제 동작. buildOpener를 바꾸면 같은 파이프라인(말풍선/세션 상태)을
  // 재사용하면서 오프너 문구의 성격만 달리 줄 수 있다.
  async function deliverOpener(buildOpener: () => PetChatOpener = buildOpenerPrompt) {
    const opener = buildOpener();
    const answer = await deps.ask(opener.prompt, {
      maxHistoryTurns: PET_CHAT_HISTORY_TURNS,
      historyCharBudget: PET_CHAT_HISTORY_CHAR_BUDGET,
      maxOutputTokens: 320
    });
    if (!answer) throw new Error(t(deps.getSettings().language, "assistant.emptyAnswerShortError"));
    const { text, expression } = extractAssistantExpression(answer);
    const displayed = text.slice(0, 4000);
    recentOpeners.push(displayed.slice(0, PET_CHAT_RECENT_OPENER_MAX_CHARS));
    recentOpeners = recentOpeners.slice(-PET_CHAT_RECENT_OPENERS_MAX);
    recentTopicKeys.push(opener.topicKey);
    recentTopicKeys = recentTopicKeys.slice(-PET_CHAT_RECENT_TOPIC_KEYS_MAX);
    sessionActive = true;
    openingMessage = displayed;
    replyText = "";
    replyAnswer = "";
    deps.openPanel(displayed, expression);
  }

  async function firePetChat() {
    const settings = deps.getSettings();
    if (!settings.petChatEnabled || !settings.assistantEnabled || !deps.hasApiKey()) return;
    if (sessionActive || deps.isAutoChatBlocked()) {
      // 다른 패널이 열려있거나 이동 모드면 잠시 후 다시 시도한다(주기 자체를 건너뛰지 않는다).
      timer = setTimeoutFn(firePetChat, 60000);
      return;
    }
    try {
      await deliverOpener();
    } catch {
      // 실패하면 조용히 다음 주기만 예약한다(에러 알림 없음).
      schedule();
    }
  }

  // 쓰다듬기 반응 대화: 일정 이상 쓰다듬으면 말을 걸지만, firePetChat과 달리 재시도하지
  // 않는다 — 다른 말풍선/패널이 떠 있는 "idle이 아닌" 상태면 이번 쓰다듬기에서는 그냥
  // 조용히 넘어간다(사용자가 그 이후에도 계속 쓰다듬으면 다음 세션에서 다시 판정됨).
  async function triggerPettingChat() {
    const settings = deps.getSettings();
    if (!settings.pettingChatEnabled || !settings.assistantEnabled || !deps.hasApiKey()) return;
    if (sessionActive || deps.isAutoChatBlocked()) return;
    try {
      await deliverOpener(buildPettingOpenerPrompt);
    } catch {
      // 조용히 무시한다 — 쓰다듬기 반응은 필수 기능이 아니라 재시도/알림이 필요 없다.
    }
  }

  // "부르기" 버튼 경로. 실패하면 예외를 그대로 던지고 타이머는 지운 채로 둔다 —
  // 분리 전 pet-chat:call-now 핸들러와 같은 동작이다(성공했을 때만 다음 주기를 예약).
  async function callNow() {
    clearTimeoutFn(timer);
    await deliverOpener();
    schedule();
  }

  // 세션 종료(패널 닫힘). 상호작용이 끝나는 시점에 딱 한 번만 로그를 남긴다
  // (답장 없이 닫았으면 펫이 건 말만 기록됨).
  function endSession() {
    if (!sessionActive) return;
    sessionActive = false;
    if (openingMessage) deps.logSession(openingMessage, replyText, replyAnswer);
    openingMessage = null;
    replyText = "";
    replyAnswer = "";
    schedule();
  }

  function recordReply(nextReplyText: string, nextReplyAnswer: string) {
    replyText = nextReplyText;
    replyAnswer = nextReplyAnswer;
  }

  function clearTimer() {
    clearTimeoutFn(timer);
  }

  return {
    schedule,
    callNow,
    triggerPettingChat,
    endSession,
    recordReply,
    clearTimer,
    isSessionActive: () => sessionActive,
    getOpeningMessage: () => openingMessage
  };
}

export { createPetChatService };
