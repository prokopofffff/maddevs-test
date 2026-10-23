import { describe, expect, it } from "vitest";
import { resetDatabase, seedDemo } from "../../src/seed/demo.ts";
import { testDb } from "../setup/worker-db.ts";
import { queue } from "../support/support.ts";
import { testApp, type TestApp } from "../support/test-app.ts";

const DAY = 24 * 60 * 60 * 1000;

async function signIn(t: TestApp, email: string, password: string) {
  const browser = t.client();
  const res = await browser.post("/api/auth/login", { email, password });
  expect(res.status, `вход ${email}`).toBe(200);
  return browser;
}

async function demoEvents(t: TestApp) {
  const demo = await signIn(t, "demo@example.com", "demo");
  const list = (await demo.get("/api/organizer/events")).body.events as any[];
  const details = await Promise.all(list.map(async (e) => (await demo.get(`/api/organizer/events/${e.id}`)).body));
  return { demo, list, details };
}

describe("Демо-сид (D-010)", () => {
  it("на пустой базе: демо-организатор видит четыре события по списку SPEC §10", async () => {
    const t = testApp();
    const now = t.clock.now();

    expect(await seedDemo(testDb(), now)).toMatchObject({ status: "seeded" });

    const { list, details } = await demoEvents(t);
    expect(list).toHaveLength(4);
    const startsIn = (e: any) => new Date(e.startsAt).getTime() - now.getTime();

    // Заполненное, с листом ожидания: мест нет, событие впереди.
    const full = list.find((e) => !e.started && e.counts.waitlisted > 0);
    expect(full?.counts.confirmed).toBe(full?.counts.limit);
    expect((await t.client().get(`/api/events/${full.id}`)).body.freeSeats).toBe(0);

    // Начинается меньше чем через сутки, с подтверждёнными.
    const soon = list.find((e) => !e.started && startsIn(e) < DAY);
    expect(soon?.counts.confirmed).toBeGreaterThan(0);

    // Прошедшее, с чекинами.
    const past = list.find((e) => e.started);
    expect(past?.counts.checkedIn).toBeGreaterThan(0);

    // С минимальным возрастом: квиз 18+ и митап 12+ (D-060).
    expect(details.filter((d) => d.event.minAge > 0).map((d) => d.event.minAge).sort()).toEqual([12, 18]);
  });

  it("публичный каталог после сида: четыре предстоящих, одно прошедшее, города Москва и Новосибирск, митап онлайн (D-056)", async () => {
    const t = testApp();
    await seedDemo(testDb(), t.clock.now());
    const guest = t.client();

    const upcoming = (await guest.get("/api/events")).body.events as any[];
    const past = (await guest.get("/api/events?when=past")).body.events as any[];
    const cities = (await guest.get("/api/events/cities")).body.cities;

    // Событие второго организатора («Лекция») в каталоге тоже: каталог не режет по организатору.
    expect(upcoming.map((e) => e.title).sort()).toEqual([
      "Воркшоп: формы на React без боли",
      "Лекция: как устроены очереди",
      "Митап: Postgres под нагрузкой",
      "Ночной квиз 18+",
    ]);
    expect(past.map((e) => e.title)).toEqual(["Конференция «Бэкенд в Сибири»"]);
    expect(cities).toEqual(["Москва", "Новосибирск"]);
    expect(upcoming.find((e) => e.title.startsWith("Митап"))).toMatchObject({ format: "online", city: null });
  });

  it("после сида проход циклов присылает напоминания подтверждённым заранее, и никаких других писем", async () => {
    const t = testApp();
    const now = t.clock.now();
    await seedDemo(testDb(), now);
    const { demo, list } = await demoEvents(t);
    const soon = list.find((e) => !e.started && new Date(e.startsAt).getTime() - now.getTime() < DAY);
    const registrations = (await demo.get(`/api/organizer/events/${soon.id}/registrations`)).body
      .registrations as any[];
    const early = registrations.filter(
      (r) => r.status === "confirmed" && new Date(r.confirmedAt).getTime() < new Date(soon.startsAt).getTime() - DAY,
    );
    expect(early.length).toBeGreaterThan(0);

    await t.runJobs(now);

    // Регистрации сида пишутся без писем; поздно подтверждённым напоминания нет (D-019).
    expect(t.mailbox.sent.map((m) => m.kind)).toEqual(early.map(() => "reminder"));
    expect(t.mailbox.sent.map((m) => m.to).sort()).toEqual(early.map((r) => r.email).sort());
  });

  it("второй организатор видит только своё событие, событие demo — 404", async () => {
    const t = testApp();
    await seedDemo(testDb(), t.clock.now());
    const { list } = await demoEvents(t);
    const demo2 = await signIn(t, "demo2@example.com", "demo");

    const own = (await demo2.get("/api/organizer/events")).body.events as any[];

    expect(own).toHaveLength(1);
    expect(list.map((e) => e.id)).not.toContain(own[0].id);
    expect((await demo2.get(`/api/organizer/events/${list[0].id}`)).status).toBe(404);
  });

  it("поддержка входит и видит одну ожидающую заявку на исправление", async () => {
    const t = testApp();
    await seedDemo(testDb(), t.clock.now());
    const support = await signIn(t, "support@example.com", "support");

    expect(await queue(support)).toHaveLength(1);
  });

  it("на непустой базе сид отказывается и ничего не меняет", async () => {
    const t = testApp();
    await seedDemo(testDb(), t.clock.now());

    expect(await seedDemo(testDb(), t.clock.now())).toEqual({ status: "not_empty" });

    expect((await demoEvents(t)).list).toHaveLength(4);
  });

  it("сброс стирает данные и применяет миграции: после него сид снова проходит", async () => {
    const t = testApp();
    await seedDemo(testDb(), t.clock.now());

    await resetDatabase(testDb());

    expect((await t.client().post("/api/auth/login", { email: "demo@example.com", password: "demo" })).status).toBe(
      401,
    );
    expect(await seedDemo(testDb(), t.clock.now())).toMatchObject({ status: "seeded" });
    expect((await demoEvents(t)).list).toHaveLength(4);
  });
});
