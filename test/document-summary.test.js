// 문서 요약 마크다운 정규화와 HTML 렌더링 회귀 테스트.
const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");
const {
  sanitizeDocumentSummaryMarkdown,
  documentSummaryRequestInstruction,
  summaryHtmlDocument
} = require("../src/main/assistant/document-summary.js");

/** @param {Partial<typeof DEFAULT_SETTINGS>} [overrides] */
function renderSettings(overrides = {}) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

test("외곽 마크다운·HTML 펜스는 제거하되 mermaid 펜스는 보존한다", () => {
  const sanitized = sanitizeDocumentSummaryMarkdown([
    "```markdown",
    "제목<br><b>본문</b>",
    "```",
    "",
    "```mermaid",
    "flowchart TD",
    "A-->B",
    "```"
  ].join("\n"));

  assert.ok(sanitized.startsWith("# 제목\n본문"));
  assert.ok(sanitized.includes("```mermaid\nflowchart TD\nA-->B\n```"));
  assert.ok(!sanitized.includes("```markdown"));
  assert.ok(!sanitized.includes("<b>"));
});

test("추가 요청에서 표·비교·시각 자료·쉬운 설명 지시를 구체화한다", () => {
  assert.equal(documentSummaryRequestInstruction(""), "");

  const instruction = documentSummaryRequestInstruction("초보자용 비교표와 다이어그램으로 정리해줘");
  assert.ok(instruction.includes("마크다운 표(| --- | 형식)를 반드시 1개 이상"));
  assert.ok(instruction.includes("공통점/차이점/장단점"));
  assert.ok(instruction.includes("```mermaid 코드 블록"));
  assert.ok(instruction.includes("쉬운 말 위주"));
});

test("제목·강조·표·경고를 HTML로 만들고 사용자 텍스트를 이스케이프한다", () => {
  const now = new Date("2026-08-10T03:04:05.000Z");
  const html = summaryHtmlDocument([
    "# **제목** <script>",
    "> **주의:** `확인` & 검토",
    "| 항목 | 값 |",
    "| --- | --- |",
    "| A | <img> |"
  ].join("\n"), renderSettings(), now);

  assert.ok(html.includes("<h1><strong>제목</strong> &lt;script&gt;</h1>"));
  assert.ok(html.includes("class=\"admonition admonition-주의\""));
  assert.ok(html.includes("<code>확인</code> &amp; 검토"));
  assert.ok(html.includes("<thead><tr><th>항목</th><th>값</th></tr></thead>"));
  assert.ok(html.includes("<tbody>"));
  assert.ok(html.includes("<tr><td>A</td><td>&lt;img&gt;</td></tr>"));
  assert.ok(html.includes(now.toLocaleString()));
});

test("펜스 없는 mermaid가 뒤의 괄호 포함 소제목을 삼키지 않는다", () => {
  const html = summaryHtmlDocument([
    "# 흐름",
    "flowchart TD",
    "A[시작] --> B[끝]",
    "## 참고 사례 (참고)",
    "본문"
  ].join("\n"), renderSettings(), new Date(0));

  assert.ok(html.includes("<pre class=\"mermaid\">flowchart TD\nA[시작] --&gt; B[끝]</pre>"));
  assert.ok(html.includes("<h2>참고 사례 (참고)</h2>"));
  assert.ok(html.includes("<p>본문</p>"));
});

test("현재 테마와 언어로 문서를 만들고 mermaid 테마를 맞춘다", () => {
  const darkHtml = summaryHtmlDocument(
    "```mermaid\nflowchart TD\nA-->B\n```",
    renderSettings({ language: "en", documentSummaryTheme: "dark" }),
    new Date(0)
  );
  assert.ok(darkHtml.includes("<html lang=\"en\">"));
  assert.ok(darkHtml.includes("mermaid.initialize({startOnLoad:true,theme:\"dark\"})"));

  const customHtml = summaryHtmlDocument(
    "# 제목",
    renderSettings({
      documentSummaryTheme: "app",
      bubbleTheme: "custom",
      bubbleThemeCustomBg: "#123456",
      bubbleThemeCustomAccent: "#abcdef"
    }),
    new Date(0)
  );
  assert.ok(customHtml.includes("body{margin:0;background:#123456"));
  assert.ok(customHtml.includes("#abcdef"));
  assert.ok(!customHtml.includes("mermaid.min.js"));
});

// ── 요약 Gemini 호출 (main.js에서 이동) ──────────────────────────────────────

const { createSummarizeDocument } = require("../src/main/assistant/document-summary.js");
const { t } = require("../src/shared/i18n.js");

/** @param {Record<string, unknown>} [response] */
function summarizeHarness(response) {
  /** @type {any[]} */
  const bodies = [];
  const summarize = createSummarizeDocument({
    generateContent: async (body) => {
      bodies.push(body);
      return response || { candidates: [{ content: { parts: [{ text: "# 제목\n\n요약" }] } }] };
    },
    getLanguage: () => "ko"
  });
  return { summarize, bodies };
}

test("요약 요청은 번역과 달리 thinkingLevel low + 토큰 4096이다", async () => {
  const { summarize, bodies } = summarizeHarness();
  const result = await summarize("원문 문서");

  assert.equal(result, "# 제목\n\n요약");
  assert.deepEqual(bodies[0].generationConfig, {
    maxOutputTokens: 4096,
    thinkingConfig: { thinkingLevel: "low" }
  });
  assert.equal(
    bodies[0].contents[0].parts[0].text,
    `${t("ko", "documentSummary.prompt")}\n\n---\n원문 문서`
  );
});

test("추가 요청이 있으면 요청 지시와 우선순위 문구가 프롬프트에 실린다", async () => {
  const { summarize, bodies } = summarizeHarness();
  await summarize("원문", "표로 정리해줘");
  const prompt = bodies[0].contents[0].parts[0].text;
  assert.ok(prompt.includes("표로 정리해줘"));
  assert.ok(prompt.includes("반드시 먼저 추가 요청사항을 충족하는 출력 형태를 선택한 뒤"));
  assert.ok(prompt.endsWith("\n\n---\n원문"));
});

test("응답은 sanitize를 거친다 — svg 등 원시 HTML이 제거된다", async () => {
  const { summarize } = summarizeHarness({
    candidates: [{ content: { parts: [{ text: "# 제목\n\n<svg><rect/></svg>\n\n본문" }] } }]
  });
  const result = await summarize("원문");
  assert.equal(result.includes("<svg>"), false);
  assert.ok(result.includes("본문"));
});
