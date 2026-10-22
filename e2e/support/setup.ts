import type { APIRequestContext } from "@playwright/test";
import postgres from "postgres";
import { databaseUrl } from "../env.ts";
import { codeFromMail } from "./mailpit.ts";

let seq = 0;
/** Уникальный адрес на запуск: письма прошлых прогонов в Mailpit не мешают (D-028). */
export const uniqueEmail = (name: string) => `${name}.${Date.now()}.${process.pid}.${++seq}@example.com`;

async function json<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>, expected: number): Promise<T> {
  if (res.status() !== expected) throw new Error(`${res.url()} ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Новый организатор и событие через API — подготовка, не предмет теста. */
export async function createEvent(request: APIRequestContext, overrides: Record<string, unknown> = {}) {
  await json(await request.post("/api/auth/signup", { data: { email: uniqueEmail("org"), password: "correct horse" } }), 201);
  const startsLocal = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16);
  const body = await json<{ event: { id: string } }>(
    await request.post("/api/organizer/events", {
      data: { title: "Митап e2e", description: "", startsLocal, timezone: "Asia/Novosibirsk", limit: 10, format: "offline", city: "Новосибирск", address: "Красный проспект, 1", category: "meetup", ...overrides },
    }),
    201,
  );
  return body.event.id;
}

/** Регистрация участника через API с кодом из Mailpit; возвращает личную ссылку и код билета. */
export async function registerParticipant(request: APIRequestContext, eventId: string, email: string) {
  const { verificationId } = await json<{ verificationId: number }>(
    await request.post(`/api/events/${eventId}/verifications`, {
      data: { purpose: "register", email, firstName: "Анна", lastName: "Иванова", birthDate: "1994-03-14" },
    }),
    201,
  );
  const code = await codeFromMail(email);
  const { token } = await json<{ token: string }>(await request.post(`/api/verifications/${verificationId}/confirm`, { data: { code } }), 200);
  const { ticketCode } = await json<{ ticketCode: string }>(await request.get(`/api/registrations/${token}`), 200);
  return { token, ticketCode };
}

/**
 * Часы браузера и сервера тест не двигает (D-028), поэтому «прошло время» — сдвигом моментов в базе e2e:
 * код этого email выдан минуту назад (повтор разрешён), событие началось минуту назад.
 */
export async function rewind({ email, eventId }: { email?: string; eventId?: string }) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    if (email) await sql`update email_verifications set created_at = created_at - interval '1 minute' where email = ${email}`;
    if (eventId) await sql`update events set starts_at = now() - interval '1 minute' where id = ${eventId}`;
  } finally {
    await sql.end();
  }
}
