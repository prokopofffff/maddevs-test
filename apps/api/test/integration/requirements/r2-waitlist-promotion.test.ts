import { describe, expect, it } from "vitest";
import { cancel, createEvent, participant, register } from "../../support/participant.ts";
import { PUBLIC_URL, testApp, type TestApp } from "../../support/test-app.ts";

const TICKET = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const shown = (ticketCode: string) => `${ticketCode.slice(0, 4)}-${ticketCode.slice(4)}`;

/** Событие с лимитом 1: A подтверждена, B и C в листе ожидания; письма о регистрации уже ушли. */
async function fullEventWithWaitlist(t: TestApp) {
  const { eventId, organizer } = await createEvent(t, { limit: 1 });
  const a = await register(t, eventId, participant({ email: "a@example.com", firstName: "Алла" }));
  const b = await register(t, eventId, participant({ email: "b@example.com", firstName: "Борис" }));
  const c = await register(t, eventId, participant({ email: "c@example.com", firstName: "Вера" }));
  await t.runJobs(t.clock.now());
  return { eventId, organizer, a: a.body, b: b.body, c: c.body };
}

const page = (t: TestApp, token: string) => t.client().get(`/api/registrations/${token}`);

describe("R2 — лист ожидания и повышение", () => {
  it("R2: места кончились — B и C встают в лист ожидания с позициями 1 и 2 и получают письма", async () => {
    const t = testApp();

    const { a, b, c } = await fullEventWithWaitlist(t);

    expect(a).toMatchObject({ result: "confirmed" });
    expect(b).toMatchObject({ result: "waitlisted", waitlistPosition: 1 });
    expect(c).toMatchObject({ result: "waitlisted", waitlistPosition: 2 });
    expect(t.mailbox.ofKind("waitlisted").map((m) => m.to)).toEqual(["b@example.com", "c@example.com"]);
  });

  it("R2: подтверждённая A отказывается — первый из листа B получает место и письмо с билетом, C становится первой", async () => {
    const t = testApp();
    const { eventId, organizer, a, b, c } = await fullEventWithWaitlist(t);

    const res = await cancel(t.client(), a.token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "cancelled" });
    expect((await page(t, a.token)).body).toMatchObject({
      status: "cancelled",
      ticketCode: null,
      cancelledAt: t.clock.now().toISOString(),
    });
    const promoted = (await page(t, b.token)).body;
    expect(promoted).toMatchObject({ status: "confirmed", ticketCode: expect.stringMatching(TICKET) });
    expect(promoted.waitlistPosition).toBeUndefined();
    expect((await page(t, c.token)).body).toMatchObject({ status: "waitlisted", waitlistPosition: 1 });
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ confirmed: 1, limit: 1, waitlisted: 1 });

    await t.runJobs(t.clock.now());
    const cancelled = t.mailbox.ofKind("cancelled");
    expect(cancelled.map((m) => m.to)).toEqual(["a@example.com"]);
    const letters = t.mailbox.ofKind("promoted");
    expect(letters.map((m) => m.to)).toEqual(["b@example.com"]);
    expect(letters[0]!.subject).toContain("Освободилось место");
    for (const body of [letters[0]!.text, letters[0]!.html]) {
      expect(body).toContain(shown(promoted.ticketCode));
      expect(body).toContain(`${PUBLIC_URL}/r/${b.token}`);
    }
  });

  it("R2: отказ из листа ожидания никого не повышает", async () => {
    const t = testApp();
    const { eventId, organizer, a, b, c } = await fullEventWithWaitlist(t);

    const res = await cancel(t.client(), b.token);

    expect(res.status).toBe(200);
    expect((await page(t, b.token)).body).toMatchObject({ status: "cancelled", ticketCode: null });
    expect((await page(t, a.token)).body).toMatchObject({ status: "confirmed" });
    expect((await page(t, c.token)).body).toMatchObject({ status: "waitlisted", waitlistPosition: 1 });
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ confirmed: 1, waitlisted: 1 });

    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("cancelled").map((m) => m.to)).toEqual(["b@example.com"]);
    expect(t.mailbox.ofKind("promoted")).toEqual([]);
  });
});
