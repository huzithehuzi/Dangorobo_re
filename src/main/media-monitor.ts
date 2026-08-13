// Windows 미디어 세션(재생/일시정지 상태) 감시와 재생 제어. main.js에서 분리(2026-08-10).
//
// alarm-scheduler.js와 같은 의존성 주입 패턴이다 — 이 모듈은 PowerShell 자식 프로세스의
// 수명과 출력 파싱만 알고, 그 결과로 무엇을 할지(펫 창에 보내기, 마우스 통과 상태 갱신 등)는
// 전혀 모른다. 호출부가 넘긴 콜백으로만 바깥과 이야기한다.
import { execFile, spawn } from "node:child_process";
import * as readline from "node:readline";
import type { ChildProcess } from "node:child_process";

type MediaUpdate = { status: string };
type MediaMonitorDependencies = {
  /** 실행 시점에 PowerShell 경로를 돌려준다. */
  powershellPath: () => string;
  /** 상태가 오거나 프로세스가 죽을 때마다 호출된다. */
  onUpdate: (data: MediaUpdate) => void;
  /** 프로세스가 죽은 뒤 설정에 따라 다시 띄울지 돌려준다. */
  shouldRestart: () => boolean;
  /** 가짜 프로세스로 파싱과 재시작을 검증하는 테스트용 주입 지점이다. */
  spawnProcess?: typeof spawn;
  /** Windows가 아닌 곳에서도 검증하는 테스트용 주입 지점이다. */
  platform?: NodeJS.Platform;
};

// WinRT의 비동기 API를 PowerShell에서 동기적으로 기다리기 위한 헬퍼. 폴링 스크립트와
// 명령 스크립트가 같이 쓴다.
const MEDIA_AWAIT_HELPER_SCRIPT = [
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
  "function Await($WinRtTask, $ResultType) {",
  "  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)",
  "  $netTask = $asTask.Invoke($null, @($WinRtTask))",
  "  $netTask.Wait(-1) | Out-Null",
  "  $netTask.Result",
  "}",
  "[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null"
].join("\n");

const MEDIA_POLL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [Text.UTF8Encoding]::new()",
  MEDIA_AWAIT_HELPER_SCRIPT,
  "try {",
  "  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])",
  "} catch {",
  "  Write-Output '{\"status\":\"Unsupported\"}'",
  "  exit",
  "}",
  "while ($true) {",
  "  try {",
  "    $session = $mgr.GetCurrentSession()",
  "    if ($session) {",
  "      $playback = $session.GetPlaybackInfo()",
  "      $result = [PSCustomObject]@{ status = $playback.PlaybackStatus.ToString() }",
  "    } else {",
  "      $result = [PSCustomObject]@{ status = 'None' }",
  "    }",
  "    Write-Output ($result | ConvertTo-Json -Compress)",
  "  } catch {",
  "    Write-Output '{\"status\":\"Error\"}'",
  "  }",
  "  Start-Sleep -Milliseconds 1000",
  "}"
].join("\n");

const MEDIA_COMMAND_METHODS: Record<string, string> = {
  play: "TryPlayAsync",
  pause: "TryPauseAsync",
  next: "TrySkipNextAsync",
  previous: "TrySkipPreviousAsync"
};

function mediaCommandScript(action: string): string {
  const method = MEDIA_COMMAND_METHODS[action];
  return [
    "$ErrorActionPreference = 'Stop'",
    MEDIA_AWAIT_HELPER_SCRIPT,
    "$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])",
    "$session = $mgr.GetCurrentSession()",
    "if ($session) {",
    `  Await ($session.${method}()) ([bool]) | Out-Null`,
    "}"
  ].join("\n");
}

function createMediaMonitor({
  powershellPath,
  onUpdate,
  shouldRestart,
  // 아래 둘은 테스트에서 가짜 프로세스를 넣고 Windows가 아닌 곳에서도 돌리기 위한 구멍이다.
  spawnProcess = spawn,
  platform = process.platform
}: MediaMonitorDependencies) {
  let monitorProcess: ChildProcess | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  function start() {
    if (platform !== "win32" || monitorProcess) return;
    const child = spawnProcess(
      powershellPath(),
      ["-NoProfile", "-NonInteractive", "-Command", MEDIA_POLL_SCRIPT],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    monitorProcess = child;
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line: string) => {
      try {
        onUpdate(JSON.parse(line));
      } catch {}
    });
    child.on("exit", () => {
      if (monitorProcess === child) {
        monitorProcess = null;
        onUpdate({ status: "None" });
        if (shouldRestart()) {
          restartTimer = setTimeout(start, 5000);
        }
      }
    });
    child.on("error", () => {
      if (monitorProcess === child) monitorProcess = null;
    });
  }

  /** 프로세스와 재시작 타이머만 정리한다 — 화면 상태 되돌리기는 호출부의 몫이다. */
  function stop() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    if (monitorProcess) {
      monitorProcess.removeAllListeners();
      monitorProcess.kill();
      monitorProcess = null;
    }
  }

  /** play/pause/next/previous 중 하나만 실행한다. */
  function sendCommand(action: string) {
    if (platform !== "win32") return;
    if (!Object.prototype.hasOwnProperty.call(MEDIA_COMMAND_METHODS, action)) return;
    execFile(
      powershellPath(),
      ["-NoProfile", "-NonInteractive", "-Command", mediaCommandScript(action)],
      { windowsHide: true, timeout: 4000 },
      (error: Error | null) => {
        if (error) console.error("미디어 명령 실행 실패:", error);
      }
    );
  }

  return { start, stop, sendCommand };
}

export { createMediaMonitor, MEDIA_AWAIT_HELPER_SCRIPT };
export type { MediaMonitorDependencies, MediaUpdate };
