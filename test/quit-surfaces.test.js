// @ts-check
// 종료 신호를 받았을 때 화면에서 먼저 사라지는 부분. 창·트레이를 주입받으므로 Electron
// 없이 확인한다. 종료가 느려 보이던 원인(요약 대기 동안 펫이 그대로 떠 있음)의 회귀 방지.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { hideSurfacesForQuit } = require("../src/main/windows/quit-surfaces.js");

/** @param {{visible?: boolean, destroyed?: boolean}} [options] */
function createWindow(options = {}) {
  const state = {
    visible: options.visible !== false,
    destroyed: options.destroyed === true,
    hides: 0
  };
  return {
    state,
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    hide: () => {
      state.hides += 1;
      state.visible = false;
    }
  };
}

/** @param {{destroyed?: boolean}} [options] */
function createTray(options = {}) {
  const state = { destroyed: options.destroyed === true, destroys: 0 };
  return {
    state,
    isDestroyed: () => state.destroyed,
    destroy: () => {
      state.destroys += 1;
      state.destroyed = true;
    }
  };
}

test("보이는 창을 모두 숨기고 트레이 아이콘도 지운다", () => {
  const windows = [createWindow(), createWindow(), createWindow()];
  const tray = createTray();
  hideSurfacesForQuit({ windows: () => windows, tray: () => tray });
  assert.deepEqual(windows.map((win) => win.state.hides), [1, 1, 1]);
  // 창만 숨기면 트레이 아이콘이 남아 아직 살아 있는 것처럼 보인다.
  assert.equal(tray.state.destroys, 1);
});

test("이미 숨겼거나 파괴된 대상은 건드리지 않는다", () => {
  const hidden = createWindow({ visible: false });
  const destroyed = createWindow({ destroyed: true });
  const tray = createTray({ destroyed: true });
  hideSurfacesForQuit({ windows: () => [hidden, destroyed], tray: () => tray });
  assert.equal(hidden.state.hides, 0);
  assert.equal(destroyed.state.hides, 0);
  assert.equal(tray.state.destroys, 0);
});

test("트레이가 없어도 창은 숨긴다", () => {
  const win = createWindow();
  hideSurfacesForQuit({ windows: () => [win], tray: () => null });
  assert.equal(win.state.hides, 1);
});

// before-quit은 요약이 끝난 뒤 다시 quit을 부르므로 이 경로는 두 번 돈다.
test("다시 불러도 같은 대상을 두 번 건드리지 않는다", () => {
  const windows = [createWindow(), createWindow()];
  const tray = createTray();
  const deps = { windows: () => windows, tray: () => tray };
  hideSurfacesForQuit(deps);
  hideSurfacesForQuit(deps);
  assert.deepEqual(windows.map((win) => win.state.hides), [1, 1]);
  assert.equal(tray.state.destroys, 1);
});

// 요약을 기다리기 **전에** 숨겨야 의미가 있다 — 뒤에 두면 8초 내내 펫이 떠 있다.
test("main은 요약을 기다리기 전에 화면을 치운다", () => {
  const source = fs
    .readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8")
    .replace(/\r\n?/g, "\n");
  const beforeQuit = source.indexOf('app.on("before-quit"');
  assert.ok(beforeQuit > 0, "before-quit 리스너를 찾지 못했다");
  const hideCall = source.indexOf("hideSurfacesForQuit({", beforeQuit);
  const summaryCall = source.indexOf("runQuitEpisodeSummary(", beforeQuit);
  assert.ok(hideCall > 0, "before-quit이 화면을 치우지 않는다");
  assert.ok(summaryCall > 0, "before-quit이 종료 요약을 부르지 않는다");
  assert.ok(hideCall < summaryCall, "화면 정리가 요약 대기보다 뒤에 있다");
});
