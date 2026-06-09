import { defineConfig } from "vite";
import path from "node:path";

/**
 * Builds the self-contained playback runtime as a single IIFE that exposes
 * `window.MarathonRuntime`. Output goes to public/ so the dev server serves it at
 * /marathon-runtime.js and the production build copies it into dist/. The interactive
 * web export fetches & inlines it. `inlineDynamicImports` folds p5.sound in too.
 */
export default defineConfig({
  // We deliberately emit into public/; disable publicDir handling so Vite doesn't warn
  // about outDir === publicDir.
  publicDir: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // See the stub for why: avoid p5.sound's eager AudioWorklet init in the inlined IIFE.
      "p5/lib/addons/p5.sound.js": path.resolve(__dirname, "src/runtime-stubs/p5sound-empty.ts"),
    },
  },
  build: {
    outDir: "public",
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/runtime-entry.ts"),
      name: "MarathonRuntime",
      formats: ["iife"],
      fileName: () => "marathon-runtime.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
