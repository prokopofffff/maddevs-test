import { and, asc, count, eq } from "drizzle-orm";
import type { Queryable } from "../db/tx.ts";
import { Hono } from "hono";
import { events, registrations } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { ageOnEventDay, belowMinAge } from "../domain/age.ts";
import { countsFor, deleteEvent, lockEvent, started, updateEvent, type EventRow } from "../domain/events.ts";
import { eventRegistrations } from "../domain/registrations.ts";
import { apiError, type Env } from "../http.ts";
import { eventInputSchema, eventPatchSchema } from "../schemas/event.ts";
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
    const { db, clock, user } = c.var;
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    const now = clock.now();
    const event = await withTx(db, async (tx) => {
      const locked = isUuid(id) ? await lockEvent(tx, id) : undefined;
      if (!locked || locked.organizerId !== user.id) return undefined;
      return updateEvent(tx, locked, patch, now);
    });
    if (!event) return apiError(c, 404, "not_found");
    if ("error" in event) return apiError(c, 501, event.error);
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
  });
