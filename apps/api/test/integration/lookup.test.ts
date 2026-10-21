import { describe, expect, it } from "vitest";
import { confirmCode, createEvent, participant, receiveLookupCode, register, requestCode } from "../support/participant.ts";
import { testApp } from "../support/test-app.ts";

describe("вход в свою регистрацию по email и коду", () => {
  it("верный код открывает неотменённую регистрацию этого email", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    const { token } = (await register(t, eventId)).body;
    t.clock.set(new Date(t.clock.now().getTime() + 60_000));

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
});
