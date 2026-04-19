import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";

// Tauri expects a fixed dev port and no clearing of the terminal.
const host = process.env.TAURI_DEV_HOST;
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    __KEEPR_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Bundle markdown prompt files as raw strings.
  assetsInclude: ["**/*.md"],
}));
