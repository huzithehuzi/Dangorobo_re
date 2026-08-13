// @ts-check
// AI 장기 기억 추출 회귀 테스트 (2026-08-10).
//
// memory-extraction.js는 **LLM이 뱉은 텍스트를 손으로 짠 파서로 읽는** 계층이라,
// 실패해도 예외가 아니라 빈 배열로 조용히 끝난다(사용자에겐 "기억이 저장 안 되네"로만
// 보인다). 그래서 어떤 입력이 통과하고 어떤 입력이 버려지는지를 여기에 못박아둔다.
// electron에 의존하지 않는 순수 함수라 그대로 require해서 돌린다.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ALLOWED_CATEGORIES,
  RESERVED_MEMORY_KEYS,
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
  repairUnquotedStringValues
} = require("../src/main/memory/memory-extraction.js");

/** LLM이 내놓아야 하는 기억 한 건. memory_value만 바꿔가며 파서를 시험한다. */
function record(rawValue = '"라떼를 좋아함"') {
  return `[{"category":"preference","memory_key":"coffee","memory_label":"커피 취향","memory_value":${rawValue},"importance":0.8}]`;
}

// ── 응답에서 JSON 배열 잘라내기 ────────────────────────────────────────────────

test("표정 태그를 떼어낸다", () => {
  assert.equal(stripTrailingExpressionTag("안녕\n[expression: happy]"), "안녕");
  assert.equal(stripTrailingExpressionTag("안녕 [expression:sad]"), "안녕");
  // 중간에 있는 건 응답 본문일 수 있으므로 건드리지 않는다.
  assert.equal(stripTrailingExpressionTag("[expression: happy] 안녕"), "[expression: happy] 안녕");
});

test("설명이나 코드펜스에 둘러싸여 있어도 배열만 잘라낸다", () => {
  assert.equal(extractBalancedJsonArray('네! ```json\n[{"a":1}]\n``` 저장했어요'), '[{"a":1}]');
  assert.equal(extractBalancedJsonArray('알겠습니다 [{"a":1}] 끝'), '[{"a":1}]');
});

test("중첩 배열의 짝을 제대로 맞춘다", () => {
  assert.equal(extractBalancedJsonArray('[{"v":["a","b"]}]'), '[{"v":["a","b"]}]');
  // 문자열 안의 대괄호는 깊이 계산에서 빠져야 한다.
  assert.equal(extractBalancedJsonArray('[{"v":"대괄호 ] 포함"}]'), '[{"v":"대괄호 ] 포함"}]');
});

test("배열이 없거나 닫히지 않으면 null", () => {
  assert.equal(extractBalancedJsonArray("기억할 만한 게 없습니다"), null);
  assert.equal(extractBalancedJsonArray('[{"a":1}'), null);
});

// ── 따옴표가 빠진 값 복구 ──────────────────────────────────────────────────────

test("값의 여는 따옴표가 빠져도 복구한다", () => {
  // LLM이 실제로 자주 내는 형태: "memory_value": 라떼를 좋아함,
  const parsed = parseExtractionResponse(record("라떼를 좋아함"));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].memory_value, "라떼를 좋아함");
});

test("복구할 값 안에 쉼표가 있어도 다음 필드까지만 삼킨다", () => {
  const parsed = parseExtractionResponse(record("라떼, 아메리카노 좋아함"));
  assert.equal(parsed[0].memory_value, "라떼, 아메리카노 좋아함");
  assert.equal(parsed[0].importance, 0.8, "뒤 필드가 값에 먹히면 안 된다");
});

test("이미 올바른 JSON은 복구가 건드리지 않는다", () => {
  const valid = record('"라떼를 좋아함"');
  assert.equal(repairUnquotedStringValues(valid), valid);
});

test("복구 대상은 알려진 필드뿐이다", () => {
  // 스키마에 없는 필드는 손대지 않는다 — 아무 텍스트나 문자열로 감싸면
  // 오히려 멀쩡한 JSON을 망가뜨릴 수 있다.
  const unknown = '[{"category":"fact","unknown_field":베어값,"memory_key":"k"}]';
  assert.equal(repairUnquotedStringValues(unknown), unknown);
});

// ── 추출 응답 파싱 ────────────────────────────────────────────────────────────

test("정상 응답을 그대로 파싱한다", () => {
  const parsed = parseExtractionResponse(record());
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].memory_key, "coffee");
});

test("코드펜스·앞뒤 설명·표정 태그가 붙어도 파싱한다", () => {
  assert.equal(parseExtractionResponse("네! ```json\n" + record() + "\n``` 저장!").length, 1);
  assert.equal(parseExtractionResponse(record() + "\n[expression: happy]").length, 1);
});

test("한 번에 최대 5건까지만 받는다", () => {
  const many = JSON.stringify(
    Array.from({ length: 9 }, (_unused, i) => ({
      category: "fact",
      memory_key: `k${i}`,
      memory_label: `l${i}`,
      memory_value: `v${i}`,
      importance: 0.8
    }))
  );
  assert.equal(parseExtractionResponse(many).length, 5);
});

test("파싱할 수 없으면 예외 대신 빈 배열", () => {
  assert.deepEqual(parseExtractionResponse("기억할 게 없습니다"), []);
  assert.deepEqual(parseExtractionResponse(""), []);
  assert.deepEqual(parseExtractionResponse(null), []);
  assert.deepEqual(parseExtractionResponse('{"not":"array"}'), []);
});

// 아래 셋은 **현재 복구하지 못하는 입력**이다. 고치는 게 목표가 아니라, 지금 어디까지
// 버티는지를 기록해두는 것 — 관대한 복구를 더 넣을수록 멀쩡한 응답을 잘못 읽을 위험도
// 같이 커지므로, 실제로 문제가 되는 게 관측되면 그때 근거를 갖고 늘린다.
test("현재 한계: 후행 쉼표·값 안의 따옴표·잘린 응답은 버린다", () => {
  const trailingComma = '[{"category":"fact","memory_key":"k","memory_label":"l","memory_value":"v","importance":0.8},]';
  assert.deepEqual(parseExtractionResponse(trailingComma), [], "후행 쉼표는 아직 복구 못 함");

  const innerQuote = '[{"category":"fact","memory_key":"q","memory_label":"인용","memory_value":"그는 "안녕"이라 했다","importance":0.8}]';
  assert.deepEqual(parseExtractionResponse(innerQuote), [], "이스케이프 안 된 따옴표는 아직 복구 못 함");

  const truncated = '[{"category":"fact","memory_key":"k","memory_value":"라떼';
  assert.deepEqual(parseExtractionResponse(truncated), [], "잘린 응답은 배열이 안 닫혀서 버린다");
});

// ── 기억 검증 ────────────────────────────────────────────────────────────────

const validCandidate = {
  category: "preference",
  memory_key: "coffee_taste",
  memory_label: "커피 취향",
  memory_value: "라떼를 좋아함",
  importance: 0.8
};

test("정상 후보는 정규화해서 통과시킨다", () => {
  const result = validateExtractedMemory(validCandidate);
  assert.equal(result.valid, true);
  assert.deepEqual(result.normalized, validCandidate);
});

test("카테고리는 허용 목록에 있어야 하고 대소문자는 무시한다", () => {
  assert.equal(validateExtractedMemory({ ...validCandidate, category: "PREFERENCE" }).valid, true);
  assert.equal(validateExtractedMemory({ ...validCandidate, category: "무엇이든" }).valid, false);
  for (const category of ALLOWED_CATEGORIES) {
    assert.equal(validateExtractedMemory({ ...validCandidate, category }).valid, true, category);
  }
});

test("예약 키는 거부한다", () => {
  // 사용자 이름·펫 이름처럼 설정이 소유한 키를 LLM이 덮어쓰면 안 된다.
  for (const key of RESERVED_MEMORY_KEYS) {
    const result = validateExtractedMemory({ ...validCandidate, memory_key: key });
    assert.equal(result.valid, false, key);
    assert.equal(result.reason, "reserved key detected");
  }
});

test("빈 값·빈 레이블·빈 키는 거부한다", () => {
  assert.equal(validateExtractedMemory({ ...validCandidate, memory_key: "" }).valid, false);
  assert.equal(validateExtractedMemory({ ...validCandidate, memory_label: "" }).valid, false);
  assert.equal(validateExtractedMemory({ ...validCandidate, memory_value: "" }).valid, false);
  assert.equal(validateExtractedMemory(null).valid, false);
  assert.equal(validateExtractedMemory("문자열").valid, false);
});

test("중요도는 0~1이어야 하고 0.5 미만이면 저장하지 않는다", () => {
  assert.equal(validateExtractedMemory({ ...validCandidate, importance: 0.49 }).valid, false);
  assert.equal(validateExtractedMemory({ ...validCandidate, importance: 0.5 }).valid, true);
  assert.equal(validateExtractedMemory({ ...validCandidate, importance: 1.5 }).valid, false);
  assert.equal(validateExtractedMemory({ ...validCandidate, importance: -1 }).valid, false);
  assert.equal(validateExtractedMemory({ ...validCandidate, importance: "높음" }).valid, false);
});

test("키·텍스트 정규화", () => {
  assert.equal(normalizeKey(" My Key "), "my_key");
  assert.equal(normalizeKey("커피 취향"), "커피_취향");
  assert.equal(isReservedMemoryKey("user_name"), true);
  assert.equal(isReservedMemoryKey("coffee"), false);
  assert.equal(validateMemoryKey("coffee_taste"), true);
  assert.equal(validateMemoryKey(""), false);
  assert.equal(sanitizeText("가".repeat(20), 5), "가가가가가");
});

// ── 유사도·충돌 ──────────────────────────────────────────────────────────────

test("유사도는 0~1이고 같은 문장이면 1이다", () => {
  assert.equal(calculateSimilarity("라떼를 좋아함", "라떼를 좋아함"), 1);
  const partial = calculateSimilarity("라떼를 좋아함", "커피를 싫어함");
  assert.ok(partial >= 0 && partial < 1);
  assert.equal(calculateSimilarity("", ""), calculateSimilarity("", ""), "빈 문자열에서 예외가 나지 않는다");
});

test("같은 내용이 이미 있으면 중복으로 본다", () => {
  assert.equal(detectConflict(validCandidate, [validCandidate]).type, "duplicate");
  assert.equal(detectConflict(validCandidate, []).type, "no_conflict");
});

// ── 미완료 주제 ──────────────────────────────────────────────────────────────

test("미완료 주제 신호를 문장에서 찾는다", () => {
  assert.ok(detectOpenLoops("나중에 다시 얘기하자").length > 0);
  assert.deepEqual(detectOpenLoops("오늘 날씨 좋네"), []);
});

test("완료 신호를 알아본다", () => {
  assert.equal(detectCompletionSignals("그 시험 결과 나왔어! 합격했어"), true);
  assert.equal(detectCompletionSignals("안녕"), false);
});

test("미완료 주제 응답을 파싱한다", () => {
  const parsed = parseOpenLoopsResponse('```json\n[{"topic":"시험","description":"결과 대기"}]\n```');
  assert.deepEqual(parsed, [{ topic: "시험" }]);
  assert.deepEqual(parseOpenLoopsResponse("없음"), []);
});

test("미완료 주제 추출 프롬프트는 저장하는 topic만 요청한다", () => {
  const history = [{ question: "시험 결과는 다음 주에 나와", answer: "나오면 알려줘" }];
  const korean = buildOpenLoopsDetectionPrompt(history, "ko");
  const english = buildOpenLoopsDetectionPrompt(history, "en");

  assert.ok(korean.userPrompt.includes('"topic"'));
  assert.ok(english.userPrompt.includes('"topic"'));
  assert.ok(!korean.userPrompt.includes('"description"'));
  assert.ok(!english.userPrompt.includes('"description"'));
});

test("해결된 주제는 1부터 세는 번호로 오고 실제 id로 바뀐다", () => {
  const openLoops = [{ id: 11, topic: "시험" }, { id: 22, topic: "면접" }];
  assert.deepEqual(parseLoopResolutionResponse("[1, 2]", openLoops), [11, 22]);
  assert.deepEqual(parseLoopResolutionResponse("[2]", openLoops), [22]);
  // 범위를 벗어난 번호는 조용히 버린다(LLM이 없는 번호를 지어내는 경우).
  assert.deepEqual(parseLoopResolutionResponse("[0, 3, 99]", openLoops), []);
  assert.deepEqual(parseLoopResolutionResponse("[]", openLoops), []);
  assert.deepEqual(parseLoopResolutionResponse("해결된 게 없어요", openLoops), []);
});

// ── 프롬프트 구성 ────────────────────────────────────────────────────────────

test("추출 프롬프트에 대화와 기존 기억 목록이 들어간다", () => {
  const history = [{ question: "커피 좋아해", answer: "그렇구나" }];
  const { systemPrompt, userPrompt, maxTokens } = buildExtractionPrompt(history, "ko", [validCandidate]);
  assert.ok(systemPrompt.length > 0);
  assert.ok(maxTokens > 0);
  assert.ok(userPrompt.includes("커피 좋아해"), "대화가 들어가야 한다");
  assert.ok(userPrompt.includes("coffee_taste"), "기존 기억 키를 보여줘야 같은 키를 재사용한다");
});

test("언어에 따라 프롬프트의 키 작명 지시가 달라진다", () => {
  const history = [{ question: "q", answer: "a" }];
  assert.ok(buildExtractionPrompt(history, "ko", []).userPrompt.includes("영어_snake_case_키"));
  assert.ok(buildExtractionPrompt(history, "en", []).userPrompt.includes("english_snake_case_key"));
});

test("해결 판정 프롬프트에 주제 목록이 번호와 함께 들어간다", () => {
  const built = buildLoopResolutionPrompt(
    [{ question: "q", answer: "a" }],
    [{ id: 11, topic: "시험" }, { id: 22, topic: "면접" }],
    "ko"
  );
  assert.ok(built.userPrompt.includes("1. 시험"));
  assert.ok(built.userPrompt.includes("2. 면접"));
  assert.ok(built.maxTokens > 0);
});

test("프롬프트에 보여줄 기존 기억 수에 상한이 있다", () => {
  assert.ok(Number.isInteger(EXISTING_MEMORIES_PROMPT_LIMIT));
  assert.ok(EXISTING_MEMORIES_PROMPT_LIMIT > 0);
});
