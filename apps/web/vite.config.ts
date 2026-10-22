import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Порт фиксирован: на него ведут ссылки в письмах (`PUBLIC_URL` в `apps/api` dev).
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // В разработке API — отдельный процесс; IP клиента передаётся заголовком (D-006, D-024).
    // Порт API тот же, что читает `apps/api` (`PORT`).
    proxy: { "/api": { target: `http://localhost:${process.env.PORT ?? 3000}`, xfwd: true } },
  },
});
