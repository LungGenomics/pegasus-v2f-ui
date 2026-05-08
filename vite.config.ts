import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// GitHub Pages serves project sites at /<repo-name>/, so production builds
// need that path prefix. Dev runs at /, so leave base alone there.
// Override via VITE_BASE_PATH for other deploy targets (custom domains, etc.).
export default defineConfig(({ command }) => ({
  base:
    command === "build"
      ? process.env.VITE_BASE_PATH ?? "/pegasus-v2f-ui/"
      : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
}));
