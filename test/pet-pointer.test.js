// @ts-check
// 전역 훅 좌표의 커서 판정과 펫 드래그. screen.screenToDipPoint()가 Windows 전용이라
// 다른 OS에서는 Electron을 띄워도 이 경로가 실행되지 않는다 — 좌표 변환을 주입받게
// 만들어 두었으므로 배율을 흉내 내 여기서 검증한다.
const test = require("node:test");
const assert = require("node:assert/strict");

const { createPetPointer } = require("../src/main/windows/pet-pointer.js");
const { DEFAULT_SETTINGS } = require("../src/main/settings-schema.js");
const { REST_WINDOW_EXTRA_TOP } = require("../src/main/windows/pet-window-layout.js");

/**
 * 창 하나를 흉내 낸다. 실제 BrowserWindow의 최소 표면만 쓴다.
 * @param {{x: number, y: number, width: number, height: number}} bounds
 * @param {{visible?: boolean, destroyed?: boolean}} [options]
 */
function fakeWindow(bounds, { visible = true, destroyed = false } = {}) {
  /** @type {Array<{channel: string, payload: any}>} */
  const sent = [];
  return {
    sent,
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    getBounds: () => ({ ...bounds }),
    getPosition: () => [bounds.x, bounds.y],
    webContents: {
      /** @param {string} channel @param {any} payload */
      send: (channel, payload) => sent.push({ channel, payload })
    }
  };
}

/**
 * @param {{
 *   dipScale?: number,
 *   settings?: Record<string, unknown>,
 *   checklistWindow?: unknown, favoritesWindow?: unknown, favoritesDockWindow?: unknown,
 *   tray?: unknown, modelTopLocalY?: number,
 *   mediaPlayerVisible?: boolean, mediaPlayerRect?: unknown, restActive?: boolean,
 *   clampPetPosition?: (position: {x: number, y: number}) => {x: number, y: number}
 * }} [overrides]
 */
function createHarness(overrides = {}) {
  /** @type {{ bounds: any[], saved: any[], savePosition: number, pettingChat: number, clamped: any[] }} */
  const calls = { bounds: [], saved: [], savePosition: 0, pettingChat: 0, clamped: [] };
  // 펫 창은 논리 폭 300px, 커스터마이징 inset 없음을 가정한다.
  const petWindow = fakeWindow({ x: 100, y: 200, width: 300, height: 720 });
  const scale = overrides.dipScale ?? 1;
  const pointer = createPetPointer({
    petWindow: () => /** @type {any} */ (petWindow),
    checklistWindow: () => /** @type {any} */ (overrides.checklistWindow ?? null),
    favoritesWindow: () => /** @type {any} */ (overrides.favoritesWindow ?? null),
    favoritesDockWindow: () => /** @type {any} */ (overrides.favoritesDockWindow ?? null),
    tray: () => /** @type {any} */ (overrides.tray ?? null),
    // 설정은 손으로 일부만 만들지 않고 기본값에서 파생한다(AGENTS.md의 QA 설정 규칙).
    getSettings: () => ({
      ...DEFAULT_SETTINGS,
      petScalePercent: 100,
      petDragMode: "always",
      headPettingEnabled: true,
      ...overrides.settings
    }),
    getModelTopLocalY: () => overrides.modelTopLocalY ?? 2.05,
    isMediaPlayerVisible: () => overrides.mediaPlayerVisible === true,
    getMediaPlayerRect: () => /** @type {any} */ (overrides.mediaPlayerRect ?? null),
    isRestActive: () => overrides.restActive === true,
    petWindowLogicalX: (actualX) => actualX,
    clampPetPosition: (position) => {
      calls.clamped.push(position);
      return overrides.clampPetPosition ? overrides.clampPetPosition(position) : position;
    },
    setPetBounds: (position) => calls.bounds.push(position),
    setSavedPosition: (position) => calls.saved.push(position),
    savePosition: () => { calls.savePosition += 1; },
    onPettingChat: () => { calls.pettingChat += 1; },
    // 배율이 1이 아니면 원좌표를 나눠 DIP로 만든다(Windows의 screenToDipPoint와 같은 방향).
    screenToDipPoint: (point) => ({ x: point.x / scale, y: point.y / scale })
  });
  return { pointer, petWindow, calls };
}

test("드래그는 잡은 지점을 유지한 채 논리 위치로 창을 옮긴다", () => {
  const { pointer, calls } = createHarness();
  // 창 좌상단(100,200)에서 오른쪽 30, 아래 40 지점을 잡는다.
  pointer.startPetDrag(130, 240);
  assert.equal(pointer.isDragging(), true);
  pointer.updatePetDrag(200, 300);
  assert.equal(calls.bounds.length, 1);
  // 잡은 오프셋(30,40)이 유지되므로 새 논리 위치는 (170, 260) + 말풍선 여백이다.
  assert.deepEqual(calls.bounds[0], { x: 170, y: 260 + REST_WINDOW_EXTRA_TOP });
});

test("드래그 중이 아니면 이동 좌표를 무시한다", () => {
  const { pointer, calls } = createHarness();
  pointer.updatePetDrag(500, 500);
  assert.equal(calls.bounds.length, 0);
});

test("드래그를 끝내면 화면 밖 보정과 위치 저장을 한 번만 한다", () => {
  const { pointer, calls, petWindow } = createHarness({
    clampPetPosition: () => ({ x: 10, y: 20 })
  });
  pointer.startPetDrag(130, 240);
  pointer.endPetDrag();
  assert.equal(pointer.isDragging(), false);
  // 창의 실제 좌상단(100,200)을 논리 위치로 되돌려(말풍선 여백을 더해) 보정에 넘긴다.
  assert.deepEqual(calls.clamped, [{ x: 100, y: 200 + REST_WINDOW_EXTRA_TOP }]);
  assert.deepEqual(calls.saved, [{ x: 10, y: 20 }]);
  assert.deepEqual(calls.bounds, [{ x: 10, y: 20 }]);
  assert.equal(calls.savePosition, 1);
  // 렌더러에 드래그 시작·종료를 각각 알린다.
  assert.deepEqual(
    petWindow.sent.map((message) => message.payload.dragging),
    [true, false]
  );
});

test("이미 끝난 드래그를 다시 끝내도 위치를 또 저장하지 않는다", () => {
  const { pointer, calls } = createHarness();
  pointer.startPetDrag(130, 240);
  pointer.endPetDrag();
  pointer.endPetDrag();
  assert.equal(calls.savePosition, 1);
});

test("배율이 다른 화면에서도 원좌표를 DIP로 옮겨 오프셋을 잡는다", () => {
  const { pointer, calls } = createHarness({ dipScale: 2 });
  // 원좌표 (300,500) → DIP (150,250). 창 좌상단이 (100,200)이므로 오프셋은 (50,50).
  pointer.startPetDrag(300, 500);
  // 원좌표 (500,700) → DIP (250,350). 오프셋을 빼면 논리 위치는 (200,300)이다.
  pointer.updatePetDrag(500, 700);
  assert.deepEqual(calls.bounds[0], { x: 200, y: 300 + REST_WINDOW_EXTRA_TOP });
});

test("펫 위 좌표라도 트레이 아이콘과 겹치면 펫으로 치지 않는다", () => {
  // (200,750)은 실제로 펫 몸통 위다 — 트레이가 없을 때 참인 것을 먼저 확인해야
  // 트레이 배제가 실제로 결과를 뒤집는지 볼 수 있다.
  const noTray = createHarness();
  assert.equal(noTray.pointer.isPointOverPet(200, 750), true);
  assert.equal(noTray.pointer.isPointOverTrayIcon(200, 750), false);

  const overTray = createHarness({
    tray: { isDestroyed: () => false, getBounds: () => ({ x: 190, y: 740, width: 24, height: 24 }) }
  });
  assert.equal(overTray.pointer.isPointOverTrayIcon(200, 750), true);
  assert.equal(overTray.pointer.isPointOverPet(200, 750), false);
});

test("히트 판정도 원좌표를 DIP로 옮긴 뒤에 한다", () => {
  // 원좌표 (400,1500)은 배율 2에서 DIP (200,750) — 펫 몸통 위다.
  // 변환을 건너뛰면 창(높이 720) 한참 아래라 거짓이 된다.
  assert.equal(createHarness({ dipScale: 2 }).pointer.isPointOverPet(400, 1500), true);
  assert.equal(createHarness().pointer.isPointOverPet(400, 1500), false);
});

test("크기가 0인 트레이 아이콘은 겹침으로 보지 않는다", () => {
  const { pointer } = createHarness({
    tray: { isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }) }
  });
  assert.equal(pointer.isPointOverTrayIcon(0, 0), false);
});

test("펫 위에 겹친 체크리스트·즐겨찾기 창 영역은 플로팅 패널로 본다", () => {
  const panel = { x: 400, y: 400, width: 200, height: 200 };
  const checklist = createHarness({ checklistWindow: fakeWindow(panel) });
  assert.equal(checklist.pointer.isPointOverFloatingPanel(450, 450), true);
  assert.equal(checklist.pointer.isPointOverFloatingPanel(50, 50), false);

  const favorites = createHarness({ favoritesWindow: fakeWindow(panel) });
  assert.equal(favorites.pointer.isPointOverFloatingPanel(450, 450), true);

  const dock = createHarness({ favoritesDockWindow: fakeWindow(panel) });
  assert.equal(dock.pointer.isPointOverFloatingPanel(450, 450), true);
});

test("숨겨진 창은 플로팅 패널로 보지 않는다", () => {
  const hidden = fakeWindow({ x: 400, y: 400, width: 200, height: 200 }, { visible: false });
  const { pointer } = createHarness({ checklistWindow: hidden });
  assert.equal(pointer.isPointOverFloatingPanel(450, 450), false);
});

test("펫 드래그 모드가 toggle이면 상시 드래그를 끈다", () => {
  assert.equal(createHarness().pointer.alwaysDragEnabled(), true);
  assert.equal(
    createHarness({ settings: { petDragMode: "toggle" } }).pointer.alwaysDragEnabled(),
    false
  );
});

test("머리 위에서 좌우로 왕복하면 쓰다듬기로 본다", () => {
  // (200,700)은 머리 영역이다. 방향 전환을 두 번 만들면 tracker가 활성으로 바뀐다.
  const { pointer, petWindow } = createHarness();
  for (const x of [180, 220, 180, 220, 180]) pointer.updateHeadPetting(x, 700);
  assert.deepEqual(petWindow.sent.at(-1), { channel: "pet:petting", payload: { active: true } });
});

test("설정이 꺼져 있거나 휴식 중이면 쓰다듬기를 추적하지 않는다", () => {
  for (const overrides of [{ settings: { headPettingEnabled: false } }, { restActive: true }]) {
    const { pointer, petWindow } = createHarness(overrides);
    for (const x of [180, 220, 180, 220, 180]) pointer.updateHeadPetting(x, 700);
    assert.deepEqual(petWindow.sent, [], JSON.stringify(overrides));
  }
});

test("펫 위에 겹친 패널 안에서는 머리 쓰다듬기를 시작하지 않는다", () => {
  const { pointer, petWindow } = createHarness({
    checklistWindow: fakeWindow({ x: 100, y: 600, width: 300, height: 300 })
  });
  for (const x of [180, 220, 180, 220, 180]) pointer.updateHeadPetting(x, 700);
  assert.deepEqual(petWindow.sent, []);
});

test("미디어 플레이어가 안 떠 있으면 그 영역 판정은 항상 거짓이다", () => {
  const rect = { left: 0, top: 600, width: 300, height: 60 };
  const hidden = createHarness({ mediaPlayerRect: rect, mediaPlayerVisible: false });
  assert.equal(hidden.pointer.isPointOverMediaPlayer(150, 830), false);
  // 사각형 자체가 없으면 보이더라도 거짓이다.
  const noRect = createHarness({ mediaPlayerVisible: true });
  assert.equal(noRect.pointer.isPointOverMediaPlayer(150, 830), false);
});
