import "../../src/shared/theme-vars.css";
import "../lib/window-base.css";
import "../../src/shared/ui-motion.css";
import "../../src/shared/i18n.js";
import "../../src/shared/ui-motion.js";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
