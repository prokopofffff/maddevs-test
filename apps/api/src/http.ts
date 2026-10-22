import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Clock } from "./clock.ts";
import type { Db } from "./db/client.ts";
import type { SessionUser } from "./auth/session.ts";
import type { AppConfig, OutboxWaker } from "./app.ts";
import type { Live } from "./live.ts";

export interface Env {
  Variables: {
    db: Db;
    clock: Clock;
    config: AppConfig;
    outbox: OutboxWaker;
    live: Live;
    user: SessionUser;
    /** Email из сессии участника; задан после `requireParticipant` и у вошедшего в `optionalParticipant` (D-057). */
    participantEmail: string;
  };
}

/** Ошибка API — `{ error: "<code>", …подробности }`; фронт переводит код в текст (D-024). */
export function apiError<S extends ContentfulStatusCode, E extends string>(
  c: Context,
  status: S,
  error: E,
  details: Record<string, unknown> = {},
) {
  return c.json({ error, ...details }, status);
}
