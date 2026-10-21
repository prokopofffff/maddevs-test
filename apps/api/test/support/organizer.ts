import type { Client } from "./test-app.ts";

let seq = 0;

/** Новый организатор с открытой сессией. */
export async function signUpOrganizer(browser: Client, email = `org${++seq}@example.com`) {
  const res = await browser.post("/api/auth/signup", { email, password: "correct horse" });
  if (res.status !== 201) throw new Error(`signup ${res.status}: ${JSON.stringify(res.body)}`);
  return browser;
}

export const eventInput = (overrides: Record<string, unknown> = {}) => ({
  title: "Митап про Postgres",
  description: "Блокировки, очереди и немного NOTIFY.",
  startsLocal: "2026-11-20T19:00",
  timezone: "Asia/Novosibirsk",
  limit: 50,
  ...overrides,
});
