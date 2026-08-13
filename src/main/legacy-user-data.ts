import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";

const LEGACY_USER_DATA_DIR_NAME = "low-poly-desktop-pet";

type LegacyUserDataDependencies = {
  argv: string[];
  existsSync: (filePath: string) => boolean;
  getAppDataPath: () => string;
  setUserDataPath: (filePath: string) => void;
  joinPath: (...parts: string[]) => string;
};

function configureLegacyUserDataPath(deps: LegacyUserDataDependencies): void {
  const overridden = deps.argv.some(
    (arg) => arg === "--user-data-dir" || arg.startsWith("--user-data-dir=")
  );
  if (overridden) return;

  try {
    const legacyUserDataPath = deps.joinPath(
      deps.getAppDataPath(),
      LEGACY_USER_DATA_DIR_NAME
    );
    if (deps.existsSync(legacyUserDataPath)) {
      deps.setUserDataPath(legacyUserDataPath);
    }
  } catch {
    // 경로 조회/설정이 실패하면 Electron 기본값(새 이름 폴더)을 그대로 쓴다.
  }
}

// 이 side effect는 main.ts의 다른 모든 main 모듈 import보다 먼저 평가돼야 한다.
// 그래야 각 모듈이 userData 경로를 처음 읽기 전에 예전 폴더 선택이 끝난다.
configureLegacyUserDataPath({
  argv: process.argv,
  existsSync: fs.existsSync,
  getAppDataPath: () => app.getPath("appData"),
  setUserDataPath: (filePath) => app.setPath("userData", filePath),
  joinPath: path.join
});

export { LEGACY_USER_DATA_DIR_NAME, configureLegacyUserDataPath };
export type { LegacyUserDataDependencies };
