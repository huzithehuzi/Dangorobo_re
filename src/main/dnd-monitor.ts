// 전체화면 방해 금지 감지. main.js에서 분리(2026-08-10).
//
// media-monitor.js와 같은 의존성 주입 패턴이다 — 이 모듈은 "지금 방해 금지 상태인가"만
// 판단하고, 그래서 어떤 창을 숨길지는 전혀 모른다. 호출부가 넘긴 onStateChange만 부른다.
import { spawn } from "node:child_process";
import * as readline from "node:readline";
import type { ChildProcess } from "node:child_process";

type DndReason = { state: number; foreground: string };
type DndMonitorDependencies = {
  /** 실행 시점에 PowerShell 경로를 돌려준다. */
  powershellPath: () => string;
  /** 같은 값으로 여러 번 불릴 수 있으므로 중복 처리는 호출부가 담당한다. */
  onStateChange: (active: boolean, reason: DndReason) => void;
  /** 프로세스가 죽은 뒤 설정에 따라 다시 띄울지 돌려준다. */
  shouldRestart: () => boolean;
  /** 가짜 프로세스로 파싱과 재시작을 검증하는 테스트용 주입 지점이다. */
  spawnProcess?: typeof spawn;
  /** Windows가 아닌 곳에서도 검증하는 테스트용 주입 지점이다. */
  platform?: NodeJS.Platform;
};

// Windows가 "지금 알림을 띄워도 되는지" 판단하는 데 쓰는 SHQueryUserNotificationState를
// 그대로 사용한다(창 크기를 직접 비교하는 것보다 정확하다).
// 2 = QUNS_BUSY(전체화면 앱 실행 중 또는 프레젠테이션 설정), 3 = D3D 전체화면,
// 4 = 프레젠테이션 모드 → 이 셋을 방해 금지로 본다.
// 이 목록을 바꾸면 아래 DND_POLL_SCRIPT 안에 하드코딩된 `$state -eq 2 -or 3 -or 4`도 같이
// 고쳐야 한다 — 안 고치면 새로 추가한 상태에서만 로그의 foreground가 빈 문자열로 남는다.
const DND_STATES = new Set([2, 3, 4]);

// "바쁨" 신호가 이 시간만큼 계속 이어져야 실제로 방해 금지에 들어간다(펫을 숨긴다).
// Win+Shift+S 캡처 오버레이처럼 순간적으로만 QUNS_BUSY를 보고하는 경우가 있는데,
// 디바운스 없이 그대로 반응하면 스크린샷 찍을 때마다 펫이 사라지는 버그가 생긴다.
// 원래 3초였는데 "전체화면 감지하는 시간이 너무 길어"(2026-08-02) 피드백으로 1초로
// 줄였다 — 폴링 주기(DND_POLL_SCRIPT의 Start-Sleep)도 같이 300ms로 줄여야, 이 값을
// 줄인 게 실제로 체감되는 총 지연 시간에 반영된다(폴링이 뜸하면 이 값을 줄여도 다음
// 샘플이 올 때까지 못 기다림).
const DND_HIDE_DELAY_MS = 1000;

// 출력은 `상태숫자|포그라운드앱이름` 한 줄. 앱 이름은 방해 금지 상태(2/3/4)일 때만 조회한다 —
// 300ms마다 도는 루프라 평상시엔 Get-Process 비용을 아예 안 들이기 위함이다. 이 이름이 있어야
// "무엇 때문에 펫이 숨었는지"를 나중에 window-debug.log만 보고 특정할 수 있다(2026-08-09 추가:
// "그림판만 켜면 펫이 숨는다" 제보를 상태 숫자만으로는 재현·확정할 수 없었다).
const DND_POLL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -Namespace Win32Dnd -Name Q -MemberDefinition '",
  "[DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int state);",
  "[DllImport(\"user32.dll\")] public static extern System.IntPtr GetForegroundWindow();",
  "[DllImport(\"user32.dll\")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int pid);'",
  "while ($true) {",
  "  $state = 0",
  "  try {",
  "    [void][Win32Dnd.Q]::SHQueryUserNotificationState([ref]$state)",
  "    $who = ''",
  "    if ($state -eq 2 -or $state -eq 3 -or $state -eq 4) {",
  "      try {",
  "        $owner = 0",
  "        [void][Win32Dnd.Q]::GetWindowThreadProcessId([Win32Dnd.Q]::GetForegroundWindow(), [ref]$owner)",
  "        $who = (Get-Process -Id $owner -ErrorAction Stop).ProcessName",
  "      } catch { $who = '?' }",
  "    }",
  "    Write-Output \"$state|$who\"",
  "  } catch {",
  "    Write-Output '0|'",
  "  }",
  "  Start-Sleep -Milliseconds 300",
  "}"
].join("\n");

function createDndMonitor({
  powershellPath,
  onStateChange,
  shouldRestart,
  // 아래 둘은 테스트에서 가짜 프로세스를 넣고 Windows가 아닌 곳에서도 돌리기 위한 구멍이다.
  spawnProcess = spawn,
  platform = process.platform
}: DndMonitorDependencies) {
  let monitorProcess: ChildProcess | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  // 방해 금지가 켜지는 순간의 근거(상태 숫자와 그때 포그라운드였던 앱). 로그에만 쓴다.
  let lastState = 0;
  let lastForeground = "";
  // "바쁨"이 처음 관측된 시각. 0이면 지금은 안 바쁘다는 뜻이다.
  let busySince = 0;

  function reason(): DndReason {
    return { state: lastState, foreground: lastForeground };
  }

  function start() {
    if (platform !== "win32" || monitorProcess) return;
    const child = spawnProcess(
      powershellPath(),
      ["-NoProfile", "-NonInteractive", "-Command", DND_POLL_SCRIPT],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    monitorProcess = child;
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line: string) => {
      const [rawState, rawForeground = ""] = String(line).trim().split("|");
      const state = Number(rawState);
      if (!Number.isFinite(state) || state === 0) return;
      lastState = state;
      lastForeground = rawForeground;
      const busyNow = DND_STATES.has(state);
      if (!busyNow) {
        busySince = 0;
        onStateChange(false, reason());
        return;
      }
      if (!busySince) busySince = Date.now();
      if (Date.now() - busySince >= DND_HIDE_DELAY_MS) onStateChange(true, reason());
    });
    child.on("exit", () => {
      if (monitorProcess !== child) return;
      monitorProcess = null;
      busySince = 0;
      onStateChange(false, reason());
      if (shouldRestart()) {
        restartTimer = setTimeout(start, 5000);
      }
    });
    child.on("error", () => {
      if (monitorProcess === child) monitorProcess = null;
    });
  }

  function stop() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    if (monitorProcess) {
      monitorProcess.kill();
      monitorProcess = null;
    }
    busySince = 0;
    onStateChange(false, reason());
  }

  return { start, stop };
}

export { createDndMonitor };
export type { DndMonitorDependencies, DndReason };
