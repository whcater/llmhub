import { defineConfig } from "vite";
import { resolve } from "path";

// Tauri expects a fixed port and ignores HMR over network during dev.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        caption: resolve(__dirname, "caption.html"),
      },
    },
  },
});
