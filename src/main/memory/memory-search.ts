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

// 프롬프트에 올릴 미완료 주제의 나이 상한(마지막 언급 이후 경과 일수). 오래 언급되지 않은
// 주제를 계속 보여주면 펫이 몇 달 전 일을 "그거 어떻게 됐어?"로 되묻는다 — 사람이 물어도
// 자연스럽지 않은 상한이라 3주 아래로 뒀다(2026-08-14 사용자 피드백).
// 해결됐는데 자동 판정이 놓쳐 열린 채로 남은 주제도 이 필터로 함께 조용해진다.
// DB에서 지우거나 닫지는 않는다 — 사용자는 설정창 기억 관리 탭에서 그대로 보고 직접 닫는다.
const OPEN_LOOP_PROMPT_MAX_AGE_DAYS = 14;

/**
 * 프롬프트에 올릴 미완료 주제만 고른다. 마지막 언급 시각을 못 읽으면 남긴다 —
 * 날짜를 못 읽었다는 이유로 주제가 조용히 사라지면 원인을 찾기 어렵다.
 *
 * **펫이 미완료 주제를 소재로 삼을지 판정하는 곳(`hasOpenLoops`)도 이 함수를 써야 한다.**
 * 판정과 실제 블록이 갈리면 "미완료 주제 중 하나를 골라 물어보라"는 지시만 가고 목록은
 * 비어서, 모델이 없는 주제를 지어낸다.
 */
function selectPromptOpenLoops(
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
  selectPromptOpenLoops,
  OPEN_LOOP_PROMPT_MAX_AGE_DAYS
};
