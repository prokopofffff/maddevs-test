import { describe, expect, it } from "vitest";
import { eventInput, signUpOrganizer } from "../support/organizer.ts";
import { cancel, createEvent, register } from "../support/participant.ts";
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

  it("те же дата и лимит, что сейчас, — не перенос и не изменение лимита", async () => {
    const organizer = await signUpOrganizer(testApp().client());
    const { id } = (await organizer.post("/api/organizer/events", eventInput())).body.event;

    // Форма прислала пояс вместе с пересчитанным временем: момент тот же.
    const res = await organizer.patch(`/api/organizer/events/${id}`, {
      startsLocal: "2026-11-20T15:00",
      timezone: "Europe/Moscow",
      limit: 50,
    });

    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({ startsAt: "2026-11-20T12:00:00.000Z", timezone: "Europe/Moscow", limit: 50 });
  });

  it("событие без регистраций удаляется", async () => {
    const organizer = await signUpOrganizer(testApp().client());
    const { id } = (await organizer.post("/api/organizer/events", eventInput())).body.event;

    const res = await organizer.delete(`/api/organizer/events/${id}`);

    expect(res.status).toBe(204);
    expect((await organizer.get(`/api/organizer/events/${id}`)).status).toBe(404);
    expect((await organizer.get("/api/organizer/events")).body.events).toEqual([]);
  });

  it("событие с регистрацией не удаляется — 409 event_has_registrations", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    await register(t, eventId);

    const res = await organizer.delete(`/api/organizer/events/${eventId}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "event_has_registrations" });
    expect((await organizer.get(`/api/organizer/events/${eventId}`)).body.registrationCount).toBe(1);
  });

  it("отменённая регистрация тоже не даёт удалить событие", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    const { token } = (await register(t, eventId)).body;
    expect((await cancel(t.client(), token)).status).toBe(200);

    const res = await organizer.delete(`/api/organizer/events/${eventId}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "event_has_registrations" });
  });

  it("чужое событие — 404 на правку и удаление, событие не меняется", async () => {
    const { client } = testApp();
    const anna = await signUpOrganizer(client());
    const boris = await signUpOrganizer(client());
    const { id } = (await anna.post("/api/organizer/events", eventInput())).body.event;

    const patched = await boris.patch(`/api/organizer/events/${id}`, { title: "Чужое" });
    const deleted = await boris.delete(`/api/organizer/events/${id}`);

    for (const res of [patched, deleted]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "not_found" });
    }
    expect((await anna.get(`/api/organizer/events/${id}`)).body.event.title).toBe("Митап про Postgres");
    expect((await boris.patch("/api/organizer/events/not-a-uuid", { title: "x" })).status).toBe(404);
    expect((await boris.delete("/api/organizer/events/not-a-uuid")).status).toBe(404);
  });
});
