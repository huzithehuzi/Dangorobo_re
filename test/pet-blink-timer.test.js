// @ts-check
// 눈 깜박임 타이머. 난수를 주입하면 대기·깜박임 전이가 전부 결정적이라 Node에서 검증한다.
//
// 경계는 이진수로 정확한 값(2.5·5.5·4.0)으로만 딱 맞춰 보고, 그 밖에는 넉넉한 여유를 둔다.
// BLINK_DURATION(0.12)은 이진수로 떨어지지 않아 `0.12 - 0.119 - 0.001 > 0`이 된다.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createBlinkTimer,
  BLINK_DURATION,
  BLINK_MIN_GAP,
  BLINK_MAX_GAP
} = require("../src/pet/blink-timer.js");

/**
 * 정해진 대기를 차례로 돌려주는 난수. 다 쓰면 마지막 값을 계속 준다.
 * @param {number[]} values
 */
function sequence(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

test("처음에는 눈을 뜨고 있고 대기가 다 지나야 감는다", () => {
  // random 0 → 대기는 최소값 2.5초(이진수로 정확한 값이라 경계를 딱 맞춰 볼 수 있다)
  const blink = createBlinkTimer({ random: sequence([0]) });
  assert.equal(blink.isActive(), false);

  assert.equal(blink.advance(2), false);
  assert.equal(blink.advance(0.5), true, "대기가 정확히 0이 되는 순간 감는다");
});

test("깜박임은 지속 시간이 지나면 끝나고 다음 대기를 새로 뽑는다", () => {
  // 첫 대기는 최소값, 그다음 대기는 random=1이라 최대값(5.5)이 된다.
  const blink = createBlinkTimer({ random: sequence([0, 1]) });
  assert.equal(blink.advance(BLINK_MIN_GAP), true);

  assert.equal(blink.advance(BLINK_DURATION / 2), true, "지속 시간 안에는 계속 감고 있다");
  assert.equal(blink.advance(BLINK_DURATION), false, "지속 시간이 지나면 뜬다");

  // 새 대기가 최대값이므로 최소값만큼 지나도 아직 안 감는다.
  assert.equal(blink.advance(BLINK_MIN_GAP), false);
  assert.equal(blink.advance(BLINK_MAX_GAP - BLINK_MIN_GAP), true, "최대 대기 경계에서 감는다");
});

test("대기 시간은 난수를 [최소, 최대] 범위로 옮긴다", () => {
  /** @type {[number, number][]} */
  const cases = [[0, BLINK_MIN_GAP], [1, BLINK_MAX_GAP], [0.5, (BLINK_MIN_GAP + BLINK_MAX_GAP) / 2]];
  for (const [value, expected] of cases) {
    const blink = createBlinkTimer({ random: sequence([value]) });
    assert.equal(blink.advance(expected - 0.5), false, `random=${value}: 아직 대기 중`);
    assert.equal(blink.advance(0.5), true, `random=${value}: 대기 ${expected}초에서 감는다`);
  }
});

test("표정 지정 중에는 대기도 깜박임도 진행하지 않는다", () => {
  // 렌더러는 표정이 지정된 프레임에 advance() 대신 suppress()만 부른다. 그래서 그 동안은
  // 대기가 줄지 않고, 표정 지정이 길어져도 풀리자마자 몰아서 깜박이지 않는다.
  const blink = createBlinkTimer({ random: sequence([0]) });
  assert.equal(blink.advance(1), false);

  for (let i = 0; i < 100; i += 1) blink.suppress();
  assert.equal(blink.isActive(), false);

  // 남은 대기 1.5초는 그대로다.
  assert.equal(blink.advance(1), false);
  assert.equal(blink.advance(0.5), true);
});

test("깜박이는 중에 표정이 지정되면 눈을 뜨고, 풀린 뒤 한 번 더 깜박인다", () => {
  const blink = createBlinkTimer({ random: sequence([0]) });
  // 깜박임이 시작되는 순간 대기는 이미 0으로 소진돼 있다.
  assert.equal(blink.advance(BLINK_MIN_GAP), true);

  blink.suppress();
  assert.equal(blink.isActive(), false, "표정 지정 상태에서는 눈을 감지 않는다");

  // 분해 전과 같은 동작 — suppress는 대기를 되돌리지 않으므로 표정 지정이 풀리면
  // 소진된 대기가 곧바로 조건을 만족해 다시 한 번 깜박이고, 그 뒤에 새 대기를 뽑는다.
  assert.equal(blink.advance(0.016), true);
  assert.equal(blink.advance(BLINK_DURATION), false);
  assert.equal(blink.advance(2), false, "그다음부터는 새로 뽑은 대기를 따른다");
  assert.equal(blink.advance(0.5), true);
});

test("깜박이지 않는 동안 suppress를 반복해도 대기가 밀리지 않는다", () => {
  const blink = createBlinkTimer({ random: sequence([0]) });
  for (let i = 0; i < 10; i += 1) {
    blink.suppress();
    assert.equal(blink.advance(0.125), false);
  }
  // 위에서 1.25초가 흘렀다. 남은 1.25초를 채우면 감는다.
  assert.equal(blink.advance(1), false);
  assert.equal(blink.advance(0.25), true);
});

test("같은 시간을 잘게 나눠 진행해도 결과가 같다(프레임률 독립)", () => {
  const coarse = createBlinkTimer({ random: sequence([0]) });
  const fine = createBlinkTimer({ random: sequence([0]) });

  coarse.advance(BLINK_MIN_GAP);
  for (let i = 0; i < 256; i += 1) fine.advance(BLINK_MIN_GAP / 256);

  assert.equal(coarse.isActive(), true);
  assert.equal(fine.isActive(), true);
});
