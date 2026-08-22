// 장기 기억 검색: 사용자의 말과 관련 있는 기억을 골라 대화 프롬프트에 넣을 블록으로 만든다.
//
// 2026-08-10까지 이 모듈은 만들어져 있기만 하고 어디서도 호출되지 않았다 — 기억을 모으고
// 설정창에 보여주기는 하는데 정작 답변에는 쓰지 않는 상태였다. 지금은 main.js의
// relatedMemoryBlock()이 askGemini() 프롬프트를 만들 때 쓴다.
const { t } = require("../../shared/i18n.js");

const KEYWORD_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "is", "are", "was", "were", "be", "been",
  "을", "를", "이", "가", "에", "에서", "으로", "로", "와", "랑", "이랑", "또는", "그리고"
]);

const KOREAN_PARTICLE_SUFFIXES = [
  "에서", "으로", "이랑", "을", "를", "이", "가", "에", "로", "와", "랑"
];

type KeywordCandidate = { raw: string; normalized: string };
type MemoryRecord = Record<string, unknown>;

function matchesKoreanParticleForm(suffix: string, stem: string) {
  const finalConsonantIndex = (stem.charCodeAt(stem.length - 1) - 0xAC00) % 28;
  const hasFinalConsonant = finalConsonantIndex !== 0;

  if (suffix === "에" || suffix === "에서") return true;
  if (suffix === "으로") return hasFinalConsonant && finalConsonantIndex !== 8;
  if (suffix === "로") return !hasFinalConsonant || finalConsonantIndex === 8;
  if (suffix === "을" || suffix === "이" || suffix === "이랑") return hasFinalConsonant;
  return !hasFinalConsonant;
}

function stripKoreanParticle(word: string) {
  if (!/^[가-힣]+$/.test(word)) return word;

  for (const suffix of KOREAN_PARTICLE_SUFFIXES) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    if (stem.length <= 1) return word;
    return matchesKoreanParticleForm(suffix, stem) ? stem : word;
  }
  return word;
}

/**
 * 원문과 조사 제거형을 함께 보관한다. 명사가 조사와 같은 음절로 끝날 수도 있으므로 점수 계산에서
 * 원문 일치를 우선하고, 제거형은 원문이 맞지 않을 때만 약한 보조 신호로 쓴다.
 */
function extractKeywordCandidates(text: unknown): KeywordCandidate[] {
  if (!text || typeof text !== "string") return [];

  const candidatesByKeyword = new Map<string, KeywordCandidate>();
  let acceptedWordCount = 0;
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, "")
    .split(/\s+/);

  for (const raw of words) {
    const normalized = stripKoreanParticle(raw);
    if (normalized.length <= 1 || KEYWORD_STOP_WORDS.has(normalized)) continue;
    acceptedWordCount += 1;
    const existing = candidatesByKeyword.get(normalized);
    if (!existing || raw === normalized) {
      candidatesByKeyword.set(normalized, { raw, normalized });
    }
    if (acceptedWordCount >= 5) break;
  }

  return [...candidatesByKeyword.values()];
}

/**
 * 사용자 문장에서 검색에 쓸 단어를 뽑는다.
 * 형태소 분석기 없이 자주 쓰는 조사 접미사만 제거한다. 제거 후 한 글자만 남으면 원문을
 * 유지해 "사과" 같은 두 글자 명사를 검색어에서 잃지 않게 한다.
 */
function extractKeywords(text: unknown): string[] {
  return extractKeywordCandidates(text).map(candidate => candidate.normalized);
}

/**
 * 기억 한 건의 관련도 점수(0~1). 키워드 일치뿐 아니라 확인 여부·중요도·언급 횟수·최근성을
 * 함께 본다.
 *
 * **값이 없는 필드는 0으로 친다.** 예전에는 `mention_count`나 `last_updated_at`이 없으면
 * 점수가 통째로 NaN이 됐는데, 그러면 findRelatedMemories의 정렬 비교자가 NaN을 돌려줘
 * 순위가 사실상 무작위가 된다(에러도 안 난다). DB에서 온 행에는 두 컬럼이 다 있지만,
 * 여기서 막아두지 않으면 호출부가 조금만 달라져도 조용히 망가진다.
 */
function scoreMemory(
  memory: MemoryRecord,
  keywords: Array<string | KeywordCandidate>,
  baseScore = 0.5
) {
  let score = baseScore;

  if (memory.is_verified) score += 0.3;

  const label_lower = String(memory.memory_label || "").toLowerCase();
  const value_lower = String(memory.memory_value || "").toLowerCase();

  let keywordMatches = 0;
  keywords.forEach(keyword => {
    const raw = typeof keyword === "string" ? keyword : keyword.raw;
    const normalized = typeof keyword === "string" ? keyword : keyword.normalized;
    if (label_lower.includes(raw)) keywordMatches += 1;
    else if (normalized !== raw && label_lower.includes(normalized)) keywordMatches += 0.5;
    if (value_lower.includes(raw)) keywordMatches += 1;
    else if (normalized !== raw && value_lower.includes(normalized)) keywordMatches += 0.5;
  });

  score += Math.min(0.3, keywordMatches * 0.1);

  const importance = Number(memory.importance);
  score += (Number.isFinite(importance) ? importance : 0) * 0.2;

  const mentionCount = Number(memory.mention_count);
  score += Math.min(0.1, (Number.isFinite(mentionCount) ? mentionCount : 0) / 10);

  const lastUpdated = new Date(String(memory.last_updated_at || "")).getTime();
  if (Number.isFinite(lastUpdated)) {
    const daysSinceUpdate = (Date.now() - lastUpdated) / (24 * 60 * 60 * 1000);
    score += Math.max(0, 0.2 - daysSinceUpdate * 0.02);
  }

  return Math.min(1, score);
}

/**
 * 사용자 문장과 관련 있는 기억을 점수순으로 고른다.
 * 검색어를 못 뽑았으면(짧은 인사 등) 최근에 갱신된 것부터 준다.
 * 점수 경로에서는 반환한 기억에 score 필드가 붙는다.
 */
function findRelatedMemories(
  memories: MemoryRecord[],
  userMessage: unknown,
  limit = 5
): MemoryRecord[] {
  if (!Array.isArray(memories) || memories.length === 0) return [];

  const keywordCandidates = extractKeywordCandidates(userMessage);
  if (keywordCandidates.length === 0) {
    return [...memories]
      .sort((a, b) => {
        const timeA = new Date(String(a.last_updated_at || "")).getTime() || 0;
        const timeB = new Date(String(b.last_updated_at || "")).getTime() || 0;
        return timeB - timeA;
      })
      .slice(0, limit);
  }

  return memories
    .map(memory => ({ ...memory, score: scoreMemory(memory, keywordCandidates) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * 고른 기억을 프롬프트에 넣을 블록으로 만든다. 확인된 기억은 ✓, 아닌 건 ○로 표시해
 * 모델이 확신 정도를 구분할 수 있게 한다.
 */
function buildMemoryContextBlock(relatedMemories: MemoryRecord[], language = "ko"): string {
  if (!Array.isArray(relatedMemories) || relatedMemories.length === 0) return "";

  const lines = relatedMemories.map(memory => t(language, "assistant.relatedMemoryLine", {
    mark: memory.is_verified ? "✓" : "○",
    label: String(memory.memory_label ?? ""),
    value: String(memory.memory_value ?? "")
  }));

  return `\n\n${t(language, "assistant.relatedMemoryHeader")}\n${lines.join("\n")}\n`;
}

// 펫이 **스스로 꺼내도 되는** 미완료 주제의 나이 상한(마지막 언급 이후 경과 일수).
// 오래 언급되지 않은 주제를 계속 보여주면 펫이 지난달 일을 "그거 어떻게 됐어?"로 되묻고,
// 해결됐는데 자동 판정이 놓친 주제까지 섞여 쓸데없이 쌓인다(2026-08-14에 2주로 뒀다가
// 2026-08-21 사용자 피드백으로 3일). 상한을 넘긴 주제도 영구히 사라지지는 않는다 —
// 사용자가 그 이야기를 먼저 꺼내면 `selectPromptOpenLoops()`가 다시 올린다.
// DB에서 지우거나 닫지는 않는다 — 표 정리는 `archiveStaleOpenLoops()`가 따로 판단하고,
// 사용자는 설정창 기억 관리 탭에서 그대로 보고 직접 닫는다.
const OPEN_LOOP_PROMPT_MAX_AGE_DAYS = 3;

// 사용자가 먼저 꺼내서 되살아나는 오래된 주제의 개수 상한. 질문 한 마디에 옛 주제가
// 우르르 붙으면 위 상한을 둔 의미가 없어진다.
const OPEN_LOOP_RECALL_LIMIT = 3;

// 오래된 주제를 되살릴지 판정할 때 훑어볼 사용자 문장 길이 상한. 문서를 그대로 붙여넣은
// 질문에서 두 글자 조각을 전부 뽑으면 무엇에든 걸린다.
const OPEN_LOOP_RECALL_SCAN_CHARS = 300;

// 두 글자 조각이 몇 개 겹쳐야 "그 이야기를 꺼냈다"로 볼지. 한 조각만으로는 흔한 어미에도 걸린다.
const OPEN_LOOP_RECALL_MIN_GRAMS = 2;

// 공백으로 단어를 끊지 않는 문자(한글·가나·한자). 일본어는 형태소 분석기가 없으면 문장
// 전체가 한 토큰이 되고 `extractKeywordCandidates()`의 문자 필터에서 아예 지워지므로,
// 단어 일치만 쓰면 되살리기 경로가 일본어에서 조용히 아무것도 못 찾는다.
// 가나(3040~30FF)·CJK 확장A(3400~4DBF)·CJK 통합한자(4E00~9FFF)·호환한자(F900~FAFF)·한글 음절.
const NO_WORD_BOUNDARY_CHAR = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힣]/;

/** 공백으로 끊을 수 없는 문자만 이어진 두 글자 조각을 모은다. */
function extractNoBoundaryBigrams(text: unknown): Set<string> {
  const grams = new Set<string>();
  if (!text || typeof text !== "string") return grams;

  const scanned = text.slice(0, OPEN_LOOP_RECALL_SCAN_CHARS).toLowerCase();
  for (let index = 0; index + 1 < scanned.length; index += 1) {
    const first = scanned[index];
    const second = scanned[index + 1];
    if (NO_WORD_BOUNDARY_CHAR.test(first) && NO_WORD_BOUNDARY_CHAR.test(second)) {
      grams.add(first + second);
    }
  }
  return grams;
}

/**
 * 사용자 문장이 그 주제를 직접 가리키는지 본다. 조사 제거 단어 일치(한국어·영어)와
 * 두 글자 조각 겹침(일본어·한자)을 함께 쓴다 — 언어별로 갈라 쓰지 않고 둘 다 보므로
 * 어느 언어에서도 이 경로가 통째로 죽지 않는다.
 */
function referencesOpenLoopTopic(question: unknown, topic: unknown): boolean {
  const topicText = String(topic ?? "").toLowerCase();
  if (!topicText) return false;

  for (const candidate of extractKeywordCandidates(question)) {
    if (topicText.includes(candidate.raw)) return true;
    if (candidate.normalized !== candidate.raw && topicText.includes(candidate.normalized)) return true;
  }

  const topicGrams = extractNoBoundaryBigrams(topicText);
  if (topicGrams.size === 0) return false;

  let gramMatches = 0;
  for (const gram of extractNoBoundaryBigrams(question)) {
    if (!topicGrams.has(gram)) continue;
    gramMatches += 1;
    if (gramMatches >= OPEN_LOOP_RECALL_MIN_GRAMS) return true;
  }
  return false;
}

/**
 * 펫이 스스로 꺼내도 되는 미완료 주제만 고른다. 마지막 언급 시각을 못 읽으면 남긴다 —
 * 날짜를 못 읽었다는 이유로 주제가 조용히 사라지면 원인을 찾기 어렵다.
 *
 * **펫이 미완료 주제를 소재로 삼을지 판정하는 곳(`hasOpenLoops`)은 이 함수를 써야 한다.**
 * 판정에 `selectPromptOpenLoops()`를 쓰면 사용자 질문에 걸려 되살아난 옛 주제까지 세어
 * "미완료 주제 중 하나를 골라 물어보라"는 지시가 살아나고, 상한을 둔 의미가 없어진다.
 */
function selectFreshOpenLoops(
  openLoops: MemoryRecord[],
  maxAgeDays = OPEN_LOOP_PROMPT_MAX_AGE_DAYS
): MemoryRecord[] {
  if (!Array.isArray(openLoops)) return [];
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return openLoops.filter(loop => {
    const mentionedAt = new Date(String(loop.last_mentioned_at || "")).getTime();
    return Number.isFinite(mentionedAt) ? mentionedAt >= cutoff : true;
  });
}

/**
 * 프롬프트에 올릴 미완료 주제. 상한 안쪽 주제는 그대로 올리고, 상한을 넘긴 주제는
 * 사용자가 이번 문장에서 그 이야기를 직접 꺼냈을 때만 뒤에 덧붙인다 — "펫이 먼저
 * 되묻지는 않지만 물어보면 기억한다"가 이 함수의 계약이다.
 *
 * 결과는 항상 `selectFreshOpenLoops()`의 상위집합이라, 소재 판정이 참이면 블록도 비지 않는다.
 * 펫이 먼저 말을 거는 경로는 사용자 발화가 없으므로 `userMessage`를 비워 부른다 —
 * 오프너 지시문을 그대로 넘기면 지시문 단어에 옛 주제가 걸린다.
 */
function selectPromptOpenLoops(
  openLoops: MemoryRecord[],
  userMessage: unknown = "",
  options: { maxAgeDays?: number; recallLimit?: number } = {}
): MemoryRecord[] {
  if (!Array.isArray(openLoops)) return [];

  const maxAgeDays = Number.isFinite(options.maxAgeDays)
    ? Number(options.maxAgeDays)
    : OPEN_LOOP_PROMPT_MAX_AGE_DAYS;
  const recallLimit = Number.isFinite(options.recallLimit)
    ? Number(options.recallLimit)
    : OPEN_LOOP_RECALL_LIMIT;

  const fresh = selectFreshOpenLoops(openLoops, maxAgeDays);
  if (recallLimit <= 0) return fresh;

  const freshLoops = new Set(fresh);
  const recalled = openLoops
    .filter(loop => !freshLoops.has(loop) && referencesOpenLoopTopic(userMessage, loop.topic))
    .slice(0, recallLimit);

  return recalled.length > 0 ? [...fresh, ...recalled] : fresh;
}

/**
 * 미완료 주제 블록. 마지막 언급이 언제였는지도 같이 준다 — 모델이 "그거 어떻게 됐어?"를
 * 자연스러운 시점에만 꺼내도록 판단 재료로 쓴다.
 */
function buildOpenLoopsContextBlock(openLoops: MemoryRecord[], language = "ko"): string {
  if (!Array.isArray(openLoops) || openLoops.length === 0) return "";

  const lines = openLoops.map(loop => {
    const mentionedAt = new Date(String(loop.last_mentioned_at || "")).getTime();
    const daysSinceMention = Number.isFinite(mentionedAt)
      ? Math.max(0, Math.floor((Date.now() - mentionedAt) / (24 * 60 * 60 * 1000)))
      : 0;
    const when = daysSinceMention === 0
      ? t(language, "assistant.openLoopsToday")
      : t(language, "assistant.openLoopsDaysAgo", { days: daysSinceMention });
    return t(language, "assistant.openLoopsLine", { topic: String(loop.topic ?? ""), when });
  });

  return `\n\n${t(language, "assistant.openLoopsHeader")}\n${lines.join("\n")}\n`;
}

export {
  extractKeywords,
  scoreMemory,
  findRelatedMemories,
  buildMemoryContextBlock,
  buildOpenLoopsContextBlock,
  selectFreshOpenLoops,
  selectPromptOpenLoops,
  referencesOpenLoopTopic,
  OPEN_LOOP_PROMPT_MAX_AGE_DAYS,
  OPEN_LOOP_RECALL_LIMIT
};
