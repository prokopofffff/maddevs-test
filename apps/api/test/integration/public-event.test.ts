import { describe, expect, it } from "vitest";
import { eventInput, signUpOrganizer } from "../support/organizer.ts";
import { testApp } from "../support/test-app.ts";

describe("публичная страница события", () => {
  it("по ссылке участник видит описание, время в поясе события и свободные места", async () => {
    const { client } = testApp({ now: "2026-11-01T09:00:00Z" });
    const organizer = await signUpOrganizer(client());
    const { id } = (await organizer.post("/api/organizer/events", eventInput({ limit: 12, minAge: 16 }))).body.event;

    const res = await client().get(`/api/events/${id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id,
      title: "Митап про Postgres",
      description: "Блокировки, очереди и немного NOTIFY.",
      startsAt: "2026-11-20T12:00:00.000Z",
      timezone: "Asia/Novosibirsk",
      format: "offline",
      city: "Новосибирск",
      address: "Красный проспект, 1",
      category: "meetup",
      minAge: 16,
      freeSeats: 12,
      started: false,
    });
  });

  it("с момента начала событие считается начавшимся, свободных мест нет", async () => {
    const { client, clock } = testApp({ now: "2026-11-01T09:00:00Z" });
    const organizer = await signUpOrganizer(client());
    const { id } = (await organizer.post("/api/organizer/events", eventInput())).body.event;

    clock.set("2026-11-20T11:59:59Z");
    expect((await client().get(`/api/events/${id}`)).body).toMatchObject({ started: false, freeSeats: 50 });
    clock.set("2026-11-20T12:00:00Z");
    expect((await client().get(`/api/events/${id}`)).body).toMatchObject({ started: true, freeSeats: 0 });
  });

  it("несуществующее событие и неизвестный маршрут API — 404 not_found", async () => {
    const { client } = testApp();

    for (const path of ["/api/events/00000000-0000-4000-8000-000000000000", "/api/events/nope", "/api/nothing"]) {
      const res = await client().get(path);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "not_found" });
    }
  });
});
