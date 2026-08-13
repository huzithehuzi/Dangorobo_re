// @ts-check
// 펫 창 논리 위치의 수명주기. screen·app 경계를 주입받으므로 Windows 없이도 검증된다.
//
// 순수 계산(작업 영역 클램프)은 pet-window-layout이 따로 검증한다. 여기서 보는 것은
// "언제 디스크에 쓰는가", "드래그 중 언제 보정하는가" 같은 판단이다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createPetPositionController,
  DRAG_CORRECTION_DELAY_MS,
  POSITION_SAVE_DEBOUNCE_MS
} = require("../src/main/windows/pet-position-controller.js");
const { WINDOW_WIDTH, REST_WINDOW_EXTRA_TOP } = require("../src/main/windows/pet-window-layout.js");

const WIDE_AREA = { x: 0, y: 0, width: 1920, height: 1080 };

/** @param {import("node:test").TestContext} context */
function setup(context, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dangorobo-pet-position-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** @type {any[]} */
  const bounds = [];
  /** @type {string[]} */
  const logs = [];
  let windowPosition = [100, 200];
  const win = {
    destroyed: false,
    isDestroyed: () => win.destroyed,
    getPosition: () => windowPosition,
    /** @param {any} next */
    setBounds: (next) => { bounds.push(next); }
  };
  const deps = {
    userDataPath: () => dir,
    primaryWorkArea: () => WIDE_AREA,
    displayNearestPoint: () => ({ workArea: WIDE_AREA }),
    petWindow: () => win,
    petScalePercent: () => 100,
    petWindowWidth: () => WINDOW_WIDTH,
    petWindowXInset: () => 0,
    /** @param {number} actualX */
    petWindowLogicalX: (actualX) => Math.round(actualX),
    /** @param {string} op */
    logWindowOp: (op) => logs.push(op),
    ...overrides
  };
  return {
    controller: createPetPositionController(/** @type {any} */ (deps)),
    dir, win, bounds, logs,
    /** @param {number[]} next */
    moveWindowTo: (next) => { windowPosition = next; },
    positionFile: () => path.join(dir, "pet-position.json"),
    readSaved: () => JSON.parse(fs.readFileSync(path.join(dir, "pet-position.json"), "utf8"))
  };
}

test("저장된 위치가 없으면 기본 위치를 쓴다", (context) => {
  const { controller, bounds } = setup(context);
  controller.load();
  assert.equal(controller.current(), undefined);

  controller.place();
  assert.ok(controller.current(), "배치하면서 위치가 정해진다");
  assert.equal(bounds.length, 1);
});

test("저장한 위치를 그대로 다시 읽는다", (context) => {
  const first = setup(context);
  first.controller.setCurrent({ x: 400, y: 300 });
  first.controller.save();

  const second = createPetPositionController(/** @type {any} */ ({
    userDataPath: () => first.dir,
    primaryWorkArea: () => WIDE_AREA,
    displayNearestPoint: () => ({ workArea: WIDE_AREA }),
    petWindow: () => null,
    petScalePercent: () => 100,
    petWindowWidth: () => WINDOW_WIDTH,
    petWindowXInset: () => 0,
    petWindowLogicalX: (/** @type {number} */ x) => x,
    logWindowOp: () => {}
  }));
  second.load();
  assert.deepEqual(second.current(), { x: 400, y: 300 });
});

test("기억한 위치가 없으면 저장하지 않는다", (context) => {
  const { controller, positionFile } = setup(context);
  controller.save();
  assert.equal(fs.existsSync(positionFile()), false);
});

test("setBounds는 논리 위치를 창 좌표로 되돌린다", (context) => {
  const { controller, bounds } = setup(context, { petWindowXInset: () => 190 });
  controller.setBounds({ x: 500, y: 400 });

  assert.equal(bounds.length, 1);
  // 논리 x에서 inset을 빼고, y에서 투명 상단 여백을 뺀다.
  assert.equal(bounds[0].x, 500 - 190);
  assert.equal(bounds[0].y, 400 - REST_WINDOW_EXTRA_TOP);
});

test("파괴된 창에는 아무것도 하지 않는다", (context) => {
  const { controller, win, bounds } = setup(context);
  win.destroyed = true;
  controller.place();
  controller.setBounds({ x: 10, y: 10 });
  controller.ensureVisible();
  assert.equal(bounds.length, 0);
});

test("화면 안에 있으면 보정도 저장도 하지 않는다", (context) => {
  const { controller, bounds, logs, positionFile, moveWindowTo } = setup(context);
  // 창 y에 투명 상단 여백(300)이 더해져 논리 y가 된다 — 조여지지 않는 값을 고른다.
  moveWindowTo([500, 200]);

  controller.ensureVisible();

  assert.equal(bounds.length, 0, "이미 안전하면 창을 옮기지 않는다");
  assert.deepEqual(logs, [], "보정 기록도 남기지 않는다");
  assert.equal(fs.existsSync(positionFile()), false, "디스크에 쓰지 않는다");
});

test("화면 밖으로 벗어났을 때만 보정하고 그때 디스크에 쓴다", (context) => {
  // 30초 워치독이 매번 무조건 파일을 쓰던 것이 다른 창 z-order와 얽혀 보여 최소화한 규칙이다.
  const { controller, bounds, logs, moveWindowTo, readSaved } = setup(context);
  moveWindowTo([9000, 9000]);

  controller.ensureVisible();

  assert.equal(bounds.length, 1, "안전한 위치로 되돌린다");
  assert.deepEqual(logs, ["ensurePetVisible:correct"]);
  const saved = readSaved();
  assert.ok(saved.x < 9000 && saved.y < 9000, "조인 위치가 저장된다");
  assert.deepEqual(controller.current(), saved);
});

test("드래그 이동은 디바운스로 한 번만 저장한다", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, moveWindowTo, positionFile, readSaved } = setup(context);

  moveWindowTo([300, 300]);
  controller.handleMoved();
  moveWindowTo([310, 300]);
  controller.handleMoved();
  moveWindowTo([320, 300]);
  controller.handleMoved();

  assert.equal(fs.existsSync(positionFile()), false, "드래그 중에는 쓰지 않는다");
  context.mock.timers.tick(POSITION_SAVE_DEBOUNCE_MS);
  assert.deepEqual(readSaved(), { x: 320, y: 300 + REST_WINDOW_EXTRA_TOP });
});

test("드래그 중 화면 밖으로 나가면 멈춘 뒤에 한 번만 되돌린다", (context) => {
  // 매 move마다 즉시 되돌리면 OS 창 이동과 충돌해 화면 구석에서 덜걱거린다.
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, bounds, moveWindowTo } = setup(context);

  moveWindowTo([9000, 9000]);
  controller.handleMoved();
  controller.handleMoved();
  controller.handleMoved();
  assert.equal(bounds.length, 0, "드래그 중에는 되돌리지 않는다");

  context.mock.timers.tick(DRAG_CORRECTION_DELAY_MS);
  assert.equal(bounds.length, 1, "멈춘 뒤 한 번만 보정한다");
});

test("우리가 옮기는 중에 들어온 move는 무시한다", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "setImmediate"] });
  const { controller, positionFile, moveWindowTo } = setup(context);

  controller.setBounds({ x: 500, y: 400 });
  // setImmediate로 풀리기 전에 들어온 이벤트 — 자기 자신에 반응하면 안 된다.
  moveWindowTo([9000, 9000]);
  controller.handleMoved();

  context.mock.timers.tick(POSITION_SAVE_DEBOUNCE_MS);
  assert.equal(fs.existsSync(positionFile()), false, "무시했으므로 저장도 없다");
});

test("dispose는 예약된 저장·보정을 취소한다", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, bounds, moveWindowTo, positionFile } = setup(context);

  moveWindowTo([9000, 9000]);
  controller.handleMoved();
  controller.dispose();

  context.mock.timers.tick(POSITION_SAVE_DEBOUNCE_MS + DRAG_CORRECTION_DELAY_MS);
  assert.equal(bounds.length, 0, "보정이 취소된다");
  assert.equal(fs.existsSync(positionFile()), false, "저장도 취소된다");
});

test("커스터마이징 클램프는 넓어진 창 전체가 들어오도록 더 조인다", (context) => {
  // 일반 클램프는 투명 여백만큼 창이 화면 밖으로 나가는 걸 허용한다. 이 모드에서는 그
  // 여백에 라벨과 툴바가 들어차 있어 잘리므로 한 번 더 조인다.
  const { controller } = setup(context, { petWindowXInset: () => 190 });
  const far = { x: 1900, y: 200 };
  const normal = controller.clamp(far);
  const forCustomize = controller.clampForCustomize(far);

  assert.ok(forCustomize.x <= normal.x, "커스터마이징 쪽이 더 안쪽으로 조인다");
  assert.ok(forCustomize.x + WINDOW_WIDTH / 2 + 190 <= WIDE_AREA.width, "넓어진 폭이 화면 안에 들어온다");
});

test("모델 높이는 클램프에 반영된다", (context) => {
  const { controller } = setup(context);
  const base = controller.getModelTopLocalY();
  controller.setModelTopLocalY(base + 1);
  assert.equal(controller.getModelTopLocalY(), base + 1);

  // 위쪽 경계로 밀어 보면 모델이 커진 만큼 더 내려온다.
  const withTaller = controller.clamp({ x: 500, y: -1000 });
  controller.setModelTopLocalY(base);
  const withBase = controller.clamp({ x: 500, y: -1000 });
  assert.ok(withTaller.y >= withBase.y);
});
