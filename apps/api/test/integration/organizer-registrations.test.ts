import { describe, expect, it } from "vitest";
import { cancel, createEvent, participant, register } from "../support/participant.ts";
import { signUpOrganizer } from "../support/organizer.ts";
import { testApp } from "../support/test-app.ts";

const registrationsOf = (organizer: { get: (path: string) => Promise<{ status: number; body: any }> }, eventId: string) =>
  organizer.get(`/api/organizer/events/${eventId}/registrations`);

describe("список участников организатора", () => {
  it("подтверждённый и ожидающий — с возрастом на день события и номером в листе", async () => {
    const t = testApp({ now: "2026-11-01T09:00:00Z" });
    // 19:00 20 ноября 2026 в Новосибирске.
    const { eventId, organizer } = await createEvent(t, { limit: 1 });
    await register(t, eventId, participant({ email: "anna@example.com" }));
    t.clock.set("2026-11-01T09:05:00Z");
    await register(
      t,
      eventId,
      participant({ email: "boris@example.com", firstName: "Борис", lastName: "Петров", birthDate: "2000-11-21" }),
    );

    const res = await registrationsOf(organizer, eventId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      registrations: [
        {
          id: expect.any(Number),
          firstName: "Анна",
          lastName: "Иванова",
          email: "anna@example.com",
          birthDate: "1994-03-14",
          ageOnEventDay: 32,
          belowMinAge: false,
          status: "confirmed",
          waitlistPosition: null,
          confirmedAt: "2026-11-01T09:00:00.000Z",
          checkedInAt: null,
        },
        {
          id: expect.any(Number),
          firstName: "Борис",
          lastName: "Петров",
          email: "boris@example.com",
          birthDate: "2000-11-21",
          // День рождения на следующий день после события — ещё 25.
          ageOnEventDay: 25,
          belowMinAge: false,
          status: "waitlisted",
          waitlistPosition: 1,
          confirmedAt: null,
          checkedInAt: null,
        },
      ],
    });
  });

  it("порядок: подтверждённые, лист ожидания по номеру, отменённые по времени отказа", async () => {
    const t = testApp({ now: "2026-11-01T09:00:00Z" });
    const { eventId, organizer } = await createEvent(t, { limit: 1 });
    const tokens: Record<string, string> = {};
    for (const [minute, email] of [[0, "a"], [1, "b"], [2, "c"], [3, "d"]] as const) {
      t.clock.set(`2026-11-01T09:0${minute}:00Z`);
      tokens[email] = (await register(t, eventId, participant({ email: `${email}@example.com` }))).body.token;
    }
    t.clock.set("2026-11-01T09:04:00Z");
    await cancel(t.client(), tokens.d!);
    // Отказ подтверждённой A повышает B.
    t.clock.set("2026-11-01T09:05:00Z");
    await cancel(t.client(), tokens.a!);

    const res = await registrationsOf(organizer, eventId);

    expect(
      res.body.registrations.map((r: { email: string; status: string; waitlistPosition: number | null }) => [
        r.email,
        r.status,
        r.waitlistPosition,
      ]),
    ).toEqual([
      ["b@example.com", "confirmed", null],
      ["c@example.com", "waitlisted", 1],
      ["d@example.com", "cancelled", null],
      ["a@example.com", "cancelled", null],
    ]);
    expect(res.body.registrations[0].confirmedAt).toBe("2026-11-01T09:05:00.000Z");
  });

  it("минимальный возраст подняли после регистрации — младшие помечены, ровесник границы нет", async () => {
    const t = testApp({ now: "2026-11-01T09:00:00Z" });
    const { eventId, organizer } = await createEvent(t);
    await register(t, eventId, participant({ email: "a@example.com", birthDate: "2008-11-20" }));
    await register(t, eventId, participant({ email: "b@example.com", birthDate: "2008-11-21" }));

    expect((await organizer.patch(`/api/organizer/events/${eventId}`, { minAge: 18 })).status).toBe(200);
    const res = await registrationsOf(organizer, eventId);

    expect(
      res.body.registrations.map((r: { email: string; ageOnEventDay: number; belowMinAge: boolean }) => [
        r.email,
        r.ageOnEventDay,
        r.belowMinAge,
      ]),
    ).toEqual([
      ["a@example.com", 18, false],
      ["b@example.com", 17, true],
    ]);
  });

  it("чужое и несуществующее событие — 404", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const boris = await signUpOrganizer(t.client());

    expect(await registrationsOf(boris, eventId)).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect((await registrationsOf(boris, "not-a-uuid")).status).toBe(404);
  });
});
