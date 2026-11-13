import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const CORE_CODEMIRROR_PACKAGES = [
  "/node_modules/@codemirror/state/",
  "/node_modules/@codemirror/view/",
  "/node_modules/@codemirror/language/",
  "/node_modules/@codemirror/commands/",
  "/node_modules/@codemirror/search/",
  "/node_modules/@codemirror/autocomplete/",
  "/node_modules/@codemirror/lint/",
  "/node_modules/@codemirror/lang-markdown/",
  "/node_modules/@codemirror/theme-one-dark/",
  "/node_modules/@uiw/react-codemirror/",
  "/node_modules/@lezer/common/",
  "/node_modules/@lezer/lr/",
  "/node_modules/@lezer/highlight/",
  "/node_modules/@lezer/markdown/",
  "/node_modules/style-mod/",
  "/node_modules/crelt/",
  "/node_modules/w3c-keyname/",
];

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: "0.0.0.0",
    // Rust build outputs include loaded DLLs that Windows cannot watch.
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
  build: {
    // Mermaid 12 ships an optional lazy elkjs layout chunk (~1.5 MB) that is
    // only loaded if a diagram explicitly selects the ELK layout engine.
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const norm = id.replace(/\\/g, "/");

          if (
            norm.includes("/node_modules/react/") ||
            norm.includes("/node_modules/react-dom/") ||
            norm.includes("/node_modules/scheduler/")
          ) {
            return "vendor-react";
          }

          if (
            norm.includes("/node_modules/katex/") ||
            norm.includes("/node_modules/rehype-katex/") ||
            norm.includes("/node_modules/remark-math/") ||
            norm.includes("/node_modules/mdast-util-math/") ||
            norm.includes("/node_modules/micromark-extension-math/")
          ) {
            return "vendor-katex";
          }

          if (
            norm.includes("/node_modules/highlight.js/") ||
            norm.includes("/node_modules/lowlight/") ||
            norm.includes("/node_modules/rehype-highlight/")
          ) {
            return "vendor-highlight";
          }

          if (norm.includes("/node_modules/@codemirror/merge/")) {
            return "vendor-cm-merge";
          }

          if (norm.includes("/node_modules/@codemirror/language-data/")) {
            return "vendor-cm-languages";
          }

          // Keep @codemirror/lang-* and @codemirror/legacy-modes/* out of the
          // core chunk so @codemirror/language-data loads parsers lazily per language.
          if (CORE_CODEMIRROR_PACKAGES.some((pkg) => norm.includes(pkg))) {
            return "vendor-codemirror";
          }

          if (norm.includes("/node_modules/docx/")) {
            return "vendor-docx";
          }

          if (
            norm.includes("/node_modules/react-markdown/") ||
            norm.includes("/node_modules/unified/") ||
            norm.includes("/node_modules/remark-") ||
            norm.includes("/node_modules/rehype-") ||
            norm.includes("/node_modules/mdast-") ||
            norm.includes("/node_modules/hast-") ||
            norm.includes("/node_modules/micromark") ||
            norm.includes("/node_modules/unist-") ||
            norm.includes("/node_modules/vfile")
          ) {
            return "vendor-markdown";
          }

          return undefined;
        },
      },
    },
  },
});
