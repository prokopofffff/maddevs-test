import { and, asc, count, eq } from "drizzle-orm";
import type { Queryable } from "../db/tx.ts";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { events, registrations } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { ageOnEventDay, belowMinAge } from "../domain/age.ts";
import { checkIn, findTicket, uncheck } from "../domain/checkin.ts";
import { countsFor, deleteEvent, lockEvent, started, updateEvent, type EventRow } from "../domain/events.ts";
import { eventRegistrations } from "../domain/registrations.ts";
import { apiError, type Env } from "../http.ts";
import { eventInputSchema, eventPatchSchema } from "../schemas/event.ts";
import { checkinSchema } from "../schemas/ticket.ts";
import { instantToLocal, localToInstant } from "../time.ts";
import { validate } from "../validation.ts";
import { requireUser } from "./auth.ts";
import { isUuid } from "./params.ts";

const organizerEvent = (e: EventRow, now: Date) => ({
  id: e.id,
  title: e.title,
  description: e.description,
  startsAt: e.startsAt.toISOString(),
  startsLocal: instantToLocal(e.startsAt, e.timezone),
  timezone: e.timezone,
  limit: e.seatLimit,
  minAge: e.minAge,
  started: started(e, now),
});

/** Пинг-комментарий держит соединение через прокси и даёт браузеру заметить обрыв (D-020). */
const PING_MS = 20_000;

/** Чужое событие неотличимо от несуществующего (D-005). */
async function ownEvent(db: Queryable, id: string, organizerId: number) {
  if (!isUuid(id)) return undefined;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), eq(events.organizerId, organizerId)));
  return event;
}

export const organizerRoutes = new Hono<Env>()
  .use(requireUser)
  .get("/events", async (c) => {
    const { db, clock, user } = c.var;
    const now = clock.now();
    const rows = await db.select().from(events).where(eq(events.organizerId, user.id)).orderBy(asc(events.startsAt));
    const counts = await countsFor(db, rows);
    return c.json(
      {
        events: rows.map((e) => ({
          id: e.id,
          title: e.title,
          startsAt: e.startsAt.toISOString(),
          timezone: e.timezone,
          started: started(e, now),
          counts: counts.get(e.id)!,
        })),
      },
      200,
    );
  })
  .post("/events", validate("json", eventInputSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, clock, user } = c.var;
    const now = clock.now();
    const startsAt = localToInstant(input.startsLocal, input.timezone);
    // Новое событие — только в будущем.
    if (startsAt <= now) return apiError(c, 400, "starts_in_past");
    const [event] = await db
      .insert(events)
      .values({
        organizerId: user.id,
        title: input.title,
        description: input.description,
        startsAt,
        timezone: input.timezone,
        seatLimit: input.limit,
        minAge: input.minAge ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return c.json({ event: organizerEvent(event!, now) }, 201);
  })
  .get("/events/:id", async (c) => {
    const { db, clock, config, user } = c.var;
    const event = await ownEvent(db, c.req.param("id"), user.id);
    if (!event) return apiError(c, 404, "not_found");
    const [counts, [registered]] = await Promise.all([
      countsFor(db, [event]),
      db.select({ n: count() }).from(registrations).where(eq(registrations.eventId, event.id)),
    ]);
    return c.json(
      {
        event: organizerEvent(event, clock.now()),
        counts: counts.get(event.id)!,
        publicUrl: `${config.publicUrl}/e/${event.id}`,
        registrationCount: registered!.n,
      },
      200,
    );
  })
  .get("/events/:id/registrations", async (c) => {
    const { db, user } = c.var;
    const event = await ownEvent(db, c.req.param("id"), user.id);
    if (!event) return apiError(c, 404, "not_found");
    const list = await eventRegistrations(db, event.id);
    return c.json(
      {
        registrations: list.map(({ row: r, waitlistPosition }) => ({
          id: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email,
          birthDate: r.birthDate,
          ageOnEventDay: ageOnEventDay(r.birthDate, event),
          belowMinAge: belowMinAge(r.birthDate, event),
          status: r.status,
          waitlistPosition,
          confirmedAt: r.confirmedAt?.toISOString() ?? null,
          checkedInAt: r.checkedInAt?.toISOString() ?? null,
        })),
      },
      200,
    );
  })
  .patch("/events/:id", validate("json", eventPatchSchema), async (c) => {
    const { db, clock, config, user } = c.var;
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    const now = clock.now();
    const event = await withTx(db, async (tx) => {
      const locked = isUuid(id) ? await lockEvent(tx, id) : undefined;
      if (!locked || locked.organizerId !== user.id) return undefined;
      return updateEvent(tx, locked, patch, { now, publicUrl: config.publicUrl });
    });
    if (!event) return apiError(c, 404, "not_found");
    if ("error" in event) return apiError(c, event.error === "event_started" ? 409 : 501, event.error);
    const counts = await countsFor(db, [event]);
    return c.json({ event: organizerEvent(event, now), counts: counts.get(event.id)! }, 200);
  })
  .delete("/events/:id", async (c) => {
    const { db, user } = c.var;
    const id = c.req.param("id");
    const result = await withTx(db, async (tx) => {
      const locked = isUuid(id) ? await lockEvent(tx, id) : undefined;
      if (!locked || locked.organizerId !== user.id) return { error: "not_found" as const };
      return deleteEvent(tx, locked);
    });
    if (result?.error === "not_found") return apiError(c, 404, result.error);
    if (result) return apiError(c, 409, result.error);
    return c.body(null, 204);
  })
  // Live-счётчики (SPEC §7): снимок при подключении и после каждого изменения, до закрытия вкладки.
  .get("/events/:id/live", async (c) => {
    const { db, live, user } = c.var;
    const event = await ownEvent(db, c.req.param("id"), user.id);
    if (!event) return apiError(c, 404, "not_found");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      await stream.write("retry: 3000\n\n");
      const unsubscribe = await live.subscribe(event.id, (counts) => {
        void stream.writeSSE({ event: "counts", data: JSON.stringify(counts) });
      });
      await new Promise<void>((resolve) => {
        const ping = setInterval(() => void stream.write(": ping\n\n"), PING_MS);
        const done = () => {
          clearInterval(ping);
          live.signal.removeEventListener("abort", done);
          unsubscribe();
          resolve();
        };
        stream.onAbort(done);
        live.signal.addEventListener("abort", done);
        if (stream.aborted || live.signal.aborted) done();
      });
    });
  })
  // Карточка билета на входе: только чтение, отметку ставит `POST …/checkin` (D-022, D-023).
  .get("/events/:id/tickets/:code", async (c) => {
    const { db, user } = c.var;
    const event = await ownEvent(db, c.req.param("id"), user.id);
    if (!event) return apiError(c, 404, "not_found");
    const ticket = await findTicket(db, event.id, c.req.param("code"));
    if (!ticket) return apiError(c, 404, "ticket_not_found");
    return c.json(
      {
        registrationId: ticket.id,
        firstName: ticket.firstName,
        lastName: ticket.lastName,
        birthDate: ticket.birthDate,
        ageOnEventDay: ageOnEventDay(ticket.birthDate, event),
        belowMinAge: belowMinAge(ticket.birthDate, event),
        status: ticket.status,
        checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
      },
      200,
    );
  })
  .post("/events/:id/checkin", validate("json", checkinSchema), async (c) => {
    const { db, clock, user } = c.var;
    const event = await ownEvent(db, c.req.param("id"), user.id);
    if (!event) return apiError(c, 404, "not_found");
    const result = await checkIn(db, event.id, c.req.valid("json").code, clock.now());
    switch (result.error) {
      case undefined:
        return c.json(
          {
            registrationId: result.registration.id,
            firstName: result.registration.firstName,
            lastName: result.registration.lastName,
            checkedInAt: result.registration.checkedInAt!.toISOString(),
          },
          200,
        );
      case "already_checked_in":
        return apiError(c, 409, result.error, {
          firstName: result.registration.firstName,
          lastName: result.registration.lastName,
          checkedInAt: result.registration.checkedInAt?.toISOString() ?? null,
        });
      case "ticket_cancelled":
        return apiError(c, 409, result.error);
      case "ticket_not_found":
        return apiError(c, 404, result.error);
    }
  })
  // «Снять отметку» в списке участников (D-023): после неё билет снова проходит чекин.
  .delete("/events/:id/checkin/:registrationId", async (c) => {
    const { db, user } = c.var;
    const event = await ownEvent(db, c.req.param("id"), user.id);
    if (!event) return apiError(c, 404, "not_found");
    const registrationId = Number(c.req.param("registrationId"));
    if (Number.isSafeInteger(registrationId) && registrationId > 0) await uncheck(db, event.id, registrationId);
    return c.body(null, 204);
  });
