// Gemini HTTP 전송 계층. 타임아웃 있는 JSON fetch와 generateContent 요청 조립만 담당한다.
// generationConfig·safetySettings는 호출자가 그대로 넘긴다 — 질문/번역/문서 요약 세 경로의
// thinkingLevel·safetySettings·blockReason 처리 비대칭은 의도된 것이라 여기서 흡수하지 않는다.
// 모델·API 키·언어는 main의 재할당 가능한 상태라 게터로 주입받는다.

const { t } = require("../../shared/i18n.js");

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Gemini 응답에서 표시할 텍스트만 뽑는다(thinking 파트 제외).
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseParts(data: unknown): Array<Record<string, unknown>> {
  if (!isObjectRecord(data) || !Array.isArray(data.candidates)) return [];
  return data.candidates.flatMap(candidate => {
    if (!isObjectRecord(candidate) || !isObjectRecord(candidate.content)) return [];
    return Array.isArray(candidate.content.parts)
      ? candidate.content.parts.filter(isObjectRecord)
      : [];
  });
}

function extractResponseText(data: unknown) {
  return responseParts(data)
    .filter(part => part.thought !== true)
    .map(part => typeof part.text === "string" ? part.text : "")
    .join("\n")
    .trim();
}

function extractPromptBlockReason(data: unknown): string {
  if (!isObjectRecord(data) || !isObjectRecord(data.promptFeedback)) return "";
  return typeof data.promptFeedback.blockReason === "string"
    ? data.promptFeedback.blockReason
    : "";
}

function extractErrorMessage(data: unknown): string {
  if (!isObjectRecord(data) || !isObjectRecord(data.error)) return "";
  return typeof data.error.message === "string" ? data.error.message : "";
}

type GeminiTransportDeps = {
  getLanguage: () => string;
  getModel: () => string;
  getApiKey: () => string;
  fetchImpl?: typeof fetch;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

function createGeminiTransport(deps: GeminiTransportDeps) {
  const fetchImpl = deps.fetchImpl || fetch;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;

  /**
   * fetch 옵션에 timeoutMs를 얹어 받는다 — 아래에서 떼어 내고 나머지만 fetch에 넘긴다.
   */
  async function fetchJson(url: string, options?: RequestInit & { timeoutMs?: number }) {
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Number(options?.timeoutMs) || 45000);
    const timeout = setTimeoutFn(() => controller.abort(), timeoutMs);
    try {
      const { timeoutMs: _timeoutMs, ...fetchOptions } = options || {};
      const response = await fetchImpl(url, { ...fetchOptions, signal: controller.signal });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = extractErrorMessage(data)
          || t(deps.getLanguage(), "assistant.requestFailedError", { status: response.status });
        throw new Error(message);
      }
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // 호출부(askGemini)가 재시도 여부를 가리려고 code로 이 타임아웃을 식별한다.
        const timeoutError = new Error(
          t(deps.getLanguage(), "assistant.requestTimedOutError")
        ) as Error & { code?: string };
        timeoutError.code = "REQUEST_TIMEOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeoutFn(timeout);
    }
  }

  /**
   * generateContent 요청. body는 호출자가 만든 모양 그대로 직렬화한다.
   */
  function generateContent(
    body: Record<string, unknown>,
    options: { timeoutMs?: number } = {}
  ) {
    const model = encodeURIComponent(deps.getModel());
    return fetchJson(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": deps.getApiKey(),
        "Content-Type": "application/json"
      },
      timeoutMs: options.timeoutMs,
      body: JSON.stringify(body)
    });
  }

  return { fetchJson, generateContent };
}

export { createGeminiTransport, extractPromptBlockReason, extractResponseText };
export type { GeminiTransportDeps };
