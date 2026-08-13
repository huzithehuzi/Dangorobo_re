import "../../src/shared/theme-vars.css";
import "../lib/window-base.css";
import "../../src/shared/ui-motion.css";
import "../../src/shared/ui-motion.js";
import "../../src/shared/favorite-icons.js";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
