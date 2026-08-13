const RESERVED_MEMORY_KEYS = new Set([
  "user_name",
  "pet_name",
  "assistant_name",
  "character_name",
  "owner_name"
]);

const ALLOWED_CATEGORIES = new Set([
  "preference",
  "habit",
  "fact",
  "relationship",
  "goal"
]);

// 프롬프트에 넣을 대화 한 턴. memory-persistence.js의 ConversationTurn이 이 모양을
// 포함하고, 여기서는 실제로 읽는 두 필드만 요구한다.
type PromptTurn = { question: string; answer: string };
type StoredMemory = {
  memory_key: string;
  category: string;
  memory_label: string;
  memory_value: string;
};
// open_loops.id는 SQLite AUTOINCREMENT라 숫자다.
type OpenLoop = { id: number; topic: string };
type RepairEdit = { start: number; end: number; value: string };

function normalizeKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

function isReservedMemoryKey(key: unknown) {
  const normalized = normalizeKey(key);
  return RESERVED_MEMORY_KEYS.has(normalized);
}

function validateMemoryKey(key: unknown) {
  if (!key || typeof key !== "string") return false;
  const normalized = normalizeKey(key);
  if (normalized.length === 0 || normalized.length > 100) return false;
  return !RESERVED_MEMORY_KEYS.has(normalized);
}

function sanitizeText(value: unknown, maxChars = 500) {
  if (!value || typeof value !== "string") return "";
  return value.trim().slice(0, Math.max(1, maxChars));
}

// 인자는 LLM이 돌려준 JSON을 파싱한 값이라 객체가 아닌 것도 들어온다 — 속성을 읽기 전에
// unknown을 좁혀야 한다(test/memory-extraction.test.js가 문자열·null도 넣어 본다).
function validateExtractedMemory(candidate: unknown) {
  try {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { valid: false, reason: "candidate is not an object" };
    }
    const memory = candidate as Record<string, unknown>;

    const category = String(memory.category || "").trim().toLowerCase();
    if (!ALLOWED_CATEGORIES.has(category)) {
      return { valid: false, reason: `invalid category: ${category}` };
    }

    const key = normalizeKey(memory.memory_key);
    if (key.length === 0 || key.length > 100) {
      return { valid: false, reason: "key length invalid" };
    }

    if (isReservedMemoryKey(key)) {
      return { valid: false, reason: "reserved key detected" };
    }

    const label = sanitizeText(memory.memory_label, 100);
    if (label.length === 0) {
      return { valid: false, reason: "label empty" };
    }

    const value = sanitizeText(memory.memory_value, 1000);
    if (value.length === 0) {
      return { valid: false, reason: "value empty" };
    }

    const importance = Number(memory.importance);
    if (Number.isNaN(importance) || importance < 0 || importance > 1) {
      return { valid: false, reason: "importance out of range" };
    }

    if (importance < 0.5) {
      return { valid: false, reason: "importance too low (< 0.5)" };
    }

    return {
      valid: true,
      normalized: {
        category,
        memory_key: key,
        memory_label: label,
        memory_value: value,
        importance
      }
    };
  } catch (error) {
    return { valid: false, reason: `exception: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const EXISTING_MEMORIES_PROMPT_LIMIT = 20;

// 이미 저장된 기억을 프롬프트에 보여주지 않으면, LLM이 대화 조각만 보고 매번
// 새로운 memory_key를 지어내서 같은 의미의 기억이 계속 별개 행으로 쌓인다.
// 문자열 유사도만으로는 한국어 의미 중복을 안전하게 판별할 수 없으므로
// (예: "매운 음식 좋아함" vs "단 음식 싫어함"도 문자 겹침은 높게 나옴),
// 실제 의미 판단은 LLM에게 기존 기억 목록을 보여주고 맡긴다.
function formatExistingMemoriesForPrompt(existingMemories: StoredMemory[], language: string) {
  if (!Array.isArray(existingMemories) || existingMemories.length === 0) return "";

  const lines = existingMemories
    .slice(0, EXISTING_MEMORIES_PROMPT_LIMIT)
    .map(m => `- ${m.memory_key} (${m.category}): ${m.memory_label} - ${m.memory_value}`)
    .join("\n");

  if (language === "ko") {
    return `\n\n이미 저장된 기억 목록:\n${lines}\n\n위 목록에 이미 같은 의미의 기억이 있다면 새 항목을 만들지 말고 그 memory_key를 그대로 재사용하세요. 완전히 새로운 내용만 새 memory_key로 추출하세요.`;
  }

  return `\n\nAlready stored memories:\n${lines}\n\nIf the extracted content means the same thing as one of the memories above, reuse that exact memory_key instead of creating a new one. Only assign a new memory_key for genuinely new content.`;
}

function buildExtractionPrompt(
  conversationHistory: PromptTurn[],
  language = "en",
  existingMemories: StoredMemory[] = []
) {
  const turns = conversationHistory
    .slice(-10)
    .map((turn, idx) => `Q${idx + 1}: ${turn.question}\nA${idx + 1}: ${turn.answer}`)
    .join("\n\n");

  const existingMemoriesBlock = formatExistingMemoriesForPrompt(existingMemories, language);

  if (language === "ko") {
    return {
      systemPrompt: "당신은 사용자와의 대화를 분석하여 장기 기억을 추출하는 AI입니다.",
      userPrompt: `다음 최근 대화를 분석해 장기 기억을 추출하세요:

${turns}

다음 JSON 형식으로 응답하세요 (배열):
[
  {
    "category": "preference|habit|fact|relationship|goal",
    "memory_key": "영어_snake_case_키",
    "memory_label": "한글 레이블 (사용자 친화적)",
    "memory_value": "값",
    "importance": 0.7
  }
]

규칙:
1. 사용자의 명백한 취향, 습관, 정보만 추출
2. 임시 정보(오늘의 감정, 일회성 이야기) 제외
3. user_name, pet_name, assistant_name은 절대 저장 금지
4. 최소 0개, 최대 5개까지만 추출
5. importance는 0.5 이상만 추출 (낮은 신뢰도 제외)${existingMemoriesBlock}`,
      maxTokens: 300
    };
  }

  return {
    systemPrompt: "You are an AI that extracts long-term memory from user conversations.",
    userPrompt: `Analyze this recent conversation and extract long-term memories:

${turns}

Respond in this JSON format (array only):
[
  {
    "category": "preference|habit|fact|relationship|goal",
    "memory_key": "english_snake_case_key",
    "memory_label": "English label (user-facing)",
    "memory_value": "value",
    "importance": 0.7
  }
]

Rules:
1. Extract only explicit user preferences, habits, and information
2. Exclude temporary info (today's mood, one-time stories)
3. NEVER store user_name, pet_name, assistant_name
4. Extract minimum 0, maximum 5 items
5. Only extract importance >= 0.5 (filter low confidence)${existingMemoriesBlock}`,
    maxTokens: 300
  };
}

const TRAILING_EXPRESSION_TAG_PATTERN = /\n?\[expression:\s*(normal|happy|angry|sad|alarm|shocked)\]\s*$/i;

function stripTrailingExpressionTag(text: unknown) {
  return String(text || "").replace(TRAILING_EXPRESSION_TAG_PATTERN, "").trim();
}

function extractBalancedJsonArray(rawText: unknown): string | null {
  const text = stripTrailingExpressionTag(rawText);
  const start = text.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

// description은 더 이상 요청하거나 반환하지 않지만, 이전 형식의 여분 필드 때문에 전체 파싱이
// 실패하지 않도록 입력 복구 목록에만 남긴다.
const KNOWN_STRING_FIELDS = ["category", "memory_key", "memory_label", "memory_value", "topic", "description"];

// LLM output occasionally drops the opening quote around a string value
// (e.g. `"memory_value": 사용자와의 장난스러운...`), which breaks strict JSON.parse.
// This scans for known field names, and if the value isn't already a valid JSON
// token (string/object/array/number/bool/null), wraps the bare text up to the next
// field-key or closing brace/bracket in quotes. Done as a manual scan (not a single
// regex) because a backtrackable \s* before the "is this quoted already" check can
// skip past real quotes and corrupt already-valid fields.
function repairUnquotedStringValues(jsonText: string) {
  const fieldStart = new RegExp(`"(?:${KNOWN_STRING_FIELDS.join("|")})"\\s*:\\s*`, "g");
  const boundaryPattern = /"[a-zA-Z_][a-zA-Z0-9_]*"\s*:|[}\]]/g;
  const edits: RepairEdit[] = [];

  while (fieldStart.exec(jsonText) !== null) {
    const valueStart = fieldStart.lastIndex;
    const nextChar = jsonText[valueStart];
    if (!nextChar) continue;
    if (nextChar === '"' || nextChar === "{" || nextChar === "[" || /[0-9-]/.test(nextChar)) continue;
    if (/^(?:true|false|null)\b/.test(jsonText.slice(valueStart))) continue;

    boundaryPattern.lastIndex = valueStart;
    const boundaryMatch = boundaryPattern.exec(jsonText);
    if (!boundaryMatch) continue;

    const raw = jsonText.slice(valueStart, boundaryMatch.index).replace(/[,\s]+$/, "");
    if (!raw) continue;
    edits.push({ start: valueStart, end: valueStart + raw.length, value: raw });
  }

  let result = jsonText;
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) {
    const escaped = edit.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    result = result.slice(0, edit.start) + `"${escaped}"` + result.slice(edit.end);
  }
  return result;
}

function parseJsonArrayLeniently(jsonSlice: string) {
  try {
    return JSON.parse(jsonSlice);
  } catch (firstError) {
    try {
      return JSON.parse(repairUnquotedStringValues(jsonSlice));
    } catch {
      throw firstError;
    }
  }
}

function parseExtractionResponse(responseText: unknown) {
  try {
    const text = String(responseText || "").trim();

    const jsonSlice = extractBalancedJsonArray(text);
    if (!jsonSlice) {
      return [];
    }

    const parsed = parseJsonArrayLeniently(jsonSlice);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.slice(0, 5);
  } catch (error) {
    console.error("[MemoryExtraction] Parse failed:", error);
    return [];
  }
}

const OPEN_LOOP_PATTERNS = [
  /나중에(?:.*)?(?:다시|또|얘기)/,
  /언제(?:쯤)?(?:\s|.*?)(?:나올까|나올|끝날까)/,
  /결과(?:.*)?기다리/,
  /(?:이번|이|그)(?:\s|.*?)(?:결과|기다|완료|끝)/,
  /끝내야|해야|할거|할래/
];

function detectOpenLoops(text: string | null | undefined): string[] {
  if (!text) return [];

  const loops: string[] = [];
  OPEN_LOOP_PATTERNS.forEach(pattern => {
    if (pattern.test(text)) {
      const match = text.match(pattern);
      if (match) {
        const topic = match[0].slice(0, 100);
        if (!loops.find(l => l.toLowerCase() === topic.toLowerCase())) {
          loops.push(topic);
        }
      }
    }
  });

  return loops;
}

function calculateSimilarity(str1: unknown, str2: unknown) {
  const s1 = String(str1 || "").toLowerCase().trim();
  const s2 = String(str2 || "").toLowerCase().trim();

  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  let matches = 0;
  for (const char of shorter) {
    if (longer.includes(char)) matches++;
  }

  return Math.max(0, matches / Math.max(s1.length, s2.length));
}

function detectConflict(newValue: unknown, existingValue: unknown) {
  const similarity = calculateSimilarity(newValue, existingValue);

  if (similarity > 0.95) {
    return { type: "duplicate", similarity };
  }

  if (similarity > 0.5) {
    return { type: "partial_overlap", similarity };
  }

  return { type: "no_conflict", similarity };
}

function detectCompletionSignals(text: unknown) {
  if (!text) return false;

  const completionKeywords = [
    "다했어", "끝났어", "완료", "결과", "나왔어",
    "이미", "벌써", "했어", "됐어", "성공",
    "finished", "done", "completed", "result", "success"
  ];

  const lowerText = String(text).toLowerCase();
  return completionKeywords.some(kw => lowerText.includes(kw));
}

// 장기 기억과 같은 이유(LLM이 매번 대화 조각만 보고 표현만 다른 주제를 새로
// 만들어내는 것)로 미완료 주제도 계속 쌓일 수 있어, 이미 열려있는 주제를
// 보여주고 같은 주제면 새로 만들지 말라고 지시한다.
function formatExistingLoopsForPrompt(existingLoops: OpenLoop[], language: string) {
  if (!Array.isArray(existingLoops) || existingLoops.length === 0) return "";

  const lines = existingLoops.map(l => `- ${l.topic}`).join("\n");

  if (language === "ko") {
    return `\n\n이미 열려있는 미완료 주제 목록:\n${lines}\n\n위 목록에 이미 같은 주제가 있다면 새로 추출하지 마세요.`;
  }

  return `\n\nAlready open loops:\n${lines}\n\nDo not extract a topic that already matches one of the above.`;
}

function buildOpenLoopsDetectionPrompt(
  conversationHistory: PromptTurn[],
  language = "ko",
  existingLoops: OpenLoop[] = []
) {
  const turns = conversationHistory
    .slice(-5)
    .map((turn, idx) => `Q${idx + 1}: ${turn.question}\nA${idx + 1}: ${turn.answer}`)
    .join("\n\n");

  const existingLoopsBlock = formatExistingLoopsForPrompt(existingLoops, language);

  if (language === "ko") {
    return {
      systemPrompt: "당신은 대화에서 미완료 주제(Open Loops)를 감지하는 AI입니다.",
      userPrompt: `다음 대화에서 사용자가 '나중에', '결과를', '끝내야' 같은 미완료 상태를 언급한 주제들을 찾으세요:

${turns}

다음 JSON 형식으로 응답하세요 (배열):
[
  {
    "topic": "회사 발표 결과 기다리는 중"
  }
]

최대 3개까지만 추출하세요.${existingLoopsBlock}`,
      maxTokens: 150
    };
  }

  return {
    systemPrompt: "You detect open loops (unresolved topics) in conversations.",
    userPrompt: `Find topics where the user mentions 'later', 'waiting for', or 'need to finish' in this conversation:

${turns}

Respond in this JSON format (array only):
[
  {
    "topic": "waiting for presentation results"
  }
]

Extract maximum 3 items.${existingLoopsBlock}`,
    maxTokens: 150
  };
}

// 완료 신호(detectCompletionSignals)가 감지됐을 때, 이미 열려있는 미완료 주제 중
// 어느 것이 해결됐는지 LLM에게 직접 판단시킨다. 문자열 유사도로는 "발표 다
// 끝났어"와 "회사 발표 결과 기다리는 중" 같은 표현 차이를 안전하게 매칭할 수
// 없기 때문에, 장기 기억 dedup과 같은 이유로 LLM 판단에 맡긴다.
function buildLoopResolutionPrompt(
  conversationHistory: PromptTurn[],
  openLoops: OpenLoop[],
  language = "ko"
) {
  const turns = conversationHistory
    .slice(-5)
    .map((turn, idx) => `Q${idx + 1}: ${turn.question}\nA${idx + 1}: ${turn.answer}`)
    .join("\n\n");

  const list = openLoops.map((loop, idx) => `${idx + 1}. ${loop.topic}`).join("\n");

  if (language === "ko") {
    return {
      systemPrompt: "당신은 대화에서 미완료 주제가 해결되었는지 판단하는 AI입니다.",
      userPrompt: `다음 대화를 보고, 아래 미완료 주제 목록 중 이미 해결/완료된 것이 있으면 번호만 배열로 답하세요. 없으면 빈 배열 []로 답하세요.

대화:
${turns}

미완료 주제 목록:
${list}

응답 형식 (숫자 배열만, 다른 텍스트 없이): [1, 3]`,
      maxTokens: 50
    };
  }

  return {
    systemPrompt: "You determine whether open loops have been resolved based on a conversation.",
    userPrompt: `Given this conversation, respond with the numbers of any open loop below that have been resolved. Respond with an empty array [] if none.

Conversation:
${turns}

Open loops:
${list}

Respond format (array of numbers only, no other text): [1, 3]`,
    maxTokens: 50
  };
}

function parseLoopResolutionResponse(responseText: unknown, openLoops: OpenLoop[]) {
  try {
    const text = String(responseText || "").trim();
    const jsonSlice = extractBalancedJsonArray(text);
    if (!jsonSlice) {
      return [];
    }

    const parsed = JSON.parse(jsonSlice);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= openLoops.length)
      .map(n => openLoops[n - 1].id);
  } catch (error) {
    console.error("[MemoryExtraction] Parse loop resolution failed:", error);
    return [];
  }
}

function parseOpenLoopsResponse(responseText: unknown) {
  try {
    const text = String(responseText || "").trim();
    const jsonSlice = extractBalancedJsonArray(text);
    if (!jsonSlice) {
      return [];
    }

    const parsed = parseJsonArrayLeniently(jsonSlice);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(item => item.topic && typeof item.topic === "string")
      .map(item => ({
        topic: sanitizeText(item.topic, 100)
      }))
      .slice(0, 3);
  } catch (error) {
    console.error("[MemoryExtraction] Parse open loops failed:", error);
    return [];
  }
}

export {
  RESERVED_MEMORY_KEYS,
  ALLOWED_CATEGORIES,
  EXISTING_MEMORIES_PROMPT_LIMIT,
  normalizeKey,
  isReservedMemoryKey,
  validateMemoryKey,
  sanitizeText,
  validateExtractedMemory,
  buildExtractionPrompt,
  parseExtractionResponse,
  detectOpenLoops,
  detectCompletionSignals,
  calculateSimilarity,
  detectConflict,
  buildOpenLoopsDetectionPrompt,
  parseOpenLoopsResponse,
  buildLoopResolutionPrompt,
  parseLoopResolutionResponse,
  extractBalancedJsonArray,
  stripTrailingExpressionTag,
  repairUnquotedStringValues,
  parseJsonArrayLeniently
};
export type { PromptTurn, StoredMemory, OpenLoop };
