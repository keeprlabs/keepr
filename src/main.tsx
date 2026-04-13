import React from "react";
import ReactDOM from "react-dom/client";
import { openUrl } from "@tauri-apps/plugin-opener";
import App from "./App";
import "./styles/globals.css";

// Tauri's webview doesn't handle target="_blank" or external href clicks.
// Intercept all clicks on <a> tags with an http(s) href and open them
// in the system browser via plugin-opener instead.
document.addEventListener("click", (e) => {
  const anchor = (e.target as HTMLElement).closest("a[href]");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href) return;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    e.preventDefault();
    e.stopPropagation();
    openUrl(href).catch((err) =>
      // eslint-disable-next-line no-console
      console.error("[keepr] failed to open URL:", href, err)
    );
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
