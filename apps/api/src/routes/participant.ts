import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  clearParticipantCookie,
  createParticipantSession,
  deleteParticipantSession,
  findParticipantEmail,
  readParticipantCookie,
  writeParticipantCookie,
} from "../auth/participant-session.ts";
import { confirmLoginCode, issueLoginCode, lastRegistrationData } from "../domain/participant-login.ts";
import { apiError, type Env } from "../http.ts";
import { emailSchema } from "../schemas/auth.ts";
import { confirmCodeSchema } from "../schemas/participant.ts";
import { z } from "zod";
import { validate } from "../validation.ts";

const ID = /^[1-9]\d{0,15}$/;

const loginRequestSchema = z.object({ email: emailSchema });

/** Email из живой сессии участника: без неё `undefined`. Организаторская cookie `sid` здесь не читается (D-057). */
async function sessionEmail(c: Parameters<typeof readParticipantCookie>[0], { db, clock }: Env["Variables"]) {
  const id = readParticipantCookie(c);
  return id ? findParticipantEmail(db, id, clock.now()) : undefined;
}

/** Пропускает только запрос с сессией участника; email кладётся в `c.var.participantEmail`. */
export const requireParticipant = createMiddleware<Env>(async (c, next) => {
  const email = await sessionEmail(c, c.var);
  if (!email) return apiError(c, 401, "unauthorized");
  c.set("participantEmail", email);
  await next();
});

/** То же без `401`: для маршрутов, которые отвечают и гостю, и вошедшему; у гостя `participantEmail` не задан. */
export const optionalParticipant = createMiddleware<Env>(async (c, next) => {
  const email = await sessionEmail(c, c.var);
  if (email) c.set("participantEmail", email);
  await next();
});

/** Вход участника по коду на email (D-057). */
export const participantRoutes = new Hono<Env>()
  .post("/verifications", validate("json", loginRequestSchema), async (c) => {
    const { db, clock, config, outbox } = c.var;
    const issued = await issueLoginCode(db, c.req.valid("json").email, { now: clock.now(), publicUrl: config.publicUrl });
    if ("error" in issued) {
      c.header("Retry-After", String(issued.retryAfter));
      return apiError(c, 429, issued.error, { retryAfter: issued.retryAfter });
    }
    // Письмо с кодом закоммичено — отправка стартует сразу, не дожидаясь тика (D-014).
    outbox.wake();
    return c.json(
      {
        verificationId: issued.verification.id,
        expiresAt: issued.verification.expiresAt.toISOString(),
        resendAfter: issued.resendAfter.toISOString(),
      },
      201,
    );
  })
  .post("/verifications/:id/confirm", validate("json", confirmCodeSchema), async (c) => {
    const { db, clock, config } = c.var;
    const id = c.req.param("id");
    if (!ID.test(id)) return apiError(c, 404, "not_found");

    const now = clock.now();
    const confirmed = await confirmLoginCode(db, Number(id), c.req.valid("json").code, now);
    if ("error" in confirmed) {
      switch (confirmed.error) {
        case "not_found":
          return apiError(c, 404, confirmed.error);
        case "code_invalid":
          return apiError(c, 400, confirmed.error, { attemptsLeft: confirmed.attemptsLeft });
        case "code_expired":
        case "code_attempts_exceeded":
          return apiError(c, 410, confirmed.error);
      }
    }
    writeParticipantCookie(c, await createParticipantSession(db, confirmed.email, now), config.cookieSecure);
    return c.json({ email: confirmed.email }, 200);
  })
  .get("/me", requireParticipant, async (c) => {
    const email = c.var.participantEmail;
    return c.json({ email, lastData: await lastRegistrationData(c.var.db, email) }, 200);
  })
  .post("/logout", async (c) => {
    const id = readParticipantCookie(c);
    if (id) await deleteParticipantSession(c.var.db, id);
    clearParticipantCookie(c);
    return c.body(null, 204);
  });
