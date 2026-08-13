// @ts-check
// AI 프롬프트 코어를 main.js에서 분리해도 기존 문자열 구성과 경계 조건이 바뀌지 않는지 고정한다.
const test = require("node:test");
const assert = require("node:assert/strict");

const { t } = require("../src/shared/i18n.js");
const {
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
} = require("../src/main/assistant/assistant-core.js");

function assistantSettings() {
  return {
    language: "ko",
    assistantPersonality: "friend",
    assistantCustomPersonality: "",
    assistantMemoryEnabled: true,
    assistantUserNickname: "냐비",
    assistantPetNickname: "당고",
    assistantMemoryTurns: 10
  };
}

test("지시문은 호출 시 받은 설정과 날짜·시각 문맥을 사용한다", () => {
  const settings = {
    ...assistantSettings(),
    assistantPersonality: "custom",
    assistantCustomPersonality: "  차분하게\n  설명해줘  "
  };
  const instructions = buildAssistantInstructions(settings, "고정된 날짜·시각", { includeDateTime: true });

  assert.ok(instructions.includes("사용자가 지정한 성격 지시: 차분하게 설명해줘"));
  assert.ok(instructions.includes('사용자를 "냐비"라고 부르며'));
  assert.ok(instructions.includes('"당고"이라는 이름을 사용하세요'));
  assert.ok(instructions.includes("고정된 날짜·시각"));
  assert.ok(instructions.includes(t("ko", "assistant.memoryNote")));

  const withoutDateTime = buildAssistantInstructions(settings, "들어가면 안 되는 날짜", { includeDateTime: false });
  assert.ok(!withoutDateTime.includes("들어가면 안 되는 날짜"));
  assert.ok(withoutDateTime.includes(t("ko", "assistant.memoryNote")));
});

test("기억용 질문과 답변은 공백을 합치고 기존 길이로 자른다", () => {
  assert.equal(compactAssistantMemoryText("  첫째\n 둘째  ", 20), "첫째 둘째");
  assert.equal(compactAssistantMemoryText(null, 20), "");
  assert.equal(rememberedAssistantQuestion("가".repeat(200)).length, 180);
  assert.equal(rememberedAssistantAnswer("나".repeat(400)).length, 320);
});

test("짧은 질문의 24자 경계와 추가 대화 조건을 유지한다", () => {
  assert.equal(isShortAssistantQuestion("가".repeat(24)), true);
  assert.equal(isShortAssistantQuestion("가".repeat(25)), false);
  assert.equal(isShortAssistantQuestion(""), false);
  assert.equal(isShortAssistantQuestion("짧은 질문", [{ question: "앞 질문", answer: "앞 답변" }]), false);
});

test("여러 줄 질문도 공백 정규화 뒤 짧은 질문으로 판정하는 현행 동작을 유지한다", () => {
  assert.equal(isShortAssistantQuestion("첫 줄\n둘째 줄"), true);
});

test("히스토리 예산을 넘더라도 최신 첫 턴은 넣고 그보다 오래된 턴은 중단한다", () => {
  const history = [
    { question: "오래된 질문", answer: "오래된 답변" },
    { question: `최신-${"가".repeat(180)}`, answer: `답-${"나".repeat(320)}` }
  ];
  const block = buildAssistantHistoryBlock(assistantSettings(), history, { totalBudget: 400 });

  assert.ok(block.includes("최신-"));
  assert.ok(!block.includes("오래된 질문"));
  assert.ok(block.length > 400, "첫 최신 턴 자체가 예산보다 길어도 빠지면 안 된다");
});

test("히스토리는 설정이 꺼졌거나 비어 있으면 붙이지 않는다", () => {
  const disabled = { ...assistantSettings(), assistantMemoryEnabled: false };
  assert.equal(buildAssistantHistoryBlock(disabled, [{ question: "질문", answer: "답" }]), "");
  assert.equal(buildAssistantHistoryBlock(assistantSettings(), []), "");
});

test("에피소드 블록은 이름과 달리 배열 앞의 세 건을 쓰고 options를 무시한다", () => {
  const episodes = [
    { date: "2026-08-01", summary: "첫 번째" },
    { date: "2026-08-02", summary: "두 번째" },
    { date: "2026-08-03", summary: "세 번째" },
    { date: "2026-08-04", summary: "네 번째" }
  ];
  const block = buildRecentEpisodeSummaryBlock(
    assistantSettings(),
    episodes,
    { maxEpisodes: 1 }
  );

  assert.ok(block.includes("첫 번째"));
  assert.ok(block.includes("두 번째"));
  assert.ok(block.includes("세 번째"));
  assert.ok(!block.includes("네 번째"));
});

test("표정 태그는 응답 맨 끝에 있는 알려진 값만 제거한다", () => {
  assert.deepEqual(
    extractAssistantExpression("좋아!\n[expression: HAPPY]  "),
    { text: "좋아!", expression: "happy" }
  );
  assert.deepEqual(
    extractAssistantExpression("[expression: sad]\n아직 본문이 남음"),
    { text: "[expression: sad]\n아직 본문이 남음", expression: "normal" }
  );
  assert.deepEqual(
    extractAssistantExpression("알 수 없음\n[expression: excited]"),
    { text: "알 수 없음\n[expression: excited]", expression: "normal" }
  );
});

test("일회성 대화 블록은 실행 시 받은 언어와 대화를 사용한다", () => {
  assert.equal(buildOneOffHistoryBlock("ko", []), "");
  const block = buildOneOffHistoryBlock("en", [{ question: "Question", answer: "Answer" }]);
  assert.ok(block.includes(t("en", "assistant.oneOffHistoryHeader")));
  assert.ok(block.includes("Question"));
  assert.ok(block.includes("Answer"));
});

test("에피소드 응답 파서는 전달받은 날짜와 messageCount를 그대로 기록한다", () => {
  const parsed = parseEpisodeSummaryResponse(
    "Summary: 커피: 취향 대화\nTopics: 커피, 라떼, 취향, 습관, 아침, 여섯째\nImportance: 1.7",
    new Date("2026-08-10T13:00:00.000Z"),
    7
  );

  assert.deepEqual(parsed, {
    summary: "커피: 취향 대화",
    keyTopics: ["커피", "라떼", "취향", "습관", "아침"],
    importance: 1,
    date: "2026-08-10",
    messageCount: 7
  });
});

test("에피소드 응답 파서는 한국어 필드와 중요도 하한을 읽고 요약이 없으면 null이다", () => {
  const parsed = parseEpisodeSummaryResponse(
    "요약: 하루 정리\n주제: 일상\n중요도: -2",
    new Date("2026-08-11T00:00:00.000Z"),
    2
  );
  assert.equal(parsed?.importance, 0);
  assert.equal(parsed?.date, "2026-08-11");
  assert.equal(parsed?.messageCount, 2);
  assert.equal(parseEpisodeSummaryResponse("Topics: 주제만", new Date(), 1), null);
});

test("오류 문구 추출과 사용자용 오류 분류를 기존 규칙대로 유지한다", () => {
  assert.equal(errorMessage(new Error("원인")), "원인");
  assert.equal(errorMessage("문자열 오류"), "");
  assert.equal(mapAssistantErrorMessage(new Error("401 authentication"), "ko"), t("ko", "assistant.apiKeyError"));
  assert.equal(mapAssistantErrorMessage(new Error("429 quota"), "en"), t("en", "assistant.quotaError"));
  assert.equal(mapAssistantErrorMessage(new Error("network ECONNRESET"), "ja"), t("ja", "assistant.networkError"));
  assert.equal(mapAssistantErrorMessage("network", "ko"), t("ko", "assistant.unknownError"));
  assert.equal(mapAssistantErrorMessage(new Error("가".repeat(300)), "ko").length, 240);
});
