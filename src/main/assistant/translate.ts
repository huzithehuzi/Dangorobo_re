// 클립보드 번역의 Gemini 호출. 번역은 펫 성격·표정 태그가 붙은 assistantInstructions()를
// 쓰면 안 된다(번역문만 깔끔하게 나와야 하므로) — 모델·API 키만 공유하고 프롬프트는 따로
// 만든다. safetySettings BLOCK_NONE 4종과 promptFeedback.blockReason 검사는 세 Gemini 경로
// 중 번역에만 있는 의도된 비대칭이다(외국어 원문이 안전 필터에 자주 걸려서).

const { t } = require("../../shared/i18n.js");
import { TRANSLATE_LANGUAGES } from "../settings-schema.js";
import {
  extractPromptBlockReason,
  extractResponseText
} from "./gemini-transport.js";

type TranslateDeps = {
  generateContent: (body: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown>;
  getLanguage: () => string;
};

function createTranslateWithGemini(deps: TranslateDeps) {
  return async function translateWithGemini(text: string, targetLanguage: string): Promise<string> {
    const lang = deps.getLanguage();
    const languageName = (TRANSLATE_LANGUAGES as Record<string, string>)[targetLanguage] || TRANSLATE_LANGUAGES.en;
    const prompt = [
      t(lang, "translate.promptInstruction", { languageName }),
      t(lang, "translate.promptNoExtra"),
      t(lang, "translate.promptKeepStructure"),
      t(lang, "translate.promptKeepAlreadyTranslated"),
      "",
      "---",
      text
    ].join("\n");

    const data = await deps.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingLevel: "minimal" }
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    });
    const blockReason = extractPromptBlockReason(data);
    if (blockReason) {
      throw new Error(t(deps.getLanguage(), "translate.blockedError", { reason: blockReason }));
    }
    return extractResponseText(data);
  };
}

export { createTranslateWithGemini };
