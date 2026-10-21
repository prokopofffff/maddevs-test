import { describe, expect, it } from "vitest";
import {
  confirmCode,
  createEvent,
  participant,
  receiveLookupCode,
  register,
  requestCode,
  requestLookup,
} from "../support/participant.ts";
import { testApp, type TestApp } from "../support/test-app.ts";

const later = (t: TestApp, ms: number) => t.clock.set(new Date(t.clock.now().getTime() + ms));
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("вход в свою регистрацию по email и коду", () => {
  it("верный код открывает неотменённую регистрацию этого email", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const { token } = (await register(t, eventId)).body;
    later(t, 60_000);

    const { verificationId, code } = await receiveLookupCode(t, eventId, " Anna@Example.COM ");
    const res = await confirmCode(t.client(), verificationId, code);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: "found", token });
    expect((await t.client().get(`/api/registrations/${token}`)).body.status).toBe("confirmed");
  });

  it("регистрации на этот email нет — код всё равно уходит, после кода registration_not_found", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    await register(t, eventId);

    const { verificationId, code } = await receiveLookupCode(t, eventId, "boris@example.com");
    const res = await confirmCode(t.client(), verificationId, code);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "registration_not_found" });
  });

  it("после начала события вход открыт, а новая регистрация — нет", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const { token } = (await register(t, eventId)).body;

    t.clock.set("2026-11-20T12:30:00Z");
    const { verificationId, code } = await receiveLookupCode(t, eventId);
    const found = await confirmCode(t.client(), verificationId, code);
    const registration = await t.client().get(`/api/registrations/${token}`);
    const newcomer = await requestCode(t.client(), eventId, participant({ email: "boris@example.com" }));

    expect(found.body).toEqual({ result: "found", token });
    expect(registration.body.event.started).toBe(true);
    expect(registration.body.ticketCode).toEqual(expect.any(String));
    expect(newcomer.status).toBe(409);
    expect(newcomer.body).toEqual({ error: "registration_closed" });
  });

  it("те же правила кода: повтор не чаще раза в минуту, новый код гасит прежний, срок 10 минут", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    await register(t, eventId);
    later(t, 60_000);
    const first = await receiveLookupCode(t, eventId);

    later(t, 30_000);
    const early = await requestLookup(t.client(), eventId);
    expect(early.status).toBe(429);
    expect(early.body).toEqual({ error: "code_resend_too_soon", retryAfter: 30 });

    later(t, 30_000);
    const second = await receiveLookupCode(t, eventId);
    expect((await confirmCode(t.client(), first.verificationId, first.code)).body).toEqual({ error: "code_expired" });

    later(t, 10 * 60_000);
    expect((await confirmCode(t.client(), second.verificationId, second.code)).body).toEqual({ error: "code_expired" });
  });

  it("те же правила кода: пять неверных попыток, шестая — code_attempts_exceeded даже с верным кодом", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    await register(t, eventId);
    later(t, 60_000);
    const { verificationId, code } = await receiveLookupCode(t, eventId);

    for (const attemptsLeft of [4, 3, 2, 1, 0]) {
      expect((await confirmCode(t.client(), verificationId, wrong(code))).body).toEqual({ error: "code_invalid", attemptsLeft });
    }
    const sixth = await confirmCode(t.client(), verificationId, code);

    expect(sixth.status).toBe(410);
    expect(sixth.body).toEqual({ error: "code_attempts_exceeded" });
  });

  it("повторный ввод того же кода (двойной клик, две вкладки) снова открывает регистрацию", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const { token } = (await register(t, eventId)).body;
    later(t, 60_000);
    const { verificationId, code } = await receiveLookupCode(t, eventId);

    const [a, b] = await Promise.all([
      confirmCode(t.client(), verificationId, code),
      confirmCode(t.client(), verificationId, code),
    ]);

    expect(a.body).toEqual({ result: "found", token });
    expect(b.body).toEqual({ result: "found", token });
  });
});
