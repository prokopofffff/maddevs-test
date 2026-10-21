import { Hono } from "hono";
import type { Clock } from "./clock.ts";
import type { Db } from "./db/client.ts";
import type { Env } from "./http.ts";
import { authRoutes } from "./routes/auth.ts";

export interface AppConfig {
  publicUrl: string;
  cookieSecure: boolean;
}

export interface AppDeps {
  db: Db;
  clock: Clock;
  config: AppConfig;
}

/** Фабрика приложения — единственная граница, которую видят тесты (D-041). */
export function createApp({ db, clock, config }: AppDeps) {
  const api = new Hono<Env>()
    .use(async (c, next) => {
      c.set("db", db);
      c.set("clock", clock);
      c.set("config", config);
      await next();
    })
    .route("/auth", authRoutes);

  return new Hono().route("/api", api);
}

export type AppType = ReturnType<typeof createApp>;
