// AI 문서 요약 결과를 안전한 독립 HTML 문서로 렌더링한다.
// 네트워크 요청과 파일 저장은 main.js가 맡고, 이 모듈은 문자열 변환만 수행한다.
import { DEFAULT_SETTINGS } from "../settings-schema.js";
const { t } = require("../../shared/i18n.js");
import { extractResponseText } from "./gemini-transport.js";

type SummaryRenderSettings = {
  language: string;
  documentSummaryTheme: string;
  bubbleTheme: string;
  bubbleThemeCustomBg: string;
  bubbleThemeCustomAccent: string;
};

type RgbColor = { r: number; g: number; b: number };
type SummaryTheme = {
  page: string;
  card: string;
  text: string;
  heading: string;
  subheading: string;
  accent: string;
  border: string;
  muted: string;
  codeBg: string;
  shadow: string;
};
type SummarizeDocumentDeps = {
  generateContent: (
    body: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ) => Promise<unknown>;
  getLanguage: () => string;
};

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" } as Record<string, string>
  )[char]);
}

function formatSummaryInline(value: string) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function sanitizeDocumentSummaryMarkdown(value: unknown) {
  const raw = String(value || "").replace(/\r/g, "");
  // 언어 태그 뒤에 줄바꿈이 와야만 매치되게 해서 ```mermaid처럼 markdown/md/html이 아닌
  // 언어 태그가 있는 펜스는 건드리지 않는다. \s*였을 때는 "mermaid"가 언어 태그로도, 빈
  // 언어 태그 뒤 공백으로도 안 잡혀서 "mermaid"라는 단어만 본문에 그대로 남고 펜스(```)가
  // 통째로 사라져 아래 summaryHtmlDocument()의 코드펜스 감지가 무력화되는 버그가 있었다.
  const withoutCodeFences = raw.replace(/```(?:markdown|md|html)?[ \t]*\n([\s\S]*?)```/gi, "$1");
  const withoutHtmlBreaks = withoutCodeFences.replace(/<br\s*\/?>/gi, "\n");
  const withoutHtmlTags = withoutHtmlBreaks.replace(/<\/?[a-z][^>\n]*>/gi, "");
  const lines = withoutHtmlTags
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line, index, array) => {
      if (line.trim()) return true;
      return array[index - 1]?.trim() || array[index + 1]?.trim();
    });
  const normalized = lines.join("\n").trim();
  if (!normalized) return "";
  if (/^#\s+/m.test(normalized)) return normalized;
  const [firstLine, ...rest] = normalized.split("\n");
  return [`# ${firstLine.trim()}`, ...rest].join("\n").trim();
}

function documentSummaryRequestInstruction(extraRequest = "") {
  const request = String(extraRequest || "").trim();
  if (!request) return "";
  const lower = request.toLowerCase();
  const wantsTable = /(표|테이블|비교표|정리표|표로|table|grid)/i.test(request);
  const wantsGrid = /(그리드|grid|카드형|카드 형식|타일)/i.test(request);
  const wantsComparison = /(비교|vs|장단점|차이점|비교표)/i.test(request);
  const wantsMoreHighlight = /(강조|색|컬러|color|colorful|눈에 띄|포인트)/i.test(request);
  const wantsShort = /(짧게|간단히|간결|요약만|핵심만|brief|concise|short)/i.test(request);
  const wantsBeginner = /(초보자|입문자|쉽게|쉽게 설명|쉬운 말|beginner|simple|plain language)/i.test(lower);
  const wantsActionItems = /(할 일|todo|to do|액션 아이템|실행|실천|해야 할 일)/i.test(lower);
  const wantsVisual = /(그림|이미지|시각자료|시각 자료|다이어그램|도표|일러스트|비주얼|그려|삽화|인포그래픽|visual|diagram|illustration|infographic)/i.test(request);

  const directives = [
    "추가 요청사항은 기본 형식보다 우선합니다.",
    "제목 1개와 제목 아래 짧은 요약 1~2문장은 유지하되, 그 이후 구성은 추가 요청사항에 맞게 바꿔도 됩니다.",
    "추가 요청사항을 반영하지 못했다면 임의로 무시하지 말고, 가능한 범위 안에서 가장 가까운 마크다운 표현으로 반드시 반영하세요.",
    "HTML/CSS 태그, 인라인 스타일, <font> 같은 태그 장식은 절대 출력하지 말고 순수 마크다운만 사용하세요.",
    "문서 내용에 없는 사실은 만들지 말고, 요청사항이 사실과 충돌하면 요청보다 사실 보존을 우선하세요."
  ];

  if (wantsTable || wantsGrid || wantsComparison) {
    directives.push("출력 본문에는 마크다운 표(| --- | 형식)를 반드시 1개 이상 포함하세요.");
  }
  if (wantsComparison) {
    directives.push("비교 요청이 있으므로 공통점/차이점/장단점 중 최소 하나를 표의 열 또는 행으로 분명하게 나누세요.");
  }
  if (wantsMoreHighlight) {
    directives.push("중요한 내용은 2개 이상을 '> 강조:' 형식의 인용 블록으로 따로 빼서 시각적으로 더 눈에 띄게 만드세요.");
  }
  if (wantsShort) {
    directives.push("전체 길이는 기본보다 더 짧고 밀도 높게 줄이고, 불릿 수도 꼭 필요한 만큼만 유지하세요.");
  }
  if (wantsBeginner) {
    directives.push("어려운 용어는 풀어서 쓰고, 초보자도 바로 이해할 수 있게 쉬운 말 위주로 설명하세요.");
  }
  if (wantsActionItems) {
    directives.push("실행 가능한 할 일이나 다음 행동이 있으면 별도 섹션으로 분리해 가장 눈에 띄게 정리하세요.");
  }
  if (wantsVisual) {
    directives.push("시각 자료를 명시적으로 요청했으므로, 절대 텍스트/불릿만으로 대체하지 말고 ```mermaid 코드 블록을 본문에 최소 1개 이상 반드시 포함하세요. 프로세스/순서가 있으면 `flowchart TD` 문법으로 흐름도를, 시계열이면 `timeline` 문법을, 그 외에는 내용에 가장 잘 어울리는 mermaid 다이어그램 종류를 직접 골라 그리세요. `<svg>` 태그는 렌더링되지 않으니 절대 쓰지 말고, mermaid 코드 블록 없이 이름만 나열하는 것은 요청을 충족하지 못한 것으로 간주합니다.");
  }

  return `추가 요청사항:\n${request}\n\n추가 요청사항 적용 규칙:\n- ${directives.join("\n- ")}`;
}

function isMermaidLikeLine(line: string) {
  return /-->|---|-\.-|==>|--x|--o|\[.*\]|\{.*\}|\(.*\)|^(graph|flowchart)\s+(TD|TB|BT|RL|LR)\b|^subgraph\b|^end$|^class\b|^click\b|^style\b|^classDef\b|^direction\b|^participant\b|^actor\b|^note\b|^activate\b|^deactivate\b|^loop\b|^alt\b|^else\b|^opt\b|^par\b|^and\b|^rect\b/i.test(line);
}

function parseMarkdownTableRow(line: string) {
  const trimmed = String(line || "").trim();
  if (!trimmed.includes("|")) return null;
  const normalized = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return normalized.split("|").map((cell) => formatSummaryInline(cell.trim()));
}

function isMarkdownTableDivider(line: string) {
  const cells = parseMarkdownTableRow(line);
  return Array.isArray(cells) && cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/<[^>]+>/g, "")));
}

function hexToRgb(value: string): RgbColor | null {
  const hex = String(value || "").trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }: RgbColor) {
  return `#${[r, g, b].map((value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

function mixHex(a: string, b: string, amount: number) {
  const colorA = hexToRgb(a);
  const colorB = hexToRgb(b);
  if (!colorA || !colorB) return a;
  return rgbToHex({
    r: colorA.r + (colorB.r - colorA.r) * amount,
    g: colorA.g + (colorB.g - colorA.g) * amount,
    b: colorA.b + (colorB.b - colorA.b) * amount
  });
}

function isDarkHex(value: string) {
  const color = hexToRgb(value);
  if (!color) return true;
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) < 140;
}

function appDocumentSummaryTheme(bg: string, accent: string): SummaryTheme {
  const base = /^#[0-9a-f]{6}$/i.test(bg || "") ? bg : DEFAULT_SETTINGS.bubbleThemeCustomBg;
  const point = /^#[0-9a-f]{6}$/i.test(accent || "") ? accent : DEFAULT_SETTINGS.bubbleThemeCustomAccent;
  const dark = isDarkHex(base);
  return dark
    ? {
        page: base,
        card: mixHex(base, "#ffffff", 0.08),
        text: "#f6f3f8",
        heading: "#ffffff",
        subheading: mixHex(point, "#ffffff", 0.22),
        accent: point,
        border: mixHex(point, "#ffffff", 0.18),
        muted: mixHex(base, "#ffffff", 0.68),
        codeBg: mixHex(base, "#ffffff", 0.14),
        shadow: "#00000066"
      }
    : {
        page: mixHex(base, "#ffffff", 0.72),
        card: "#ffffff",
        text: mixHex(base, "#000000", 0.78),
        heading: mixHex(base, "#000000", 0.62),
        subheading: mixHex(point, "#000000", 0.18),
        accent: point,
        border: mixHex(point, "#ffffff", 0.62),
        muted: mixHex(base, "#000000", 0.42),
        codeBg: mixHex(point, "#ffffff", 0.86),
        shadow: `${mixHex(base, "#000000", 0.45)}22`
      };
}

function documentSummaryThemeCss(settings: SummaryRenderSettings) {
  const appThemeColors = {
    charcoal: { bg: "#20232b", accent: "#d75566" },
    rose: { bg: "#432436", accent: "#d65f87" },
    ocean: { bg: "#193448", accent: "#3f91bd" },
    forest: { bg: "#1f3b31", accent: "#4f9a70" },
    amber: { bg: "#48331b", accent: "#c68436" }
  };
  const appThemes: Record<string, SummaryTheme> = {
    charcoal: appDocumentSummaryTheme(appThemeColors.charcoal.bg, appThemeColors.charcoal.accent),
    rose: appDocumentSummaryTheme(appThemeColors.rose.bg, appThemeColors.rose.accent),
    ocean: appDocumentSummaryTheme(appThemeColors.ocean.bg, appThemeColors.ocean.accent),
    forest: appDocumentSummaryTheme(appThemeColors.forest.bg, appThemeColors.forest.accent),
    amber: appDocumentSummaryTheme(appThemeColors.amber.bg, appThemeColors.amber.accent)
  };
  const dark: SummaryTheme = { page: "#15151a", card: "#20212a", text: "#f3f0f6", heading: "#ffffff", subheading: "#ddb7ff", accent: "#b783ff", border: "#373146", muted: "#b7adbf", codeBg: "#2c2638", shadow: "#00000055" };
  const light: SummaryTheme = { page: "#f8fafc", card: "#ffffff", text: "#20242c", heading: "#172033", subheading: "#385b84", accent: "#5177c8", border: "#dde6f1", muted: "#6b7280", codeBg: "#eef4ff", shadow: "#26334a18" };
  let theme: SummaryTheme = settings.documentSummaryTheme === "dark" ? dark : light;
  if (settings.documentSummaryTheme === "app") {
    theme = settings.bubbleTheme === "custom"
      ? appDocumentSummaryTheme(settings.bubbleThemeCustomBg, settings.bubbleThemeCustomAccent)
      : appThemes[settings.bubbleTheme] || appThemes.charcoal;
  }
  const shadow = theme.shadow || `${theme.heading}20`;
  const admonitionBg = mixHex(theme.accent, theme.card, 0.12);
  const css = `body{margin:0;background:${theme.page};color:${theme.text};font:16px/1.75 system-ui,-apple-system,'Segoe UI',sans-serif}main{width:min(920px,calc(100% - 32px));box-sizing:border-box;margin:40px auto;padding:42px;background:${theme.card};border-radius:24px;box-shadow:0 18px 50px ${shadow}}h1{margin:0 0 28px;color:${theme.heading};font-size:2em;line-height:1.28}h2{margin:30px 0 10px;color:${theme.subheading};font-size:1.18em;border-bottom:2px solid ${theme.border};padding-bottom:7px}h3,h4,h5,h6{margin:20px 0 8px;color:${theme.subheading};font-size:1.05em}p{margin:10px 0}ul{margin:8px 0 16px;padding-left:1.4em}li::marker{color:${theme.accent}}strong{color:${theme.subheading}}code{padding:2px 5px;border-radius:5px;background:${theme.codeBg};color:${theme.subheading};font:.9em ui-monospace,monospace}pre{margin:16px 0;padding:14px 16px;border-radius:8px;background:${theme.codeBg};overflow-x:auto;border:1px solid ${theme.border}}pre code{padding:0;background:transparent;color:${theme.text};font-family:ui-monospace,monospace}blockquote{margin:14px 0;padding:14px 16px;border-left:4px solid ${theme.accent};background:${mixHex(theme.card, theme.accent, 0.08)};border-radius:14px;color:${theme.text}}.admonition{margin:16px 0;padding:14px 16px;border-left:5px solid ${theme.accent};background:${admonitionBg};border-radius:12px;color:${theme.text}}.admonition strong{color:${theme.accent}}.summary-diagram{margin:24px 0;padding:16px;border:1px solid ${theme.border};border-radius:12px;background:${mixHex(theme.card, theme.accent, 0.04)};display:flex;justify-content:center;overflow-x:auto}.summary-diagram svg{max-width:100%;height:auto}.summary-diagram pre.mermaid{margin:0;padding:0;border:none;background:transparent;text-align:left}table{width:100%;border-collapse:collapse;margin:16px 0 20px;overflow:hidden;border-radius:16px;border:1px solid ${theme.border};background:${mixHex(theme.card, "#ffffff", theme.card === "#ffffff" ? 0 : 0.02)}}th,td{padding:10px 12px;border-bottom:1px solid ${theme.border};text-align:left;vertical-align:top}th{background:${mixHex(theme.accent, theme.card, 0.82)};color:${theme.subheading};font-weight:700}tr:last-child td{border-bottom:none}footer{margin-top:36px;padding-top:16px;border-top:1px solid ${theme.border};color:${theme.muted};font-size:.82em}`;
  return { css, isDark: isDarkHex(theme.page) };
}

function summaryHtmlDocument(markdown: string, settings: SummaryRenderSettings, now = new Date()) {
  const blocks: string[] = [];
  let listOpen = false;
  let tableRows: string[][] | null = null;
  let inSvgBlock = false;
  let svgContent = "";
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeContent = "";
  let inBareMermaidBlock = false;
  let bareMermaidLines: string[] = [];
  const flushBareMermaid = () => {
    if (!inBareMermaidBlock) return;
    inBareMermaidBlock = false;
    if (bareMermaidLines.length) {
      closeList();
      closeTable();
      blocks.push(`<figure class="summary-diagram"><pre class="mermaid">${escapeHtml(bareMermaidLines.join("\n"))}</pre></figure>`);
    }
    bareMermaidLines = [];
  };
  const closeList = () => {
    if (!listOpen) return;
    blocks.push("</ul>");
    listOpen = false;
  };
  const closeTable = () => {
    if (!tableRows?.length) return;
    const [header, ...bodyRows] = tableRows;
    blocks.push("<table>");
    blocks.push(`<thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>`);
    if (bodyRows.length) {
      blocks.push("<tbody>");
      for (const row of bodyRows) {
        blocks.push(`<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`);
      }
      blocks.push("</tbody>");
    }
    blocks.push("</table>");
    tableRows = null;
  };
  for (const rawLine of String(markdown).replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    const codeBlockMatch = line.match(/^```(\w*)/);
    if (codeBlockMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = codeBlockMatch[1] || "";
        codeContent = "";
        continue;
      } else {
        inCodeBlock = false;
        closeList();
        closeTable();
        if (codeBlockLang.toLowerCase() === "mermaid") {
          blocks.push(`<figure class="summary-diagram"><pre class="mermaid">${escapeHtml(codeContent.trimEnd())}</pre></figure>`);
        } else {
          const langAttr = codeBlockLang ? ` class="language-${escapeHtml(codeBlockLang)}"` : "";
          blocks.push(`<pre><code${langAttr}>${escapeHtml(codeContent.trimEnd())}</code></pre>`);
        }
        codeBlockLang = "";
        codeContent = "";
        continue;
      }
    }
    if (inCodeBlock) {
      codeContent += line + "\n";
      continue;
    }
    if (line.includes("<svg")) {
      inSvgBlock = true;
      svgContent = line;
      continue;
    }
    if (inSvgBlock) {
      svgContent += "\n" + line;
      if (line.includes("</svg>")) {
        inSvgBlock = false;
        closeList();
        closeTable();
        blocks.push(`<figure class="summary-diagram">${svgContent}</figure>`);
        svgContent = "";
      }
      continue;
    }
    // AI가 ```mermaid 펜스 없이 순수 텍스트로 mermaid 다이어그램을 출력하는 경우를 대비한 방어적 감지.
    if (!inBareMermaidBlock && /^mermaid$/i.test(line)) {
      inBareMermaidBlock = true;
      bareMermaidLines = [];
      continue;
    }
    if (!inBareMermaidBlock && /^(graph|flowchart)\s+(TD|TB|BT|RL|LR)\b/.test(line)) {
      inBareMermaidBlock = true;
      bareMermaidLines = [line];
      continue;
    }
    if (inBareMermaidBlock) {
      if (!line) { continue; }
      // 소제목/표/인용/리스트처럼 명백한 마크다운 구조 줄은, 괄호·대괄호를 포함해
      // isMermaidLikeLine()에 우연히 걸리더라도 mermaid 콘텐츠로 보지 않는다.
      const looksLikeMarkdownStructure = /^(#{1,6}\s|>\s|[-*]\s|\|)/.test(line);
      if (!looksLikeMarkdownStructure && isMermaidLikeLine(line)) {
        bareMermaidLines.push(line);
        continue;
      }
      flushBareMermaid();
    }
    if (!line) { closeList(); closeTable(); continue; }
    const admonitionMatch = line.match(/^>\s+\*\*([^*:]+):\*\*\s*(.*)/);
    if (admonitionMatch) {
      closeList();
      closeTable();
      const [, type, content] = admonitionMatch;
      const typeClass = type.toLowerCase().replace(/[^\w가-힣a-z0-9]/gi, "");
      blocks.push(`<aside class="admonition admonition-${typeClass}"><strong>${escapeHtml(type)}:</strong> ${formatSummaryInline(content)}</aside>`);
      continue;
    }
    const tableCells = parseMarkdownTableRow(line);
    if (line.startsWith("# ")) { closeList(); closeTable(); blocks.push(`<h1>${formatSummaryInline(line.slice(2))}</h1>`); }
    else if (line.startsWith("## ")) { closeList(); closeTable(); blocks.push(`<h2>${formatSummaryInline(line.slice(3))}</h2>`); }
    else if (line.startsWith("### ")) { closeList(); closeTable(); blocks.push(`<h3>${formatSummaryInline(line.slice(4))}</h3>`); }
    else if (line.startsWith("#### ")) { closeList(); closeTable(); blocks.push(`<h4>${formatSummaryInline(line.slice(5))}</h4>`); }
    else if (line.startsWith("##### ")) { closeList(); closeTable(); blocks.push(`<h5>${formatSummaryInline(line.slice(6))}</h5>`); }
    else if (line.startsWith("###### ")) { closeList(); closeTable(); blocks.push(`<h6>${formatSummaryInline(line.slice(7))}</h6>`); }
    else if (line.startsWith("> ")) { closeList(); closeTable(); blocks.push(`<blockquote>${formatSummaryInline(line.slice(2))}</blockquote>`); }
    else if (/^[-*]\s+/.test(line)) { closeTable(); if (!listOpen) { blocks.push("<ul>"); listOpen = true; } blocks.push(`<li>${formatSummaryInline(line.replace(/^[-*]\s+/, ""))}</li>`); }
    else if (isMarkdownTableDivider(line)) {
      closeList();
      if (!tableRows) tableRows = [];
    }
    else if (tableCells) {
      closeList();
      if (!tableRows) tableRows = [];
      tableRows.push(tableCells);
    }
    else { closeList(); closeTable(); blocks.push(`<p>${formatSummaryInline(line)}</p>`); }
  }
  flushBareMermaid();
  closeList();
  closeTable();
  const { css, isDark } = documentSummaryThemeCss(settings);
  const mermaidInitScript = blocks.some((block) => block.includes("class=\"mermaid\""))
    ? `<script src="mermaid.min.js"></script><script>mermaid.initialize({startOnLoad:true,theme:${JSON.stringify(isDark ? "dark" : "default")}});</script>`
    : "";
  return `<!doctype html><html lang="${escapeHtml(settings.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>문서 요약</title><style>${css}</style></head><body><main>${blocks.join("\n")}<footer>AI 문서 요약 · ${now.toLocaleString()}</footer></main></body>${mermaidInitScript}</html>`;
}

// 다이어그램을 포함한 긴 문서는 일반 질문보다 출력 여유가 더 필요하다. Mermaid로 렌더링해도
// 모델이 다이어그램을 생략할 수 있으므로 thinkingLevel과 토큰 한도를 질문 경로보다 높게 둔다.
function createSummarizeDocument(deps: SummarizeDocumentDeps) {
  return async function summarizeDocumentWithGemini(text: string, extraRequest = "") {
    const request = String(extraRequest || "").trim();
    const requestInstruction = documentSummaryRequestInstruction(request);
    const language = deps.getLanguage();
    const prompt = request
      ? `${t(language, "documentSummary.prompt")}\n\n${requestInstruction}\n\n반드시 먼저 추가 요청사항을 충족하는 출력 형태를 선택한 뒤, 그 형태에 맞춰 문서를 요약하세요. 기본 형식은 요청사항을 돕는 범위에서만 유지하고, 요청사항을 약하게 반영하는 타협안은 피하세요.\n\n---\n${text}`
      : `${t(language, "documentSummary.prompt")}\n\n---\n${text}`;
    const data = await deps.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "low" } }
    });
    return sanitizeDocumentSummaryMarkdown(extractResponseText(data));
  };
}

export {
  sanitizeDocumentSummaryMarkdown,
  documentSummaryRequestInstruction,
  summaryHtmlDocument,
  createSummarizeDocument
};
export type { SummaryRenderSettings, SummarizeDocumentDeps };
