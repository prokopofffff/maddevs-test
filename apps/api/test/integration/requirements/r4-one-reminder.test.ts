import { describe, expect, it } from "vitest";
import { cancel, confirmedTicket, createEvent, participant, register } from "../../support/participant.ts";
import { PUBLIC_URL, testApp, type TestApp } from "../../support/test-app.ts";

// Событие по умолчанию — 20 ноября 2026, 19:00 в Новосибирске (UTC+7).
const T = new Date("2026-11-20T12:00:00Z");
const before = (hours: number) => new Date(T.getTime() - hours * 60 * 60_000);
const shown = (ticketCode: string) => `${ticketCode.slice(0, 4)}-${ticketCode.slice(4)}`;

/** Событие и подтверждённая в T−48 ч Анна; письма о регистрации уже ушли. */
async function confirmedTwoDaysBefore(t: TestApp) {
  const { eventId } = await createEvent(t);
  t.clock.set(before(48));
  const ticket = await confirmedTicket(t, eventId);
  return { eventId, ...ticket };
}

const reminders = (t: TestApp) => t.mailbox.ofKind("reminder");

describe("R4 — ровно одно напоминание", () => {
  it("R4: за 25 ч до начала напоминания нет, за 24 ч — одно с кодом билета и личной ссылкой, повторный проход второго не даёт", async () => {
    const t = testApp();
    const { token, ticketCode } = await confirmedTwoDaysBefore(t);

    await t.runJobs(before(25));
    expect(reminders(t)).toEqual([]);

    await t.runJobs(before(24));
    expect(reminders(t).map((m) => m.to)).toEqual(["anna@example.com"]);
    const [letter] = reminders(t);
    expect(letter!.subject).toContain("Митап про Postgres");
    for (const body of [letter!.text, letter!.html]) {
      expect(body).toContain("20 ноября 2026, 19:00 (UTC+7)");
      expect(body).toContain(shown(ticketCode));
      expect(body).toContain(`${PUBLIC_URL}/r/${token}`);
    }

    await t.runJobs(before(24));
    await t.runJobs(before(23));
    expect(reminders(t)).toHaveLength(1);
  });

  it("R4: два параллельных прохода на разных соединениях ставят одно напоминание", async () => {
    const t = testApp();
    await confirmedTwoDaysBefore(t);

    await Promise.all([t.sweepReminders(before(24)), t.sweepReminders(before(24))]);
    await t.runJobs(before(24));

    expect(reminders(t)).toHaveLength(1);
  });

  it("R4: первый проход после простоя в T−20 ч ставит пропущенное напоминание", async () => {
    const t = testApp();
    await confirmedTwoDaysBefore(t);

    await t.runJobs(before(20));

    expect(reminders(t).map((m) => m.to)).toEqual(["anna@example.com"]);
  });

  it("R4: лист ожидания и отменённые напоминания не получают", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 1 });
    t.clock.set(before(48));
    await register(t, eventId, participant({ email: "a@example.com" }));
    await register(t, eventId, participant({ email: "b@example.com" }));
    const c = await register(t, eventId, participant({ email: "c@example.com" }));
    await cancel(t.client(), c.body.token);

    await t.runJobs(before(24));

    expect(reminders(t).map((m) => m.to)).toEqual(["a@example.com"]);
  });

  it("R4: проход после начала напоминания не ставит", async () => {
    const t = testApp();
    await confirmedTwoDaysBefore(t);

    await t.runJobs(new Date(T.getTime() + 60_000));

    expect(reminders(t)).toEqual([]);
  });

  it("R4: регистрация за 20 ч до начала — напоминания нет, его роль играет письмо о месте", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    t.clock.set(before(20));
    await register(t, eventId);

    await t.runJobs(before(19));

    expect(t.mailbox.ofKind("confirmed")).toHaveLength(1);
    expect(reminders(t)).toEqual([]);
  });

  it("R4: повышение из листа ожидания за 20 ч — напоминания нет, его роль играет письмо о повышении", async () => {
    const t = testApp();
    await promotedBefore(t, 20);

    await t.runJobs(before(20));
    await t.runJobs(before(1));

    expect(t.mailbox.ofKind("promoted").map((m) => m.to)).toEqual(["b@example.com"]);
    expect(reminders(t)).toEqual([]);
  });

  it("R4: повышение из листа ожидания за 30 ч — напоминание за 24 ч", async () => {
    const t = testApp();
    await promotedBefore(t, 30);

    await t.runJobs(before(30));
    await t.runJobs(before(24));

    expect(t.mailbox.ofKind("promoted").map((m) => m.to)).toEqual(["b@example.com"]);
    expect(reminders(t).map((m) => m.to)).toEqual(["b@example.com"]);
  });
});

/** Лимит 1: A и B зарегистрированы в T−48 ч, B в листе ожидания; A отказывается за `hours` до начала — B повышена. */
async function promotedBefore(t: TestApp, hours: number) {
  const { eventId } = await createEvent(t, { limit: 1 });
  t.clock.set(before(48));
  const a = await register(t, eventId, participant({ email: "a@example.com" }));
  await register(t, eventId, participant({ email: "b@example.com" }));
  t.clock.set(before(hours));
  await cancel(t.client(), a.body.token);
}
