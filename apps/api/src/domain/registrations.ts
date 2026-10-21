import { and, asc, eq, ne, sql } from "drizzle-orm";
import { emailVerifications, registrations } from "../db/schema.ts";
import type { Queryable, Tx } from "../db/tx.ts";
import { enqueue } from "../mail/outbox.ts";
import { cancelledMail } from "../mail/templates/cancelled.ts";
import { confirmedMail } from "../mail/templates/confirmed.ts";
import { promotedMail } from "../mail/templates/promoted.ts";
import { waitlistedMail } from "../mail/templates/waitlisted.ts";
import { newRegistrationToken, newTicketCode } from "./codes.ts";
import { countsFor, started, type EventRow } from "./events.ts";

export type RegistrationRow = typeof registrations.$inferSelect;
type Verification = typeof emailVerifications.$inferSelect;

/** Отказ правила мест; транзакция откатывается, маршрут переводит код в ответ. */
export class DomainError extends Error {
  constructor(readonly code: "registration_closed" | "event_started" | "already_checked_in") {
    super(code);
  }
}

export interface MailContext {
  now: Date;
  publicUrl: string;
}

export const personalLink = (publicUrl: string, token: string) => `${publicUrl}/r/${token}`;

/** Неотменённая регистрация email на событие — не больше одной (D-007, D-011). */
export async function activeRegistration(db: Queryable, eventId: string, email: string) {
  const [row] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.email, email), ne(registrations.status, "cancelled")));
  return row;
}

/**
 * Позиция в листе ожидания не хранится: 1 + число `waitlisted` того же события
 * с меньшим `(verified_at, id)` (D-012).
 */
export async function waitlistPosition(db: Queryable, registration: RegistrationRow) {
  const [row] = await db
    .select({ ahead: sql<number>`count(*)::int` })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, registration.eventId),
        eq(registrations.status, "waitlisted"),
        // В сыром `sql` Date не кодируется сам: параметр берёт кодировщик колонки.
        sql`(${registrations.verifiedAt}, ${registrations.id})
          < (${sql.param(registration.verifiedAt, registrations.verifiedAt)}, ${registration.id})`,
      ),
    );
  return row!.ahead + 1;
}

/**
 * Распределение после верного кода `register` (SPEC, раздел 3). Вызывается под блокировкой события,
 * поэтому подсчёт и вставка не гоняются с параллельными подтверждениями (D-011).
 */
export async function allocate(tx: Tx, event: EventRow, verification: Verification, { now, publicUrl }: MailContext) {
  if (started(event, now)) throw new DomainError("registration_closed");

  const existing = await activeRegistration(tx, event.id, verification.email);
  // Данные формы повтора не применяются, писем нет (D-007).
  if (existing) return { result: "existing" as const, registration: existing };

  const counts = (await countsFor(tx, [event])).get(event.id)!;
  const seat = counts.confirmed < event.seatLimit && counts.waitlisted === 0;

  const [inserted] = await tx
    .insert(registrations)
    .values({
      eventId: event.id,
      email: verification.email,
      firstName: verification.firstName!,
      lastName: verification.lastName!,
      birthDate: verification.birthDate!,
      status: seat ? "confirmed" : "waitlisted",
      token: newRegistrationToken(),
      ticketCode: seat ? newTicketCode() : null,
      verifiedAt: now,
      confirmedAt: seat ? now : null,
      createdAt: now,
    })
    .returning();
  const registration = inserted!;
  const link = personalLink(publicUrl, registration.token);

  if (seat) {
    await enqueue(
      tx,
      {
        dedupKey: `confirmed:${registration.id}`,
        kind: "confirmed",
        to: registration.email,
        ...confirmedMail({ event, firstName: registration.firstName, ticketCode: registration.ticketCode!, link }),
      },
      now,
    );
    return { result: "confirmed" as const, registration };
  }

  const position = await waitlistPosition(tx, registration);
  await enqueue(
    tx,
    {
      dedupKey: `waitlisted:${registration.id}`,
      kind: "waitlisted",
      to: registration.email,
      ...waitlistedMail({ event, firstName: registration.firstName, position, link }),
    },
    now,
  );
  return { result: "waitlisted" as const, registration, waitlistPosition: position };
}

/**
 * Заполнение свободных мест первыми из листа ожидания (SPEC, раздел 3) — после отказа подтверждённого
 * и после изменения лимита. Вызывается под блокировкой события; после начала повышений нет (D-012, D-032, D-033).
 */
export async function fillFreeSeats(tx: Tx, event: EventRow, { now, publicUrl }: MailContext) {
  if (started(event, now)) return;
  const counts = (await countsFor(tx, [event])).get(event.id)!;
  const free = event.seatLimit - counts.confirmed;
  if (free <= 0) return;

  const next = await tx
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, event.id), eq(registrations.status, "waitlisted")))
    .orderBy(asc(registrations.verifiedAt), asc(registrations.id))
    .limit(free)
    .for("update");
  for (const waiting of next) {
    const [promoted] = await tx
      .update(registrations)
      .set({ status: "confirmed", ticketCode: newTicketCode(), confirmedAt: now })
      .where(eq(registrations.id, waiting.id))
      .returning();
    await enqueue(
      tx,
      {
        dedupKey: `promoted:${promoted!.id}`,
        kind: "promoted",
        to: promoted!.email,
        ...promotedMail({
          event,
          firstName: promoted!.firstName,
          ticketCode: promoted!.ticketCode!,
          link: personalLink(publicUrl, promoted!.token),
        }),
      },
      now,
    );
  }
}

/**
 * Отказ по личной ссылке (SPEC, раздел 3). Вызывается под блокировкой события со строкой регистрации,
 * прочитанной уже после неё. Повторный отказ ничего не меняет и писем не шлёт (D-007, D-022, D-033).
 */
export async function cancel(tx: Tx, event: EventRow, registration: RegistrationRow, ctx: MailContext) {
  const { now } = ctx;
  if (started(event, now)) throw new DomainError("event_started");
  if (registration.checkedInAt) throw new DomainError("already_checked_in");
  if (registration.status === "cancelled") return registration;

  const [cancelled] = await tx
    .update(registrations)
    .set({ status: "cancelled", cancelledAt: now })
    .where(eq(registrations.id, registration.id))
    .returning();
  await enqueue(
    tx,
    {
      dedupKey: `cancelled:${registration.id}`,
      kind: "cancelled",
      to: registration.email,
      ...cancelledMail({ event, firstName: registration.firstName }),
    },
    now,
  );
  // Освободилось место только у подтверждённой; уход из листа ожидания никого не повышает (D-007).
  if (registration.status === "confirmed") await fillFreeSeats(tx, event, ctx);
  return cancelled!;
}
