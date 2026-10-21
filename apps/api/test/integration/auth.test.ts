import { describe, expect, it } from "vitest";
import { testApp } from "../support/test-app.ts";

const credentials = { email: "Org@Example.com ", password: "correct horse" };

describe("вход организатора", () => {
  it("без сессии «кто я» отвечает 401", async () => {
    const res = await testApp().client().get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("signup открывает сессию организатора, logout её закрывает", async () => {
    const browser = testApp().client();

    const signup = await browser.post("/api/auth/signup", credentials);
    expect(signup.status).toBe(201);
    expect(signup.body.user).toMatchObject({ email: "org@example.com", role: "organizer" });
    expect(signup.headers.get("set-cookie")).toMatch(/sid=.+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax/);

    const me = await browser.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ user: signup.body.user });

    expect((await browser.post("/api/auth/logout")).status).toBe(204);
    expect((await browser.get("/api/auth/me")).status).toBe(401);
  });

  it("login по тому же email в другом регистре открывает новую сессию", async () => {
    const { client } = testApp();
    await client().post("/api/auth/signup", credentials);
    const browser = client();

    const login = await browser.post("/api/auth/login", { email: " ORG@example.com", password: "correct horse" });

    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ email: "org@example.com", role: "organizer" });
    expect((await browser.get("/api/auth/me")).status).toBe(200);
  });

  it("неверный email и неверный пароль дают одну и ту же ошибку", async () => {
    const { client } = testApp();
    await client().post("/api/auth/signup", credentials);

    const wrongPassword = await client().post("/api/auth/login", { email: credentials.email, password: "wrong horse" });
    const wrongEmail = await client().post("/api/auth/login", { email: "nobody@example.com", password: "correct horse" });

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: "invalid_credentials" });
    expect(wrongEmail.status).toBe(401);
    expect(wrongEmail.body).toEqual(wrongPassword.body);
  });

  it("второй signup на тот же email — 409 email_taken", async () => {
    const { client } = testApp();
    await client().post("/api/auth/signup", credentials);

    const again = await client().post("/api/auth/signup", { email: "org@example.com", password: "another pass" });

    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "email_taken" });
  });

  it("короткий пароль и кривой email — 400 validation_failed", async () => {
    const res = await testApp().client().post("/api/auth/signup", { email: "not-an-email", password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
    expect(res.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(["email", "password"]);
  });

  it("сессия живёт 30 дней", async () => {
    const { client, clock } = testApp({ now: "2026-11-01T09:00:00Z" });
    const browser = client();
    await browser.post("/api/auth/signup", credentials);

    clock.set("2026-12-01T08:59:59Z");
    expect((await browser.get("/api/auth/me")).status).toBe(200);
    clock.set("2026-12-01T09:00:00Z");
    expect((await browser.get("/api/auth/me")).status).toBe(401);
  });
});
