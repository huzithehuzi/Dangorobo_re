// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCapsLockStateReader,
  parseCapsLockState
} = require("../src/main/caps-lock-state.js");

test("CapsLock PowerShell 출력은 공백과 대소문자를 무시해 해석한다", () => {
  assert.equal(parseCapsLockState(" True\r\n"), true);
  assert.equal(parseCapsLockState("FALSE\n"), false);
  assert.equal(parseCapsLockState("1"), false);
  assert.equal(parseCapsLockState(undefined), false);
});

test("Windows가 아니면 PowerShell을 실행하지 않고 상태 없음을 돌려준다", async () => {
  let executions = 0;
  const read = createCapsLockStateReader({
    platform: "darwin",
    powershellPath: () => "powershell.exe",
    execFile: () => { executions += 1; }
  });
  assert.equal(await read(), undefined);
  assert.equal(executions, 0);
});

test("Windows에서는 제한된 PowerShell 인자로 실제 CapsLock 상태를 읽는다", async () => {
  /** @type {unknown[]} */
  const executions = [];
  const read = createCapsLockStateReader({
    platform: "win32",
    powershellPath: () => "D:\\Windows\\powershell.exe",
    execFile: (file, args, options, callback) => {
      executions.push({ file, args, options });
      callback(null, "TRUE\r\n");
    }
  });
  assert.equal(await read(), true);
  assert.deepEqual(executions, [{
    file: "D:\\Windows\\powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", "[Console]::CapsLock"],
    options: { encoding: "utf8", timeout: 8000, windowsHide: true }
  }]);

  const readOff = createCapsLockStateReader({
    platform: "win32",
    powershellPath: () => "powershell.exe",
    execFile: (_file, _args, _options, callback) => callback(null, "False\r\n")
  });
  assert.equal(await readOff(), false, "reader가 파서의 false 결과도 그대로 돌려준다");
});

test("PowerShell 실행 실패는 호출자에게 같은 오류로 전달한다", async () => {
  const expected = new Error("PowerShell 실패");
  const read = createCapsLockStateReader({
    platform: "win32",
    powershellPath: () => "powershell.exe",
    execFile: (_file, _args, _options, callback) => callback(expected, "")
  });
  await assert.rejects(read(), (error) => error === expected);
});
