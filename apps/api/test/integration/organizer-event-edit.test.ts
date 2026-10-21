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
});
