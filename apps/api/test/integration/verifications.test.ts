import { describe, expect, it } from "vitest";
import { confirmCode, createEvent, participant, receiveCode, register, requestCode } from "../support/participant.ts";
import { testApp, type TestApp } from "../support/test-app.ts";

const later = (t: TestApp, ms: number) => t.clock.set(new Date(t.clock.now().getTime() + ms));
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("коды подтверждения", () => {
  it("выдача кода отвечает сроком и временем повтора, письмо с кодом и названием события уходит в транспорт", async () => {
    const t = testApp({ now: "2026-11-01T09:00:00Z" });
    const { eventId } = await createEvent(t);

    const res = await requestCode(t.client(), eventId, participant({ email: " Anna@Example.COM " }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      verificationId: expect.any(Number),
      expiresAt: "2026-11-01T09:10:00.000Z",
      resendAfter: "2026-11-01T09:01:00.000Z",
    });
    await t.runJobs(t.clock.now());
    const [letter] = t.mailbox.ofKind("code");
    expect(letter!.to).toBe("anna@example.com");
    expect(letter!.text).toMatch(/\b\d{6}\b/);
    expect(letter!.text).toContain("Митап про Postgres");
    expect(letter!.text).toContain("10 минут");
  });

  it("неверный код уменьшает число попыток, шестая попытка — code_attempts_exceeded даже с верным кодом", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const { verificationId, code } = await receiveCode(t, eventId);

    for (const attemptsLeft of [4, 3, 2, 1, 0]) {
      const res = await confirmCode(t.client(), verificationId, wrong(code));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "code_invalid", attemptsLeft });
    }
    const sixth = await confirmCode(t.client(), verificationId, code);
    expect(sixth.status).toBe(410);
    expect(sixth.body).toEqual({ error: "code_attempts_exceeded" });
  });

  it("через 10 минут код истёк", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const { verificationId, code } = await receiveCode(t, eventId);

    later(t, 10 * 60_000);
    const res = await confirmCode(t.client(), verificationId, code);

    expect(res.status).toBe(410);
    expect(res.body).toEqual({ error: "code_expired" });
  });

  it("повтор раньше минуты — 429 с таймером; через минуту новый код, прежний погашен", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const first = await receiveCode(t, eventId);

    later(t, 45_000);
    const early = await requestCode(t.client(), eventId);
    expect(early.status).toBe(429);
    expect(early.body).toEqual({ error: "code_resend_too_soon", retryAfter: 15 });
    expect(early.headers.get("retry-after")).toBe("15");

    later(t, 15_000);
    const second = await receiveCode(t, eventId);
    expect(second.verificationId).not.toBe(first.verificationId);
    expect(t.mailbox.ofKind("code")).toHaveLength(2);
    expect((await confirmCode(t.client(), first.verificationId, first.code)).body).toEqual({ error: "code_expired" });
    expect((await confirmCode(t.client(), second.verificationId, second.code)).body.result).toBe("confirmed");
  });

  it("младше минимального возраста на день события — 422 до отправки кода", async () => {
    const t = testApp();
    // 20 ноября 2026 в Новосибирске; 18 лет исполняется 21 ноября.
    const { eventId } = await createEvent(t, { minAge: 18 });

    const res = await requestCode(t.client(), eventId, participant({ birthDate: "2008-11-21" }));

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "below_min_age", minAge: 18 });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.sent).toEqual([]);
  });

  it("возраст считается по дате начала в поясе события: день рождения в день события проходит", async () => {
    const t = testApp();
    // 20 ноября 2026, 01:00 в Новосибирске — в UTC это ещё 19 ноября.
    const { eventId } = await createEvent(t, { minAge: 18, startsLocal: "2026-11-20T01:00" });

    const res = await requestCode(t.client(), eventId, participant({ birthDate: "2008-11-20" }));

    expect(res.status).toBe(201);
  });

  it("дата рождения в будущем и кривые данные формы — 400 validation_failed", async () => {
    const t = testApp({ now: "2026-11-01T09:00:00Z" });
    const { eventId } = await createEvent(t);

    const future = await requestCode(t.client(), eventId, participant({ birthDate: "2026-11-02" }));
    expect(future.status).toBe(400);
    expect(future.body).toEqual({ error: "validation_failed", issues: [{ path: "birthDate", message: "in_future" }] });

    const broken = await requestCode(
      t.client(),
      eventId,
      participant({ email: "not-an-email", firstName: " ", birthDate: "2001-02-30" }),
    );
    expect(broken.status).toBe(400);
    expect(broken.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(["birthDate", "email", "firstName"]);
  });

  it("несуществующее событие и несуществующий код — 404", async () => {
    const t = testApp();

    expect((await requestCode(t.client(), "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await confirmCode(t.client(), 999, "123456")).status).toBe(404);
    expect((await t.client().get("/api/registrations/nope")).status).toBe(404);
    expect((await t.client().get(`/api/registrations/${"a".repeat(43)}`)).status).toBe(404);
  });
});

describe("регистрация после начала события", () => {
  it("после начала код не выдаётся — registration_closed", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);

    t.clock.set("2026-11-20T12:00:00Z");
    const res = await requestCode(t.client(), eventId);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "registration_closed" });
  });

  it("код, запрошенный до начала и введённый после, места не даёт", async () => {
    const t = testApp({ now: "2026-11-20T11:55:00Z" });
    const { eventId, organizer } = await createEvent(t, { startsLocal: "2026-11-20T19:00" });
    const { verificationId, code } = await receiveCode(t, eventId);

    t.clock.set("2026-11-20T12:00:00Z");
    const res = await confirmCode(t.client(), verificationId, code);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "registration_closed" });
    expect((await organizer.get(`/api/organizer/events/${eventId}`)).body.registrationCount).toBe(0);
  });
});

describe("лист ожидания", () => {
  it("повтор регистрации из листа ожидания — existing с текущим номером, нового письма нет", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 1 });
    await register(t, eventId);
    await register(t, eventId, participant({ email: "boris@example.com" }));
    const first = await register(t, eventId, participant({ email: "vera@example.com" }));
    expect(first.body).toMatchObject({ result: "waitlisted", waitlistPosition: 2 });
    await t.runJobs(t.clock.now());
    t.clock.set(new Date(t.clock.now().getTime() + 5 * 60_000));

    const again = await register(t, eventId, participant({ email: " Vera@Example.com ", firstName: "Вера" }));

    expect(again.body).toEqual({
      result: "existing",
      status: "waitlisted",
      token: first.body.token,
      waitlistPosition: 2,
    });
    await t.runJobs(t.clock.now());
    expect(t.mailbox.ofKind("waitlisted", "vera@example.com")).toHaveLength(1);
  });
});

describe("личная ссылка", () => {
  it("открывает регистрацию с событием, данными участника и кодом билета", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 10 });
    const { token } = (await register(t, eventId)).body;

    const res = await t.client().get(`/api/registrations/${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      event: {
        id: eventId,
        title: "Митап про Postgres",
        startsAt: "2026-11-20T12:00:00.000Z",
        timezone: "Asia/Novosibirsk",
        started: false,
      },
      status: "confirmed",
      email: "anna@example.com",
      firstName: "Анна",
      lastName: "Иванова",
      birthDate: "1994-03-14",
      ticketCode: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{8}$/),
      checkedInAt: null,
      cancelledAt: null,
    });
  });

  it("письмо о месте показывает время в поясе события с подписью смещения", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    await register(t, eventId);
    await t.runJobs(t.clock.now());

    const [letter] = t.mailbox.ofKind("confirmed");

    expect(letter!.subject).toBe("Ваш билет: Митап про Postgres");
    expect(letter!.text).toContain("20 ноября 2026, 19:00 (UTC+7)");
    expect(letter!.html).toContain("20 ноября 2026, 19:00 (UTC+7)");
  });
});
