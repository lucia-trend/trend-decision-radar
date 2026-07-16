import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "static",
  base: "/trend-decision-radar/",
  plugins: [react()],
  build: { outDir: "../dist-pages", emptyOutDir: true },
});
