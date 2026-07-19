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

  // O onnxruntime-web carrega o runtime wasm com um import() de URL calculada
  // em runtime; o pré-bundle do dev reescreve esse import e ele passa a
  // falhar com "no available backend found" SÓ EM DEV — o que mascara a
  // prova do backend. Fora do optimizeDeps, o loader fica nativo nos dois
  // mundos (dev = prod) e o selfteste do bgremove vale como prova.
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
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
