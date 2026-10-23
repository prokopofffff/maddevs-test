import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay } from "date-fns";
import { and, asc, desc, eq, gt, ilike, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { events, registrations } from "../db/schema.ts";
import type { Queryable } from "../db/tx.ts";
import type { CatalogQuery } from "../schemas/catalog.ts";
import { countsFor, freeSeats, started, type EventRow } from "./events.ts";

/** Страница каталога (D-061); 25-я строка читается только затем, чтобы узнать, есть ли следующая. */
const PAGE_SIZE = 24;

/** Поля карточки: ни описания, ни адреса, ни участников (SPEC, раздел 4). */
export interface CatalogEvent {
  id: string;
  title: string;
  startsAt: string;
  timezone: string;
  format: EventRow["format"];
  city: string | null;
  category: EventRow["category"];
  minAge: number;
  freeSeats: number;
  started: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Только четырёхзначный год от 0001: `Date` принимает ещё `+010000-…` и `0000-…`, а Postgres на таком `timestamptz` падает с 500. */
const CURSOR_INSTANT = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const encodeCursor = (event: Pick<EventRow, "startsAt" | "id">) =>
  Buffer.from(JSON.stringify([event.startsAt.toISOString(), event.id])).toString("base64url");

/** Курсор непрозрачен для клиента; всё, что не `[ISO-момент, uuid]`, — `undefined`. */
function decodeCursor(cursor: string): { startsAt: Date; id: string } | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2) return;
    const [iso, id] = value;
    if (typeof iso !== "string" || typeof id !== "string" || !UUID.test(id) || !CURSOR_INSTANT.test(iso)) return;
    const startsAt = new Date(iso);
    if (Number.isNaN(startsAt.getTime()) || startsAt.toISOString() !== iso) return;
    return { startsAt, id };
  } catch {
    return;
  }
}

/** `%`, `_` и `\\` в запросе посетителя — обычные символы, а не шаблон `ILIKE` (D-061). */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

/** Условия `when`; «сегодня» и «неделя» считаются в поясе посетителя, а не события (D-061). */
function whenCondition(when: CatalogQuery["when"], tz: string, now: Date): SQL {
  if (when === "past") return lte(events.startsAt, now);
  const upcoming = gt(events.startsAt, now);
  if (when === "upcoming") return upcoming;
  // Неделя — до конца седьмого дня, считая сегодняшний: граница — начало дня `сегодня + 7`.
  const days = when === "today" ? 1 : 7;
  const end = startOfDay(addDays(startOfDay(new TZDate(now, tz)), days));
  return and(upcoming, lt(events.startsAt, new Date(end.getTime())))!;
}

/** Места считаются подзапросами, а не в JS: иначе страница после фильтра выходила бы неполной (D-061). */
const hasSeatsCondition = (now: Date): SQL => sql`(
  ${events.startsAt} > ${now.toISOString()}::timestamptz
  and ${events.seatLimit} > (select count(*) from ${registrations} where ${registrations.eventId} = ${events.id} and ${registrations.status} = 'confirmed')
  and not exists (select 1 from ${registrations} where ${registrations.eventId} = ${events.id} and ${registrations.status} = 'waitlisted')
)`;

/** Каталог: один `select` по `events` с условиями, затем счётчики мест одним запросом (D-026, D-061). */
export async function listCatalog(
  db: Queryable,
  query: CatalogQuery,
  now: Date,
): Promise<{ events: CatalogEvent[]; nextCursor: string | null } | { error: "invalid_cursor" }> {
  const descending = query.when === "past";
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  if (query.cursor !== undefined && !cursor) return { error: "invalid_cursor" };

  const conditions: (SQL | undefined)[] = [
    whenCondition(query.when, query.tz, now),
    query.q ? or(ilike(events.title, likePattern(query.q)), ilike(events.description, likePattern(query.q))) : undefined,
    query.hasSeats ? hasSeatsCondition(now) : undefined,
    query.format ? eq(events.format, query.format) : undefined,
    query.city ? sql`lower(${events.city}) = lower(${query.city})` : undefined,
    query.category ? eq(events.category, query.category) : undefined,
    query.maxAge === undefined ? undefined : lte(events.minAge, query.maxAge),
    // Сравнение строк `(starts_at, id)` идёт по индексу `events_starts_idx` и не теряет события одной минуты (D-061).
    cursor
      ? sql`(${events.startsAt}, ${events.id}) ${descending ? sql`<` : sql`>`} (${cursor.startsAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
      : undefined,
  ];

  const rows = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(...(descending ? [desc(events.startsAt), desc(events.id)] : [asc(events.startsAt), asc(events.id)]))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const counts = await countsFor(db, page);
  return {
    events: page.map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.startsAt.toISOString(),
      timezone: e.timezone,
      format: e.format,
      city: e.city,
      category: e.category,
      minAge: e.minAge,
      freeSeats: freeSeats(e, counts.get(e.id)!, now),
      started: started(e, now),
    })),
    nextCursor: rows.length > PAGE_SIZE ? encodeCursor(page.at(-1)!) : null,
  };
}

/** Города предстоящих офлайн-событий: регистр не различается, пишется так, как у самого раннего события (D-061). */
export async function catalogCities(db: Queryable, now: Date): Promise<string[]> {
  const rows = await db
    .selectDistinctOn([sql`lower(${events.city})`], { city: events.city })
    .from(events)
    .where(and(eq(events.format, "offline"), gt(events.startsAt, now)))
    .orderBy(sql`lower(${events.city})`, asc(events.startsAt));
  return rows.map((r) => r.city!).sort((a, b) => a.localeCompare(b, "ru"));
}
