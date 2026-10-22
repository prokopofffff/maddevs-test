import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { createAccount } from "../auth/accounts.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  findSessionUser,
  readSessionCookie,
  writeSessionCookie,
  type SessionUser,
} from "../auth/session.ts";
import { users } from "../db/schema.ts";
import { apiError, type Env } from "../http.ts";
import { loginSchema, signupSchema } from "../schemas/auth.ts";
import { validate } from "../validation.ts";

/** Пропускает только запрос с живой сессией; пользователь кладётся в `c.var.user`. */
export const requireUser = createMiddleware<Env>(async (c, next) => {
  const id = readSessionCookie(c);
  const user = id ? await findSessionUser(c.var.db, id, c.var.clock.now()) : undefined;
  if (!user) return apiError(c, 401, "unauthorized");
  c.set("user", user);
  await next();
});

/**
 * Пропускает только роль `role`; остальным — `404`, как на чужое событие (D-005, D-030).
 * Ставится после `requireUser`.
 */
export const requireRole = (role: SessionUser["role"]) =>
  createMiddleware<Env>(async (c, next) => {
    if (c.var.user.role !== role) return apiError(c, 404, "not_found");
    await next();
  });

// Хеш для несуществующего email: проверка пароля идёт всегда, время ответа не выдаёт, есть ли аккаунт.
const dummyHash = hashPassword("dummy password");

const publicUser = (u: { id: number; email: string; role: "organizer" | "support" }) => ({
  id: u.id,
  email: u.email,
  role: u.role,
});

export const authRoutes = new Hono<Env>()
  .post("/signup", validate("json", signupSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const { db, clock, config } = c.var;
    const now = clock.now();
    // Signup создаёт только организатора (D-030).
    const user = await createAccount(db, { email, password, role: "organizer", now });
    if (!user) return apiError(c, 409, "email_taken");
    writeSessionCookie(c, await createSession(db, user.id, now), config.cookieSecure);
    return c.json({ user: publicUser(user) }, 201);
  })
  .post("/login", validate("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const { db, clock, config } = c.var;
    const [user] = await db.select().from(users).where(eq(users.email, email));
    const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
    // Одна ошибка на неверный email и неверный пароль (D-005).
    if (!user || !valid) return apiError(c, 401, "invalid_credentials");
    writeSessionCookie(c, await createSession(db, user.id, clock.now()), config.cookieSecure);
    return c.json({ user: publicUser(user) }, 200);
  })
  .post("/logout", async (c) => {
    const id = readSessionCookie(c);
    if (id) await deleteSession(c.var.db, id);
    clearSessionCookie(c);
    return c.body(null, 204);
  })
  .get("/me", requireUser, (c) => c.json({ user: publicUser(c.var.user) }, 200));
