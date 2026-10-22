import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { apiError } from "./http.ts";

/** Лимиты корзин — запросов в минуту на IP (D-006). */
export interface RateLimits {
  global: number;
  auth: number;
  public: number;
}

export interface RateLimitConfig {
  rateLimits: RateLimits;
  /** `true` — IP клиента из `X-Forwarded-For`, его дописал наш прокси (Vite в разработке). */
  trustProxy: boolean;
}

/**
 * IP клиента. За прокси — последний адрес `X-Forwarded-For`: его дописал сам прокси,
 * а всё левее прислал клиент и мог подделать. Без прокси — адрес сокета.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // Сокета нет у запроса через `app.request()` в тестах.
    return "unknown";
  }
}

/**
 * Три корзины по IP с окном в минуту, счётчики в памяти процесса (D-006).
 * Превышение — `429 rate_limited`, `Retry-After` и `RateLimit-*`.
 */
export function createRateLimits({ rateLimits, trustProxy }: RateLimitConfig) {
  const bucket = (limit: number) =>
    rateLimiter({
      windowMs: 60_000,
      limit,
      standardHeaders: "draft-6",
      keyGenerator: (c) => clientIp(c, trustProxy),
      handler: (c) => apiError(c, 429, "rate_limited"),
    });
  return {
    global: bucket(rateLimits.global),
    auth: bucket(rateLimits.auth),
    public: bucket(rateLimits.public),
  };
}
