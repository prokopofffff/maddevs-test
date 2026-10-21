import { describe, expect, it } from "vitest";
import { checkin, signUpOrganizer, ticketCard } from "../support/organizer.ts";
import { cancel, confirmedTicket, createEvent, participant, register } from "../support/participant.ts";
import { testApp } from "../support/test-app.ts";

// Событие из `eventInput` начинается 20 ноября в 19:00 по Новосибирску — 12:00 UTC.
const STARTS_AT = "2026-11-20T12:00:00.000Z";

describe("Чекин", () => {
  it("карточка показывает имя, дату рождения, возраст на день события и «младше минимального»", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    // 17 лет на 20 ноября 2026: день рождения — днём позже.
    const { ticketCode } = await confirmedTicket(t, eventId, participant({ birthDate: "2008-11-21" }));
    // Минимальный возраст подняли после регистрации: участник остаётся, на входе — предупреждение (D-017).
    await organizer.patch(`/api/organizer/events/${eventId}`, { minAge: 18 });

    const card = await ticketCard(organizer, eventId, ticketCode);

    expect(card.status).toBe(200);
    expect(card.body).toEqual({
      registrationId: expect.any(Number),
      firstName: "Анна",
      lastName: "Иванова",
      birthDate: "2008-11-21",
      ageOnEventDay: 17,
      belowMinAge: true,
      status: "confirmed",
      checkedInAt: null,
    });
  });

  it("чекин работает и после начала события", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    const { ticketCode } = await confirmedTicket(t, eventId);

    t.clock.set(new Date(new Date(STARTS_AT).getTime() + 2 * 3600_000));
    const res = await checkin(organizer, eventId, ticketCode);

    expect(res.status).toBe(200);
    expect(res.body.checkedInAt).toBe(t.clock.now().toISOString());
  });

  it("чекин и карточка — только у владельца события: чужому организатору 404, без входа 401", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const { ticketCode } = await confirmedTicket(t, eventId);
    const stranger = await signUpOrganizer(t.client());

    for (const res of [await ticketCard(stranger, eventId, ticketCode), await checkin(stranger, eventId, ticketCode)]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "not_found" });
    }
    expect((await checkin(t.client(), eventId, ticketCode)).status).toBe(401);
    expect((await ticketCard(stranger, "not-a-uuid", ticketCode)).status).toBe(404);
  });

  it("после чекина отказаться нельзя: 409 already_checked_in, место и «Пришло» остаются", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 1 });
    const { token, ticketCode } = await confirmedTicket(t, eventId);
    await register(t, eventId, participant({ email: "boris@example.com" }));
    const marked = (await checkin(organizer, eventId, ticketCode)).body;

    const res = await cancel(t.client(), token);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "already_checked_in" });
    const page = (await t.client().get(`/api/registrations/${token}`)).body;
    expect(page).toMatchObject({ status: "confirmed", checkedInAt: marked.checkedInAt });
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ confirmed: 1, waitlisted: 1, checkedIn: 1 });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("cancelled")).toEqual([]);
    expect(t.mailbox.ofKind("promoted")).toEqual([]);
  });

  it("пустой ввод — не ошибка формы, а «билет не найден»; без поля `code` — 400", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);

    const empty = await checkin(organizer, eventId, "");
    const missing = await organizer.post(`/api/organizer/events/${eventId}/checkin`, {});

    expect(empty.status).toBe(404);
    expect(empty.body).toEqual({ error: "ticket_not_found" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("validation_failed");
  });
});
