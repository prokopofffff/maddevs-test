import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // В разработке API — отдельный процесс; IP клиента передаётся заголовком (D-006, D-024).
    proxy: { "/api": { target: "http://localhost:3000", xfwd: true } },
  },
});
