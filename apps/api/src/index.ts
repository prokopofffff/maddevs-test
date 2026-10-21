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
import { createOutboxRunner } from "./mail/outbox.ts";
import { smtpTransport } from "./mail/smtp.ts";

const env = readEnv();
const db = createDb(env.databaseUrl);

// Миграции — до `listen` (D-009).
await runMigrations(db);

const transport = smtpTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  from: env.mailFrom,
  messageIdDomain: new URL(env.publicUrl).hostname,
});
const jobs = createJobs({ db, transport });
// Отправка — каждые 2 с и по пинку после коммита (D-013, D-014).
const outbox = createOutboxRunner(() => jobs.dispatch(systemClock.now()));
outbox.start();

const app = new Hono().route("/", createApp({ db, clock: systemClock, config: env, outbox }));

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
  server.close(async () => {
    await outbox.stop();
    await db.$client.end({ timeout: 5 });
    process.exit(0);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
