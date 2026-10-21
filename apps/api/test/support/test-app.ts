import { drizzle } from "drizzle-orm/postgres-js";
import { onTestFinished } from "vitest";
import { createApp } from "../../src/app.ts";
import type { Clock } from "../../src/clock.ts";
import * as schema from "../../src/db/schema.ts";
import { createJobs } from "../../src/jobs.ts";
import { createLive } from "../../src/live.ts";
import { testDb } from "../setup/worker-db.ts";
import { Mailbox } from "./mailbox.ts";

export const PUBLIC_URL = "http://app.test";

/** Подставные часы: время двигает только тест (D-041). */
export class TestClock implements Clock {
  constructor(private current: Date) {}
  now() {
    return new Date(this.current);
  }
  set(at: Date | string) {
    this.current = new Date(at);
  }
}

export interface Response<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** Клиент поверх `app.request()`, который хранит cookie как браузер. */
export class Client {
  private cookies = new Map<string, string>();

  constructor(private readonly app: ReturnType<typeof createApp>) {}

  /** Сырой ответ с cookie сессии — для потоков, тело которых не кончается (SSE). */
  async open(path: string, method = "GET", body?: unknown): Promise<globalThis.Response> {
    const headers = new Headers();
    if (body !== undefined) headers.set("content-type", "application/json");
    if (this.cookies.size > 0) {
      headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    const res = await this.app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const [name, value = ""] = pair!.split("=");
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (expired || value === "") this.cookies.delete(name!.trim());
      else this.cookies.set(name!.trim(), value);
    }
    return res;
  }

  async request<T = any>(method: string, path: string, body?: unknown): Promise<Response<T>> {
    const res = await this.open(path, method, body);
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await res.json() : await res.text();
    return { status: res.status, body: (payload === "" ? undefined : payload) as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T = any>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body);
  }
  patch<T = any>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, body);
  }
  delete<T = any>(path: string) {
    return this.request<T>("DELETE", path);
  }
}

/**
 * Тестовая сборка приложения (D-041): база воркера, подставные часы, фейковый транспорт.
 * Письма уходят только по `runJobs(now)` — пинок после коммита в тестах ничего не делает.
 * Live слушает базу воркера, только пока тесту нужен поток, и отписывается в конце теста.
 * `queries` собирает SQL, который приложение отправило в базу, — для проверки `.for('update')` (D-009).
 */
export function testApp(options: { now?: string; queries?: string[] } = {}) {
  const { queries } = options;
  const db = queries
    ? drizzle(testDb().$client, { schema, logger: { logQuery: (query) => void queries.push(query) } })
    : testDb();
  const clock = new TestClock(new Date(options.now ?? "2026-11-01T09:00:00Z"));
  const mailbox = new Mailbox();
  const live = createLive(db);
  onTestFinished(() => live.stop());
  const app = createApp({ db, clock, live, config: { publicUrl: PUBLIC_URL, cookieSecure: false } });
  const { runJobs } = createJobs({ db, transport: mailbox });
  return { app, clock, mailbox, runJobs, client: () => new Client(app) };
}

export type TestApp = ReturnType<typeof testApp>;
