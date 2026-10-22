import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { systemClock } from "./clock.ts";
import { createDb, runMigrations } from "./db/client.ts";
import { readEnv } from "./env.ts";
import { createJobs } from "./jobs.ts";
import { createLive } from "./live.ts";
import { createLoop } from "./loop.ts";
import { smtpTransport } from "./mail/smtp.ts";

const env = readEnv();
const db = createDb(env.databaseUrl);

// Миграции — до `listen` (D-009).
await runMigrations(db);
// Слушатель live-счётчиков — до циклов и `serve` (SPEC §3, «Порядок старта»).
const live = createLive(db);
await live.start();

const transport = smtpTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  from: env.mailFrom,
  messageIdDomain: new URL(env.publicUrl).hostname,
});
const jobs = createJobs({ db, transport, publicUrl: env.publicUrl });
// Отправка — каждые 2 с и по пинку после коммита (D-013, D-014).
const outbox = createLoop("отправка писем", () => jobs.dispatch(systemClock.now()), 2000);
outbox.start();
// Напоминания — сразу после старта и раз в минуту; поставленное уходит пинком отправки (D-018).
const reminders = createLoop(
  "напоминания",
  async () => {
    if ((await jobs.sweepReminders(systemClock.now())) > 0) outbox.wake();
  },
  60_000,
);
reminders.start();

const app = new Hono().route("/", createApp({ db, clock: systemClock, config: env, live, outbox }));

// Один процесс отдаёт и API, и собранный фронт; остальные пути — SPA-фоллбэк на index.html (D-024).
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
} else {
  console.warn(`Собранного фронта нет (${webDist}): отдаётся только API. Соберите его: pnpm build`);
}

const server = serve({ fetch: app.fetch, port: env.port }, ({ port }) => {
  console.log(`API слушает http://localhost:${port}`);
});

const shutdown = () => {
  // Остановка live закрывает открытые SSE-потоки, иначе `close` ждал бы их вечно.
  const liveStopped = live.stop();
  server.close(async () => {
    await Promise.all([reminders.stop().then(() => outbox.stop()), liveStopped]);
    await db.$client.end({ timeout: 5 });
    process.exit(0);
  });
  if (!("closeIdleConnections" in server)) return;
  // Соединение закончившегося потока браузер держит keep-alive и переподключается по нему же — закрываем.
  void liveStopped.then(() => server.closeIdleConnections());
  // Что не закончилось за 5 с, обрываем: иначе `close` ждёт без конца.
  setTimeout(() => server.closeAllConnections(), 5000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
