// CSS 순서는 바닐라 settings.html과 동일: theme-vars → settings.css → color-picker.css →
// ui-motion.css(항상 마지막). settings.css가 자체 :root 배경·폰트 규칙을 갖고 있어
// window-base.css(Tailwind 진입점)는 여기서 쓰지 않는다 — 이 창은 기존 스타일시트를
// 그대로 유지하는 쪽이 안전하다(파이 메뉴 dock.css와 같은 판단).
import "../../src/shared/theme-vars.css";
import "./settings.css";
import "../../src/shared/color-picker.css";
import "../../src/shared/ui-motion.css";
// 전역 스크립트: PetUiMotion / PetColorPicker / PetI18n / FavoriteIcons / PetCustomizationCatalog
import "../../src/shared/ui-motion.js";
import "../../src/shared/color-picker.js";
import "../../src/shared/i18n.js";
import "../../src/shared/favorite-icons.js";
import "../../src/shared/customization-catalog.js";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
