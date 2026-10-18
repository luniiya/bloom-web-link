import { createRoot } from "react-dom/client";
import { App } from "./components/App.tsx";
import { applyTheme, savedTheme } from "./theme.ts";

// Apply the saved theme before the first render so the page never flashes.
applyTheme(savedTheme(), false);

createRoot(document.getElementById("root")!).render(<App />);
