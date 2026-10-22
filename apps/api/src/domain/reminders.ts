import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { emailOutbox, events, registrations } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { enqueue } from "../mail/outbox.ts";
import { reminderMail } from "../mail/templates/reminder.ts";
import { personalLink, type MailContext } from "./registrations.ts";

const DAY_MS = 24 * 60 * 60_000;

/**
 * Проход напоминаний (SPEC, раздел 6; D-018). Время — параметр, `now()` в SQL нет.
 * Одно напоминание на регистрацию и время начала держится на ключе `reminder:<id>:<reschedule_count>`;
 * подтверждённым или перенесённым меньше чем за сутки до начала его заменяет письмо о месте или о переносе (D-016, D-019).
 */
export async function sweepReminders(db: Db, { now, publicUrl }: MailContext) {
  return withTx(db, async (tx) => {
    // FOR SHARE ждёт идущие регистрацию, отказ с повышением и перенос этих событий (D-011, D-016):
    // следующий запрос в READ COMMITTED видит их результат целиком.
    const due = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(gt(events.startsAt, now), lte(events.startsAt, new Date(now.getTime() + DAY_MS))))
      .for("share");
    if (due.length === 0) return 0;

    const dedupKey = sql<string>`'reminder:' || ${registrations.id} || ':' || ${events.rescheduleCount}`;
    const rows = await tx
      .select({ registration: registrations, event: events, dedupKey })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(
        and(
          inArray(
            registrations.eventId,
            due.map((e) => e.id),
          ),
          eq(registrations.status, "confirmed"),
          // `greatest` пропускает NULL: без переносов сравнивается только `confirmed_at`.
          sql`greatest(${registrations.confirmedAt}, ${events.rescheduledAt}) < ${events.startsAt} - interval '24 hours'`,
          // Уже поставленные не рендерятся заново каждую минуту; однократность всё равно держит ON CONFLICT.
          sql`not exists (select 1 from ${emailOutbox} where ${emailOutbox.dedupKey} = ${dedupKey})`,
        ),
      );

    for (const { registration, event, dedupKey } of rows) {
      await enqueue(
        tx,
        {
          dedupKey,
          kind: "reminder",
          to: registration.email,
          ...reminderMail({
            event,
            firstName: registration.firstName,
            ticketCode: registration.ticketCode!,
            link: personalLink(publicUrl, registration.token),
          }),
        },
        now,
      );
    }
    return rows.length;
  });
}
