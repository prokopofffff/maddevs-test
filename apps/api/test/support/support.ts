import { createAccount } from "../../src/auth/accounts.ts";
import { testDb } from "../setup/worker-db.ts";
import type { Client, TestApp } from "./test-app.ts";

let seq = 0;

/** Учётная запись поддержки — той же функцией, что и `pnpm admin:create` (D-030), — и вход в неё. */
export async function signInSupport(t: TestApp, email = `support${++seq}@example.com`) {
  await createAccount(testDb(), { email, password: "support pass", role: "support", now: t.clock.now() });
  const browser = t.client();
  const res = await browser.post("/api/auth/login", { email, password: "support pass" });
  if (res.status !== 200) throw new Error(`login ${res.status}: ${JSON.stringify(res.body)}`);
  return browser;
}

/** Форма «Исправить данные» на странице по личной ссылке. */
export function submitCorrection(client: Client, token: string, data: Record<string, unknown>) {
  return client.post(`/api/registrations/${token}/corrections`, data);
}

/** Очередь ожидающих заявок на экране поддержки. */
export async function queue(support: Client) {
  const res = await support.get("/api/support/corrections");
  if (res.status !== 200) throw new Error(`queue ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.corrections as any[];
}

export const accept = (support: Client, id: number) => support.post(`/api/support/corrections/${id}/accept`);

export const reject = (support: Client, id: number, body: Record<string, unknown> = {}) =>
  support.post(`/api/support/corrections/${id}/reject`, body);
