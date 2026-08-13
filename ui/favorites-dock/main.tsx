import "../../src/shared/theme-vars.css";
import "../lib/window-base.css";
// 독의 파이 메뉴 연출(transform 조합·전환 상태)은 유틸리티로 옮기지 않고 전용 CSS로
// 유지한다 — AGENTS.md의 :active/transform 주의사항이 그대로 적용되는 영역이다.
import "./dock.css";
import "../../src/shared/ui-motion.css";
import "../../src/shared/i18n.js";
import "../../src/shared/ui-motion.js";
import "../../src/shared/favorite-icons.js";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
