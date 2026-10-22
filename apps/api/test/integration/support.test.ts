import { describe, expect, it } from "vitest";
import { cancel, createEvent, participant, register } from "../support/participant.ts";
import { accept, queue, reject, signInSupport, submitCorrection } from "../support/support.ts";
import { testApp, type TestApp } from "../support/test-app.ts";

// Событие из `eventInput` начинается 20 ноября в 19:00 по Новосибирску — 12:00 UTC.
const STARTS_AT = "2026-11-20T12:00:00.000Z";

const fixed = { firstName: "Анна", lastName: "Петрова", birthDate: "1994-03-14" };

/** Событие с одной подтверждённой регистрацией Анны Ивановой. */
async function registered(t: TestApp, overrides: Record<string, unknown> = {}) {
  const { eventId, organizer } = await createEvent(t, overrides);
  const { token } = (await register(t, eventId)).body as { token: string };
  return { eventId, organizer, token };
}

const later = (t: TestApp, ms = 60_000) => t.clock.set(new Date(t.clock.now().getTime() + ms));

describe("Заявка на исправление: подача по личной ссылке", () => {
  it("подача создаёт ожидающую заявку: страница показывает её, данные регистрации прежние", async () => {
    const t = testApp();
    const { token } = await registered(t);

    const res = await submitCorrection(t.client(), token, { ...fixed, firstName: "  Анна " });

    expect(res.status).toBe(201);
    const pendingCorrection = { ...fixed, createdAt: t.clock.now().toISOString() };
    expect(res.body).toEqual({ pendingCorrection });
    const page = (await t.client().get(`/api/registrations/${token}`)).body;
    expect(page).toMatchObject({ firstName: "Анна", lastName: "Иванова", birthDate: "1994-03-14", pendingCorrection });
  });

  it("без заявки поля pendingCorrection на странице нет", async () => {
    const t = testApp();
    const { token } = await registered(t);

    const page = (await t.client().get(`/api/registrations/${token}`)).body;

    expect(page).not.toHaveProperty("pendingCorrection");
  });

  it("повторная подача заменяет заявку: в очереди одна, с новыми значениями; прежняя уже не ждёт решения", async () => {
    const t = testApp();
    const { token } = await registered(t);
    const support = await signInSupport(t);
    await submitCorrection(t.client(), token, fixed);
    const [first] = await queue(support);
    later(t);

    const again = await submitCorrection(t.client(), token, { ...fixed, lastName: "Сидорова" });

    expect(again.status).toBe(201);
    const list = await queue(support);
    expect(list).toHaveLength(1);
    expect(list[0].new).toEqual({ ...fixed, lastName: "Сидорова" });
    expect(list[0].id).not.toBe(first.id);
    const stale = await accept(support, first.id);
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ error: "correction_not_pending" });
    const page = (await t.client().get(`/api/registrations/${token}`)).body;
    expect(page.lastName).toBe("Иванова");
    expect(page.pendingCorrection.lastName).toBe("Сидорова");
  });

  it("отказ закрывает ожидающую заявку: её нет в очереди, принять её нельзя", async () => {
    const t = testApp();
    const { token } = await registered(t);
    const support = await signInSupport(t);
    await submitCorrection(t.client(), token, fixed);
    const [pending] = await queue(support);

    await cancel(t.client(), token);

    expect(await queue(support)).toEqual([]);
    const res = await accept(support, pending.id);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "correction_not_pending" });
    const page = (await t.client().get(`/api/registrations/${token}`)).body;
    expect(page).toMatchObject({ status: "cancelled", lastName: "Иванова" });
    expect(page).not.toHaveProperty("pendingCorrection");
  });

  it("у отменённой регистрации подача закрыта — 409 registration_cancelled", async () => {
    const t = testApp();
    const { token } = await registered(t);
    await cancel(t.client(), token);

    const res = await submitCorrection(t.client(), token, fixed);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "registration_cancelled" });
  });

  it("подавать может и участник из листа ожидания", async () => {
    const t = testApp();
    const { eventId } = await registered(t, { limit: 1 });
    const { token } = (await register(t, eventId, participant({ email: "boris@example.com" }))).body;

    const res = await submitCorrection(t.client(), token, { ...fixed, firstName: "Борис" });

    expect(res.status).toBe(201);
  });

  it("с началом события подача закрыта — 409 event_started; поданную до начала поддержка решает как обычно", async () => {
    const t = testApp();
    const { eventId } = await registered(t);
    const boris = (await register(t, eventId, participant({ email: "boris@example.com" }))).body;
    const support = await signInSupport(t);
    await submitCorrection(t.client(), boris.token, { ...fixed, firstName: "Борис" });

    t.clock.set(STARTS_AT);
    const late = await submitCorrection(t.client(), boris.token, { ...fixed, firstName: "Борислав" });
    const [pending] = await queue(support);
    const decided = await accept(support, pending.id);

    expect(late.status).toBe(409);
    expect(late.body).toEqual({ error: "event_started" });
    expect(decided.status).toBe(200);
    const page = (await t.client().get(`/api/registrations/${boris.token}`)).body;
    expect(page.firstName).toBe("Борис");
  });

  it("форма проверяется общей схемой: пустое имя и дата рождения в будущем — 400", async () => {
    const t = testApp();
    const { token } = await registered(t);

    const empty = await submitCorrection(t.client(), token, { ...fixed, firstName: "  " });
    const future = await submitCorrection(t.client(), token, { ...fixed, birthDate: "2026-11-02" });

    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("validation_failed");
    expect(empty.body.issues.map((i: { path: string }) => i.path)).toEqual(["firstName"]);
    expect(future.status).toBe(400);
    expect(future.body).toEqual({ error: "validation_failed", issues: [{ path: "birthDate", message: "in_future" }] });
  });

  it("заявка без изменений — 422 correction_unchanged, в очередь не попадает", async () => {
    const t = testApp();
    const { token } = await registered(t);
    const support = await signInSupport(t);

    const res = await submitCorrection(t.client(), token, participant());

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "correction_unchanged" });
    expect(await queue(support)).toEqual([]);
  });

  it("неизвестный токен — 404", async () => {
    const t = testApp();

    const res = await submitCorrection(t.client(), "A".repeat(43), fixed);

    expect(res.status).toBe(404);
  });
});

describe("Заявка на исправление: очередь поддержки", () => {
  it("очередь — только ожидающие, от старых к новым, с «было → стало» и событием", async () => {
    const t = testApp();
    const { eventId, token } = await registered(t, { minAge: 18 });
    const boris = (await register(t, eventId, participant({ email: "boris@example.com", firstName: "Борис" }))).body;
    const vera = (await register(t, eventId, participant({ email: "vera@example.com", firstName: "Вера" }))).body;
    const support = await signInSupport(t);
    const firstAt = t.clock.now().toISOString();
    await submitCorrection(t.client(), token, fixed);
    later(t);
    await submitCorrection(t.client(), boris.token, { ...fixed, firstName: "Борислав" });
    later(t);
    await submitCorrection(t.client(), vera.token, { ...fixed, firstName: "Вероника" });
    const [, , veraRequest] = await queue(support);
    await reject(support, veraRequest.id);

    const list = await queue(support);

    expect(list.map((c) => c.email)).toEqual(["anna@example.com", "boris@example.com"]);
    expect(list[0]).toEqual({
      id: expect.any(Number),
      createdAt: firstAt,
      event: {
        id: eventId,
        title: "Митап про Postgres",
        startsAt: STARTS_AT,
        timezone: "Asia/Novosibirsk",
        minAge: 18,
      },
      email: "anna@example.com",
      old: { firstName: "Анна", lastName: "Иванова", birthDate: "1994-03-14" },
      new: fixed,
      belowMinAgeAfter: false,
    });
  });

  it("«Будет младше N лет на день события»: belowMinAgeAfter по новой дате рождения и дню события", async () => {
    const t = testApp();
    const { eventId, token } = await registered(t, { minAge: 18 });
    const boris = (await register(t, eventId, participant({ email: "boris@example.com" }))).body;
    const support = await signInSupport(t);
    // 18 лет исполнится 21 ноября — на следующий день после события.
    await submitCorrection(t.client(), token, { ...fixed, birthDate: "2008-11-21" });
    // Ровно в день события — уже 18.
    await submitCorrection(t.client(), boris.token, { ...fixed, birthDate: "2008-11-20" });

    const list = await queue(support);

    expect(list.map((c) => c.belowMinAgeAfter)).toEqual([true, false]);
  });
});

describe("Заявка на исправление: решение поддержки", () => {
  it("«Принять» — новые значения в регистрации и у организатора, письмо с новыми значениями, очередь пуста", async () => {
    const t = testApp();
    const { eventId, organizer, token } = await registered(t);
    const support = await signInSupport(t);
    await submitCorrection(t.client(), token, { ...fixed, birthDate: "1995-04-15" });
    const [pending] = await queue(support);

    const res = await accept(support, pending.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
    const page = (await t.client().get(`/api/registrations/${token}`)).body;
    expect(page).toMatchObject({ firstName: "Анна", lastName: "Петрова", birthDate: "1995-04-15", status: "confirmed" });
    expect(page).not.toHaveProperty("pendingCorrection");
    const list = (await organizer.get(`/api/organizer/events/${eventId}/registrations`)).body.registrations;
    expect(list[0]).toMatchObject({ lastName: "Петрова", birthDate: "1995-04-15" });
    expect(await queue(support)).toEqual([]);
    await t.runJobs(t.clock.now());
    const [letter, ...rest] = t.mailbox.ofKind("correction_accepted");
    expect(rest).toEqual([]);
    expect(letter!.to).toBe("anna@example.com");
    expect(letter!.text).toContain("Петрова");
    expect(letter!.text).toContain("15.04.1995");
    expect(letter!.text).toContain(`http://app.test/r/${token}`);
    expect(t.mailbox.ofKind("correction_rejected")).toEqual([]);
  });

  it("«Отклонить» с причиной — данные прежние, письмо с причиной", async () => {
    const t = testApp();
    const { token } = await registered(t);
    const support = await signInSupport(t);
    await submitCorrection(t.client(), token, fixed);
    const [pending] = await queue(support);

    const res = await reject(support, pending.id, { reason: "  Фамилия в паспорте другая  " });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "rejected" });
    const page = (await t.client().get(`/api/registrations/${token}`)).body;
    expect(page).toMatchObject({ firstName: "Анна", lastName: "Иванова" });
    expect(page).not.toHaveProperty("pendingCorrection");
    expect(await queue(support)).toEqual([]);
    await t.runJobs(t.clock.now());
    const [letter, ...rest] = t.mailbox.ofKind("correction_rejected");
    expect(rest).toEqual([]);
    expect(letter!.to).toBe("anna@example.com");
    expect(letter!.text).toContain("Фамилия в паспорте другая");
    expect(t.mailbox.ofKind("correction_accepted")).toEqual([]);
  });

  it("«Отклонить» без причины — письмо без причины", async () => {
    const t = testApp();
    const { token } = await registered(t);
    const support = await signInSupport(t);
    await submitCorrection(t.client(), token, fixed);
    const [pending] = await queue(support);

    const res = await reject(support, pending.id, { reason: "   " });

    expect(res.status).toBe(200);
    await t.runJobs(t.clock.now());
    const [letter] = t.mailbox.ofKind("correction_rejected");
    expect(letter!.text).not.toContain("Причина");
  });

  it("после решения заявку нельзя решить ещё раз — 409 correction_not_pending", async () => {
    const t = testApp();
    const { token } = await registered(t);
    const support = await signInSupport(t);
    await submitCorrection(t.client(), token, fixed);
    const [pending] = await queue(support);
    await reject(support, pending.id);

    const res = await accept(support, pending.id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "correction_not_pending" });
    expect((await t.client().get(`/api/registrations/${token}`)).body.lastName).toBe("Иванова");
  });

  it("два параллельных «Принять» — один 200, один 409; новые значения и письмо — один раз", async () => {
    const t = testApp();
    const { token } = await registered(t);
    const [first, second] = [await signInSupport(t), await signInSupport(t)];
    await submitCorrection(t.client(), token, fixed);
    const [pending] = await queue(first);

    const answers = await Promise.all([accept(first, pending.id), accept(second, pending.id)]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect(answers.find((a) => a.status === 409)!.body).toEqual({ error: "correction_not_pending" });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("correction_accepted")).toHaveLength(1);
  });

  it("«Принять» и «Отклонить» одновременно — срабатывает одно решение", async () => {
    const t = testApp();
    const { token } = await registered(t);
    const support = await signInSupport(t);
    await submitCorrection(t.client(), token, fixed);
    const [pending] = await queue(support);

    const answers = await Promise.all([accept(support, pending.id), reject(support, pending.id)]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("correction_accepted").length + t.mailbox.ofKind("correction_rejected").length).toBe(1);
  });

  it("неизвестная заявка — 404", async () => {
    const t = testApp();
    const support = await signInSupport(t);

    expect((await accept(support, 999)).status).toBe(404);
    expect((await reject(support, 999)).status).toBe(404);
    expect((await support.post("/api/support/corrections/abc/accept")).status).toBe(404);
  });
});

describe("Поддержка: роли", () => {
  it("вход поддержки отвечает ролью support", async () => {
    const t = testApp();
    const support = await signInSupport(t, "help@example.com");

    const me = await support.get("/api/auth/me");

    expect(me.body.user).toMatchObject({ email: "help@example.com", role: "support" });
  });

  it("без сессии маршруты поддержки отвечают 401", async () => {
    const res = await testApp().client().get("/api/support/corrections");

    expect(res.status).toBe(401);
  });

  it("организатор на маршрутах поддержки получает 404", async () => {
    const t = testApp();
    const { organizer, token } = await registered(t);
    await submitCorrection(t.client(), token, fixed);
    const support = await signInSupport(t);
    const [pending] = await queue(support);

    const answers = [
      await organizer.get("/api/support/corrections"),
      await organizer.post(`/api/support/corrections/${pending.id}/accept`),
      await organizer.post(`/api/support/corrections/${pending.id}/reject`, {}),
    ];

    expect(answers.map((a) => a.status)).toEqual([404, 404, 404]);
    expect(answers[0]!.body).toEqual({ error: "not_found" });
    expect(await queue(support)).toHaveLength(1);
  });

  it("поддержка на организаторских маршрутах получает 404: своих событий у неё нет", async () => {
    const t = testApp();
    const { eventId } = await registered(t);
    const support = await signInSupport(t);

    const answers = [
      await support.get("/api/organizer/events"),
      await support.post("/api/organizer/events", {}),
      await support.get(`/api/organizer/events/${eventId}`),
      await support.get(`/api/organizer/events/${eventId}/registrations`),
      await support.patch(`/api/organizer/events/${eventId}`, { title: "Чужое" }),
    ];

    expect(answers.map((a) => a.status)).toEqual([404, 404, 404, 404, 404]);
    expect(answers[0]!.body).toEqual({ error: "not_found" });
  });
});

describe("Поддержка: события только на чтение", () => {
  it("видит события всех организаторов по времени начала, с email организатора и счётчиками", async () => {
    const t = testApp();
    const late = await registered(t, { title: "Позднее", startsLocal: "2026-12-01T10:00", limit: 1 });
    await register(t, late.eventId, participant({ email: "boris@example.com" }));
    const early = await createEvent(t, { title: "Раннее", startsLocal: "2026-11-10T10:00" });
    const support = await signInSupport(t);

    const res = await support.get("/api/support/events");

    expect(res.status).toBe(200);
    const organizerEmail = async (organizer: typeof early.organizer) =>
      (await organizer.get("/api/auth/me")).body.user.email;
    expect(res.body.events).toEqual([
      {
        id: early.eventId,
        title: "Раннее",
        organizerEmail: await organizerEmail(early.organizer),
        startsAt: "2026-11-10T03:00:00.000Z",
        timezone: "Asia/Novosibirsk",
        minAge: null,
        counts: { confirmed: 0, limit: 50, waitlisted: 0, checkedIn: 0 },
      },
      {
        id: late.eventId,
        title: "Позднее",
        organizerEmail: await organizerEmail(late.organizer),
        startsAt: "2026-12-01T03:00:00.000Z",
        timezone: "Asia/Novosibirsk",
        minAge: null,
        counts: { confirmed: 1, limit: 1, waitlisted: 1, checkedIn: 0 },
      },
    ]);
  });

  it("список регистраций события — тот же, что у организатора", async () => {
    const t = testApp();
    const { eventId, organizer, token } = await registered(t, { limit: 1 });
    await register(t, eventId, participant({ email: "boris@example.com", birthDate: "2010-01-01" }));
    await organizer.patch(`/api/organizer/events/${eventId}`, { minAge: 18 });
    await cancel(t.client(), token);
    const support = await signInSupport(t);

    const res = await support.get(`/api/support/events/${eventId}/registrations`);

    expect(res.status).toBe(200);
    const own = await organizer.get(`/api/organizer/events/${eventId}/registrations`);
    expect(res.body).toEqual(own.body);
    expect(res.body.registrations).toHaveLength(2);
  });

  it("неизвестное событие — 404; организатору маршруты событий поддержки — 404", async () => {
    const t = testApp();
    const { eventId, organizer } = await registered(t);
    const support = await signInSupport(t);

    expect((await support.get("/api/support/events/00000000-0000-4000-8000-000000000000/registrations")).status).toBe(404);
    expect((await support.get("/api/support/events/not-a-uuid/registrations")).status).toBe(404);
    expect((await organizer.get("/api/support/events")).status).toBe(404);
    expect((await organizer.get(`/api/support/events/${eventId}/registrations`)).status).toBe(404);
  });
});
