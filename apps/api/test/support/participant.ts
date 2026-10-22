import { eventInput, signUpOrganizer } from "./organizer.ts";
import type { Client, TestApp } from "./test-app.ts";

export const participant = (overrides: Record<string, unknown> = {}) => ({
  email: "anna@example.com",
  firstName: "Анна",
  lastName: "Иванова",
  birthDate: "1994-03-14",
  ...overrides,
});

/** Событие нового организатора; организатор возвращается, чтобы смотреть счётчики. */
export async function createEvent(t: TestApp, overrides: Record<string, unknown> = {}) {
  const organizer = await signUpOrganizer(t.client());
  const res = await organizer.post("/api/organizer/events", eventInput(overrides));
  if (res.status !== 201) throw new Error(`event ${res.status}: ${JSON.stringify(res.body)}`);
  return { eventId: res.body.event.id as string, organizer };
}

export function requestCode(client: Client, eventId: string, data: Record<string, unknown> = participant()) {
  return client.post(`/api/events/${eventId}/verifications`, { purpose: "register", ...data });
}

/** Код просят, письмо с кодом уходит шагом фоновых циклов, код читается из письма. */
export async function receiveCode(t: TestApp, eventId: string, data: Record<string, unknown> = participant()) {
  const res = await requestCode(t.client(), eventId, data);
  if (res.status !== 201) throw new Error(`verification ${res.status}: ${JSON.stringify(res.body)}`);
  await t.runJobs(t.clock.now());
  const to = String(data.email).trim().toLowerCase();
  return { verificationId: res.body.verificationId as number, code: t.mailbox.lastCode(to) };
}

export function confirmCode(client: Client, verificationId: number, code: string) {
  return client.post(`/api/verifications/${verificationId}/confirm`, { code });
}

export function requestLookup(client: Client, eventId: string, email = "anna@example.com") {
  return client.post(`/api/events/${eventId}/verifications`, { purpose: "lookup", email });
}

/** «Потерял письмо»: код на email, письмо уходит шагом фоновых циклов, код читается из письма. */
export async function receiveLookupCode(t: TestApp, eventId: string, email = "anna@example.com") {
  const res = await requestLookup(t.client(), eventId, email);
  if (res.status !== 201) throw new Error(`lookup ${res.status}: ${JSON.stringify(res.body)}`);
  await t.runJobs(t.clock.now());
  return { verificationId: res.body.verificationId as number, code: t.mailbox.lastCode(email.trim().toLowerCase()) };
}

/** Полный путь участника: форма → письмо с кодом → ввод кода. */
export async function register(t: TestApp, eventId: string, data: Record<string, unknown> = participant()) {
  const { verificationId, code } = await receiveCode(t, eventId, data);
  return confirmCode(t.client(), verificationId, code);
}

/** Подтверждённая регистрация и её код билета — со страницы по личной ссылке. */
export async function confirmedTicket(t: TestApp, eventId: string, data: Record<string, unknown> = participant()) {
  const { token } = (await register(t, eventId, data)).body;
  const page = (await t.client().get(`/api/registrations/${token}`)).body;
  return { token: token as string, ticketCode: page.ticketCode as string };
}

/** Отказ по личной ссылке: кнопка «Отказаться» после диалога. */
export function cancel(client: Client, token: string) {
  return client.post(`/api/registrations/${token}/cancel`);
}

export const requestLoginCode = (client: Client, email = "anna@example.com") =>
  client.post("/api/participant/verifications", { email });

/** Код входа: запрос, письмо `login_code` уходит шагом фоновых циклов, код читается из письма. */
export async function receiveLoginCode(t: TestApp, email = "anna@example.com", client: Client = t.client()) {
  const res = await requestLoginCode(client, email);
  if (res.status !== 201) throw new Error(`login code ${res.status}: ${JSON.stringify(res.body)}`);
  await t.runJobs(t.clock.now());
  return { verificationId: res.body.verificationId as number, code: t.mailbox.lastCode(email.trim().toLowerCase(), "login_code") };
}

export const confirmLogin = (client: Client, verificationId: number, code: string) =>
  client.post(`/api/participant/verifications/${verificationId}/confirm`, { code });

/** Вход участника целиком: код, письмо, ввод; клиент остаётся с cookie `psid`. */
export async function signInParticipant(t: TestApp, email = "anna@example.com") {
  const browser = t.client();
  const { verificationId, code } = await receiveLoginCode(t, email, browser);
  const res = await confirmLogin(browser, verificationId, code);
  if (res.status !== 200) throw new Error(`participant login ${res.status}: ${JSON.stringify(res.body)}`);
  return browser;
}
