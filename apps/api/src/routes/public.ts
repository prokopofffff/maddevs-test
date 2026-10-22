import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { events, registrations } from "../db/schema.ts";
import { withTx, type Queryable } from "../db/tx.ts";
import { catalogCities, listCatalog } from "../domain/catalog.ts";
import { pendingCorrection, pendingCorrectionView, submitCorrection } from "../domain/corrections.ts";
import { countsFor, freeSeats, lockEvent, started } from "../domain/events.ts";
import { activeRegistration, cancel, DomainError, registerSignedIn, waitlistPosition, type RegistrationRow } from "../domain/registrations.ts";
import { confirmVerification, issueVerification } from "../domain/verifications.ts";
import { apiError, type Env } from "../http.ts";
import { catalogQuerySchema } from "../schemas/catalog.ts";
import { confirmCodeSchema, participantDataSchema, verificationRequestSchema } from "../schemas/participant.ts";
import { validate } from "../validation.ts";
import { isUuid } from "./params.ts";
import { optionalParticipant, requireParticipant } from "./participant.ts";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[1-9]\d{0,15}$/;

/** Номер в листе ожидания — только у `waitlisted`; у остальных поля в ответе нет. */
const positionOf = async (db: Queryable, registration: RegistrationRow): Promise<{ waitlistPosition?: number }> =>
  registration.status === "waitlisted" ? { waitlistPosition: await waitlistPosition(db, registration) } : {};

/** Маршруты участника: без входа, доступ по ссылке на событие и по токену личной ссылки (D-007). */
export const publicRoutes = new Hono<Env>()
  // Каталог (D-061). `/events/cities` объявлен раньше `/events/:id`, иначе «cities» читалось бы как id.
  .get("/events", validate("query", catalogQuerySchema), async (c) => {
    const { db, clock } = c.var;
    const catalog = await listCatalog(db, c.req.valid("query"), clock.now());
    if ("error" in catalog) {
      return apiError(c, 400, "validation_failed", { issues: [{ path: "cursor", message: "invalid" }] });
    }
    return c.json(catalog, 200);
  })
  .get("/events/cities", async (c) => {
    const { db, clock } = c.var;
    return c.json({ cities: await catalogCities(db, clock.now()) }, 200);
  })
  .get("/events/:id", optionalParticipant, async (c) => {
    const { db, clock } = c.var;
    const id = c.req.param("id");
    const [event] = isUuid(id) ? await db.select().from(events).where(eq(events.id, id)) : [];
    if (!event) return apiError(c, 404, "not_found");
    const now = clock.now();
    const counts = (await countsFor(db, [event])).get(event.id)!;
    // Только под сессией участника: у гостя поля нет, у вошедшего без регистрации — `null` (D-058).
    const email = c.var.participantEmail;
    const mine = email ? await activeRegistration(db, event.id, email) : undefined;
    return c.json(
      {
        id: event.id,
        title: event.title,
        description: event.description,
        startsAt: event.startsAt.toISOString(),
        timezone: event.timezone,
        format: event.format,
        city: event.city,
        address: event.address,
        category: event.category,
        minAge: event.minAge,
        freeSeats: freeSeats(event, counts, now),
        started: started(event, now),
        ...(email ? { myRegistration: mine ? { token: mine.token, status: mine.status } : null } : {}),
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
  // Регистрация без кода: email из сессии участника, дальше те же проверки и тот же `allocate` (D-058).
  .post("/events/:id/registrations", requireParticipant, validate("json", participantDataSchema), async (c) => {
    const { db, clock, config, outbox } = c.var;
    const id = c.req.param("id");
    if (!isUuid(id)) return apiError(c, 404, "not_found");

    let registered;
    try {
      registered = await registerSignedIn(db, id, c.var.participantEmail, c.req.valid("json"), {
        now: clock.now(),
        publicUrl: config.publicUrl,
      });
    } catch (error) {
      if (error instanceof DomainError) return apiError(c, 409, error.code);
      throw error;
    }
    if ("error" in registered) {
      switch (registered.error) {
        case "not_found":
          return apiError(c, 404, registered.error);
        case "birth_date_in_future":
          return apiError(c, 400, "validation_failed", { issues: [{ path: "birthDate", message: "in_future" }] });
        case "below_min_age":
          return apiError(c, 422, registered.error, { minAge: registered.minAge });
      }
    }
    // Как у `confirm`: письмо о месте или листе ожидания закоммичено, повтор `existing` писем не ставит (D-014, D-007).
    if (registered.result !== "existing") outbox.wake();
    const { registration } = registered;
    const position: { waitlistPosition?: number } =
      registered.result === "waitlisted" ? { waitlistPosition: registered.waitlistPosition } : await positionOf(db, registration);
    return c.json({ result: registered.result, token: registration.token, status: registration.status, ...position }, 200);
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
        case "registration_not_found":
          return apiError(c, 404, confirmed.error);
        case "code_invalid":
          return apiError(c, 400, confirmed.error, { attemptsLeft: confirmed.attemptsLeft });
        case "code_expired":
        case "code_attempts_exceeded":
          return apiError(c, 410, confirmed.error);
      }
    }
    if (confirmed.result === "found") return c.json({ result: confirmed.result, token: confirmed.registration.token }, 200);
    // Новая регистрация поставила письмо о месте или о листе ожидания; повтор `existing` писем не шлёт (D-007).
    if (confirmed.result !== "existing") outbox.wake();
    const { registration } = confirmed;
    // Номер нового в листе посчитан под блокировкой события; у повтора — текущий.
    const position: { waitlistPosition?: number } =
      confirmed.result === "waitlisted"
        ? { waitlistPosition: confirmed.waitlistPosition }
        : await positionOf(db, registration);
    return c.json(
      { result: confirmed.result, token: registration.token, status: registration.status, ...position },
      200,
    );
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
    const pending = await pendingCorrection(db, r.id);
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
        ...(await positionOf(db, r)),
        checkedInAt: r.checkedInAt?.toISOString() ?? null,
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        // Плашка «Заявка на рассмотрении» с предложенными значениями (D-031).
        ...(pending ? { pendingCorrection: pendingCorrectionView(pending) } : {}),
      },
      200,
    );
  })
  .post("/registrations/:token/cancel", async (c) => {
    const { db, clock, config, outbox } = c.var;
    const token = c.req.param("token");
    const [found] = TOKEN.test(token)
      ? await db.select({ eventId: registrations.eventId }).from(registrations).where(eq(registrations.token, token))
      : [];
    if (!found) return apiError(c, 404, "not_found");

    let cancelled;
    try {
      cancelled = await withTx(db, async (tx) => {
        // Порядок блокировок «событие → регистрации»; строка перечитывается уже под блокировкой события (D-011).
        const event = (await lockEvent(tx, found.eventId))!;
        const [registration] = await tx
          .select()
          .from(registrations)
          .where(eq(registrations.token, token))
          .for("update");
        return cancel(tx, event, registration!, { now: clock.now(), publicUrl: config.publicUrl });
      });
    } catch (error) {
      if (error instanceof DomainError) return apiError(c, 409, error.code);
      throw error;
    }
    // Письмо об отказе и, если место освободилось, о повышении закоммичены (D-014).
    outbox.wake();
    return c.json({ status: cancelled.status }, 200);
  })
  // Форма «Исправить данные»: заявка ждёт решения поддержки, данные регистрации пока прежние (D-031).
  .post("/registrations/:token/corrections", validate("json", participantDataSchema), async (c) => {
    const { db, clock } = c.var;
    const token = c.req.param("token");
    const [found] = TOKEN.test(token)
      ? await db.select({ eventId: registrations.eventId }).from(registrations).where(eq(registrations.token, token))
      : [];
    if (!found) return apiError(c, 404, "not_found");

    const submitted = await withTx(db, async (tx) => {
      // Как у отказа: начало и отмена проверяются под блокировкой события (D-011, D-033).
      const event = (await lockEvent(tx, found.eventId))!;
      const [registration] = await tx
        .select()
        .from(registrations)
        .where(eq(registrations.token, token))
        .for("update");
      return submitCorrection(tx, event, registration!, c.req.valid("json"), clock.now());
    });
    if ("error" in submitted) {
      switch (submitted.error) {
        case "event_started":
        case "registration_cancelled":
          return apiError(c, 409, submitted.error);
        case "birth_date_in_future":
          return apiError(c, 400, "validation_failed", { issues: [{ path: "birthDate", message: "in_future" }] });
        case "correction_unchanged":
          return apiError(c, 422, submitted.error);
      }
    }
    return c.json({ pendingCorrection: pendingCorrectionView(submitted.correction) }, 201);
  });
