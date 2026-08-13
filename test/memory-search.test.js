// @ts-check
// 장기 기억 검색 회귀 테스트 (2026-08-10).
//
// 이 모듈은 만들어져 있기만 하고 어디서도 호출되지 않다가 2026-08-10에 askGemini()
// 프롬프트에 연결됐다. 이제 사용자가 보는 답변 품질에 직접 영향을 주므로,
// 순위 매기기와 블록 문구를 여기서 고정한다.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractKeywords,
  scoreMemory,
  findRelatedMemories,
  buildMemoryContextBlock,
  buildOpenLoopsContextBlock
} = require("../src/main/memory/memory-search.js");

/** @param {number} days */
function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** DB(long_term_memory)에서 나오는 행의 모양. */
function memory(overrides = {}) {
  return {
    memory_key: "coffee_taste",
    memory_label: "커피 취향",
    memory_value: "라떼를 좋아함",
    category: "preference",
    importance: 0.8,
    mention_count: 1,
    is_verified: false,
    last_updated_at: daysAgo(1),
    ...overrides
  };
}

// ── 검색어 뽑기 ──────────────────────────────────────────────────────────────

test("한 글자와 불용어를 걸러내고 최대 5개까지 뽑는다", () => {
  assert.deepEqual(extractKeywords("나는 커피 라떼 좋아해"), ["나는", "커피", "라떼", "좋아해"]);
  assert.deepEqual(extractKeywords("a the and 커피"), ["커피"]);
  assert.equal(extractKeywords("하나 다섯 여섯 일곱 여덟 아홉 열하나").length, 5);
});

test("문자열이 아니거나 비어 있으면 빈 배열", () => {
  assert.deepEqual(extractKeywords(""), []);
  assert.deepEqual(extractKeywords(null), []);
  assert.deepEqual(extractKeywords(123), []);
});

test("단어에 붙은 한국어 조사를 제거한다", () => {
  assert.deepEqual(
    extractKeywords("커피랑 라떼를 회사에서 친구와 이야기"),
    ["커피", "라떼", "회사", "친구", "이야기"]
  );
  assert.deepEqual(extractKeywords("시험으로 학교에 고양이가"), ["시험", "학교", "고양이"]);
  assert.deepEqual(extractKeywords("여행이랑 서울로"), ["여행", "서울"]);
});

test("조사와 같은 음절로 끝나는 두 글자 명사는 유지한다", () => {
  assert.deepEqual(extractKeywords("사과 종이 전문가"), ["사과", "종이", "전문가"]);
});

test("잘못된 조사 이형태는 단어를 자르지 않는다", () => {
  assert.deepEqual(
    extractKeywords("커피을 시험를 커피이랑 서울으로"),
    ["커피을", "시험를", "커피이랑", "서울으로"]
  );
});

test("영문과 숫자 검색어는 기존대로 유지한다", () => {
  assert.deepEqual(
    extractKeywords("Coffee AND GPT4 node18 2026"),
    ["coffee", "gpt4", "node18", "2026"]
  );
});

// ── 점수 ─────────────────────────────────────────────────────────────────────

test("점수는 항상 0~1 사이의 유한한 수다", () => {
  const score = scoreMemory(memory(), ["라떼를"]);
  assert.ok(Number.isFinite(score));
  assert.ok(score > 0 && score <= 1);
});

test("필드가 비어 있어도 NaN이 되지 않는다", () => {
  // NaN이 되면 정렬 비교자가 NaN을 돌려줘 순위가 사실상 무작위가 된다(에러는 안 난다).
  const broken = { memory_label: "l", memory_value: "v" };
  const score = scoreMemory(broken, ["v"]);
  assert.ok(Number.isFinite(score), "mention_count·last_updated_at·importance가 없어도 유한해야 한다");

  assert.ok(Number.isFinite(scoreMemory(memory({ mention_count: undefined }), [])));
  assert.ok(Number.isFinite(scoreMemory(memory({ last_updated_at: "날짜아님" }), [])));
  assert.ok(Number.isFinite(scoreMemory(memory({ importance: null }), [])));
});

test("키워드가 맞으면 점수가 올라간다", () => {
  const keywords = ["라떼를"];
  assert.ok(scoreMemory(memory(), keywords) > scoreMemory(memory(), ["자동차"]));
});

test("확인된 기억과 최근 기억이 더 높다", () => {
  assert.ok(scoreMemory(memory({ is_verified: true }), []) > scoreMemory(memory({ is_verified: false }), []));
  assert.ok(scoreMemory(memory({ last_updated_at: daysAgo(0) }), []) >
    scoreMemory(memory({ last_updated_at: daysAgo(30) }), []));
});

// ── 관련 기억 고르기 ──────────────────────────────────────────────────────────

test("관련도가 높은 것부터 limit만큼 준다", () => {
  const memories = [
    memory({ memory_key: "car", memory_label: "차", memory_value: "자전거를 탐" }),
    memory({ memory_key: "coffee", memory_label: "커피", memory_value: "라떼를 좋아함" })
  ];
  const related = findRelatedMemories(memories, "오늘 라떼를 마셨어", 1);
  assert.equal(related.length, 1);
  assert.equal(related[0].memory_key, "coffee");
});

test("조사가 붙은 질문도 해당 기억의 순위를 올린다", () => {
  const memories = [
    memory({
      memory_key: "car", memory_label: "자동차", memory_value: "드라이브를 좋아함",
      importance: 0.2, mention_count: 0, last_updated_at: "날짜아님"
    }),
    memory({
      memory_key: "coffee", memory_label: "커피", memory_value: "차가운 음료",
      importance: 0, mention_count: 0, last_updated_at: "날짜아님"
    })
  ];
  const related = findRelatedMemories(memories, "커피랑 이야기", 1);
  assert.equal(related[0].memory_key, "coffee");
});

test("조사와 같은 끝 음절의 명사는 원문 일치를 우선한다", () => {
  const shared = { importance: 0, mention_count: 0, last_updated_at: "날짜아님" };
  const memories = [
    memory({ ...shared, memory_key: "restaurant-stem", memory_label: "레스토", memory_value: "줄임말" }),
    memory({ ...shared, memory_key: "restaurant", memory_label: "레스토랑", memory_value: "식당" })
  ];
  const related = findRelatedMemories(memories, "레스토랑", 1);
  assert.equal(related[0].memory_key, "restaurant");
});

test("검색어를 못 뽑으면 최근 갱신 순으로 준다", () => {
  const memories = [
    memory({ memory_key: "old", last_updated_at: daysAgo(30) }),
    memory({ memory_key: "new", last_updated_at: daysAgo(0) })
  ];
  // "음" 한 글자는 걸러져서 검색어가 하나도 안 남는다.
  const related = findRelatedMemories(memories, "음", 2);
  assert.deepEqual(related.map((m) => m.memory_key), ["new", "old"]);
});

test("원본 배열을 뒤섞지 않는다", () => {
  const memories = [
    memory({ memory_key: "a", last_updated_at: daysAgo(30) }),
    memory({ memory_key: "b", last_updated_at: daysAgo(0) })
  ];
  findRelatedMemories(memories, "음", 2);
  assert.deepEqual(memories.map((m) => m.memory_key), ["a", "b"], "호출부의 배열이 정렬돼 버리면 안 된다");
});

test("빈 입력에서 예외가 나지 않는다", () => {
  assert.deepEqual(findRelatedMemories([], "라떼"), []);
  assert.deepEqual(findRelatedMemories(/** @type {any} */ (null), "라떼"), []);
});

// ── 프롬프트 블록 ────────────────────────────────────────────────────────────

test("기억이 없으면 빈 문자열이라 프롬프트가 늘어나지 않는다", () => {
  assert.equal(buildMemoryContextBlock([], "ko"), "");
  assert.equal(buildMemoryContextBlock(/** @type {any} */ (null), "ko"), "");
  assert.equal(buildOpenLoopsContextBlock([], "ko"), "");
  assert.equal(buildOpenLoopsContextBlock(/** @type {any} */ (null), "ko"), "");
});

test("기억 블록에 레이블과 값이 들어가고 확인 여부를 표시한다", () => {
  const block = buildMemoryContextBlock([
    memory({ is_verified: true }),
    memory({ memory_key: "k2", memory_label: "취미", memory_value: "등산", is_verified: false })
  ], "ko");
  assert.ok(block.includes("커피 취향: 라떼를 좋아함"));
  assert.ok(block.includes("취미: 등산"));
  assert.ok(block.includes("✓"), "확인된 기억 표시");
  assert.ok(block.includes("○"), "확인 안 된 기억 표시");
});

test("블록은 언어를 따른다", () => {
  const mems = [memory()];
  assert.notEqual(buildMemoryContextBlock(mems, "ko"), buildMemoryContextBlock(mems, "en"));
  assert.notEqual(buildMemoryContextBlock(mems, "en"), buildMemoryContextBlock(mems, "ja"));
});

test("미완료 주제의 경과 일수도 언어를 따른다", () => {
  const loops = [{ topic: "시험 결과", last_mentioned_at: daysAgo(3) }];
  const ko = buildOpenLoopsContextBlock(loops, "ko");
  const en = buildOpenLoopsContextBlock(loops, "en");
  assert.ok(ko.includes("시험 결과"));
  assert.ok(ko.includes("3일 전"));
  // 예전에는 헤더만 번역하고 "3일 전"은 언어와 무관하게 한국어로 붙었다.
  assert.ok(en.includes("3 days ago"));
  assert.ok(!en.includes("일 전"));
});

test("오늘 언급한 주제는 '오늘'로 표시한다", () => {
  const loops = [{ topic: "면접", last_mentioned_at: daysAgo(0) }];
  assert.ok(buildOpenLoopsContextBlock(loops, "ko").includes("오늘"));
  assert.ok(buildOpenLoopsContextBlock(loops, "en").includes("today"));
});

test("날짜가 깨져 있어도 블록이 만들어진다", () => {
  const block = buildOpenLoopsContextBlock([{ topic: "무언가", last_mentioned_at: null }], "ko");
  assert.ok(block.includes("무언가"));
  assert.ok(!block.includes("NaN"));
});
