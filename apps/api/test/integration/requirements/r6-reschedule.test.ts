import { describe, expect, it } from "vitest";
import { cancel, confirmedTicket, createEvent, participant, register } from "../../support/participant.ts";
import { PUBLIC_URL, testApp, type TestApp } from "../../support/test-app.ts";

// Событие по умолчанию — 20 ноября 2026, 19:00 в Новосибирске (UTC+7).
const T = new Date("2026-11-20T12:00:00Z");
const hours = (h: number) => h * 60 * 60_000;
const before = (h: number, at = T) => new Date(at.getTime() - hours(h));
const shown = (ticketCode: string) => `${ticketCode.slice(0, 4)}-${ticketCode.slice(4)}`;

const rescheduled = (t: TestApp, to?: string) => t.mailbox.ofKind("rescheduled", to);
const reminders = (t: TestApp) => t.mailbox.ofKind("reminder");

describe("R6 — перенос", () => {
  it("R6: письмо о переносе получают подтверждённые и лист ожидания, отменённая — нет; второй перенос — новые письма", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 2 });
    const a = await confirmedTicket(t, eventId, participant({ email: "a@example.com" }));
    await register(t, eventId, participant({ email: "b@example.com" }));
    const c = await register(t, eventId, participant({ email: "c@example.com" }));
    const d = await register(t, eventId, participant({ email: "d@example.com" }));
    expect([c.body.result, d.body.result]).toEqual(["waitlisted", "waitlisted"]);
    await cancel(t.client(), d.body.token);

    const res = await organizer.patch(`/api/organizer/events/${eventId}`, { startsLocal: "2026-11-21T19:00" });
    await t.runJobs(t.clock.now());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rescheduled: true, event: { startsAt: "2026-11-21T12:00:00.000Z" } });
    expect(rescheduled(t).map((m) => m.to).sort()).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
    const [toA] = rescheduled(t, "a@example.com");
    const [toC] = rescheduled(t, "c@example.com");
    expect(toA!.subject).toContain("Митап про Postgres");
    for (const body of [toA!.text, toA!.html]) {
      expect(body).toContain("20 ноября 2026, 19:00 (UTC+7)");
      expect(body).toContain("21 ноября 2026, 19:00 (UTC+7)");
      expect(body).toContain(shown(a.ticketCode));
      expect(body).toContain(`${PUBLIC_URL}/r/${a.token}`);
    }
    for (const body of [toC!.text, toC!.html]) {
      expect(body).toContain("21 ноября 2026, 19:00 (UTC+7)");
      expect(body).toContain("№1 в листе ожидания");
      expect(body).toContain(`${PUBLIC_URL}/r/${c.body.token}`);
    }

    await organizer.patch(`/api/organizer/events/${eventId}`, { startsLocal: "2026-11-22T19:00" });
    await t.runJobs(t.clock.now());

    expect(rescheduled(t)).toHaveLength(6);
    const second = rescheduled(t, "a@example.com");
    expect(second).toHaveLength(2);
    expect(second[1]!.text).toContain("21 ноября 2026, 19:00 (UTC+7)");
    expect(second[1]!.text).toContain("22 ноября 2026, 19:00 (UTC+7)");
    expect(rescheduled(t, "d@example.com")).toEqual([]);
  });

  it("R6: смена только пояса — не перенос; перенос на прошедший момент — 400, после начала — 409; писем нет", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    await register(t, eventId);
    const patch = (body: Record<string, unknown>) => organizer.patch(`/api/organizer/events/${eventId}`, body);

    const zoneOnly = await patch({ timezone: "Europe/Moscow" });
    const sameMoment = await patch({ startsLocal: "2026-11-20T15:00", timezone: "Europe/Moscow" });
    for (const res of [zoneOnly, sameMoment]) {
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ rescheduled: false, belowMinAgeCount: 0, event: { startsAt: T.toISOString() } });
    }

    const past = await patch({ startsLocal: "2026-11-01T11:00" }); // 08:00 UTC — за час до «сейчас»
    expect(past.status).toBe(400);
    expect(past.body).toEqual({ error: "starts_in_past" });

    t.clock.set(T);
    const afterStart = await patch({ startsLocal: "2026-11-27T15:00" });
    expect(afterStart.status).toBe(409);
    expect(afterStart.body).toEqual({ error: "event_started" });

    await t.runJobs(t.clock.now());
    expect(rescheduled(t)).toEqual([]);
    expect((await organizer.get(`/api/organizer/events/${eventId}`)).body.event).toMatchObject({
      startsAt: T.toISOString(),
      timezone: "Europe/Moscow",
    });
  });

  it("R6: напоминание отправлено, затем перенос на неделю — второе напоминание за сутки до новой даты", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    t.clock.set(before(48));
    await confirmedTicket(t, eventId);
    await t.runJobs(before(24));
    expect(reminders(t)).toHaveLength(1);

    t.clock.set(before(23));
    await organizer.patch(`/api/organizer/events/${eventId}`, { startsLocal: "2026-11-27T19:00" });
    const T2 = new Date("2026-11-27T12:00:00Z");

    await t.runJobs(before(23));
    await t.runJobs(before(25, T2));
    expect(rescheduled(t)).toHaveLength(1);
    expect(reminders(t)).toHaveLength(1);

    await t.runJobs(before(24, T2));
    await t.runJobs(before(23, T2));
    expect(reminders(t)).toHaveLength(2);
    expect(reminders(t)[1]!.text).toContain("27 ноября 2026, 19:00 (UTC+7)");
  });

  it("R6: перенос внутрь суток до отправки напоминания — напоминаний нет, его роль играет письмо о переносе", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    t.clock.set(before(48));
    await confirmedTicket(t, eventId);

    // За 30 ч до прежнего начала событие переносится на 20 ч вперёд от «сейчас»: 20 ноября, 09:00 по Новосибирску.
    t.clock.set(before(30));
    const res = await organizer.patch(`/api/organizer/events/${eventId}`, { startsLocal: "2026-11-20T09:00" });
    expect(res.body).toMatchObject({ rescheduled: true, event: { startsAt: "2026-11-20T02:00:00.000Z" } });

    await t.runJobs(before(30));
    await t.runJobs(before(24));
    await t.runJobs(before(11));

    expect(rescheduled(t).map((m) => m.to)).toEqual(["anna@example.com"]);
    expect(reminders(t)).toEqual([]);
  });

  it("R6: перенос на дату, к которой участнику меньше минимального возраста, — предупреждение, регистрация остаётся", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { minAge: 18 });
    // Обоим исполняется 18 15 ноября: к 20 ноября проходят, к 10 ноября — нет.
    const young = { birthDate: "2008-11-15" };
    const { token } = await confirmedTicket(t, eventId, participant(young));
    const gone = await register(t, eventId, participant({ ...young, email: "gone@example.com" }));
    await cancel(t.client(), gone.body.token);

    const res = await organizer.patch(`/api/organizer/events/${eventId}`, { startsLocal: "2026-11-10T19:00" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rescheduled: true, belowMinAgeCount: 1 });
    expect((await t.client().get(`/api/registrations/${token}`)).body.status).toBe("confirmed");
  });
});
