import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { events, registrations } from "../db/schema.ts";
import { countsFor, freeSeats, started } from "../domain/events.ts";
import { DomainError } from "../domain/registrations.ts";
import { confirmVerification, issueVerification } from "../domain/verifications.ts";
import { apiError, type Env } from "../http.ts";
import { confirmCodeSchema, verificationRequestSchema } from "../schemas/participant.ts";
import { validate } from "../validation.ts";
import { isUuid } from "./params.ts";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[1-9]\d{0,15}$/;

/** Маршруты участника: без входа, доступ по ссылке на событие и по токену личной ссылки (D-007). */
export const publicRoutes = new Hono<Env>()
  .get("/events/:id", async (c) => {
    const { db, clock } = c.var;
    const id = c.req.param("id");
    const [event] = isUuid(id) ? await db.select().from(events).where(eq(events.id, id)) : [];
    if (!event) return apiError(c, 404, "not_found");
    const now = clock.now();
    const counts = (await countsFor(db, [event])).get(event.id)!;
    return c.json(
      {
        id: event.id,
        title: event.title,
        description: event.description,
        startsAt: event.startsAt.toISOString(),
        timezone: event.timezone,
        minAge: event.minAge,
        freeSeats: freeSeats(event, counts, now),
        started: started(event, now),
      },
      200,
    );
  })
  .post("/events/:id/verifications", validate("json", verificationRequestSchema), async (c) => {
    const { db, clock, config, outbox } = c.var;
    const id = c.req.param("id");
    const [event] = isUuid(id) ? await db.select().from(events).where(eq(events.id, id)) : [];
    if (!event) return apiError(c, 404, "not_found");

    const issued = await issueVerification(db, event, c.req.valid("json"), {
      now: clock.now(),
      publicUrl: config.publicUrl,
    });
    if ("error" in issued) {
      switch (issued.error) {
        case "registration_closed":
          return apiError(c, 409, issued.error);
        case "birth_date_in_future":
          return apiError(c, 400, "validation_failed", { issues: [{ path: "birthDate", message: "in_future" }] });
        case "below_min_age":
          return apiError(c, 422, issued.error, { minAge: issued.minAge });
        case "code_resend_too_soon":
          c.header("Retry-After", String(issued.retryAfter));
          return apiError(c, 429, issued.error, { retryAfter: issued.retryAfter });
      }
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
    const { db, clock, config, outbox } = c.var;
    const id = c.req.param("id");
    if (!ID.test(id)) return apiError(c, 404, "not_found");

    let confirmed;
    try {
      confirmed = await confirmVerification(db, Number(id), c.req.valid("json").code, {
        now: clock.now(),
        publicUrl: config.publicUrl,
      });
    } catch (error) {
      if (error instanceof DomainError) return apiError(c, 409, error.code);
      throw error;
    }
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
    if (confirmed.result === "found") return c.json({ result: confirmed.result, token: confirmed.registration.token }, 200);
    if (confirmed.result === "confirmed") outbox.wake();
    const { registration } = confirmed;
    return c.json({ result: confirmed.result, token: registration.token, status: registration.status }, 200);
  })
  .get("/registrations/:token", async (c) => {
    const { db, clock } = c.var;
    const token = c.req.param("token");
    const [row] = TOKEN.test(token)
      ? await db
          .select({ registration: registrations, event: events })
          .from(registrations)
          .innerJoin(events, eq(events.id, registrations.eventId))
          .where(eq(registrations.token, token))
      : [];
    if (!row) return apiError(c, 404, "not_found");
    const { registration: r, event } = row;
    return c.json(
      {
        event: {
          id: event.id,
          title: event.title,
          startsAt: event.startsAt.toISOString(),
          timezone: event.timezone,
          started: started(event, clock.now()),
        },
        status: r.status,
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        birthDate: r.birthDate,
        // Билет отменённой регистрации недействителен — не показываем (D-022).
        ticketCode: r.status === "confirmed" ? r.ticketCode : null,
        checkedInAt: r.checkedInAt?.toISOString() ?? null,
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
      },
      200,
    );
  });
