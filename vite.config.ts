import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],

  // Lição da suíte: uma única cópia do React (senão hooks quebram).
  resolve: {
    dedupe: ["react", "react-dom"],
  },

  clearScreen: false,
  server: {
    // Porta única do LocalPaint na suíte (plano-so-completo §4.1): 1482.
    // O Tauri não tem fallback de porta — devUrl e esta porta têm que bater.
    port: 1482,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1483,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
