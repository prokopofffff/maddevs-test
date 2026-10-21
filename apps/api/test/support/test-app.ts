import { createApp } from "../../src/app.ts";
import type { Clock } from "../../src/clock.ts";
import { createJobs } from "../../src/jobs.ts";
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

  async request<T = any>(method: string, path: string, body?: unknown): Promise<Response<T>> {
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
}

/**
 * Тестовая сборка приложения (D-041): база воркера, подставные часы, фейковый транспорт.
 * Письма уходят только по `runJobs(now)` — пинок после коммита в тестах ничего не делает.
 */
export function testApp(options: { now?: string } = {}) {
  const db = testDb();
  const clock = new TestClock(new Date(options.now ?? "2026-11-01T09:00:00Z"));
  const mailbox = new Mailbox();
  const app = createApp({ db, clock, config: { publicUrl: PUBLIC_URL, cookieSecure: false } });
  const { runJobs } = createJobs({ db, transport: mailbox });
  return { app, clock, mailbox, runJobs, client: () => new Client(app) };
}

export type TestApp = ReturnType<typeof testApp>;
