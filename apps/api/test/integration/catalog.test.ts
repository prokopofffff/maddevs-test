import { describe, expect, it } from "vitest";
import { eventInput, signUpOrganizer } from "../support/organizer.ts";
import { createEvent, participant, register } from "../support/participant.ts";
import { testApp, type Client, type TestApp } from "../support/test-app.ts";

/** Часы стоят на 1 ноября 09:00 UTC; события в тестах задаются в UTC, если не сказано иное. */
const NOW = "2026-11-01T09:00:00Z";

const create = async (organizer: Client, overrides: Record<string, unknown> = {}) => {
  const res = await organizer.post("/api/organizer/events", eventInput({ timezone: "UTC", ...overrides }));
  if (res.status !== 201) throw new Error(`event ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.event.id as string;
};

const titles = async (t: TestApp, query = "") => {
  const res = await t.client().get(`/api/events${query}`);
  expect(res.status).toBe(200);
  return (res.body.events as { title: string }[]).map((e) => e.title);
};

describe("каталог событий: GET /api/events", () => {
  it("по умолчанию — только предстоящие, по возрастанию начала; прошедшие — по убыванию", async () => {
    const t = testApp({ now: "2026-10-01T09:00:00Z" });
    const organizer = await signUpOrganizer(t.client());
    await create(organizer, { title: "C", startsLocal: "2026-10-20T10:00" });
    await create(organizer, { title: "A", startsLocal: "2026-10-05T10:00" });
    await create(organizer, { title: "B", startsLocal: "2026-10-10T10:00" });

    expect(await titles(t)).toEqual(["A", "B", "C"]);

    t.clock.set("2026-10-12T00:00:00Z");
    expect(await titles(t)).toEqual(["C"]);
    expect(await titles(t, "?when=past")).toEqual(["B", "A"]);
  });

  it("ответ не содержит email, имён, адреса и описания", async () => {
    const t = testApp({ now: NOW });
    await createEvent(t);

    const res = await t.client().get("/api/events");

    expect(res.body.nextCursor).toBeNull();
    expect(Object.keys(res.body.events[0]).sort()).toEqual([
      "category",
      "city",
      "format",
      "freeSeats",
      "id",
      "minAge",
      "started",
      "startsAt",
      "timezone",
      "title",
    ]);
    expect(res.body.events[0]).toMatchObject({ freeSeats: 50, started: false, minAge: 0 });
  });

  it("q ищет в названии и описании без учёта регистра; '100%' и '_' не работают как шаблон", async () => {
    const t = testApp({ now: NOW });
    const organizer = await signUpOrganizer(t.client());
    await create(organizer, { title: "Митап про Postgres", description: "Блокировки" });
    await create(organizer, { title: "Квиз", description: "Вопросы про КОТОВ" });
    await create(organizer, { title: "Скидка 100% для всех", description: "x" });
    await create(organizer, { title: "Обычное событие", description: "100 человек" });
    await create(organizer, { title: "snake_case", description: "y" });
    await create(organizer, { title: "snakeXcase", description: "z" });

    expect(await titles(t, "?q=postgres")).toEqual(["Митап про Postgres"]);
    expect(await titles(t, `?q=${encodeURIComponent("котов")}`)).toEqual(["Квиз"]);
    expect(await titles(t, `?q=${encodeURIComponent("100%")}`)).toEqual(["Скидка 100% для всех"]);
    expect(await titles(t, "?q=snake_")).toEqual(["snake_case"]);
    expect(await titles(t, "?q=%25")).toEqual(["Скидка 100% для всех"]);
    // Пустой запрос после обрезки пробелов — не фильтр.
    expect(await titles(t, "?q=%20%20")).toHaveLength(6);
  });

  it("today и week — в поясе tz, а не в поясе события", async () => {
    const t = testApp({ now: NOW });
    const organizer = await signUpOrganizer(t.client());
    // 23:30 по Новосибирску 1 ноября = 16:30 UTC; 01:00 2 ноября = 18:00 UTC 1 ноября.
    await create(organizer, { title: "вечер 1 ноября", startsLocal: "2026-11-01T23:30", timezone: "Asia/Novosibirsk" });
    await create(organizer, { title: "ночь 2 ноября", startsLocal: "2026-11-02T01:00", timezone: "Asia/Novosibirsk" });

    // Граница дня Новосибирска — 17:00 UTC; Лондона (зима) — 00:00 UTC.
    expect(await titles(t, "?when=today&tz=Asia/Novosibirsk")).toEqual(["вечер 1 ноября"]);
    expect(await titles(t, "?when=today&tz=Europe/London")).toEqual(["вечер 1 ноября", "ночь 2 ноября"]);

    // Начало дня today + 7 по Новосибирску — 7 ноября 17:00 UTC.
    await create(organizer, { title: "7 ноября, 23:30", startsLocal: "2026-11-07T23:30", timezone: "Asia/Novosibirsk" });
    await create(organizer, { title: "8 ноября, 00:30", startsLocal: "2026-11-08T00:30", timezone: "Asia/Novosibirsk" });
    const week = await titles(t, "?when=week&tz=Asia/Novosibirsk");
    expect(week).toContain("7 ноября, 23:30");
    expect(week).not.toContain("8 ноября, 00:30");
    expect(await titles(t, "?when=week&tz=Europe/London")).toContain("8 ноября, 00:30");
  });

  it("hasSeats=1 исключает заполненное и событие с листом ожидания", async () => {
    const t = testApp({ now: NOW });
    await createEvent(t, { title: "свободное", limit: 2 });
    const full = await createEvent(t, { title: "заполненное", limit: 1 });
    const waiting = await createEvent(t, { title: "с листом", limit: 1 });
    await register(t, full.eventId, participant({ email: "a@example.com" }));
    await register(t, waiting.eventId, participant({ email: "b@example.com" }));
    await register(t, waiting.eventId, participant({ email: "c@example.com" }));
    // Подтверждённый уходит, лист ожидания пуст — место снова свободно.
    const gone = await createEvent(t, { title: "освободилось", limit: 1 });
    const { token } = (await register(t, gone.eventId, participant({ email: "d@example.com" }))).body;
    await t.client().post(`/api/registrations/${token}/cancel`);

    expect((await titles(t)).sort()).toEqual(["заполненное", "освободилось", "с листом", "свободное"]);
    expect((await titles(t, "?hasSeats=1")).sort()).toEqual(["освободилось", "свободное"]);
    // Прошедшие мест не дают.
    expect(await titles(t, "?hasSeats=1&when=past")).toEqual([]);
  });

  it("format, city (без учёта регистра), category, maxAge=12 — по одному и вместе", async () => {
    const t = testApp({ now: NOW });
    const organizer = await signUpOrganizer(t.client());
    await create(organizer, { title: "A", city: "Москва", category: "lecture", minAge: 0 });
    await create(organizer, { title: "B", city: "москва", category: "meetup", minAge: 6 });
    await create(organizer, { title: "C", city: "Казань", category: "lecture", minAge: 12 });
    await create(organizer, { title: "D", city: "Москва", category: "lecture", minAge: 16 });
    await create(organizer, { title: "E", format: "online", city: null, address: null, category: "lecture", minAge: 18 });

    const sorted = async (q: string) => (await titles(t, q)).sort();
    expect(await sorted("?format=online")).toEqual(["E"]);
    expect(await sorted("?format=offline")).toEqual(["A", "B", "C", "D"]);
    expect(await sorted(`?city=${encodeURIComponent("МОСКВА")}`)).toEqual(["A", "B", "D"]);
    expect(await sorted("?category=lecture")).toEqual(["A", "C", "D", "E"]);
    expect(await sorted("?maxAge=12")).toEqual(["A", "B", "C"]);
    expect(await sorted(`?city=${encodeURIComponent("Москва")}&category=lecture&maxAge=12`)).toEqual(["A"]);
    expect(await sorted(`?format=offline&category=lecture&maxAge=16&city=${encodeURIComponent("москва")}`)).toEqual(["A", "D"]);
  });

  it("курсор: 30 событий, 5 из них в одну минуту на границе — две страницы 24 + 6 без дублей и пропусков", async () => {
    const t = testApp({ now: NOW });
    const organizer = await signUpOrganizer(t.client());
    // Позиции 22–26 (по 1-based) начинаются в одну минуту: страница обрывается внутри группы.
    const minute = (i: number) => (i >= 21 && i <= 25 ? 21 : i);
    const created: string[] = [];
    for (let i = 0; i < 30; i++) {
      const hh = String(10 + Math.floor(minute(i) / 60)).padStart(2, "0");
      const mm = String(minute(i) % 60).padStart(2, "0");
      created.push(await create(organizer, { title: `E${i}`, startsLocal: `2026-11-10T${hh}:${mm}` }));
    }

    const first = (await t.client().get("/api/events")).body;
    expect(first.events).toHaveLength(24);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await t.client().get(`/api/events?cursor=${first.nextCursor}`)).body;
    expect(second.events).toHaveLength(6);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.events, ...second.events].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(30);
    expect([...ids].sort()).toEqual([...created].sort());
    // Порядок сквозной: по моменту начала, внутри минуты — по id.
    const keys = [...first.events, ...second.events].map((e: { startsAt: string; id: string }) => `${e.startsAt}|${e.id}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("курсор у past идёт в обратную сторону без дублей", async () => {
    const t = testApp({ now: "2026-10-01T00:00:00Z" });
    const organizer = await signUpOrganizer(t.client());
    for (let i = 0; i < 26; i++) {
      await create(organizer, { title: `P${i}`, startsLocal: `2026-10-${String(2 + i).padStart(2, "0")}T10:00` });
    }
    t.clock.set("2026-12-01T00:00:00Z");

    const first = (await t.client().get("/api/events?when=past")).body;
    const second = (await t.client().get(`/api/events?when=past&cursor=${first.nextCursor}`)).body;

    expect(first.events).toHaveLength(24);
    expect(second.events).toHaveLength(2);
    const all = [...first.events, ...second.events] as { startsAt: string; id: string }[];
    expect(new Set(all.map((e) => e.id)).size).toBe(26);
    const keys = all.map((e) => `${e.startsAt}|${e.id}`);
    expect(keys).toEqual([...keys].sort().reverse());
  });

  it("битый курсор и неизвестный пояс — 400 validation_failed с путём в issues", async () => {
    const t = testApp({ now: NOW });
    const garbage = ["не-курсор", Buffer.from("[1,2]").toString("base64url"), Buffer.from('["2026-11-01T00:00:00.000Z","x"]').toString("base64url")];

    for (const cursor of garbage) {
      const res = await t.client().get(`/api/events?cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "validation_failed", issues: [{ path: "cursor", message: "invalid" }] });
    }
    const tz = await t.client().get("/api/events?tz=Mars/Base");
    expect(tz.status).toBe(400);
    expect(tz.body).toMatchObject({ error: "validation_failed", issues: [{ path: "tz" }] });
    expect((await t.client().get("/api/events?maxAge=7")).status).toBe(400);
    expect((await t.client().get("/api/events?when=tomorrow")).status).toBe(400);
  });
});

describe("города каталога: GET /api/events/cities", () => {
  it("города предстоящих офлайн-событий без учёта регистра, по алфавиту, написание самого раннего", async () => {
    const t = testApp({ now: "2026-10-01T00:00:00Z" });
    const organizer = await signUpOrganizer(t.client());
    await create(organizer, { city: "москва", startsLocal: "2026-10-20T10:00" });
    await create(organizer, { city: "Москва", startsLocal: "2026-10-10T10:00" });
    await create(organizer, { city: "Казань", startsLocal: "2026-10-15T10:00" });
    await create(organizer, { city: "Ёлкино", startsLocal: "2026-10-16T10:00" });
    await create(organizer, { city: "Архангельск", startsLocal: "2026-10-25T10:00" });
    await create(organizer, { format: "online", city: null, address: null, startsLocal: "2026-10-12T10:00" });
    await create(organizer, { city: "Прошлое", startsLocal: "2026-10-02T10:00" });
    t.clock.set("2026-10-05T00:00:00Z");

    const res = await t.client().get("/api/events/cities");

    expect(res.status).toBe(200);
    // «Прошлое» уже в прошлом; «Москва» — с написанием события 10 октября; «Ёлкино» — по русскому порядку между «Е» и «Ж», то есть до «Казани».
    expect(res.body).toEqual({ cities: ["Архангельск", "Ёлкино", "Казань", "Москва"] });
    // Маршрут не перехвачен /events/:id.
    expect((await t.client().get("/api/events/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
