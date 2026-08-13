const test = require("node:test");
const assert = require("node:assert/strict");

const { createEpisodeSummaryRunner } = require("../src/main/assistant/episode-summary-runner.js");

const PROMPT = { userPrompt: "요약해줘", maxTokens: 200 };

/**
 * @param {{
 *   askResponse?: string | Error | "never",
 *   parsed?: Record<string, unknown> | null
 * }} [options]
 */
function createHarness(options = {}) {
  const calls = {
    /** @type {Array<{ userPrompt: string, options: Record<string, unknown> }>} */
    ask: [],
    /** @type {string[]} */
    parse: [],
    /** @type {unknown[]} */
    append: [],
    /** @type {Array<{ fn: () => void, delay: number }>} */
    timers: []
  };
  const run = createEpisodeSummaryRunner({
    ask: (userPrompt, askOptions) => {
      calls.ask.push({ userPrompt, options: askOptions });
      if (options.askResponse === "never") return new Promise(() => {});
      if (options.askResponse instanceof Error) return Promise.reject(options.askResponse);
      return Promise.resolve(options.askResponse ?? "");
    },
    parseSummary: (responseText) => {
      calls.parse.push(responseText);
      return options.parsed !== undefined ? options.parsed : null;
    },
    appendEpisode: (episodeData) => {
      calls.append.push(episodeData);
      return true;
    },
    setTimeoutFn: /** @type {any} */ ((/** @type {() => void} */ fn, /** @type {number} */ delay) => {
      calls.timers.push({ fn, delay });
      return 0;
    })
  });
  return { run, calls };
}

test("성공: 분리 전과 같은 옵션으로 요청하고 파싱 결과를 저장한다", async () => {
  const episode = { summary: "오늘의 대화" };
  const { run, calls } = createHarness({ askResponse: "요약 텍스트", parsed: episode });
  await run(PROMPT);

  assert.deepEqual(calls.ask, [{
    userPrompt: "요약해줘",
    options: {
      shortQuestionMode: true,
      maxHistoryTurns: 0,
      includeMemory: false,
      maxOutputTokens: 200,
      timeoutMs: 5000,
      retryOnTimeout: false
    }
  }]);
  assert.deepEqual(calls.parse, ["요약 텍스트"]);
  assert.deepEqual(calls.append, [episode]);
});

test("응답이 비거나 공백뿐이면 파싱·저장하지 않는다", async () => {
  for (const askResponse of ["", "   \n"]) {
    const { run, calls } = createHarness({ askResponse, parsed: { summary: "x" } });
    await run(PROMPT);
    assert.deepEqual(calls.parse, []);
    assert.deepEqual(calls.append, []);
  }
});

test("파싱이 null이면 저장하지 않는다", async () => {
  const { run, calls } = createHarness({ askResponse: "이상한 응답", parsed: null });
  await run(PROMPT);
  assert.deepEqual(calls.parse, ["이상한 응답"]);
  assert.deepEqual(calls.append, []);
});

test("요청이 던져도 resolve한다 — 종료를 막지 않는다", async () => {
  const { run } = createHarness({ askResponse: new Error("네트워크 실패") });
  await assert.doesNotReject(run(PROMPT));
});

test("요청이 영원히 안 끝나도 8초 상한 타이머로 끝난다", async () => {
  const { run, calls } = createHarness({ askResponse: "never" });
  const pending = run(PROMPT);
  assert.equal(calls.timers.length, 1);
  assert.equal(calls.timers[0].delay, 8000);
  calls.timers[0].fn();
  await pending;
  assert.deepEqual(calls.append, []);
});
