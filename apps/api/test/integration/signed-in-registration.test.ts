import { describe, expect, it } from "vitest";
import { confirmCode, createEvent, participant, receiveCode, signInParticipant } from "../support/participant.ts";
import { testApp } from "../support/test-app.ts";

const data = (overrides: Record<string, unknown> = {}) => {
  const { email: _email, ...rest } = participant(overrides);
  return rest;
};
const registerSignedIn = (browser: Awaited<ReturnType<typeof signInParticipant>>, eventId: string, body: unknown = data()) =>
  browser.post(`/api/events/${eventId}/registrations`, body);

describe("POST /events/:id/registrations: регистрация без кода под сессией участника (D-058)", () => {
  it("вошедший участник получает место без кода; письмо confirmed уходит, email из сессии", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 5 });
    const browser = await signInParticipant(t, "anna@example.com");

    // Чужой email в теле схемой не читается: адрес берётся только из сессии.
    const res = await registerSignedIn(browser, eventId, { ...data(), email: "evil@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: "confirmed", status: "confirmed", token: expect.any(String) });
    expect(res.body.waitlistPosition).toBeUndefined();
    const page = (await t.client().get(`/api/registrations/${res.body.token}`)).body;
    expect(page).toMatchObject({ email: "anna@example.com", firstName: "Анна", status: "confirmed", ticketCode: expect.any(String) });

    await t.runJobs(t.clock.now());
    const letters = t.mailbox.ofKind("confirmed");
    expect(letters).toHaveLength(1);
    expect(letters[0]!.to).toBe("anna@example.com");
    expect(t.mailbox.ofKind("confirmed", "evil@example.com")).toHaveLength(0);
  });

  it("мест нет → waitlisted с номером; повтор → existing с тем же token, писем нет", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 1 });
    await registerSignedIn(await signInParticipant(t, "first@example.com"), eventId);
    const browser = await signInParticipant(t, "anna@example.com");

    const waiting = await registerSignedIn(browser, eventId);

    expect(waiting.status).toBe(200);
    expect(waiting.body).toMatchObject({ result: "waitlisted", status: "waitlisted", waitlistPosition: 1 });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("waitlisted", "anna@example.com")).toHaveLength(1);

    const before = t.mailbox.ofKind("waitlisted").length + t.mailbox.ofKind("confirmed").length;
    const again = await registerSignedIn(browser, eventId, data({ firstName: "Другая" }));

    expect(again.status).toBe(200);
    expect(again.body).toEqual({ result: "existing", token: waiting.body.token, status: "waitlisted", waitlistPosition: 1 });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("waitlisted").length + t.mailbox.ofKind("confirmed").length).toBe(before);
    // Данные формы повтора не применяются (D-007).
    expect((await t.client().get(`/api/registrations/${waiting.body.token}`)).body.firstName).toBe("Анна");
  });

  it("младше minAge → 422 below_min_age {minAge: 18}; после начала → 409 registration_closed; без сессии → 401", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { minAge: 18 });
    const browser = await signInParticipant(t);

    const young = await registerSignedIn(browser, eventId, data({ birthDate: "2015-01-01" }));
    expect(young.status).toBe(422);
    expect(young.body).toEqual({ error: "below_min_age", minAge: 18 });

    const future = await registerSignedIn(browser, eventId, data({ birthDate: "2999-01-01" }));
    expect(future.status).toBe(400);
    expect(future.body).toMatchObject({ error: "validation_failed", issues: [{ path: "birthDate", message: "in_future" }] });

    const invalid = await registerSignedIn(browser, eventId, { firstName: "", lastName: "И", birthDate: "1994-03-14" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("validation_failed");

    const guest = await registerSignedIn(t.client(), eventId);
    expect(guest.status).toBe(401);
    expect(guest.body).toEqual({ error: "unauthorized" });

    expect((await registerSignedIn(browser, "00000000-0000-4000-8000-000000000000")).status).toBe(404);

    t.clock.set("2026-11-20T12:00:00Z");
    const closed = await registerSignedIn(browser, eventId);
    expect(closed.status).toBe(409);
    expect(closed.body).toEqual({ error: "registration_closed" });
  });

  it("гонка: лимит 1, обычная регистрация по коду и регистрация без кода параллельно → ровно один confirmed", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 1 });
    const viaCode = await receiveCode(t, eventId, participant({ email: "bycode@example.com" }));
    const browser = await signInParticipant(t, "nocode@example.com");

    const [a, b] = await Promise.all([
      confirmCode(t.client(), viaCode.verificationId, viaCode.code),
      registerSignedIn(browser, eventId),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.result, b.body.result].sort()).toEqual(["confirmed", "waitlisted"]);
    expect([a, b].find((r) => r.body.result === "waitlisted")!.body.waitlistPosition).toBe(1);
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ confirmed: 1, limit: 1, waitlisted: 1 });
  });

  it("GET /events/:id: у вошедшего с регистрацией — myRegistration {token, status}; у гостя поля нет", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 5 });
    const browser = await signInParticipant(t);

    const before = (await browser.get(`/api/events/${eventId}`)).body;
    expect(before.myRegistration).toBeNull();

    const reg = (await registerSignedIn(browser, eventId)).body;
    const mine = (await browser.get(`/api/events/${eventId}`)).body;
    expect(mine.myRegistration).toEqual({ token: reg.token, status: "confirmed" });

    const guest = (await t.client().get(`/api/events/${eventId}`)).body;
    expect("myRegistration" in guest).toBe(false);

    // Отменённая регистрация не считается: снова null.
    await browser.post(`/api/registrations/${reg.token}/cancel`);
    expect((await browser.get(`/api/events/${eventId}`)).body.myRegistration).toBeNull();
    // Чужая регистрация другому участнику не видна.
    const other = await signInParticipant(t, "boris@example.com");
    expect((await other.get(`/api/events/${eventId}`)).body.myRegistration).toBeNull();
  });
});
