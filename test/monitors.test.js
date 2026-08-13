// @ts-check
// 미디어·방해 금지 모니터 회귀 테스트 (2026-08-10).
//
// 둘 다 Windows 전용이라 macOS/Linux CI에서는 실제 동작을 볼 수 없다. 그래서 두 모듈은
// spawn과 platform을 주입받게 열어뒀고, 여기서 가짜 자식 프로세스로 출력만 흘려보내
// **파싱·디바운스·재시작 판단**을 검증한다(실제 PowerShell 스크립트의 정확성은 여전히
// Windows 실기에서만 확인할 수 있다).
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");

const { createMediaMonitor } = require("../src/main/media-monitor.js");
const { createDndMonitor } = require("../src/main/dnd-monitor.js");

/** PowerShell 자식 프로세스 흉내 — stdout으로 줄을 흘리고 exit을 낼 수 있다. */
function fakeChild() {
  const child = /** @type {any} */ (new EventEmitter());
  child.stdout = new Readable({ read() {} });
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  child.emitLine = (/** @type {string} */ line) => child.stdout.push(line + "\n");
  child.exit = () => child.emit("exit");
  return child;
}

/** readline이 줄을 흘려보낼 시간을 준다. */
function flush() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

test("미디어 모니터: 출력 JSON을 그대로 onUpdate로 넘긴다", async () => {
  const child = fakeChild();
  /** @type {Array<{ status: string }>} */
  const seen = [];
  const monitor = createMediaMonitor({
    powershellPath: () => "pwsh",
    onUpdate: (data) => seen.push(data),
    shouldRestart: () => false,
    spawnProcess: () => child,
    platform: "win32"
  });
  monitor.start();
  child.emitLine('{"status":"Playing"}');
  child.emitLine("깨진 줄");
  child.emitLine('{"status":"Paused"}');
  await flush();
  monitor.stop();
  assert.deepEqual(seen, [{ status: "Playing" }, { status: "Paused" }]);
});

test("미디어 모니터: Windows가 아니면 프로세스를 띄우지 않는다", () => {
  let spawned = 0;
  const monitor = createMediaMonitor({
    powershellPath: () => "pwsh",
    onUpdate: () => {},
    shouldRestart: () => false,
    spawnProcess: () => {
      spawned++;
      return fakeChild();
    },
    platform: "darwin"
  });
  monitor.start();
  assert.equal(spawned, 0);
});

test("미디어 모니터: 두 번 start해도 프로세스는 하나다", () => {
  let spawned = 0;
  const monitor = createMediaMonitor({
    powershellPath: () => "pwsh",
    onUpdate: () => {},
    shouldRestart: () => false,
    spawnProcess: () => {
      spawned++;
      return fakeChild();
    },
    platform: "win32"
  });
  monitor.start();
  monitor.start();
  assert.equal(spawned, 1);
});

test("미디어 모니터: 프로세스가 죽으면 None을 알리고 설정에 따라 재시작한다", async () => {
  /** @type {any[]} */
  const children = [];
  /** @type {string[]} */
  const seen = [];
  let restartWanted = true;
  const monitor = createMediaMonitor({
    powershellPath: () => "pwsh",
    onUpdate: (data) => seen.push(data.status),
    shouldRestart: () => restartWanted,
    spawnProcess: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
    platform: "win32"
  });
  monitor.start();
  children[0].exit();
  await flush();
  assert.deepEqual(seen, ["None"]);
  assert.equal(children.length, 1, "재시작은 5초 뒤라 즉시 새로 뜨지는 않는다");
  monitor.stop(); // 대기 중인 재시작 타이머를 없앤다

  // 설정이 꺼져 있으면 죽어도 재시작 예약을 하지 않는다.
  restartWanted = false;
  monitor.start();
  children[1].exit();
  await flush();
  assert.deepEqual(seen, ["None", "None"]);
  monitor.stop();
});

test("방해 금지: 바쁨이 유지돼야 켜진다(짧은 깜빡임은 무시)", async () => {
  const child = fakeChild();
  /** @type {Array<{ active: boolean, state: number, foreground: string }>} */
  const events = [];
  const monitor = createDndMonitor({
    powershellPath: () => "pwsh",
    onStateChange: (active, reason) => events.push({ active, ...reason }),
    shouldRestart: () => false,
    spawnProcess: () => child,
    platform: "win32"
  });
  monitor.start();

  // Win+Shift+S 캡처 오버레이처럼 순간적으로만 바쁨을 보고하는 경우 —
  // 1초를 못 채우고 곧바로 한가해지면 방해 금지에 들어가지 않아야 한다.
  child.emitLine("2|ScreenClippingHost");
  await flush();
  child.emitLine("1|");
  await flush();
  assert.deepEqual(events.map((e) => e.active), [false], "짧은 바쁨은 켜지면 안 된다");

  monitor.stop();
});

test("방해 금지: 상태 0과 깨진 줄은 무시한다", async () => {
  const child = fakeChild();
  /** @type {boolean[]} */
  const events = [];
  const monitor = createDndMonitor({
    powershellPath: () => "pwsh",
    onStateChange: (active) => events.push(active),
    shouldRestart: () => false,
    spawnProcess: () => child,
    platform: "win32"
  });
  monitor.start();
  child.emitLine("0|");
  child.emitLine("이건숫자가아님|");
  await flush();
  assert.deepEqual(events, []);
  monitor.stop();
});

test("방해 금지: 한가해지면 해제를 알리고 근거(상태·앱 이름)를 함께 넘긴다", async () => {
  const child = fakeChild();
  /** @type {Array<{ active: boolean, state: number, foreground: string }>} */
  const events = [];
  const monitor = createDndMonitor({
    powershellPath: () => "pwsh",
    onStateChange: (active, reason) => events.push({ active, ...reason }),
    shouldRestart: () => false,
    spawnProcess: () => child,
    platform: "win32"
  });
  monitor.start();
  child.emitLine("3|game");
  await flush();
  child.emitLine("1|explorer");
  await flush();
  const release = events.at(-1);
  assert.equal(release?.active, false);
  assert.equal(release?.state, 1, "마지막으로 관측한 상태 숫자를 넘긴다");
  assert.equal(release?.foreground, "explorer");
  monitor.stop();
});

test("방해 금지: stop()은 해제를 한 번 알린다", async () => {
  const child = fakeChild();
  /** @type {boolean[]} */
  const events = [];
  const monitor = createDndMonitor({
    powershellPath: () => "pwsh",
    onStateChange: (active) => events.push(active),
    shouldRestart: () => false,
    spawnProcess: () => child,
    platform: "win32"
  });
  monitor.start();
  monitor.stop();
  assert.deepEqual(events, [false]);
  assert.equal(child.killed, true);
});
