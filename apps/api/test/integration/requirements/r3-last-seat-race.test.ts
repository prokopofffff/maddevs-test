import { describe, expect, it } from "vitest";
import { confirmCode, createEvent, participant, receiveCode, register } from "../../support/participant.ts";
import { testApp } from "../../support/test-app.ts";

describe("R3 — гонка за последнее место", () => {
  it("R3: распределение места берёт строку события запросом с FOR UPDATE", async () => {
    const queries: string[] = [];
    const t = testApp({ queries });
    const { eventId } = await createEvent(t, { limit: 5 });

    const res = await register(t, eventId);

    expect(res.status).toBe(200);
    expect(queries).toContainEqual(
      expect.stringMatching(/^select .* from "events" where "events"\."id" = \$1 for update$/),
    );
  });

  it("R3: 10 одновременных подтверждений на последнее место — подтверждён ровно один, 9 в листе ожидания с позициями 1…9", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 5 });
    for (let i = 1; i <= 4; i++) {
      const res = await register(t, eventId, participant({ email: `early${i}@example.com` }));
      expect(res.body.result).toBe("confirmed");
    }
    const codes = [];
    for (let i = 1; i <= 10; i++) {
      codes.push(await receiveCode(t, eventId, participant({ email: `racer${i}@example.com` })));
    }

    // Каждый ввод кода — свой клиент и своё соединение пула; транзакции коммитятся по-настоящему.
    const answers = await Promise.all(
      codes.map(({ verificationId, code }) => confirmCode(t.client(), verificationId, code)),
    );

    expect(answers.map((a) => a.status)).toEqual(Array(10).fill(200));
    const winners = answers.filter((a) => a.body.result === "confirmed");
    const waiting = answers.filter((a) => a.body.result === "waitlisted");
    expect(winners).toHaveLength(1);
    expect(waiting).toHaveLength(9);
    expect(winners[0]!.body.status).toBe("confirmed");
    expect(waiting.map((a) => a.body.status)).toEqual(Array(9).fill("waitlisted"));
    expect(waiting.map((a) => a.body.waitlistPosition).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const event = (await organizer.get(`/api/organizer/events/${eventId}`)).body;
    expect(event.counts).toMatchObject({ confirmed: 5, limit: 5, waitlisted: 9 });
    expect(event.registrationCount).toBe(14);

    // Личная ссылка каждого из листа показывает его номер; у победителя — билет.
    const pages = await Promise.all(answers.map((a) => t.client().get(`/api/registrations/${a.body.token}`)));
    const winnerPage = pages[answers.indexOf(winners[0]!)]!.body;
    expect(winnerPage).toMatchObject({ status: "confirmed", ticketCode: expect.any(String) });
    expect(winnerPage.waitlistPosition).toBeUndefined();
    const positions = new Map<string, number>();
    for (const [i, answer] of answers.entries()) {
      if (answer.body.result !== "waitlisted") continue;
      const page = pages[i]!.body;
      expect(page).toMatchObject({
        status: "waitlisted",
        ticketCode: null,
        waitlistPosition: answer.body.waitlistPosition,
      });
      positions.set(page.email, page.waitlistPosition);
    }
    expect([...positions.values()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Новое письмо о месте одно, о листе ожидания — девять, каждое со своим номером.
    await t.runJobs(t.clock.now());
    const confirmedLetters = t.mailbox.ofKind("confirmed").filter((m) => m.to.startsWith("racer"));
    expect(confirmedLetters).toHaveLength(1);
    expect(confirmedLetters[0]!.to).toBe(winnerPage.email);
    const waitlistedLetters = t.mailbox.ofKind("waitlisted");
    expect(waitlistedLetters).toHaveLength(9);
    for (const letter of waitlistedLetters) {
      const position = positions.get(letter.to);
      expect(position).toBeDefined();
      for (const body of [letter.text, letter.html]) expect(body).toContain(`№${position}`);
    }
  });

  it("R3: пока лист ожидания не пуст, страница события показывает ноль свободных мест", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 1 });
    await register(t, eventId, participant({ email: "first@example.com" }));
    expect((await t.client().get(`/api/events/${eventId}`)).body.freeSeats).toBe(0);

    const second = await register(t, eventId, participant({ email: "second@example.com" }));

    expect(second.body).toMatchObject({ result: "waitlisted", status: "waitlisted", waitlistPosition: 1 });
    expect((await t.client().get(`/api/events/${eventId}`)).body.freeSeats).toBe(0);
  });
});
