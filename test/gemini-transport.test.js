const test = require("node:test");
const assert = require("node:assert/strict");

const { createGeminiTransport, extractResponseText } = require("../src/main/assistant/gemini-transport.js");
const { t } = require("../src/shared/i18n.js");

/**
 * @param {{
 *   response?: { ok: boolean, status?: number, json?: unknown, jsonThrows?: boolean },
 *   fetchImpl?: typeof fetch,
 *   abortImmediately?: boolean
 * }} [options]
 */
function createHarness(options = {}) {
  const calls = {
    /** @type {Array<{ url: string, init: Record<string, any> }>} */
    fetch: [],
    /** @type {number[]} */
    timeoutDelays: [],
    cleared: 0
  };
  const transport = createGeminiTransport({
    getLanguage: () => "ko",
    getModel: () => "gemini-test-model",
    getApiKey: () => "키-123",
    fetchImpl: options.fetchImpl || (/** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
      calls.fetch.push({ url, init });
      const response = options.response || { ok: true, json: { done: true } };
      return {
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 500),
        json: async () => {
          if (response.jsonThrows) throw new Error("잘못된 JSON");
          return response.json;
        }
      };
    })),
    setTimeoutFn: /** @type {any} */ ((/** @type {() => void} */ fn, /** @type {number} */ delay) => {
      calls.timeoutDelays.push(delay);
      if (options.abortImmediately) fn();
      return 0;
    }),
    clearTimeoutFn: /** @type {any} */ (() => {
      calls.cleared += 1;
    })
  });
  return { transport, calls };
}

test("성공하면 파싱된 JSON을 돌려주고 타임아웃 타이머를 정리한다", async () => {
  const { transport, calls } = createHarness({ response: { ok: true, json: { candidates: [] } } });
  const data = await transport.fetchJson("https://example.test", { timeoutMs: 5000 });
  assert.deepEqual(data, { candidates: [] });
  assert.deepEqual(calls.timeoutDelays, [5000]);
  assert.equal(calls.cleared, 1);
  // timeoutMs는 fetch 옵션에서 떼어 내고 signal을 대신 넣는다
  assert.equal("timeoutMs" in calls.fetch[0].init, false);
  assert.ok(calls.fetch[0].init.signal instanceof AbortSignal);
});

test("타임아웃 하한은 1000ms, 기본은 45000ms", async () => {
  const short = createHarness();
  await short.transport.fetchJson("https://example.test", { timeoutMs: 5 });
  assert.deepEqual(short.calls.timeoutDelays, [1000]);

  const none = createHarness();
  await none.transport.fetchJson("https://example.test");
  assert.deepEqual(none.calls.timeoutDelays, [45000]);
});

test("non-ok 응답은 서버 오류 메시지를 우선하고 없으면 상태 코드 문구로 던진다", async () => {
  const withMessage = createHarness({
    response: { ok: false, status: 429, json: { error: { message: "쿼터 초과" } } }
  });
  await assert.rejects(withMessage.transport.fetchJson("https://example.test"), /쿼터 초과/);

  const withoutBody = createHarness({ response: { ok: false, status: 503, json: {}, jsonThrows: true } });
  await assert.rejects(
    withoutBody.transport.fetchJson("https://example.test"),
    new RegExp(t("ko", "assistant.requestFailedError", { status: 503 }).replace(/[()]/g, "\\$&"))
  );
});

test("응답 본문 JSON 파싱 실패는 빈 객체로 취급한다(ok면 성공)", async () => {
  const { transport } = createHarness({ response: { ok: true, json: null, jsonThrows: true } });
  assert.deepEqual(await transport.fetchJson("https://example.test"), {});
});

test("abort되면 REQUEST_TIMEOUT code가 붙은 지역화 오류로 바뀐다", async () => {
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  const { transport } = createHarness({
    fetchImpl: /** @type {any} */ (() => Promise.reject(abortError))
  });
  await assert.rejects(transport.fetchJson("https://example.test"), (/** @type {any} */ error) => {
    assert.equal(error.code, "REQUEST_TIMEOUT");
    assert.equal(error.message, t("ko", "assistant.requestTimedOutError"));
    return true;
  });
});

test("AbortError가 아닌 오류는 그대로 전파한다", async () => {
  const { transport } = createHarness({
    fetchImpl: /** @type {any} */ (() => Promise.reject(new Error("DNS 실패")))
  });
  await assert.rejects(transport.fetchJson("https://example.test"), /DNS 실패/);
});

test("generateContent는 분리 전과 같은 URL·헤더·body를 만든다", async () => {
  const { transport, calls } = createHarness();
  const body = {
    contents: [{ role: "user", parts: [{ text: "안녕" }] }],
    generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: "minimal" } }
  };
  await transport.generateContent(body, { timeoutMs: 22000 });

  const request = calls.fetch[0];
  assert.equal(
    request.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent"
  );
  assert.equal(request.init.method, "POST");
  assert.deepEqual(request.init.headers, {
    "x-goog-api-key": "키-123",
    "Content-Type": "application/json"
  });
  // 분리 전 코드가 만들던 body와 바이트 단위로 같아야 한다
  assert.equal(
    request.init.body,
    '{"contents":[{"role":"user","parts":[{"text":"안녕"}]}],"generationConfig":{"maxOutputTokens":1024,"thinkingConfig":{"thinkingLevel":"minimal"}}}'
  );
  assert.deepEqual(calls.timeoutDelays, [22000]);
});

test("모델 이름은 URL 인코딩한다", async () => {
  /** @type {string[]} */
  const urls = [];
  const calls = { urls };
  const transport = createGeminiTransport({
    getLanguage: () => "ko",
    getModel: () => "models/커스텀 모델",
    getApiKey: () => "k",
    fetchImpl: /** @type {any} */ (async (/** @type {string} */ url) => {
      calls.urls.push(url);
      return { ok: true, status: 200, json: async () => ({}) };
    })
  });
  await transport.generateContent({});
  assert.ok(calls.urls[0].includes(encodeURIComponent("models/커스텀 모델")));
});

test("extractResponseText는 thinking 파트를 빼고 텍스트만 합친다", () => {
  const data = {
    candidates: [
      { content: { parts: [{ text: "첫 줄", thought: false }, { text: "생각", thought: true }] } },
      { content: { parts: [{ text: "둘째 줄" }, { text: 42 }] } },
      {}
    ]
  };
  // 숫자 text는 ""가 되고 끝의 빈 줄은 trim으로 사라진다
  assert.equal(extractResponseText(data), "첫 줄\n둘째 줄");
  assert.equal(extractResponseText({}), "");
  assert.equal(extractResponseText({ candidates: [] }), "");
});
