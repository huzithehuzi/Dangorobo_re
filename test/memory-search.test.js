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
  buildOpenLoopsContextBlock,
  selectFreshOpenLoops,
  selectPromptOpenLoops,
  referencesOpenLoopTopic,
  OPEN_LOOP_PROMPT_MAX_AGE_DAYS,
  OPEN_LOOP_RECALL_LIMIT
} = require("../src/main/memory/memory-search.js");
const fs = require("node:fs");
const path = require("node:path");

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

// ── 오래된 미완료 주제 걸러내기 (2026-08-14, 2026-08-21 되살리기 추가) ──────────────
//
// 오래 언급되지 않은 주제를 계속 프롬프트에 넣으면 펫이 지난달 일을 되묻고, 해결된 줄
// 모르고 남은 주제까지 쌓인다. selectFreshOpenLoops는 "펫이 스스로 꺼내도 되는 것",
// selectPromptOpenLoops는 "거기에 사용자가 방금 꺼낸 옛 주제를 더한 것"이다.
// DB에서 지우지는 않으므로, 여기서 고정하는 것은 "무엇을 프롬프트에 올리는지"뿐이다.

test("상한보다 오래된 주제는 펫이 먼저 꺼낼 수 없고 최근 것만 남는다", () => {
  const fresh = { topic: "오늘 발표", last_mentioned_at: daysAgo(0) };
  const edge = { topic: "상한 직전", last_mentioned_at: daysAgo(OPEN_LOOP_PROMPT_MAX_AGE_DAYS - 1) };
  const stale = { topic: "석 달 전 이사", last_mentioned_at: daysAgo(90) };

  assert.deepEqual(
    selectFreshOpenLoops([fresh, edge, stale]).map((loop) => loop.topic),
    ["오늘 발표", "상한 직전"]
  );
});

test("상한 일수는 기본값으로 쓰이고 호출부가 덮어쓸 수 있다", () => {
  assert.equal(OPEN_LOOP_PROMPT_MAX_AGE_DAYS, 3);
  const loops = [{ topic: "이틀 전", last_mentioned_at: daysAgo(2) }];
  assert.equal(selectFreshOpenLoops(loops).length, 1, "기본 상한 안");
  assert.equal(selectFreshOpenLoops(loops, 1).length, 0, "상한을 줄이면 빠진다");
});

test("마지막 언급 시각을 못 읽는 주제는 남긴다", () => {
  // 날짜를 못 읽었다는 이유로 조용히 사라지면 원인을 찾기 어렵다.
  const loops = [
    { topic: "날짜 없음", last_mentioned_at: null },
    { topic: "깨진 날짜", last_mentioned_at: "언젠가" }
  ];
  assert.equal(selectFreshOpenLoops(loops).length, 2);
  assert.equal(selectPromptOpenLoops(loops, "아무 말").length, 2);
});

test("사용자 발화가 없으면 오래된 주제는 블록에 안 실린다", () => {
  const loops = [
    { topic: "어제 산 재료", last_mentioned_at: daysAgo(1) },
    { topic: "작년 자격증", last_mentioned_at: daysAgo(300) }
  ];
  const block = buildOpenLoopsContextBlock(selectPromptOpenLoops(loops, ""), "ko");
  assert.ok(block.includes("어제 산 재료"));
  assert.ok(!block.includes("작년 자격증"));
});

// ── 사용자가 먼저 꺼낸 옛 주제 되살리기 (2026-08-21) ───────────────────────────────
//
// 3일 상한만 두면 "펫이 안 꺼낸다"와 "물어봐도 모른다"가 같아진다. 미완료 주제 블록은
// 장기 기억과 달리 질문과 무관하게 통째로 실리므로, 상한을 넘긴 주제는 사용자가 그
// 이야기를 직접 꺼냈을 때만 되살린다.

test("사용자가 그 이야기를 꺼내면 상한을 넘긴 주제도 되살아난다", () => {
  const loops = [
    { topic: "이번 주 장보기", last_mentioned_at: daysAgo(1) },
    { topic: "자격증 시험 결과 기다리는 중", last_mentioned_at: daysAgo(40) },
    { topic: "작년 이사 견적", last_mentioned_at: daysAgo(200) }
  ];

  const topics = selectPromptOpenLoops(loops, "그 자격증 시험 결과 나왔어?").map((loop) => loop.topic);
  assert.deepEqual(topics, ["이번 주 장보기", "자격증 시험 결과 기다리는 중"]);
});

test("되살아난 주제는 최신 주제 뒤에 붙고 개수 상한을 넘지 않는다", () => {
  const stale = Array.from({ length: 6 }, (_, index) => ({
    topic: `발표 준비 ${index}`,
    last_mentioned_at: daysAgo(30 + index)
  }));
  const loops = [{ topic: "오늘 산책", last_mentioned_at: daysAgo(0) }, ...stale];

  const selected = selectPromptOpenLoops(loops, "발표 어떻게 됐어?");
  assert.equal(selected[0].topic, "오늘 산책", "최신 주제가 앞에 온다");
  assert.equal(selected.length, 1 + OPEN_LOOP_RECALL_LIMIT);
});

test("되살리기 결과는 항상 최신 목록의 상위집합이다", () => {
  // 펫대화의 소재 판정(selectFreshOpenLoops)이 참인데 블록이 비면 모델이 주제를 지어낸다.
  const loops = [
    { topic: "오늘 병원 예약", last_mentioned_at: daysAgo(0) },
    { topic: "지난달 노트북 수리", last_mentioned_at: daysAgo(45) }
  ];
  const fresh = selectFreshOpenLoops(loops).map((loop) => loop.topic);
  const prompt = selectPromptOpenLoops(loops, "노트북 수리 다 됐어").map((loop) => loop.topic);
  assert.ok(fresh.every((topic) => prompt.includes(topic)));
  assert.ok(prompt.length > fresh.length);
});

test("되살리기 상한이 0이면 최신 주제만 남는다", () => {
  const loops = [{ topic: "지난달 이사 견적", last_mentioned_at: daysAgo(45) }];
  assert.deepEqual(selectPromptOpenLoops(loops, "이사 견적 어떻게 됐어?", { recallLimit: 0 }), []);
});

test("관계 없는 질문에는 옛 주제가 붙지 않는다", () => {
  const loops = [{ topic: "자격증 시험 결과", last_mentioned_at: daysAgo(40) }];
  assert.deepEqual(selectPromptOpenLoops(loops, "오늘 점심 뭐 먹을까?"), []);
});

// ── 되살리기 판정은 언어별로 갈라 쓰지 않는다 ─────────────────────────────────────
//
// 조사 제거 단어 일치만 쓰면 일본어에서 이 경로가 통째로 죽는다 — 형태소 분석기가 없어
// 문장이 한 토큰이 되고, 키워드 추출의 문자 필터가 가나·한자를 아예 지운다.

test("한국어는 조사가 붙은 표현으로도 주제를 가리킨다", () => {
  assert.ok(referencesOpenLoopTopic("발표를 언제 한다고 했지", "다음 주 발표 준비"));
  assert.ok(!referencesOpenLoopTopic("고양이 밥 줬어", "다음 주 발표 준비"));
});

test("영어도 단어 일치로 주제를 가리킨다", () => {
  assert.ok(referencesOpenLoopTopic("any news on the presentation?", "waiting for presentation results"));
  assert.ok(!referencesOpenLoopTopic("what should I eat tonight?", "waiting for presentation results"));
});

test("일본어는 공백이 없어도 주제를 가리킨다", () => {
  // 단어 일치만 쓰던 시절에는 이 검사가 통째로 false였다.
  assert.ok(referencesOpenLoopTopic("資格試験の結果どうなった?", "資格試験の結果待ち"));
  assert.ok(!referencesOpenLoopTopic("今日は何を食べようかな", "資格試験の結果待ち"));
});

test("두 글자 한 조각만 겹치면 되살리지 않는다", () => {
  // 흔한 어미 한 조각으로 옛 주제가 우르르 붙으면 상한을 둔 의미가 없다.
  assert.ok(!referencesOpenLoopTopic("今日はいい天気", "資格試験の結果待ち"));
});

test("빈 주제나 빈 질문에는 아무것도 걸리지 않는다", () => {
  assert.equal(referencesOpenLoopTopic("자격증 시험", ""), false);
  assert.equal(referencesOpenLoopTopic("", "자격증 시험"), false);
  assert.equal(referencesOpenLoopTopic(null, "자격증 시험"), false);
});

test("main은 프롬프트 블록과 펫대화 판정에 서로 다른 목적의 필터를 쓴다", () => {
  // 판정에 되살리기 필터를 쓰면 사용자 질문에 걸린 옛 주제까지 세어, 오프너에서는 비어
  // 있는 목록을 두고 "미완료 주제 중 하나를 골라 물어보라"는 지시가 나간다.
  const mainSource = fs
    .readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8")
    .replace(/\s+/g, " ");
  assert.ok(
    mainSource.includes("buildOpenLoopsContextBlock( selectPromptOpenLoops("),
    "프롬프트 블록은 되살리기 필터를 거친다"
  );
  assert.ok(
    mainSource.includes(
      "hasOpenLoops: () => settings.assistantMemoryEnabled && selectFreshOpenLoops(getOpenLoops()).length > 0"
    ),
    "펫대화 판정은 최신 주제만 센다"
  );
  assert.ok(
    !mainSource.includes("hasOpenLoops: () => settings.assistantMemoryEnabled && selectPromptOpenLoops("),
    "판정이 되살리기 필터로 되돌아가면 안 된다"
  );
});

test("펫이 먼저 말 거는 경로는 되살리기를 끈다", () => {
  // 오프너는 질문 자리에 지시문이 들어간다 — 그 문장에 옛 주제가 걸리면 3일 상한이 무의미해진다.
  const petChatSource = fs
    .readFileSync(path.join(__dirname, "..", "src", "main", "assistant", "pet-chat-service.ts"), "utf8")
    .replace(/\s+/g, " ");
  assert.ok(petChatSource.includes("recallOpenLoops: false"));

  const mainSource = fs
    .readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8")
    .replace(/\s+/g, " ");
  assert.ok(
    mainSource.includes('options.recallOpenLoops === false ? "" : question'),
    "main의 블록이 그 옵션을 실제로 읽는다"
  );
});
