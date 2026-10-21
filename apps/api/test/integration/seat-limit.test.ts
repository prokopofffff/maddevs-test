import { describe, expect, it } from "vitest";
import { cancel, createEvent, participant, register } from "../support/participant.ts";
import { testApp } from "../support/test-app.ts";

const TICKET = /^[0-9A-HJKMNP-TV-Z]{8}$/;

const page = (t: ReturnType<typeof testApp>, token: string) => t.client().get(`/api/registrations/${token}`);

describe("лимит мест: увеличение и «сверх лимита»", () => {
  it("увеличение лимита повышает первых из листа ожидания по порядку, с письмами", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 1 });
    // A подтверждена, B, C, D — в листе ожидания по порядку.
    const regs = [];
    for (const email of ["a@example.com", "b@example.com", "c@example.com", "d@example.com"]) {
      regs.push((await register(t, eventId, participant({ email }))).body);
    }
    await t.runJobs(t.clock.now());

    const res = await organizer.patch(`/api/organizer/events/${eventId}`, { limit: 3 });

    expect(res.status).toBe(200);
    expect(res.body.event.limit).toBe(3);
    expect(res.body.counts).toMatchObject({ confirmed: 3, limit: 3, waitlisted: 1 });
    expect((await page(t, regs[1]!.token)).body).toMatchObject({ status: "confirmed", ticketCode: expect.stringMatching(TICKET) });
    expect((await page(t, regs[2]!.token)).body).toMatchObject({ status: "confirmed", ticketCode: expect.stringMatching(TICKET) });
    expect((await page(t, regs[3]!.token)).body).toMatchObject({ status: "waitlisted", waitlistPosition: 1 });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("promoted").map((m) => m.to)).toEqual(["b@example.com", "c@example.com"]);
  });

  it("50 → 40: билеты у всех, писем нет; регистрация в лист; отказы повышают, только когда подтверждённых меньше лимита", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 50 });
    const confirmed: string[] = [];
    for (let i = 1; i <= 50; i++) {
      confirmed.push((await register(t, eventId, participant({ email: `p${i}@example.com` }))).body.token);
    }
    await t.runJobs(t.clock.now());
    const sentBefore = t.mailbox.sent.length;

    const res = await organizer.patch(`/api/organizer/events/${eventId}`, { limit: 40 });

    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ confirmed: 50, limit: 40, waitlisted: 0 });
    for (const token of confirmed) {
      expect((await page(t, token)).body).toMatchObject({ status: "confirmed", ticketCode: expect.stringMatching(TICKET) });
    }
    await t.runJobs(t.clock.now());
    expect(t.mailbox.sent.length).toBe(sentBefore);

    // Сверх лимита свободных мест нет — новая регистрация встаёт в лист ожидания.
    const late = await register(t, eventId, participant({ email: "late@example.com" }));
    expect(late.body).toMatchObject({ result: "waitlisted", waitlistPosition: 1 });

    // 50 из 40 → 40 из 40: каждый отказ никого не повышает.
    for (const token of confirmed.splice(0, 10)) expect((await cancel(t.client(), token)).status).toBe(200);
    expect((await organizer.get(`/api/organizer/events/${eventId}`)).body.counts).toMatchObject({
      confirmed: 40,
      limit: 40,
      waitlisted: 1,
    });
    expect((await page(t, late.body.token)).body).toMatchObject({ status: "waitlisted" });

    // При 40 из 40 следующий отказ освобождает место — его забирает первый из листа.
    expect((await cancel(t.client(), confirmed[0]!)).status).toBe(200);
    expect((await page(t, late.body.token)).body).toMatchObject({ status: "confirmed", ticketCode: expect.stringMatching(TICKET) });
    expect((await organizer.get(`/api/organizer/events/${eventId}`)).body.counts).toMatchObject({
      confirmed: 40,
      limit: 40,
      waitlisted: 0,
    });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("promoted").map((m) => m.to)).toEqual(["late@example.com"]);
  });

  it("после начала лимит не меняется — 409 event_started, лист ожидания не трогается", async () => {
    const t = testApp({ now: "2026-11-01T09:00:00Z" });
    const { eventId, organizer } = await createEvent(t, { limit: 1 });
    await register(t, eventId, participant({ email: "a@example.com" }));
    const b = (await register(t, eventId, participant({ email: "b@example.com" }))).body;
    t.clock.set("2026-11-20T12:00:00Z"); // ровно момент начала

    const res = await organizer.patch(`/api/organizer/events/${eventId}`, { limit: 5, title: "Другое" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "event_started" });
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.event).toMatchObject({ limit: 1, title: "Митап про Postgres" });
    expect(event.counts).toMatchObject({ confirmed: 1, limit: 1, waitlisted: 1 });
    expect((await page(t, b.token)).body).toMatchObject({ status: "waitlisted" });
  });
});
