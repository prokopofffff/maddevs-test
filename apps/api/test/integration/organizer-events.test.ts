import { describe, expect, it } from "vitest";
import { eventInput, signUpOrganizer } from "../support/organizer.ts";
import { PUBLIC_URL, testApp } from "../support/test-app.ts";

describe("события организатора", () => {
  it("создание переводит время в поясе события в момент начала", async () => {
    const organizer = await signUpOrganizer(testApp({ now: "2026-11-01T09:00:00Z" }).client());

    const res = await organizer.post("/api/organizer/events", eventInput({ minAge: 18 }));

    expect(res.status).toBe(201);
    expect(res.body.event).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      title: "Митап про Postgres",
      description: "Блокировки, очереди и немного NOTIFY.",
      startsAt: "2026-11-20T12:00:00.000Z", // 19:00 в Новосибирске (UTC+7)
      startsLocal: "2026-11-20T19:00",
      timezone: "Asia/Novosibirsk",
      limit: 50,
      format: "offline",
      city: "Новосибирск",
      address: "Красный проспект, 1",
      category: "meetup",
      minAge: 18,
      started: false,
    });
  });

  it("событие в прошлом не создаётся", async () => {
    const organizer = await signUpOrganizer(testApp({ now: "2026-11-20T12:00:00Z" }).client());

    const res = await organizer.post("/api/organizer/events", eventInput({ startsLocal: "2026-11-20T19:00" }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "starts_in_past" });
    expect((await organizer.get("/api/organizer/events")).body.events).toEqual([]);
  });

  it("неизвестный пояс, нулевой лимит и пустое название — 400 validation_failed", async () => {
    const organizer = await signUpOrganizer(testApp().client());

    const res = await organizer.post(
      "/api/organizer/events",
      eventInput({ title: "", timezone: "Mars/Olympus", limit: 0 }),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
    expect(res.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(["limit", "timezone", "title"]);
  });

  it("«Мои события» — только свои, по времени начала, со счётчиками", async () => {
    const { client } = testApp();
    const anna = await signUpOrganizer(client());
    const boris = await signUpOrganizer(client());
    await anna.post("/api/organizer/events", eventInput({ title: "Позже", startsLocal: "2026-12-01T10:00" }));
    await anna.post("/api/organizer/events", eventInput({ title: "Раньше", startsLocal: "2026-11-10T10:00", limit: 5 }));
    await boris.post("/api/organizer/events", eventInput({ title: "Чужое" }));

    const res = await anna.get("/api/organizer/events");

    expect(res.status).toBe(200);
    expect(res.body.events.map((e: { title: string }) => e.title)).toEqual(["Раньше", "Позже"]);
    expect(res.body.events[0]).toMatchObject({
      startsAt: "2026-11-10T03:00:00.000Z",
      timezone: "Asia/Novosibirsk",
      started: false,
      counts: { confirmed: 0, limit: 5, waitlisted: 0, checkedIn: 0 },
    });
  });

  it("своё событие открывается со ссылкой для участников, чужое — 404", async () => {
    const { client } = testApp();
    const anna = await signUpOrganizer(client());
    const boris = await signUpOrganizer(client());
    const { id } = (await anna.post("/api/organizer/events", eventInput())).body.event;

    const own = await anna.get(`/api/organizer/events/${id}`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      event: { id, title: "Митап про Postgres", limit: 50 },
      counts: { confirmed: 0, limit: 50, waitlisted: 0, checkedIn: 0 },
      publicUrl: `${PUBLIC_URL}/e/${id}`,
      registrationCount: 0,
    });

    const foreign = await boris.get(`/api/organizer/events/${id}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: "not_found" });
    expect((await anna.get("/api/organizer/events/not-a-uuid")).status).toBe(404);
  });

  it("без сессии события организатора закрыты", async () => {
    const res = await testApp().client().get("/api/organizer/events");

    expect(res.status).toBe(401);
  });
});
