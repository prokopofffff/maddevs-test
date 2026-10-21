import { Hono } from "hono";
import type { Clock } from "./clock.ts";
import type { Db } from "./db/client.ts";
import type { Env } from "./http.ts";
import { authRoutes } from "./routes/auth.ts";
import { organizerRoutes } from "./routes/organizer.ts";
import { publicRoutes } from "./routes/public.ts";
import { apiError } from "./http.ts";

export interface AppConfig {
  publicUrl: string;
  cookieSecure: boolean;
}

/** Пинок цикла отправки после коммита, поставившего письмо (D-014). */
export interface OutboxWaker {
  wake(): void;
}

export interface AppDeps {
  db: Db;
  clock: Clock;
  config: AppConfig;
  /** В тестах не передаётся: письма уходят только по `runJobs(now)`. */
  outbox?: OutboxWaker;
}

const noWake: OutboxWaker = { wake() {} };

/** Фабрика приложения — единственная граница, которую видят тесты (D-041). */
export function createApp({ db, clock, config, outbox = noWake }: AppDeps) {
  const api = new Hono<Env>()
    .use(async (c, next) => {
      c.set("db", db);
      c.set("clock", clock);
      c.set("config", config);
      c.set("outbox", outbox);
      await next();
    })
    .route("/auth", authRoutes)
    .route("/organizer", organizerRoutes)
    .route("/", publicRoutes)
    // `notFound` вложенного приложения Hono не вызывает: неизвестный маршрут API ловим явно.
    .all("*", (c) => apiError(c, 404, "not_found"));

  return new Hono().route("/api", api);
}

export type AppType = ReturnType<typeof createApp>;
