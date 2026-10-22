import { describe, expect, it } from "vitest";
import { testDb } from "../../setup/worker-db.ts";
import { openLive } from "../../support/live.ts";
import { checkin, signUpOrganizer, ticketCard } from "../../support/organizer.ts";
import { cancel, confirmedTicket, createEvent, participant, register } from "../../support/participant.ts";
import { testApp, type Client } from "../../support/test-app.ts";

const shown = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

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

/** «Снять отметку» в списке участников (D-023). */
const uncheck = (organizer: Client, eventId: string, registrationId: number) =>
  organizer.delete(`/api/organizer/events/${eventId}/checkin/${registrationId}`);

describe("R5 — live", () => {
  it("R5: поток сразу отдаёт снимок, чекин на другом соединении — следующий снимок с «пришло + 1» в пределах 2 с на всех экранах", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 50 });
    const { ticketCode } = await confirmedTicket(t, eventId);
    await register(t, eventId, participant({ email: "boris@example.com" }));

    // Два экрана организатора: кабинет и чекин у соседнего входа.
    const cabinet = await openLive(organizer, eventId);
    const entrance = await openLive(organizer, eventId);
    expect(cabinet.status).toBe(200);
    expect(cabinet.headers.get("content-type")).toContain("text/event-stream");
    expect(cabinet.headers.get("cache-control")).toBe("no-cache");
    expect(cabinet.headers.get("x-accel-buffering")).toBe("no");
    expect(await cabinet.next(2000)).toEqual({ retry: 3000 });
    const before = { confirmed: 2, limit: 50, waitlisted: 0, checkedIn: 0 };
    expect(await cabinet.counts()).toEqual(before);
    expect(await entrance.counts()).toEqual(before);

    const started = Date.now();
    expect((await checkin(organizer, eventId, ticketCode)).status).toBe(200);

    const after = { ...before, checkedIn: 1 };
    expect(await cabinet.counts(2000)).toEqual(after);
    expect(await entrance.counts(2000)).toEqual(after);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("R5: откаченная транзакция снимка не даёт", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    const { ticketCode } = await confirmedTicket(t, eventId);
    const live = await openLive(organizer, eventId);
    expect(await live.counts()).toMatchObject({ confirmed: 1, checkedIn: 0 });

    // Отдельное соединение к базе — как `psql` на демо: отметка поставлена и откачена.
    const rollback = new Error("rollback");
    await expect(
      testDb().$client.begin(async (sql) => {
        await sql`update registrations set checked_in_at = now() where event_id = ${eventId}`;
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    expect(await live.countsWithin(700)).toBeUndefined();
    // Поток жив: настоящая отметка приходит, и в ней ровно одна отметка.
    expect((await checkin(organizer, eventId, ticketCode)).status).toBe(200);
    expect(await live.counts()).toMatchObject({ confirmed: 1, checkedIn: 1 });
  });

  it("R5: снятие отметки — «пришло» уменьшается на открытом экране, билет снова проходит чекин", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    const { ticketCode } = await confirmedTicket(t, eventId);
    const live = await openLive(organizer, eventId);
    await live.counts();
    const first = await checkin(organizer, eventId, ticketCode);
    expect(await live.counts()).toMatchObject({ checkedIn: 1 });

    const res = await uncheck(organizer, eventId, first.body.registrationId);
    expect(res.status).toBe(204);
    expect(await live.counts()).toMatchObject({ confirmed: 1, checkedIn: 0 });
    expect((await ticketCard(organizer, eventId, ticketCode)).body).toMatchObject({ checkedInAt: null });
    // Повторное снятие ничего не меняет и снимка не даёт.
    expect((await uncheck(organizer, eventId, first.body.registrationId)).status).toBe(204);
    expect(await live.countsWithin(500)).toBeUndefined();

    t.clock.set(new Date(t.clock.now().getTime() + 5 * 60_000));
    const again = await checkin(organizer, eventId, ticketCode);
    expect(again.status).toBe(200);
    expect(again.body.checkedInAt).toBe(t.clock.now().toISOString());
    expect(await live.counts()).toMatchObject({ checkedIn: 1 });
  });

  it("R5: регистрация, отказ и правка лимита тоже присылают снимок", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 1 });
    const live = await openLive(organizer, eventId);
    expect(await live.counts()).toEqual({ confirmed: 0, limit: 1, waitlisted: 0, checkedIn: 0 });

    const { token } = await confirmedTicket(t, eventId);
    expect(await live.counts()).toEqual({ confirmed: 1, limit: 1, waitlisted: 0, checkedIn: 0 });
    await register(t, eventId, participant({ email: "boris@example.com" }));
    expect(await live.counts()).toEqual({ confirmed: 1, limit: 1, waitlisted: 1, checkedIn: 0 });
    // Отказ и повышение — одна транзакция: один итоговый снимок.
    await cancel(t.client(), token);
    expect(await live.counts()).toEqual({ confirmed: 1, limit: 1, waitlisted: 0, checkedIn: 0 });
    expect((await organizer.patch(`/api/organizer/events/${eventId}`, { limit: 3 })).status).toBe(200);
    expect(await live.counts()).toEqual({ confirmed: 1, limit: 3, waitlisted: 0, checkedIn: 0 });
  });

  it("R5: слушатель базы переподключился — открытые экраны получают свежий снимок", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    await confirmedTicket(t, eventId);
    const live = await openLive(organizer, eventId);
    expect(await live.counts()).toMatchObject({ confirmed: 1 });

    // Обрыв соединения под LISTEN: уведомления за время разрыва потеряны, снимок после переподключения их покрывает.
    const killed = await testDb().$client<{ pid: number }[]>`
      select pg_terminate_backend(pid) as pid from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid() and query ilike 'listen%'`;
    expect(killed).toHaveLength(1);

    expect(await live.counts(5000)).toEqual({ confirmed: 1, limit: 50, waitlisted: 0, checkedIn: 0 });
  });

  it("R5: чужое событие — потока и снятия отметки нет", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    const { ticketCode } = await confirmedTicket(t, eventId);
    const { registrationId } = (await checkin(organizer, eventId, ticketCode)).body;
    const stranger = await signUpOrganizer(t.client());

    const live = await stranger.get(`/api/organizer/events/${eventId}/live`);
    expect(live.status).toBe(404);
    expect(live.body).toEqual({ error: "not_found" });
    expect((await uncheck(stranger, eventId, registrationId)).status).toBe(404);
    expect((await ticketCard(organizer, eventId, ticketCode)).body.checkedInAt).not.toBeNull();
    expect((await t.client().get(`/api/organizer/events/${eventId}/live`)).status).toBe(401);
  });
});
