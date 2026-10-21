import type { AppType } from "@app/api/app";
import { hc, type ClientResponse } from "hono/client";

export const client = hc<AppType>("/");

/** Ошибка API с кодом из тела `{ error }`; текст для человека — в `errors.ts` (D-024). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

type Success<R> = R extends ClientResponse<infer T, infer S, infer _F> ? (S extends 200 | 201 ? T : never) : never;

/** Ждёт ответ `hc`, возвращает тело успешного ответа или бросает `ApiError`. */
export async function api<R extends ClientResponse<unknown, number, string>>(request: Promise<R>): Promise<Success<R>> {
  const res = await request;
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as Success<R>;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new ApiError(res.status, body.error ?? "unknown");
}
