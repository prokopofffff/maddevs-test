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
import { getProfile, saveProfile } from "../domain/profile.ts";
import { participantRegistrations } from "../domain/registrations.ts";
import { apiError, type Env } from "../http.ts";
import { emailSchema } from "../schemas/auth.ts";
import { confirmCodeSchema, profileUpdateSchema } from "../schemas/participant.ts";
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
    const { db, participantEmail: email } = c.var;
    return c.json({ email, profile: await getProfile(db, email), lastData: await lastRegistrationData(db, email) }, 200);
  })
  // Профиль и перенос данных в текущие регистрации (D-065). Письма — только об отказах и повышениях из `cancel`.
  .put("/profile", requireParticipant, validate("json", profileUpdateSchema), async (c) => {
    const { db, clock, config, outbox } = c.var;
    const { cancelConflicts, ...data } = c.req.valid("json");
    const saved = await saveProfile(
      db,
      c.var.participantEmail,
      data,
      { cancelConflicts: cancelConflicts === true },
      { now: clock.now(), publicUrl: config.publicUrl },
    );
    if ("error" in saved) {
      switch (saved.error) {
        case "birth_date_in_future":
          return apiError(c, 400, "validation_failed", { issues: [{ path: "birthDate", message: "in_future" }] });
        case "profile_conflicts":
          return apiError(c, 409, saved.error, { events: saved.events });
      }
    }
    if (saved.cancelled.length > 0) outbox.wake();
    return c.json(saved, 200);
  })
  .get("/registrations", requireParticipant, async (c) => {
    const registrations = await participantRegistrations(c.var.db, c.var.participantEmail, c.var.clock.now());
    return c.json({ registrations }, 200);
  })
  .post("/logout", async (c) => {
    const id = readParticipantCookie(c);
    if (id) await deleteParticipantSession(c.var.db, id);
    clearParticipantCookie(c);
    return c.body(null, 204);
  });
