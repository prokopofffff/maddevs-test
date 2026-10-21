import { describe, expect, it } from "vitest";
import { checkin, ticketCard } from "../../support/organizer.ts";
import { cancel, createEvent, participant, register } from "../../support/participant.ts";
import { testApp, type TestApp } from "../../support/test-app.ts";

const shown = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Подтверждённая регистрация и её код билета — со страницы по личной ссылке. */
async function confirmedTicket(t: TestApp, eventId: string, data = participant()) {
  const { token } = (await register(t, eventId, data)).body;
  const page = (await t.client().get(`/api/registrations/${token}`)).body;
  return { token, ticketCode: page.ticketCode as string };
}

describe("R5 — однократный чекин", () => {
  it("R5: два одновременных чекина одного кода — одна отметка, второй получает «уже прошёл» со временем первой", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    const { token, ticketCode } = await confirmedTicket(t, eventId);

    // Две стойки на входе: свои клиенты организатора, свои соединения пула, коммиты по-настоящему.
    const answers = await Promise.all([checkin(organizer, eventId, ticketCode), checkin(organizer, eventId, ticketCode)]);

    const passed = answers.filter((a) => a.status === 200);
    const repeated = answers.filter((a) => a.status === 409);
    expect(passed).toHaveLength(1);
    expect(repeated).toHaveLength(1);
    const first = passed[0]!.body;
    expect(first).toMatchObject({ firstName: "Анна", lastName: "Иванова", checkedInAt: t.clock.now().toISOString() });
    expect(repeated[0]!.body).toEqual({
      error: "already_checked_in",
      firstName: "Анна",
      lastName: "Иванова",
      checkedInAt: first.checkedInAt,
    });

    // Через минуту тот же билет снова: отметка не сдвигается, время — первой.
    t.clock.set(new Date(t.clock.now().getTime() + 60_000));
    const later = await checkin(organizer, eventId, ticketCode);
    expect(later.status).toBe(409);
    expect(later.body.checkedInAt).toBe(first.checkedInAt);
    expect((await ticketCard(organizer, eventId, ticketCode)).body).toMatchObject({
      registrationId: first.registrationId,
      status: "confirmed",
      checkedInAt: first.checkedInAt,
    });
    expect((await t.client().get(`/api/registrations/${token}`)).body.checkedInAt).toBe(first.checkedInAt);
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ confirmed: 1, checkedIn: 1 });
  });

  it("R5: отменённый билет — «билет отменён», отметки нет", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    const { token, ticketCode } = await confirmedTicket(t, eventId);
    await cancel(t.client(), token);

    const card = await ticketCard(organizer, eventId, ticketCode);
    const res = await checkin(organizer, eventId, ticketCode);

    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ status: "cancelled", checkedInAt: null });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "ticket_cancelled" });
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ checkedIn: 0 });
  });

  it("R5: код другого события и несуществующий код — «билет не найден»", async () => {
    const t = testApp();
    const { eventId: other, organizer } = await createEvent(t);
    const res = await organizer.post("/api/organizer/events", {
      title: "Второй митап",
      description: "",
      startsLocal: "2026-11-27T19:00",
      timezone: "Asia/Novosibirsk",
      limit: 50,
    });
    const eventId = res.body.event.id as string;
    const { ticketCode } = await confirmedTicket(t, other);

    for (const code of [ticketCode, "ZZZZ-ZZZZ", "абв"]) {
      const card = await ticketCard(organizer, eventId, code);
      expect(card.status).toBe(404);
      expect(card.body).toEqual({ error: "ticket_not_found" });
      const attempt = await checkin(organizer, eventId, code);
      expect(attempt.status).toBe(404);
      expect(attempt.body).toEqual({ error: "ticket_not_found" });
    }
    // Билет своего события при этом не тронут.
    expect((await ticketCard(organizer, other, ticketCode)).body).toMatchObject({ checkedInAt: null });
  });

  it("R5: код в нижнем регистре, с дефисом, с пробелами и с O вместо 0 находится", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 100 });
    // Код случайный: регистрируем, пока в коде не окажется ноль (у одного кода — около 22 %).
    let ticketCode = "";
    for (let i = 1; i <= 60 && !ticketCode.includes("0"); i++) {
      ({ ticketCode } = await confirmedTicket(t, eventId, participant({ email: `guest${i}@example.com` })));
    }
    expect(ticketCode).toContain("0");

    const variants = [
      shown(ticketCode).toLowerCase(),
      shown(ticketCode).replaceAll("0", "O"),
      ` ${shown(ticketCode).replaceAll("0", "o").replaceAll("1", "l").toLowerCase()} `,
    ];
    const cards = await Promise.all(variants.map((code) => ticketCard(organizer, eventId, code)));
    for (const card of cards) {
      expect(card.status).toBe(200);
      expect(card.body.registrationId).toBe(cards[0]!.body.registrationId);
      expect(card.body.status).toBe("confirmed");
    }

    const res = await checkin(organizer, eventId, variants[2]!);
    expect(res.status).toBe(200);
    expect(res.body.registrationId).toBe(cards[0]!.body.registrationId);
  });
});
