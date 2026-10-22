import { describe, expect, it } from "vitest";
import { cancel, createEvent, participant, register, signInParticipant } from "../support/participant.ts";
import { testApp, type TestApp } from "../support/test-app.ts";

/** Минута между кодами на один email: повторная регистрация и вторая запись ждут. */
const later = (t: TestApp) => t.clock.set(new Date(t.clock.now().getTime() + 60_000));
const list = (browser: Awaited<ReturnType<typeof signInParticipant>>) => browser.get("/api/participant/registrations");

describe("GET /participant/registrations: «Мои регистрации» (D-057)", () => {
  it("отдаёт только регистрации своего email, включая отменённые и повторную после отказа (две строки)", async () => {
    const t = testApp();
    // Событие B начинается раньше A: порядок ответа — по `starts_at`, а не по времени регистрации.
    const a = await createEvent(t, { title: "Событие A", startsLocal: "2026-11-20T19:00" });
    const b = await createEvent(t, { title: "Событие B", startsLocal: "2026-11-10T19:00", format: "online", city: null, address: null });
    const first = (await register(t, a.eventId)).body;
    await cancel(t.client(), first.token);
    later(t);
    const again = (await register(t, a.eventId)).body;
    later(t);
    const inB = (await register(t, b.eventId)).body;
    await register(t, a.eventId, participant({ email: "boris@example.com" }));

    const res = await list(await signInParticipant(t));

    expect(res.status).toBe(200);
    expect(again.token).not.toBe(first.token);
    // Внутри одного события — по времени создания: отказ раньше повторной.
    expect(res.body.registrations.map((r: { token: string; status: string }) => [r.token, r.status])).toEqual([
      [inB.token, "confirmed"],
      [first.token, "cancelled"],
      [again.token, "confirmed"],
    ]);
    expect(res.body.registrations[0].event).toEqual({
      id: b.eventId,
      title: "Событие B",
      startsAt: "2026-11-10T12:00:00.000Z",
      timezone: "Asia/Novosibirsk",
      format: "online",
      city: null,
      started: false,
    });
    expect(res.body.registrations[1].event).toMatchObject({ id: a.eventId, format: "offline", city: "Новосибирск" });

    // Чужие регистрации в ответ не попадают: у Бориса одна строка.
    const boris = (await list(await signInParticipant(t, "boris@example.com"))).body.registrations;
    expect(boris).toHaveLength(1);
    expect(boris[0].event.id).toBe(a.eventId);
  });

  it("у листа ожидания — текущий номер; у отменённой ticketCode null; started по часам", async () => {
    const t = testApp();
    const waiting = await createEvent(t, { limit: 1, startsLocal: "2026-11-20T19:00" });
    const early = await createEvent(t, { startsLocal: "2026-11-10T19:00" });
    await register(t, waiting.eventId, participant({ email: "boris@example.com" }));
    const carol = (await register(t, waiting.eventId, participant({ email: "carol@example.com" }))).body;
    const anna = (await register(t, waiting.eventId)).body;
    const cancelled = (await register(t, early.eventId)).body;
    await cancel(t.client(), cancelled.token);
    const browser = await signInParticipant(t);

    const before = (await list(browser)).body.registrations;
    expect(before.map((r: { token: string }) => r.token)).toEqual([cancelled.token, anna.token]);
    expect(before[1]).toMatchObject({ status: "waitlisted", waitlistPosition: 2, ticketCode: null, checkedInAt: null, cancelledAt: null });
    expect(before[1].event.started).toBe(false);

    // Карол выходит из листа — номер Анны становится текущим, а не тем, что был при записи.
    await cancel(t.client(), carol.token);
    t.clock.set("2026-11-10T12:00:00Z");
    const after = (await list(browser)).body.registrations;

    expect(after[1].waitlistPosition).toBe(1);
    expect(after[1].event.started).toBe(false);
    expect(after[0]).toMatchObject({ status: "cancelled", ticketCode: null, cancelledAt: "2026-11-01T09:00:00.000Z" });
    expect(after[0]).not.toHaveProperty("waitlistPosition");
    expect(after[0].event.started).toBe(true);
  });

  it("у подтверждённой — код билета, как на личной странице", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const { token } = (await register(t, eventId)).body;
    const page = (await t.client().get(`/api/registrations/${token}`)).body;

    const [row] = (await list(await signInParticipant(t))).body.registrations;

    expect(row.ticketCode).toBe(page.ticketCode);
    expect(row.ticketCode).toEqual(expect.any(String));
    expect(row).not.toHaveProperty("waitlistPosition");
  });

  it("без сессии → 401", async () => {
    const t = testApp();

    const res = await t.client().get("/api/participant/registrations");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });
});
