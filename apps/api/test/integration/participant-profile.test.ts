import { describe, expect, it } from "vitest";
import { cancel, createEvent, participant, register, signInParticipant } from "../support/participant.ts";
import { queue, signInSupport, submitCorrection } from "../support/support.ts";
import { testApp, type Client, type TestApp } from "../support/test-app.ts";

const EMAIL = "anna@example.com";
const profile = { firstName: "Анна", lastName: "Иванова", birthDate: "1994-03-14" };

const putProfile = (browser: Client, body: Record<string, unknown> = profile) => browser.put("/api/participant/profile", body);
const oneClick = (browser: Client, eventId: string, body: unknown = {}) =>
  browser.post(`/api/events/${eventId}/registrations`, body);

/** Вошедший участник с сохранённым профилем. */
async function withProfile(t: TestApp, data: Record<string, unknown> = profile) {
  const browser = await signInParticipant(t, EMAIL);
  const res = await putProfile(browser, data);
  if (res.status !== 200) throw new Error(`profile ${res.status}: ${JSON.stringify(res.body)}`);
  return browser;
}

/** Данные регистрации глазами организатора. */
async function listed(organizer: Client, eventId: string) {
  const res = await organizer.get(`/api/organizer/events/${eventId}/registrations`);
  return res.body.registrations as any[];
}

const DECEMBER = { startsLocal: "2026-12-20T19:00" };

describe("Профиль участника: PUT /participant/profile и GET /participant/me (D-065)", () => {
  it("первое сохранение создаёт профиль; /me отдаёт profile и прежний lastData", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    await register(t, eventId, participant({ firstName: "Старое", lastName: "Имя", birthDate: "1990-01-01" }));
    const browser = await signInParticipant(t, EMAIL);
    const before = (await browser.get("/api/participant/me")).body;
    expect(before).toEqual({ email: EMAIL, profile: null, lastData: { firstName: "Старое", lastName: "Имя", birthDate: "1990-01-01" } });

    const res = await putProfile(browser);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ profile, updated: 1, cancelled: [] });
    // Регистрация получила данные профиля, поэтому и lastData теперь они.
    expect((await browser.get("/api/participant/me")).body).toEqual({ email: EMAIL, profile, lastData: profile });
  });

  it("повторное сохранение заменяет профиль; без регистраций updated 0; значения обрезаются по краям", async () => {
    const t = testApp();
    const browser = await withProfile(t);

    const res = await putProfile(browser, { firstName: " Мария ", lastName: "Петрова", birthDate: "1991-05-05" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile: { firstName: "Мария", lastName: "Петрова", birthDate: "1991-05-05" },
      updated: 0,
      cancelled: [],
    });
    expect((await browser.get("/api/participant/me")).body.profile).toEqual(res.body.profile);
  });

  it("дата рождения в будущем → 400 in_future; без сессии → 401; пустое имя → 400", async () => {
    const t = testApp();
    const browser = await withProfile(t);

    const future = await putProfile(browser, { ...profile, birthDate: "2999-01-01" });
    expect(future.status).toBe(400);
    expect(future.body).toMatchObject({ error: "validation_failed", issues: [{ path: "birthDate", message: "in_future" }] });
    expect((await browser.get("/api/participant/me")).body.profile).toEqual(profile);

    expect((await putProfile(browser, { ...profile, firstName: " " })).status).toBe(400);
    expect((await putProfile(t.client())).status).toBe(401);
    expect((await t.client().get("/api/participant/me")).status).toBe(401);
  });
});

describe("Регистрация в один клик (D-065)", () => {
  it("профиль есть, тело {} → confirmed с данными профиля; письмо уходит", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 5 });
    const browser = await withProfile(t, { firstName: "Мария", lastName: "Петрова", birthDate: "1991-05-05" });

    const res = await oneClick(browser, eventId, {});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: "confirmed", status: "confirmed" });
    expect(await listed(organizer, eventId)).toMatchObject([
      { email: EMAIL, firstName: "Мария", lastName: "Петрова", birthDate: "1991-05-05", status: "confirmed" },
    ]);
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("confirmed", EMAIL)).toHaveLength(1);
  });

  it("совсем без тела запрос тоже в один клик", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const browser = await withProfile(t);

    const res = await oneClick(browser, eventId, undefined);

    expect(res.status).toBe(200);
    expect(res.body.result).toBe("confirmed");
  });

  it("профиля нет и тело пустое → 409 profile_required, регистрации нет", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    const browser = await signInParticipant(t, EMAIL);

    const res = await oneClick(browser, eventId, {});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "profile_required" });
    expect(await listed(organizer, eventId)).toHaveLength(0);
  });

  it("профиля нет, тело с данными → зарегистрирован и профиль создан тем же запросом", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    const browser = await signInParticipant(t, EMAIL);

    const res = await oneClick(browser, eventId, profile);

    expect(res.status).toBe(200);
    expect(res.body.result).toBe("confirmed");
    expect((await browser.get("/api/participant/me")).body.profile).toEqual(profile);
    expect(await listed(organizer, eventId)).toHaveLength(1);
  });

  it("профиль уже есть, а в теле другие данные → регистрация с телом, профиль не меняется", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    const browser = await withProfile(t);

    const res = await oneClick(browser, eventId, { firstName: "Другая", lastName: "Фамилия", birthDate: "1980-02-02" });

    expect(res.status).toBe(200);
    expect(await listed(organizer, eventId)).toMatchObject([{ firstName: "Другая", birthDate: "1980-02-02" }]);
    expect((await browser.get("/api/participant/me")).body.profile).toEqual(profile);
  });

  it("отказ регистрации (младше minAge) не создаёт профиль", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { minAge: 18 });
    const browser = await signInParticipant(t, EMAIL);

    const res = await oneClick(browser, eventId, { ...profile, birthDate: "2015-01-01" });

    expect(res.status).toBe(422);
    expect((await browser.get("/api/participant/me")).body.profile).toBeNull();
  });

  it("профиль младше minAge события → 422 below_min_age; битое тело → 400 с путём поля", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { minAge: 18 });
    const browser = await withProfile(t, { ...profile, birthDate: "2015-01-01" });

    const young = await oneClick(browser, eventId, {});
    expect(young.status).toBe(422);
    expect(young.body).toEqual({ error: "below_min_age", minAge: 18 });

    const broken = await oneClick(browser, eventId, { firstName: "Анна" });
    expect(broken.status).toBe(400);
    expect(broken.body.error).toBe("validation_failed");
    expect(broken.body.issues.map((i: any) => i.path).sort()).toEqual(["birthDate", "lastName"]);
  });

  it("без сессии → 401", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    expect((await oneClick(t.client(), eventId, {})).status).toBe(401);
  });
});

describe("Правка профиля переносится в регистрации (D-065)", () => {
  it("новые данные попадают в неотменённые регистрации не начавшихся событий, остальные не трогаются", async () => {
    const t = testApp();
    const started = await createEvent(t); // 20 ноября
    const future = await createEvent(t, DECEMBER);
    const waiting = await createEvent(t, { ...DECEMBER, limit: 1 });
    const cancelled = await createEvent(t, DECEMBER);
    await register(t, started.eventId, participant({ email: EMAIL }));
    const futureReg = (await register(t, future.eventId, participant({ email: EMAIL }))).body;
    await register(t, waiting.eventId, participant({ email: "first@example.com", firstName: "Первый" }));
    await register(t, waiting.eventId, participant({ email: EMAIL }));
    const toCancel = (await register(t, cancelled.eventId, participant({ email: EMAIL }))).body;
    await cancel(t.client(), toCancel.token);
    const browser = await signInParticipant(t, EMAIL);
    t.clock.set("2026-11-21T00:00:00Z"); // событие 20 ноября началось
    await t.runJobs(t.clock.now());
    const lettersBefore = t.mailbox.sent.length;

    const next = { firstName: "Мария", lastName: "Петрова", birthDate: "1991-05-05" };
    const res = await putProfile(browser, next);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ profile: next, updated: 2, cancelled: [] });
    expect(await listed(started.organizer, started.eventId)).toMatchObject([{ firstName: "Анна", lastName: "Иванова", birthDate: "1994-03-14" }]);
    expect(await listed(future.organizer, future.eventId)).toMatchObject([{ ...next, status: "confirmed" }]);
    const waitingRow = (await listed(waiting.organizer, waiting.eventId)).find((r) => r.email === EMAIL);
    expect(waitingRow).toMatchObject({ ...next, status: "waitlisted" });
    expect(await listed(cancelled.organizer, cancelled.eventId)).toMatchObject([{ firstName: "Анна", status: "cancelled" }]);
    // Личная ссылка показывает те же новые данные.
    expect((await t.client().get(`/api/registrations/${futureReg.token}`)).body).toMatchObject(next);
    // Письма об изменении данных нет.
    await t.runJobs(t.clock.now());
    expect(t.mailbox.sent).toHaveLength(lettersBefore);
  });

  it("зарегистрированный с чекином не меняется", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, DECEMBER);
    const { token } = (await register(t, eventId, participant({ email: EMAIL }))).body;
    const { ticketCode } = (await t.client().get(`/api/registrations/${token}`)).body;
    const checked = await organizer.post(`/api/organizer/events/${eventId}/checkin`, { code: ticketCode });
    expect(checked.status).toBe(200);
    const browser = await signInParticipant(t, EMAIL);

    const res = await putProfile(browser, { firstName: "Мария", lastName: "Петрова", birthDate: "1991-05-05" });

    expect(res.body.updated).toBe(0);
    expect(await listed(organizer, eventId)).toMatchObject([{ firstName: "Анна", lastName: "Иванова", birthDate: "1994-03-14" }]);
  });

  it("чужие регистрации с другим email не меняются", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, DECEMBER);
    await register(t, eventId, participant({ email: "boris@example.com", firstName: "Борис" }));
    const browser = await withProfile(t);

    await putProfile(browser, { firstName: "Мария", lastName: "Петрова", birthDate: "1991-05-05" });

    expect(await listed(organizer, eventId)).toMatchObject([{ email: "boris@example.com", firstName: "Борис" }]);
  });

  it("ожидающая заявка на исправление снимается у обновлённой регистрации", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, DECEMBER);
    const { token } = (await register(t, eventId, participant({ email: EMAIL }))).body;
    await submitCorrection(t.client(), token, { firstName: "Анна", lastName: "Сидорова", birthDate: "1994-03-14" });
    const support = await signInSupport(t);
    expect(await queue(support)).toHaveLength(1);
    const browser = await signInParticipant(t, EMAIL);

    await putProfile(browser, { firstName: "Мария", lastName: "Петрова", birthDate: "1991-05-05" });

    expect(await queue(support)).toHaveLength(0);
    const page = (await t.client().get(`/api/registrations/${token}`)).body;
    expect(page).not.toHaveProperty("pendingCorrection");
    expect(page).toMatchObject({ firstName: "Мария", lastName: "Петрова" });
  });
});

describe("Конфликт возраста при правке профиля (D-065)", () => {
  /** Анна 1994 г. р. записана на 18+ (лимит 1) и на событие без ограничения; Борис в листе ожидания 18+. */
  async function adultSetup(t: TestApp) {
    const adult = await createEvent(t, { ...DECEMBER, minAge: 18, limit: 1 });
    const open = await createEvent(t, DECEMBER);
    await register(t, adult.eventId, participant({ email: EMAIL }));
    await register(t, adult.eventId, participant({ email: "boris@example.com", firstName: "Борис" }));
    await register(t, open.eventId, participant({ email: EMAIL }));
    return { adult, open, browser: await signInParticipant(t, EMAIL) };
  }
  const teen = { firstName: "Анна", lastName: "Иванова", birthDate: "2010-01-01" };

  it("без cancelConflicts → 409 profile_conflicts со списком событий, ничего не изменилось", async () => {
    const t = testApp();
    const { adult, open, browser } = await adultSetup(t);
    await putProfile(browser);

    const res = await putProfile(browser, teen);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: "profile_conflicts",
      events: [
        { id: adult.eventId, title: "Митап про Postgres", startsAt: "2026-12-20T12:00:00.000Z", timezone: "Asia/Novosibirsk", minAge: 18 },
      ],
    });
    expect((await browser.get("/api/participant/me")).body.profile).toEqual(profile);
    expect(await listed(adult.organizer, adult.eventId)).toMatchObject([
      { email: EMAIL, birthDate: "1994-03-14", status: "confirmed" },
      { email: "boris@example.com", status: "waitlisted" },
    ]);
    expect(await listed(open.organizer, open.eventId)).toMatchObject([{ birthDate: "1994-03-14" }]);
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("cancelled")).toHaveLength(0);
  });

  it("с cancelConflicts: true → регистрация отменена, письмо cancelled, первый из листа ожидания получает место, остальное обновлено", async () => {
    const t = testApp();
    const { adult, open, browser } = await adultSetup(t);

    const res = await putProfile(browser, { ...teen, cancelConflicts: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ profile: teen, updated: 1, cancelled: [{ id: adult.eventId, title: "Митап про Postgres" }] });
    expect((await browser.get("/api/participant/me")).body.profile).toEqual(teen);
    const rows = await listed(adult.organizer, adult.eventId);
    expect(rows).toMatchObject([
      { email: "boris@example.com", status: "confirmed" },
      { email: EMAIL, status: "cancelled", birthDate: "1994-03-14" },
    ]);
    expect(await listed(open.organizer, open.eventId)).toMatchObject([{ ...teen, status: "confirmed" }]);

    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("cancelled", EMAIL)).toHaveLength(1);
    expect(t.mailbox.ofKind("promoted", "boris@example.com")).toHaveLength(1);
  });

  it("первое сохранение профиля тоже ловит конфликт со старой регистрацией", async () => {
    const t = testApp();
    const { adult, browser } = await adultSetup(t);

    const res = await putProfile(browser, teen);

    expect(res.status).toBe(409);
    expect(res.body.events).toHaveLength(1);
    expect((await browser.get("/api/participant/me")).body.profile).toBeNull();
    expect(await listed(adult.organizer, adult.eventId)).toMatchObject([{ status: "confirmed" }, { status: "waitlisted" }]);
  });

  it("регистрация в листе ожидания в конфликте отменяется без повышения других", async () => {
    const t = testApp();
    const adult = await createEvent(t, { ...DECEMBER, minAge: 18, limit: 1 });
    await register(t, adult.eventId, participant({ email: "boris@example.com", firstName: "Борис" }));
    await register(t, adult.eventId, participant({ email: EMAIL }));
    const browser = await signInParticipant(t, EMAIL);

    const res = await putProfile(browser, { ...teen, cancelConflicts: true });

    expect(res.body.cancelled).toHaveLength(1);
    expect(await listed(adult.organizer, adult.eventId)).toMatchObject([
      { email: "boris@example.com", status: "confirmed" },
      { email: EMAIL, status: "cancelled" },
    ]);
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("promoted")).toHaveLength(0);
  });

  it("ожидающая заявка отменённой регистрации снимается", async () => {
    const t = testApp();
    const { adult, browser } = await adultSetup(t);
    const rows = await listed(adult.organizer, adult.eventId);
    expect(rows).toHaveLength(2);
    const token = (await browser.get("/api/participant/registrations")).body.registrations.find(
      (r: any) => r.event.id === adult.eventId,
    ).token;
    await submitCorrection(t.client(), token, { firstName: "Анна", lastName: "Сидорова", birthDate: "1994-03-14" });
    const support = await signInSupport(t);
    expect(await queue(support)).toHaveLength(1);

    await putProfile(browser, { ...teen, cancelConflicts: true });

    expect(await queue(support)).toHaveLength(0);
  });

  it("событие, на которое возраст не проходит, но оно уже началось, конфликтом не считается", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { minAge: 18 });
    await register(t, eventId, participant({ email: EMAIL }));
    const browser = await signInParticipant(t, EMAIL);
    t.clock.set("2026-11-21T00:00:00Z");

    const res = await putProfile(browser, teen);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ profile: teen, updated: 0, cancelled: [] });
    expect(await listed(organizer, eventId)).toMatchObject([{ birthDate: "1994-03-14", status: "confirmed" }]);
  });
});

describe("Параллельные правки (D-065, D-011)", () => {
  it("две правки профиля и регистрации на тех же событиях одновременно не дают дедлока", async () => {
    const t = testApp();
    const events = await Promise.all([1, 2, 3].map(() => createEvent(t, DECEMBER)));
    for (const { eventId } of events) await register(t, eventId, participant({ email: EMAIL }));
    const extra = await createEvent(t, DECEMBER);
    const browser = await signInParticipant(t, EMAIL);
    const a = { firstName: "Мария", lastName: "Петрова", birthDate: "1991-05-05" };
    const b = { firstName: "Ольга", lastName: "Сидорова", birthDate: "1992-06-06" };

    const results = await Promise.all([putProfile(browser, a), putProfile(browser, b), oneClick(browser, extra.eventId, a)]);

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const final = (await browser.get("/api/participant/me")).body.profile;
    expect([a, b]).toContainEqual(final);
    for (const { eventId, organizer } of events) expect(await listed(organizer, eventId)).toMatchObject([{ ...final }]);
  });
});
