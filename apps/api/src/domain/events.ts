import { eq, inArray, sql } from "drizzle-orm";
import { events, registrations } from "../db/schema.ts";
import type { Queryable, Tx } from "../db/tx.ts";
import type { EventPatch } from "../schemas/event.ts";
import { localToInstant } from "../time.ts";
import { fillFreeSeats, type MailContext } from "./registrations.ts";

export type EventRow = typeof events.$inferSelect;

export interface Counts {
  confirmed: number;
  limit: number;
  waitlisted: number;
  checkedIn: number;
}

/** Ровно в момент начала событие уже началось (D-033). */
export const started = (event: Pick<EventRow, "startsAt">, now: Date) => now >= event.startsAt;

/** Счётчики не хранятся: один запрос по `(event_id, status)` (D-011). */
export async function countsFor(db: Queryable, list: Pick<EventRow, "id" | "seatLimit">[]): Promise<Map<string, Counts>> {
  const result = new Map<string, Counts>(
    list.map((e) => [e.id, { confirmed: 0, limit: e.seatLimit, waitlisted: 0, checkedIn: 0 }]),
  );
  if (list.length === 0) return result;
  const rows = await db
    .select({
      eventId: registrations.eventId,
      confirmed: sql<number>`count(*) filter (where ${registrations.status} = 'confirmed')::int`,
      waitlisted: sql<number>`count(*) filter (where ${registrations.status} = 'waitlisted')::int`,
      checkedIn: sql<number>`count(*) filter (where ${registrations.status} = 'confirmed' and ${registrations.checkedInAt} is not null)::int`,
    })
    .from(registrations)
    .where(
      inArray(
        registrations.eventId,
        list.map((e) => e.id),
      ),
    )
    .groupBy(registrations.eventId);
  for (const { eventId, ...counts } of rows) Object.assign(result.get(eventId)!, counts);
  return result;
}

/** Лимит минус подтверждённые, не меньше нуля; ноль при непустом листе ожидания и после начала (D-026, D-032, D-033). */
/** Строка события под блокировкой: первый шаг любой транзакции, меняющей места (D-011). */
export async function lockEvent(tx: Queryable, id: string): Promise<EventRow | undefined> {
  const [event] = await tx.select().from(events).where(eq(events.id, id)).for("update");
  return event;
}

export function freeSeats(event: Pick<EventRow, "startsAt">, counts: Counts, now: Date) {
  if (started(event, now) || counts.waitlisted > 0) return 0;
  return Math.max(0, counts.limit - counts.confirmed);
}

/** Правка организатором: событие уже под блокировкой (SPEC, раздел 3). */
export async function updateEvent(
  tx: Tx,
  event: EventRow,
  patch: EventPatch,
  ctx: MailContext,
): Promise<EventRow | { error: "not_implemented" | "event_started" }> {
  const { now } = ctx;
  const timezone = patch.timezone ?? event.timezone;
  // Без `startsLocal` момент сохраняется; смена только пояса — не перенос (D-016).
  const startsAt = patch.startsLocal ? localToInstant(patch.startsLocal, timezone) : event.startsAt;
  // Заглушка: перенос — тикет «R6 — перенос события».
  const moved = startsAt.getTime() !== event.startsAt.getTime();
  if (moved) return { error: "not_implemented" };
  const resized = patch.limit !== undefined && patch.limit !== event.seatLimit;
  // После начала место всё равно никто не получит (D-033).
  if (resized && started(event, now)) return { error: "event_started" };

  const [updated] = await tx
    .update(events)
    .set({
      title: patch.title ?? event.title,
      description: patch.description ?? event.description,
      timezone,
      seatLimit: patch.limit ?? event.seatLimit,
      minAge: patch.minAge === undefined ? event.minAge : patch.minAge,
      updatedAt: now,
    })
    .where(eq(events.id, event.id))
    .returning();
  // Новые места сразу забирает лист ожидания; ниже подтверждённых — никого не трогаем (D-012, D-032).
  if (resized) await fillFreeSeats(tx, updated!, ctx);
  return updated!;
}

/** Удаление события, созданного по ошибке: только без единой регистрации, включая отменённые; коды подтверждения уходят каскадом (D-035). */
export async function deleteEvent(tx: Tx, event: EventRow): Promise<{ error: "event_has_registrations" } | undefined> {
  const [any] = await tx.select({ id: registrations.id }).from(registrations).where(eq(registrations.eventId, event.id)).limit(1);
  if (any) return { error: "event_has_registrations" };
  await tx.delete(events).where(eq(events.id, event.id));
}
