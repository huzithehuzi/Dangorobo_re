// @ts-check
// 누름 젤리 출렁임 회귀 테스트 (2026-08-21).
//
// 이 효과의 핵심 제약은 "transform을 애니메이션하지 않는다"다. 키프레임 값은 명시도와
// 무관하게 일반 선언을 이기므로, transform으로 자리를 잡는 버튼(.fab·.gradient-stop·
// .pie-item의 translate(-50%, -50%))이라면 애니메이션이 도는 동안 그 translate가 사라져
// 버튼이 오른쪽 아래로 튄다. active-transform-specificity.test.js가 기록한 그 버그와 같은
// 증상인데, 이쪽은 명시도를 올려도 막을 수 없다 — 그래서 별개 속성인 `scale`을 쓴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/** @param {string} relativePath */
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n?/g, "\n");
}

const motionCss = read("src/shared/ui-motion.css");
const motionJs = read("src/shared/ui-motion.js");

/**
 * ui-motion.css에서 @keyframes 한 덩이를 떼어낸다.
 * @param {string} name
 */
function keyframesBody(name) {
  const start = motionCss.indexOf(`@keyframes ${name} {`);
  assert.notEqual(start, -1, `@keyframes ${name}을 찾지 못했다`);
  const end = motionCss.indexOf("\n}", start);
  assert.notEqual(end, -1, `@keyframes ${name}이 닫히지 않았다`);
  return motionCss.slice(start, end);
}

test("젤리 키프레임은 transform이 아니라 독립 scale 속성을 움직인다", () => {
  const body = keyframesBody("ui-jelly-press");
  assert.ok(/\bscale:/.test(body), "scale 속성을 써야 한다");
  assert.ok(
    !/\btransform\s*:/.test(body),
    "transform을 애니메이션하면 translate로 자리를 잡은 버튼이 누를 때 튄다 "
      + "(명시도로 막을 수 없다 — 별개 속성인 scale을 쓸 것)"
  );
});

test("젤리는 가로·세로를 반대로 움직여 부피가 유지되는 것처럼 보인다", () => {
  // 두 축이 같이 커지거나 같이 작아지면 그냥 확대·축소지 출렁임이 아니다.
  const body = keyframesBody("ui-jelly-press");
  const stops = [...body.matchAll(/scale:\s*([\d.]+)\s+([\d.]+)/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
  assert.ok(stops.length >= 4, "중간 정지점이 있어야 출렁임으로 읽힌다");

  const moving = stops.filter(([x, y]) => x !== 1 || y !== 1);
  assert.ok(moving.length >= 3, "움직이는 정지점이 3개 이상이어야 한다");
  for (const [x, y] of moving) {
    assert.ok((x - 1) * (y - 1) < 0, `가로·세로가 같은 방향으로 움직인다: ${x} ${y}`);
  }

  // 시작과 끝은 원래 크기여야 한다(애니메이션이 끝나고 클래스를 떼도 안 튀게).
  assert.deepEqual(stops[0], [1, 1]);
  assert.deepEqual(stops[stops.length - 1], [1, 1]);
});

test("젤리 진폭은 기존 누름 축소와 곱해져도 과하지 않다", () => {
  // 공용 :active가 이미 scale(0.94)로 줄인다. 여기서 더 키우면 출렁임이 아니라 튀는 것처럼 보인다.
  const body = keyframesBody("ui-jelly-press");
  const values = [...body.matchAll(/scale:\s*([\d.]+)\s+([\d.]+)/g)]
    .flatMap((match) => [Number(match[1]), Number(match[2])]);
  for (const value of values) {
    assert.ok(value >= 0.88 && value <= 1.12, `진폭이 과하다: ${value}`);
  }
});

test("움직임 최소화 설정에서 젤리가 꺼진다", () => {
  const reduceBlock = motionCss.slice(motionCss.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(
    /\.ui-jelly\s*\{\s*animation:\s*none;?\s*\}/.test(reduceBlock),
    "감성 효과라도 멀미·주의력 문제로 끄는 사용자가 있다"
  );
});

test("드라이버는 파문과 젤리에 같은 누름 대상을 쓴다", () => {
  // 대상 판정이 갈리면 한쪽 효과만 도는 버튼이 생긴다.
  assert.ok(/function pressTarget\(/.test(motionJs));
  const rippleUsesShared = /function spawnRipple\([\s\S]{0,200}?pressTarget\(event\)/.test(motionJs);
  const jellyUsesShared = /function jellyPress\([\s\S]{0,200}?pressTarget\(event\)/.test(motionJs);
  assert.ok(rippleUsesShared, "파문이 공용 대상 판정을 쓴다");
  assert.ok(jellyUsesShared, "젤리가 공용 대상 판정을 쓴다");
  assert.ok(
    /addEventListener\("pointerdown", jellyPress/.test(motionJs),
    "pointerdown에 등록돼야 한다 — click은 pointerdown을 만들지 않는다"
  );
});

test("젤리 클래스는 연타에 다시 재생되고 끝나면 떼어진다", () => {
  // 클래스를 뗀 뒤 리플로를 강제하지 않으면 두 번째 누름에서 애니메이션이 재생되지 않는다.
  const jelly = motionJs.slice(motionJs.indexOf("function jellyPress("));
  const body = jelly.slice(0, jelly.indexOf("\n  }"));
  assert.ok(/classList\.remove\(JELLY_CLASS\)[\s\S]*offsetWidth[\s\S]*classList\.add\(JELLY_CLASS\)/.test(body));
  assert.ok(
    /animationName !== JELLY_ANIMATION/.test(body),
    "버튼 안쪽 요소의 animationend에 반응하면 출렁임이 중간에 끊긴다"
  );
});

test("누름 효과를 실제 창에서 확인할 QA 경로가 있다", () => {
  // el.click()은 pointerdown을 만들지 않아 기존 클릭 플래그로는 이 효과를 볼 수 없다.
  const qaCapture = read("src/main/qa-capture.ts");
  assert.ok(qaCapture.includes("--capture-settings-press="));
  assert.ok(
    /new PointerEvent\("pointerdown"/.test(qaCapture),
    "실제 pointerdown을 만들어야 파문·젤리가 돈다"
  );
});
