import { describe, expect, it } from "vitest";
import { eventInput, signUpOrganizer } from "../support/organizer.ts";
import { testApp } from "../support/test-app.ts";

describe("правка и удаление события", () => {
  it("правка названия, описания и минимального возраста сохраняется", async () => {
    const organizer = await signUpOrganizer(testApp().client());
    const { id } = (await organizer.post("/api/organizer/events", eventInput())).body.event;

    const res = await organizer.patch(`/api/organizer/events/${id}`, {
      title: "Митап про Postgres 17",
      description: "Новая программа.",
      minAge: 21,
    });

    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({
      id,
      title: "Митап про Postgres 17",
      description: "Новая программа.",
      minAge: 21,
      startsAt: "2026-11-20T12:00:00.000Z",
      timezone: "Asia/Novosibirsk",
      limit: 50,
    });
    expect((await organizer.get(`/api/organizer/events/${id}`)).body.event).toMatchObject({
      title: "Митап про Postgres 17",
      description: "Новая программа.",
      minAge: 21,
    });
  });

  it("после начала название, описание и возраст по-прежнему правятся", async () => {
    const t = testApp({ now: "2026-11-01T09:00:00Z" });
    const organizer = await signUpOrganizer(t.client());
    const { id } = (await organizer.post("/api/organizer/events", eventInput())).body.event;
    t.clock.set("2026-11-20T12:00:00Z"); // ровно момент начала

    const res = await organizer.patch(`/api/organizer/events/${id}`, { title: "Запись митапа", minAge: null });

    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({ title: "Запись митапа", minAge: null, started: true });
  });

  it("смена только пояса сохраняет момент начала", async () => {
    const organizer = await signUpOrganizer(testApp().client());
    const { id } = (await organizer.post("/api/organizer/events", eventInput())).body.event;

    const res = await organizer.patch(`/api/organizer/events/${id}`, { timezone: "Europe/Moscow" });

    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({
      startsAt: "2026-11-20T12:00:00.000Z",
      startsLocal: "2026-11-20T15:00", // тот же момент в Москве (UTC+3)
      timezone: "Europe/Moscow",
    });
  });
});
