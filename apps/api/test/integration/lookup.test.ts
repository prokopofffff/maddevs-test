import { describe, expect, it } from "vitest";
import { confirmCode, createEvent, receiveLookupCode, register } from "../support/participant.ts";
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
});
