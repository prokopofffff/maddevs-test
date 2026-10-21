import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { events } from "../db/schema.ts";
import { countsFor, freeSeats, started } from "../domain/events.ts";
import { apiError, type Env } from "../http.ts";
import { isUuid } from "./params.ts";

/** Маршруты участника: без входа, доступ по ссылке на событие (D-007). */
export const publicRoutes = new Hono<Env>().get("/events/:id", async (c) => {
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
});
