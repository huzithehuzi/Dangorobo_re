// CSS 로드 순서는 바닐라 창들과 동일하게 유지한다:
// theme-vars(테마 토큰) → 창 베이스(Tailwind 포함) → ui-motion(공용 모션, 항상 마지막).
import "../../src/shared/theme-vars.css";
import "../lib/window-base.css";
import "../../src/shared/ui-motion.css";
// UMD·전역 스크립트 — window.PetI18n / window.PetUiMotion 을 심는다(값 import 아님).
import "../../src/shared/i18n.js";
import "../../src/shared/ui-motion.js";
import { createRoot } from "react-dom/client";
import App from "./App";

// StrictMode는 쓰지 않는다: dev 모드에서 effect를 두 번 실행하는데, preload의
// onAssistantLogAdded/onSettingsUpdated는 구독 해제 API가 없어 리스너가 중복 등록된다.
createRoot(document.getElementById("root")!).render(<App />);
