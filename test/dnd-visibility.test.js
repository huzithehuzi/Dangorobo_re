// @ts-check
// 방해 금지 상태의 창 숨김·복구. 감지는 PowerShell에 붙어 있어 다른 OS에서 못 돌리지만
// "그래서 어떤 창을 숨길지"는 창 객체만 흉내 내면 그대로 검증된다.
//
// 가장 중요한 계약은 **우리가 숨긴 창만 되살린다**는 것이다. 사용자가 직접 숨겨 둔 펫까지
// 복구하면 방해 금지가 풀릴 때마다 숨겨 둔 펫이 되살아난다.
const test = require("node:test");
const assert = require("node:assert/strict");

const { createDndVisibility } = require("../src/main/windows/dnd-visibility.js");

/** @param {{ visible?: boolean, destroyed?: boolean }} [options] */
function fakeWindow(options = {}) {
  const win = {
    visible: options.visible !== false,
    destroyed: options.destroyed === true,
    calls: /** @type {string[]} */ ([]),
    isDestroyed: () => win.destroyed,
    isVisible: () => win.visible,
    hide() { win.calls.push("hide"); win.visible = false; },
    showInactive() { win.calls.push("showInactive"); win.visible = true; }
  };
  return win;
}

function setup(overrides = {}) {
  const pet = fakeWindow();
  const checklist = fakeWindow();
  const favorites = fakeWindow();
  const dock = fakeWindow();
  /** @type {string[]} */
  const events = [];
  const deps = {
    petWindow: () => pet,
    checklistWindow: () => checklist,
    favoritesWindows: { window: () => favorites, dockWindow: () => dock },
    alarmQueue: { tryShowNext: () => events.push("alarm:tryShowNext") },
    ensurePetVisible: () => events.push("ensurePetVisible"),
    logWindowOp: (/** @type {string} */ op, /** @type {any} */ detail) =>
      events.push(`log:${op}:${detail?.active}`),
    ...overrides
  };
  return { dnd: createDndVisibility(/** @type {any} */ (deps)), pet, checklist, favorites, dock, events };
}

test("켜지면 보이는 창을 전부 숨긴다", () => {
  const { dnd, pet, checklist, favorites, dock } = setup();
  assert.equal(dnd.isActive(), false);

  dnd.apply(true);

  assert.equal(dnd.isActive(), true);
  assert.deepEqual(pet.calls, ["hide"]);
  assert.deepEqual(checklist.calls, ["hide"]);
  assert.deepEqual(favorites.calls, ["hide"]);
  assert.deepEqual(dock.calls, ["hide"]);
});

test("꺼지면 우리가 숨긴 창만 되살린다", () => {
  const { dnd, pet, checklist, favorites, dock, events } = setup();
  dnd.apply(true);
  dnd.apply(false);

  assert.equal(dnd.isActive(), false);
  assert.deepEqual(pet.calls, ["hide", "showInactive"]);
  assert.deepEqual(checklist.calls, ["hide", "showInactive"]);
  assert.deepEqual(favorites.calls, ["hide", "showInactive"]);
  assert.deepEqual(dock.calls, ["hide", "showInactive"]);
  // 펫은 화면 밖으로 나가 있을 수 있어 보이기 전에 위치를 확인한다.
  // indexOf 비교만 하면 호출이 아예 없을 때 -1이라 통과해 버린다 — 존재부터 단언한다.
  assert.ok(events.includes("ensurePetVisible"), "펫을 보이기 전에 위치를 확인한다");
  assert.ok(events.indexOf("ensurePetVisible") < events.indexOf("alarm:tryShowNext"));
});

test("사용자가 이미 숨겨 둔 창은 되살리지 않는다", () => {
  // 이게 이 모듈의 핵심 계약이다.
  const { dnd, pet, checklist } = setup();
  pet.visible = false;
  checklist.visible = false;

  dnd.apply(true);
  assert.deepEqual(pet.calls, [], "이미 숨어 있으면 건드리지 않는다");
  assert.deepEqual(checklist.calls, []);

  dnd.apply(false);
  assert.deepEqual(pet.calls, [], "우리가 숨긴 게 아니므로 되살리지 않는다");
  assert.deepEqual(checklist.calls, []);
  assert.equal(pet.visible, false);
});

test("일부만 보이던 상태도 그 일부만 되살린다", () => {
  const { dnd, pet, checklist, favorites, dock } = setup();
  checklist.visible = false;
  dock.visible = false;

  dnd.apply(true);
  dnd.apply(false);

  assert.deepEqual(pet.calls, ["hide", "showInactive"]);
  assert.deepEqual(favorites.calls, ["hide", "showInactive"]);
  assert.deepEqual(checklist.calls, []);
  assert.deepEqual(dock.calls, []);
});

test("같은 값으로 여러 번 불러도 한 번만 처리한다", () => {
  const { dnd, pet, events } = setup();
  dnd.apply(true);
  dnd.apply(true);
  dnd.apply(true);
  assert.deepEqual(pet.calls, ["hide"], "중복 호출로 숨김이 반복되지 않는다");

  dnd.apply(false);
  dnd.apply(false);
  assert.deepEqual(pet.calls, ["hide", "showInactive"]);
  assert.equal(events.filter((e) => e === "alarm:tryShowNext").length, 1);
});

test("해제할 때만 밀어둔 알람을 꺼낸다", () => {
  const { dnd, events } = setup();
  dnd.apply(true);
  assert.equal(events.includes("alarm:tryShowNext"), false, "켜질 때는 알람을 꺼내지 않는다");
  dnd.apply(false);
  assert.equal(events.filter((e) => e === "alarm:tryShowNext").length, 1);
});

test("파괴된 창은 건드리지 않는다", () => {
  const { dnd, pet, checklist } = setup();
  dnd.apply(true);
  pet.destroyed = true;
  checklist.destroyed = true;

  dnd.apply(false);
  assert.deepEqual(pet.calls, ["hide"], "파괴된 창에 showInactive를 부르지 않는다");
  assert.deepEqual(checklist.calls, ["hide"]);
});

test("복구 시점에 파괴된 즐겨찾기 창은 건드리지 않는다", () => {
  const { dnd, favorites, dock } = setup();
  dnd.apply(true);
  favorites.destroyed = true;

  dnd.apply(false);
  assert.deepEqual(favorites.calls, ["hide"], "파괴된 창에 showInactive를 부르지 않는다");
  assert.deepEqual(dock.calls, ["hide", "showInactive"]);
});

test("한 번 복구한 창은 목록에서 지워 다음 주기에 되살아나지 않는다", () => {
  // 목록을 비우지 않으면 사용자가 그 뒤에 직접 숨긴 창까지 다음 해제 때 되살아난다.
  const { dnd, favorites } = setup();
  dnd.apply(true);
  dnd.apply(false);
  assert.deepEqual(favorites.calls, ["hide", "showInactive"]);

  // 사용자가 직접 숨긴다.
  favorites.visible = false;
  favorites.calls.length = 0;

  dnd.apply(true);
  dnd.apply(false);
  assert.deepEqual(favorites.calls, [], "우리가 숨긴 게 아니므로 되살리지 않는다");
});

test("창이 아예 없어도 터지지 않는다", () => {
  const { dnd } = setup({
    petWindow: () => null,
    checklistWindow: () => undefined,
    favoritesWindows: { window: () => null, dockWindow: () => null }
  });
  dnd.apply(true);
  dnd.apply(false);
  assert.equal(dnd.isActive(), false);
});

test("전환마다 이유와 함께 기록을 남긴다", () => {
  const { dnd, events } = setup();
  dnd.apply(true, { state: 2, foreground: "game.exe" });
  dnd.apply(false, { state: 0, foreground: "" });
  assert.deepEqual(
    events.filter((e) => e.startsWith("log:")),
    ["log:applyDndState:true", "log:applyDndState:false"]
  );
});
