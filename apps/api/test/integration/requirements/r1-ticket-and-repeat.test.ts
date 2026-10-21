import { describe, expect, it } from "vitest";
import { confirmCode, createEvent, participant, receiveCode, register } from "../../support/participant.ts";
import { PUBLIC_URL, testApp } from "../../support/test-app.ts";

const TICKET = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const shown = (ticketCode: string) => `${ticketCode.slice(0, 4)}-${ticketCode.slice(4)}`;

describe("R1 — письмо с билетом и повторная регистрация", () => {
  it("R1: после верного кода место подтверждено, письмо с кодом билета и личной ссылкой уходит шагом фоновых циклов", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 10 });

    const res = await register(t, eventId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: "confirmed", status: "confirmed", token: expect.any(String) });
    const registration = await t.client().get(`/api/registrations/${res.body.token}`);
    expect(registration.status).toBe(200);
    expect(registration.body).toMatchObject({
      status: "confirmed",
      firstName: "Анна",
      lastName: "Иванова",
      birthDate: "1994-03-14",
      ticketCode: expect.stringMatching(TICKET),
    });

    // Письмо стоит в outbox, но уходит только шагом фоновых циклов.
    expect(t.mailbox.ofKind("confirmed")).toEqual([]);
    await t.runJobs(t.clock.now());
    const letters = t.mailbox.ofKind("confirmed");
    expect(letters).toHaveLength(1);
    expect(letters[0]!.to).toBe("anna@example.com");
    for (const body of [letters[0]!.text, letters[0]!.html]) {
      expect(body).toContain(shown(registration.body.ticketCode));
      expect(body).toContain(`${PUBLIC_URL}/r/${res.body.token}`);
    }

    // Отправленное письмо помечено: следующий шаг его не повторяет.
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("confirmed")).toHaveLength(1);
  });

  it("R1: повторная регистрация того же email показывает существующую и второго места не создаёт", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 10 });
    const first = await register(t, eventId);
    await t.runJobs(t.clock.now());
    t.clock.set(new Date(t.clock.now().getTime() + 5 * 60_000));

    const again = await register(
      t,
      eventId,
      participant({ email: " Anna@Example.com ", firstName: "Аня", lastName: "Петрова", birthDate: "1990-01-01" }),
    );

    expect(again.status).toBe(200);
    expect(again.body).toEqual({ result: "existing", status: "confirmed", token: first.body.token });
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ confirmed: 1, waitlisted: 0 });
    expect(event.registrationCount).toBe(1);
    const registration = (await t.client().get(`/api/registrations/${first.body.token}`)).body;
    expect(registration).toMatchObject({ firstName: "Анна", lastName: "Иванова", birthDate: "1994-03-14" });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("confirmed")).toHaveLength(1);
  });

  it("R1: два параллельных подтверждения одного email дают одну регистрацию, второй ответ — existing", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 10 });
    const { verificationId, code } = await receiveCode(t, eventId);

    const answers = await Promise.all([
      confirmCode(t.client(), verificationId, code),
      confirmCode(t.client(), verificationId, code),
    ]);

    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(answers.map((a) => a.body.result).sort()).toEqual(["confirmed", "existing"]);
    expect(answers[0]!.body.token).toBe(answers[1]!.body.token);
    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ confirmed: 1, waitlisted: 0 });
    expect(event.registrationCount).toBe(1);
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("confirmed")).toHaveLength(1);
  });
});
