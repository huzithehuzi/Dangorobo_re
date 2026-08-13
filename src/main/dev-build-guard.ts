// TS 전환 파일의 낡은 산출물 감지. .ts 소스가 옆자리 .js보다 새로우면(또는 .js가 없으면)
// 앱이 조용히 옛 코드를 실행하는 함정이 된다 — prestart/pretest 훅을 타지 않는
// `npx electron .`(QA 캡처)이 정확히 그 경로라, main.js가 시작 시점에 이 검사로 막는다.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Dirent } from "node:fs";

const SKIP_DIRS = new Set(["node_modules", "vendor"]);

/** rootDir 아래에서 산출물(.js)이 없거나 소스(.ts)보다 오래된 전환 파일을 찾는다. */
function findStaleTsArtifacts(rootDir: string): string[] {
  const stale: string[] = [];
  walk(rootDir);
  return stale;

  function walk(dir: string): void {
    let entries: Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
      const artifactPath = fullPath.slice(0, -3) + ".js";
      let artifactMtime: number;
      try {
        artifactMtime = fs.statSync(artifactPath).mtimeMs;
      } catch {
        stale.push(path.relative(rootDir, fullPath));
        continue;
      }
      if (fs.statSync(fullPath).mtimeMs > artifactMtime) {
        stale.push(path.relative(rootDir, fullPath));
      }
    }
  }
}

export { findStaleTsArtifacts };
