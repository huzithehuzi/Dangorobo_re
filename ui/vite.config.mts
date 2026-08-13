// React로 전환한 창들의 Vite 설정 (2026-08-10 도입).
// - 멀티페이지: 창 하나 = ui/<창 이름>/index.html 입력 하나. 창을 전환할 때마다 input에 추가한다.
// - 산출물은 dist/ui/<창 이름>/ 로 나가고, main.js의 loadUiWindow()가 로드한다.
// - base "./"라 file:// 로 로드해도 에셋 경로가 맞는다(패키징 후에도 동일).
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootDir,
  base: "./",
  appType: "mpa",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(rootDir, "../dist/ui"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        logs: resolve(rootDir, "logs/index.html"),
        "pet-context-menu": resolve(rootDir, "pet-context-menu/index.html"),
        "favorites-window": resolve(rootDir, "favorites-window/index.html"),
        "favorites-dock": resolve(rootDir, "favorites-dock/index.html"),
        checklist: resolve(rootDir, "checklist/index.html"),
        settings: resolve(rootDir, "settings/index.html")
      }
    }
  }
});
