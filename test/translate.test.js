const test = require("node:test");
const assert = require("node:assert/strict");

const { createTranslateWithGemini } = require("../src/main/assistant/translate.js");
const { t } = require("../src/shared/i18n.js");

/**
 * @param {{ response?: Record<string, unknown> }} [options]
 */
function createHarness(options = {}) {
  /** @type {Array<{ body: any, options: Record<string, unknown> | undefined }>} */
  const requests = [];
  const translate = createTranslateWithGemini({
    generateContent: async (body, requestOptions) => {
      requests.push({ body, options: requestOptions });
      return options.response || { candidates: [{ content: { parts: [{ text: "번역 결과" }] } }] };
    },
    getLanguage: () => "ko"
  });
  return { translate, requests };
}

test("번역 프롬프트와 요청 본문은 분리 전 모양 그대로다", async () => {
  const { translate, requests } = createHarness();
  const result = await translate("Hello world", "ko");

  assert.equal(result, "번역 결과");
  const body = requests[0].body;
  const expectedPrompt = [
    t("ko", "translate.promptInstruction", { languageName: "한국어" }),
    t("ko", "translate.promptNoExtra"),
    t("ko", "translate.promptKeepStructure"),
    t("ko", "translate.promptKeepAlreadyTranslated"),
    "",
    "---",
    "Hello world"
  ].join("\n");
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: expectedPrompt }] }]);
  // 번역만의 의도된 비대칭: 토큰 4096 + safetySettings 4종 BLOCK_NONE (질문·요약에는 없다)
  assert.deepEqual(body.generationConfig, {
    maxOutputTokens: 4096,
    thinkingConfig: { thinkingLevel: "minimal" }
  });
  assert.deepEqual(body.safetySettings, [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
  ]);
  // 타임아웃 지정 없음 → transport 기본값(45초)에 맡긴다
  assert.equal(requests[0].options, undefined);
});

test("모르는 대상 언어는 영어로 폴백한다", async () => {
  const { translate, requests } = createHarness();
  await translate("Hello", "없는언어");
  const prompt = requests[0].body.contents[0].parts[0].text;
  assert.ok(prompt.includes(t("ko", "translate.promptInstruction", { languageName: "영어(English)" })));
});

test("안전 필터 차단은 blockReason이 담긴 오류로 던진다", async () => {
  const { translate } = createHarness({
    response: { promptFeedback: { blockReason: "SAFETY" }, candidates: [] }
  });
  await assert.rejects(
    translate("텍스트", "en"),
    new RegExp(t("ko", "translate.blockedError", { reason: "SAFETY" }).replace(/[()]/g, "\\$&"))
  );
});
