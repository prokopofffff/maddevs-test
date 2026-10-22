import { describe, expect, it } from "vitest";
import {
  confirmCode,
  confirmLogin,
  createEvent,
  participant,
  receiveCode,
  receiveLoginCode,
  register,
  requestLoginCode,
  signInParticipant,
} from "../support/participant.ts";
import { signInSupport } from "../support/support.ts";
import { testApp, type TestApp } from "../support/test-app.ts";

const later = (t: TestApp, ms: number) => t.clock.set(new Date(t.clock.now().getTime() + ms));
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("вход участника по коду на email (D-057)", () => {
  it("код уходит на email без регистраций; после кода cookie psid и /participant/me → {email, lastData: null}", async () => {
    const t = testApp();
    const browser = t.client();

    const issued = await requestLoginCode(browser, " Anna@Example.COM ");
    expect(issued.status).toBe(201);
    expect(issued.body).toEqual({
      verificationId: expect.any(Number),
      expiresAt: "2026-11-01T09:10:00.000Z",
      resendAfter: "2026-11-01T09:01:00.000Z",
    });
    await t.runJobs(t.clock.now());
    const code = t.mailbox.lastCode("anna@example.com", "login_code");

    const confirmed = await confirmLogin(browser, issued.body.verificationId, code);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({ email: "anna@example.com" });
    const cookie = confirmed.headers.getSetCookie().find((l) => l.startsWith("psid="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=2592000/i);

    const me = await browser.get("/api/participant/me");
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ email: "anna@example.com", lastData: null });
  });

  it("без сессии /participant/me → 401", async () => {
    const res = await testApp().client().get("/api/participant/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("lastData — из последней регистрации этого email", async () => {
    const t = testApp();
    const first = await createEvent(t);
    const second = await createEvent(t);
    await register(t, first.eventId, participant({ firstName: "Анна", lastName: "Иванова", birthDate: "1994-03-14" }));
    later(t, 60_000);
    await register(t, second.eventId, participant({ firstName: "Анна-Мария", lastName: "Петрова", birthDate: "1994-03-15" }));
    // Чужая регистрация позже по времени не должна попасть в данные Анны.
    later(t, 60_000);
    await register(t, first.eventId, participant({ email: "boris@example.com", firstName: "Борис" }));
    later(t, 60_000);

    const browser = await signInParticipant(t);
    const me = await browser.get("/api/participant/me");

    expect(me.body).toEqual({
      email: "anna@example.com",
      lastData: { firstName: "Анна-Мария", lastName: "Петрова", birthDate: "1994-03-15" },
    });
  });

  it("повтор раньше минуты → 429 code_resend_too_soon {retryAfter}; через минуту — новый код гасит прежний", async () => {
    const t = testApp();
    const first = await receiveLoginCode(t);

    later(t, 20_000);
    const early = await requestLoginCode(t.client());
    expect(early.status).toBe(429);
    expect(early.body).toEqual({ error: "code_resend_too_soon", retryAfter: 40 });
    expect(early.headers.get("Retry-After")).toBe("40");

    later(t, 40_000);
    const second = await receiveLoginCode(t);
    const stale = await confirmLogin(t.client(), first.verificationId, first.code);
    expect(stale.status).toBe(410);
    expect(stale.body).toEqual({ error: "code_expired" });
    expect((await confirmLogin(t.client(), second.verificationId, second.code)).status).toBe(200);
  });

  it("минута считается по email: другой email можно просить сразу, регистрационный код не мешает", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    await receiveCode(t, eventId);

    expect((await requestLoginCode(t.client(), "anna@example.com")).status).toBe(201);
    expect((await requestLoginCode(t.client(), "boris@example.com")).status).toBe(201);
  });

  it("пять неверных кодов → code_attempts_exceeded; истёкший через 10 минут → 410 code_expired", async () => {
    const t = testApp();
    const { verificationId, code } = await receiveLoginCode(t);
    const client = t.client();

    const first = await confirmLogin(client, verificationId, wrong(code));
    expect(first.status).toBe(400);
    expect(first.body).toEqual({ error: "code_invalid", attemptsLeft: 4 });
    for (let i = 0; i < 4; i++) await confirmLogin(client, verificationId, wrong(code));
    const blocked = await confirmLogin(client, verificationId, code);
    expect(blocked.status).toBe(410);
    expect(blocked.body).toEqual({ error: "code_attempts_exceeded" });
    expect((await client.get("/api/participant/me")).status).toBe(401);

    later(t, 60_000);
    const fresh = await receiveLoginCode(t);
    later(t, 10 * 60_000);
    const expired = await confirmLogin(t.client(), fresh.verificationId, fresh.code);
    expect(expired.status).toBe(410);
    expect(expired.body).toEqual({ error: "code_expired" });
  });

  it("повтор верного кода в пределах жизни даёт 200 и новую сессию, как у lookup (D-048)", async () => {
    const t = testApp();
    const { verificationId, code } = await receiveLoginCode(t);

    const one = t.client();
    const two = t.client();
    expect((await confirmLogin(one, verificationId, code)).status).toBe(200);
    expect((await confirmLogin(two, verificationId, code)).body).toEqual({ email: "anna@example.com" });
    expect((await one.get("/api/participant/me")).status).toBe(200);
    expect((await two.get("/api/participant/me")).status).toBe(200);
  });

  it("код login на /api/verifications/:id/confirm → 404; код register на /participant/verifications/:id/confirm → 404", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const login = await receiveLoginCode(t);
    const reg = await receiveCode(t, eventId);

    const viaOld = t.client();
    const loginOnOld = await confirmCode(viaOld, login.verificationId, login.code);
    expect(loginOnOld.status).toBe(404);
    expect(loginOnOld.body).toEqual({ error: "not_found" });
    expect(loginOnOld.headers.getSetCookie()).toEqual([]);

    const viaNew = t.client();
    const regOnNew = await confirmLogin(viaNew, reg.verificationId, reg.code);
    expect(regOnNew.status).toBe(404);
    expect(regOnNew.body).toEqual({ error: "not_found" });
    expect((await viaNew.get("/api/participant/me")).status).toBe(401);

    // Оба кода остались нетронутыми: свои маршруты их принимают.
    expect((await confirmLogin(t.client(), login.verificationId, login.code)).status).toBe(200);
    expect((await confirmCode(t.client(), reg.verificationId, reg.code)).status).toBe(200);
  });

  it("неверный код на чужом маршруте тоже 404 и не тратит попытки", async () => {
    const t = testApp();
    const login = await receiveLoginCode(t);

    for (let i = 0; i < 6; i++) await confirmCode(t.client(), login.verificationId, wrong(login.code));

    expect((await confirmLogin(t.client(), login.verificationId, login.code)).status).toBe(200);
  });

  it("logout удаляет сессию: /participant/me → 401", async () => {
    const t = testApp();
    const browser = await signInParticipant(t);
    expect((await browser.get("/api/participant/me")).status).toBe(200);

    const out = await browser.post("/api/participant/logout");
    expect(out.status).toBe(204);

    expect((await browser.get("/api/participant/me")).status).toBe(401);
  });

  it("истёкшая сессия (30 дней) не принимается", async () => {
    const t = testApp();
    const browser = await signInParticipant(t);

    later(t, 30 * 24 * 60 * 60 * 1000 + 1000);

    expect((await browser.get("/api/participant/me")).status).toBe(401);
  });

  it("сессия участника не открывает /organizer/events и /support/corrections (401)", async () => {
    const t = testApp();
    const browser = await signInParticipant(t);

    expect((await browser.get("/api/organizer/events")).status).toBe(401);
    expect((await browser.get("/api/support/corrections")).status).toBe(401);
    expect((await browser.get("/api/auth/me")).status).toBe(401);
  });

  it("сессия организатора не открывает /participant/me; обе сессии живут независимо", async () => {
    const t = testApp();
    const { organizer } = await createEvent(t);
    expect((await organizer.get("/api/participant/me")).status).toBe(401);

    // Тот же браузер: организатор входит ещё и как участник, выход из одной сессии не трогает другую.
    const { verificationId, code } = await receiveLoginCode(t, "anna@example.com", organizer);
    await confirmLogin(organizer, verificationId, code);
    expect((await organizer.get("/api/participant/me")).status).toBe(200);
    expect((await organizer.get("/api/organizer/events")).status).toBe(200);
    await organizer.post("/api/participant/logout");
    expect((await organizer.get("/api/participant/me")).status).toBe(401);
    expect((await organizer.get("/api/organizer/events")).status).toBe(200);
  });

  it("поддержка тоже не получает доступ к /participant/me по сессии sid", async () => {
    const t = testApp();
    const support = await signInSupport(t);
    expect((await support.get("/api/participant/me")).status).toBe(401);
  });

  it("письмо login_code: тема «Код для входа: NNNNNN», в тексте «10 минут»", async () => {
    const t = testApp();
    const { code } = await receiveLoginCode(t);

    const [letter] = t.mailbox.ofKind("login_code", "anna@example.com");
    expect(letter!.subject).toBe(`Код для входа: ${code}`);
    expect(letter!.text).toContain("10 минут");
    expect(letter!.html).toContain(code);
    expect(letter!.html).toContain("Вход в «Мои регистрации»");
  });

  it("мусорный id и тело → 404 и 400", async () => {
    const t = testApp();
    expect((await confirmLogin(t.client(), 0, "123456")).status).toBe(404);
    expect((await t.client().post("/api/participant/verifications/abc/confirm", { code: "123456" })).status).toBe(404);
    expect((await t.client().post("/api/participant/verifications", { email: "не email" })).status).toBe(400);
  });
});
