import { eq, inArray, sql } from "drizzle-orm";
import { events, registrations } from "../db/schema.ts";
import type { Queryable, Tx } from "../db/tx.ts";
import type { EventPatch } from "../schemas/event.ts";
import { localToInstant } from "../time.ts";
import { enqueue } from "../mail/outbox.ts";
import { rescheduledMail } from "../mail/templates/rescheduled.ts";
import { belowMinAge } from "./age.ts";
import { eventRegistrations, fillFreeSeats, personalLink, type MailContext } from "./registrations.ts";

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

export interface EventUpdate {
  event: EventRow;
  rescheduled: boolean;
  /** Неотменённые регистрации, не проходящие по возрасту на день события после правки (D-017). */
  belowMinAgeCount: number;
}

/** Правка организатором: событие уже под блокировкой (SPEC, раздел 3). */
export async function updateEvent(
  tx: Tx,
  event: EventRow,
  patch: EventPatch,
  ctx: MailContext,
): Promise<
  EventUpdate | { error: "event_started" | "starts_in_past" } | { error: "place_required"; fields: ("city" | "address")[] }
> {
  const { now, publicUrl } = ctx;
  const timezone = patch.timezone ?? event.timezone;
  // Без `startsLocal` момент сохраняется; смена только пояса — не перенос (D-016).
  const startsAt = patch.startsLocal ? localToInstant(patch.startsLocal, timezone) : event.startsAt;
  const moved = startsAt.getTime() !== event.startsAt.getTime();
  const resized = patch.limit !== undefined && patch.limit !== event.seatLimit;
  // После начала место всё равно никто не получит, а переносить уже идущее событие некуда (D-016, D-033).
  if ((moved || resized) && started(event, now)) return { error: "event_started" };
  if (moved && startsAt <= now) return { error: "starts_in_past" };

  // Пара «формат — место» проверяется по слитым значениям: правка может прислать только `format` (D-059).
  const format = patch.format ?? event.format;
  const city = format === "online" ? null : (patch.city ?? event.city);
  const address = format === "online" ? null : (patch.address ?? event.address);
  if (format === "offline" && (!city || !address)) {
    return { error: "place_required", fields: [...(city ? [] : (["city"] as const)), ...(address ? [] : (["address"] as const))] };
  }

  const [updated] = await tx
    .update(events)
    .set({
      title: patch.title ?? event.title,
      description: patch.description ?? event.description,
      startsAt,
      timezone,
      seatLimit: patch.limit ?? event.seatLimit,
      format,
      city,
      address,
      category: patch.category ?? event.category,
      minAge: patch.minAge ?? event.minAge,
      // Номер переноса различает письма о переносе и «раунды» напоминаний (D-016, D-018).
      ...(moved && { rescheduleCount: event.rescheduleCount + 1, rescheduledAt: now }),
      updatedAt: now,
    })
    .where(eq(events.id, event.id))
    .returning();

  // Блокировка события держит список неотменённых: регистрация и отказ ждут коммита (D-016).
  const active = (await eventRegistrations(tx, event.id)).filter(({ row }) => row.status !== "cancelled");
  if (moved) {
    for (const { row, waitlistPosition } of active) {
      await enqueue(
        tx,
        {
          dedupKey: `rescheduled:${row.id}:${updated!.rescheduleCount}`,
          kind: "rescheduled",
          to: row.email,
          ...rescheduledMail({
            event: updated!,
            previous: event,
            firstName: row.firstName,
            status: waitlistPosition === null ? { ticketCode: row.ticketCode! } : { position: waitlistPosition },
            link: personalLink(publicUrl, row.token),
          }),
        },
        now,
      );
    }
  }
  // Новые места сразу забирает лист ожидания; ниже подтверждённых — никого не трогаем (D-012, D-032).
  if (resized) await fillFreeSeats(tx, updated!, ctx);
  // Возраст проверялся при регистрации; правка ничего не отменяет, только считает (D-017).
  const belowMinAgeCount = active.filter(({ row }) => belowMinAge(row.birthDate, updated!)).length;
  return { event: updated!, rescheduled: moved, belowMinAgeCount };
}

/** Удаление события, созданного по ошибке: только без единой регистрации, включая отменённые; коды подтверждения уходят каскадом (D-035). */
export async function deleteEvent(tx: Tx, event: EventRow): Promise<{ error: "event_has_registrations" } | undefined> {
  const [any] = await tx.select({ id: registrations.id }).from(registrations).where(eq(registrations.eventId, event.id)).limit(1);
  if (any) return { error: "event_has_registrations" };
  await tx.delete(events).where(eq(events.id, event.id));
}
