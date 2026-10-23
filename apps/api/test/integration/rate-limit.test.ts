import { afterEach, describe, expect, it, vi } from "vitest";
import { readEnv } from "../../src/env.ts";
import {
  confirmCode,
  confirmLogin,
  createEvent,
  participant,
  receiveCode,
  requestCode,
  requestLoginCode,
  signInParticipant,
} from "../support/participant.ts";
import { testApp, type Client } from "../support/test-app.ts";

// Значения по умолчанию из env — те, с которыми сервис запускается (SPEC §10).
const defaults = readEnv({}).rateLimits;
const wrong = { email: "nobody@example.com", password: "wrong password" };

const login = (client: Client) => client.post("/api/auth/login", wrong);

async function repeat(times: number, request: () => Promise<{ status: number }>) {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await request()).status);
  return statuses;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("rate limit (D-006)", () => {
  it("лимиты по умолчанию: 300 на всё, 10 на вход, 20 на действия участника; доверие прокси выключено", () => {
    expect(defaults).toEqual({ global: 300, auth: 10, public: 20 });
    expect(readEnv({}).trustProxy).toBe(false);
    expect(
      readEnv({ RATE_LIMIT_GLOBAL: "5000", RATE_LIMIT_AUTH: "1000", RATE_LIMIT_PUBLIC: "2000", TRUST_PROXY: "1" }),
    ).toMatchObject({ trustProxy: true, rateLimits: { global: 5000, auth: 1000, public: 2000 } });
  });

  it("11-й вход за минуту → 429 с Retry-After", async () => {
    const browser = testApp({ rateLimit: { rateLimits: defaults } }).client();

    expect(await repeat(10, () => login(browser))).toEqual(Array(10).fill(401));
    const res = await login(browser);

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(55);
    expect(Number(res.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect(res.headers.get("ratelimit-limit")).toBe("10");
    expect(res.headers.get("ratelimit-remaining")).toBe("0");
  });

  it("signup и login — одна корзина; «кто я» в неё не входит", async () => {
    const browser = testApp({ rateLimit: { rateLimits: defaults } }).client();

    await repeat(5, () => browser.post("/api/auth/signup", { email: "short", password: "x" }));
    await repeat(5, () => login(browser));
    expect((await browser.get("/api/auth/me")).status).toBe(401);

    expect((await browser.post("/api/auth/signup", { email: "org@example.com", password: "correct horse" })).status).toBe(
      429,
    );
  });

  it("через минуту вход снова открыт", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const browser = testApp({ rateLimit: { rateLimits: defaults } }).client();
    await repeat(10, () => login(browser));
    expect((await login(browser)).status).toBe(429);

    vi.setSystemTime(Date.now() + 60_000);

    expect((await login(browser)).status).toBe(401);
  });

  it("21-е действие участника за минуту → 429; код, ввод кода и отказ считаются вместе, страница события — нет", async () => {
    const t = testApp({ rateLimit: { rateLimits: defaults } });
    const { eventId } = await createEvent(t);
    const browser = t.client();

    const { verificationId, code } = await receiveCode(t, eventId);
    const confirmed = await confirmCode(browser, verificationId, code);
    expect(confirmed.status).toBe(200);
    // Неверные коды и отказы по чужому токену тоже считаются.
    await repeat(9, () => confirmCode(browser, verificationId, "000000"));
    await repeat(8, () => browser.post(`/api/registrations/${"x".repeat(43)}/cancel`));
    expect((await browser.get(`/api/events/${eventId}`)).status).toBe(200);
    expect((await browser.post(`/api/registrations/${confirmed.body.token}/cancel`)).status).toBe(200);

    const res = await requestCode(browser, eventId, participant({ email: "boris@example.com" }));
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
    expect(res.headers.get("ratelimit-limit")).toBe("20");
    // Корзина входа своя.
    expect((await login(browser)).status).toBe(401);
  });

  it("вход участника в корзине участника: код и ввод кода считаются вместе с остальными действиями", async () => {
    const t = testApp({ rateLimit: { rateLimits: defaults } });
    const browser = t.client();

    const issued = await requestLoginCode(browser);
    expect(issued.status).toBe(201);
    // Неверные коды (400, потом 410 после пяти) и несуществующий код (404) считаются одинаково.
    const statuses = await repeat(19, () => confirmLogin(browser, issued.body.verificationId, "000000"));
    expect(statuses).not.toContain(429);
    const res = await confirmLogin(browser, issued.body.verificationId, "000000");

    expect(res.status).toBe(429);
    expect(res.headers.get("ratelimit-limit")).toBe("20");
    // `/participant/me` в корзину не входит, корзина входа организатора своя.
    expect((await browser.get("/api/participant/me")).status).toBe(401);
    expect((await login(browser)).status).toBe(401);
  });

  it("регистрация без кода в корзине участника: вход участника тоже в ней, 21-й запрос → 429", async () => {
    const t = testApp({ rateLimit: { rateLimits: defaults } });
    const { eventId } = await createEvent(t, { limit: 5 });
    // Вход участника — два действия корзины: запрос кода и ввод кода.
    const browser = await signInParticipant(t, "anna@example.com");
    const { email: _email, ...data } = participant();
    const registerSignedIn = () => browser.post(`/api/events/${eventId}/registrations`, data);

    expect(await repeat(18, registerSignedIn)).toEqual(Array(18).fill(200));
    const res = await registerSignedIn();

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
    expect(res.headers.get("ratelimit-limit")).toBe("20");
    // Корзина входа организатора своя.
    expect((await login(browser)).status).toBe(401);
  });

  it("301-й запрос за минуту на любой маршрут → 429", async () => {
    const browser = testApp({ rateLimit: { rateLimits: defaults } }).client();

    expect(await repeat(300, () => browser.get("/api/auth/me"))).toEqual(Array(300).fill(401));
    const res = await browser.get("/api/no-such-route");

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  describe("IP клиента", () => {
    const behindProxy = (ip: string) => ({ "x-forwarded-for": ip });

    it("при доверии прокси корзина своя у каждого IP из X-Forwarded-For", async () => {
      const { client } = testApp({ rateLimit: { rateLimits: defaults, trustProxy: true } });
      const anna = client(behindProxy("203.0.113.1"));
      await repeat(10, () => login(anna));
      expect((await login(anna)).status).toBe(429);

      expect((await login(client(behindProxy("203.0.113.2")))).status).toBe(401);
    });

    it("при доверии прокси берётся адрес, который дописал прокси, а не присланный клиентом", async () => {
      const { client } = testApp({ rateLimit: { rateLimits: defaults, trustProxy: true } });
      await repeat(10, () => login(client(behindProxy(`198.51.100.1, 203.0.113.1`))));

      expect((await login(client(behindProxy("198.51.100.99, 203.0.113.1")))).status).toBe(429);
    });

    it("без доверия прокси X-Forwarded-For не меняет корзину", async () => {
      const { client } = testApp({ rateLimit: { rateLimits: defaults } });
      await repeat(10, () => login(client(behindProxy("203.0.113.1"))));

      expect((await login(client(behindProxy("203.0.113.2")))).status).toBe(429);
    });
  });
});
