import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), mkcert()],
  resolve: {
    dedupe: ["three"],
  },
  server: {
    https: true,
    host: true,
  },
  preview: {
    https: true,
    host: true,
  },
});
