/** @type {import('tailwindcss').Config} */
import { createRequire } from 'module';

// Loaded through createRequire because the plugin is CommonJS while this
// config is ESM (package.json sets "type": "module").
const require = createRequire(import.meta.url);
const tailwindcssAnimate = require('tailwindcss-animate');

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Semantic surfaces backed by CSS variables, so light/dark colors live
        // in one place instead of scattered arbitrary dark:bg-[#...] values.
        app: "rgb(var(--color-bg-app) / <alpha-value>)",
        chrome: "rgb(var(--color-bg-chrome) / <alpha-value>)",
        panel: "rgb(var(--color-bg-panel) / <alpha-value>)",
        workspace: "rgb(var(--color-bg-workspace) / <alpha-value>)",
        elevated: "rgb(var(--color-bg-elevated) / <alpha-value>)",
        edge: "rgb(var(--color-border) / <alpha-value>)",
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "Roboto",
          "'Helvetica Neue'",
          "Arial",
          "'Noto Sans'",
          "'PingFang SC'",
          "'Hiragino Sans GB'",
          "'Microsoft YaHei'",
          "sans-serif",
        ],
        mono: [
          "'JetBrains Mono'",
          "'Fira Code'",
          "'Cascadia Code'",
          "Consolas",
          "'Courier New'",
          "monospace",
        ],
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
