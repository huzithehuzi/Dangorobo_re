// @ts-check
// 설정창의 즉시 미리보기. 저장 전에도 펫에 반영하므로 "지금 보이는 설정"이 저장된 설정과
// 다를 수 있고, 저장 없이 닫으면 되돌려야 한다.
//
// 되돌릴지 판단하는 플래그와 미리보기 값이 함께 움직이는지가 핵심이다 — 따로 두면
// "값은 남았는데 되돌리지 않는" 상태가 생겨 다음에 창을 열 때 옛 미리보기가 되살아난다.
const test = require("node:test");
const assert = require("node:assert/strict");

const { createSettingsPreview } = require("../src/main/windows/settings-preview.js");

function setup(saved = { petScalePercent: 100, bodyColors: [{ id: "head", color: "#111111" }] }) {
  /** @type {any[]} */
  const broadcasts = [];
  /** @type {any[]} */
  const petMessages = [];
  const preview = createSettingsPreview(/** @type {any} */ ({
    publicSettings: () => ({ ...saved }),
    broadcast: (/** @type {any} */ next) => broadcasts.push(next),
    sendToPet: (/** @type {any} */ next) => petMessages.push(next)
  }));
  return { preview, broadcasts, petMessages, saved };
}

test("처음에는 미리보기가 없다", () => {
  const { preview } = setup();
  assert.equal(preview.isActive(), false);
  assert.equal(preview.current(), null);
});

test("적용하면 저장된 설정 위에 얹어 모든 창에 보낸다", () => {
  const { preview, broadcasts } = setup();
  preview.apply({ petScalePercent: 130 });

  assert.equal(preview.isActive(), true);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].petScalePercent, 130);
  assert.deepEqual(broadcasts[0].bodyColors, [{ id: "head", color: "#111111" }], "안 바꾼 값은 저장본에서 온다");
});

test("여러 번 적용하면 앞서 바꾼 값이 유지된다", () => {
  // 매번 저장본에서 새로 만들면 색을 고른 뒤 크기를 바꿀 때 색이 원래대로 돌아간다.
  const { preview, broadcasts } = setup();
  preview.apply({ petScalePercent: 130 });
  preview.apply({ outlineEnabled: false });

  const last = broadcasts[broadcasts.length - 1];
  assert.equal(last.petScalePercent, 130, "앞서 바꾼 크기가 남아 있다");
  assert.equal(last.outlineEnabled, false);
});

test("미리보기 중에 닫으면 되돌려야 한다고 알려주고 상태를 지운다", () => {
  const { preview } = setup();
  preview.apply({ petScalePercent: 130 });

  assert.equal(preview.takeRestoreNeeded(), true);
  assert.equal(preview.isActive(), false, "판단과 동시에 상태가 지워진다");
  assert.equal(preview.current(), null);
});

test("미리보기가 없었으면 되돌릴 필요가 없다", () => {
  const { preview } = setup();
  assert.equal(preview.takeRestoreNeeded(), false);
});

test("한 번 되돌린 뒤 다시 물으면 false다", () => {
  // 플래그와 값이 함께 지워지지 않으면 여기서 true가 또 나와 저장된 설정을 덮어쓴다.
  const { preview } = setup();
  preview.apply({ petScalePercent: 130 });
  preview.takeRestoreNeeded();
  assert.equal(preview.takeRestoreNeeded(), false);
});

test("저장이 끝나면 되돌릴 것이 없다", () => {
  const { preview } = setup();
  preview.apply({ petScalePercent: 130 });
  preview.clear();

  assert.equal(preview.isActive(), false);
  assert.equal(preview.current(), null);
  assert.equal(preview.takeRestoreNeeded(), false, "저장 뒤 창을 닫아도 되돌리지 않는다");
});

test("펫에서 고른 색은 미리보기 스냅샷에도 반영된다", () => {
  // 반영하지 않으면 설정창을 저장 없이 닫을 때 여기서 고른 색이 되돌려진다.
  const { preview, petMessages } = setup();
  preview.apply({ petScalePercent: 130 });

  const next = [{ id: "head", color: "#ff0000" }];
  preview.syncBodyColors(/** @type {any} */ (next));

  const snapshot = preview.current();
  assert.ok(snapshot, "미리보기 스냅샷이 남아 있다");
  assert.deepEqual(snapshot.bodyColors, next);
  assert.equal(snapshot.petScalePercent, 130, "다른 미리보기 값은 그대로다");
  assert.deepEqual(petMessages[petMessages.length - 1].bodyColors, next);
});

test("미리보기가 없을 때 색을 고르면 저장본을 그대로 펫에 보낸다", () => {
  const { preview, petMessages, saved } = setup();
  preview.syncBodyColors(/** @type {any} */ ([{ id: "head", color: "#00ff00" }]));

  assert.equal(preview.current(), null, "미리보기를 새로 만들지 않는다");
  assert.deepEqual(petMessages[petMessages.length - 1].bodyColors, saved.bodyColors);
});

test("색 동기화는 펫 창에만 보낸다", () => {
  // 체크리스트·즐겨찾기는 바디 색을 쓰지 않는다.
  const { preview, broadcasts, petMessages } = setup();
  preview.apply({ petScalePercent: 130 });
  broadcasts.length = 0;

  preview.syncBodyColors(/** @type {any} */ ([{ id: "head", color: "#0000ff" }]));
  assert.equal(broadcasts.length, 0);
  assert.equal(petMessages.length, 1);
});
