import { describe, expect, it } from "vitest";
import { cancel, createEvent, participant, register } from "../support/participant.ts";
import { testApp } from "../support/test-app.ts";

describe("Отказ по личной ссылке", () => {
  it("повторный отказ отвечает тем же и второго письма не шлёт", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 1 });
    const { token } = (await register(t, eventId)).body;
    await register(t, eventId, participant({ email: "boris@example.com" }));
    await cancel(t.client(), token);
    t.clock.set(new Date(t.clock.now().getTime() + 60_000));

    const again = await cancel(t.client(), token);

    expect(again.status).toBe(200);
    expect(again.body).toEqual({ status: "cancelled" });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("cancelled")).toHaveLength(1);
    expect(t.mailbox.ofKind("promoted")).toHaveLength(1);
    // Время отказа — первого нажатия.
    const page = (await t.client().get(`/api/registrations/${token}`)).body;
    expect(page.cancelledAt).toBe(new Date(t.clock.now().getTime() - 60_000).toISOString());
  });

  // Событие из `eventInput` начинается 20 ноября в 19:00 по Новосибирску — 12:00 UTC.
  const STARTS_AT = "2026-11-20T12:00:00.000Z";

  it("с началом события отказ закрыт: ни подтверждённая, ни ожидающая отказаться не могут", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 1 });
    const confirmed = (await register(t, eventId)).body;
    const waiting = (await register(t, eventId, participant({ email: "boris@example.com" }))).body;

    t.clock.set(STARTS_AT);
    const answers = [await cancel(t.client(), confirmed.token), await cancel(t.client(), waiting.token)];

    for (const res of answers) {
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "event_started" });
    }
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ confirmed: 1, waitlisted: 1 });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("cancelled")).toEqual([]);
  });

  it("отказ за секунду до начала повышает первого из листа ожидания", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 1 });
    const confirmed = (await register(t, eventId)).body;
    const waiting = (await register(t, eventId, participant({ email: "boris@example.com" }))).body;

    t.clock.set(new Date(new Date(STARTS_AT).getTime() - 1000));
    const res = await cancel(t.client(), confirmed.token);

    expect(res.status).toBe(200);
    const page = (await t.client().get(`/api/registrations/${waiting.token}`)).body;
    expect(page).toMatchObject({ status: "confirmed", ticketCode: expect.any(String) });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("promoted").map((m) => m.to)).toEqual(["boris@example.com"]);
  });

  it("после отказа можно зарегистрироваться заново: на свободное место — новой регистрацией с новым билетом", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 2 });
    const first = (await register(t, eventId)).body;
    const oldTicket = (await t.client().get(`/api/registrations/${first.token}`)).body.ticketCode;
    await cancel(t.client(), first.token);
    t.clock.set(new Date(t.clock.now().getTime() + 2 * 60_000));

    const again = await register(t, eventId);

    expect(again.body).toMatchObject({ result: "confirmed", status: "confirmed" });
    expect(again.body.token).not.toBe(first.token);
    const page = (await t.client().get(`/api/registrations/${again.body.token}`)).body;
    expect(page.ticketCode).toEqual(expect.any(String));
    expect(page.ticketCode).not.toBe(oldTicket);
    expect((await t.client().get(`/api/registrations/${first.token}`)).body.status).toBe("cancelled");
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ confirmed: 1, waitlisted: 0 });
    expect(event.registrationCount).toBe(2);
  });

  it("после отказа можно зарегистрироваться заново: при листе ожидания — в его конец", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 1 });
    const anna = (await register(t, eventId)).body;
    await register(t, eventId, participant({ email: "boris@example.com" }));
    await register(t, eventId, participant({ email: "vera@example.com" }));
    await cancel(t.client(), anna.token);
    t.clock.set(new Date(t.clock.now().getTime() + 2 * 60_000));

    const again = await register(t, eventId);

    expect(again.body).toMatchObject({ result: "waitlisted", status: "waitlisted", waitlistPosition: 2 });
  });
});
