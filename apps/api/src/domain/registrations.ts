import { and, eq, ne } from "drizzle-orm";
import { emailVerifications, registrations } from "../db/schema.ts";
import type { Queryable, Tx } from "../db/tx.ts";
import { enqueue } from "../mail/outbox.ts";
import { confirmedMail } from "../mail/templates/confirmed.ts";
import { newRegistrationToken, newTicketCode } from "./codes.ts";
import { countsFor, started, type EventRow } from "./events.ts";

export type RegistrationRow = typeof registrations.$inferSelect;
type Verification = typeof emailVerifications.$inferSelect;

/** Отказ правила мест; транзакция откатывается, маршрут переводит код в ответ. */
export class DomainError extends Error {
  constructor(readonly code: "registration_closed" | "no_seats") {
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
 * Распределение после верного кода `register` (SPEC, раздел 3). Вызывается под блокировкой события.
 * Пока мест нет — `no_seats`: лист ожидания приходит с тикетом R3.
 */
export async function allocate(tx: Tx, event: EventRow, verification: Verification, { now, publicUrl }: MailContext) {
  if (started(event, now)) throw new DomainError("registration_closed");

  const existing = await activeRegistration(tx, event.id, verification.email);
  // Данные формы повтора не применяются, писем нет (D-007).
  if (existing) return { result: "existing" as const, registration: existing };

  const counts = (await countsFor(tx, [event])).get(event.id)!;
  if (counts.confirmed >= event.seatLimit || counts.waitlisted > 0) throw new DomainError("no_seats");

  const [registration] = await tx
    .insert(registrations)
    .values({
      eventId: event.id,
      email: verification.email,
      firstName: verification.firstName!,
      lastName: verification.lastName!,
      birthDate: verification.birthDate!,
      status: "confirmed",
      token: newRegistrationToken(),
      ticketCode: newTicketCode(),
      verifiedAt: now,
      confirmedAt: now,
      createdAt: now,
    })
    .returning();
  await enqueue(
    tx,
    {
      dedupKey: `confirmed:${registration!.id}`,
      kind: "confirmed",
      to: registration!.email,
      ...confirmedMail({
        event,
        firstName: registration!.firstName,
        ticketCode: registration!.ticketCode!,
        link: personalLink(publicUrl, registration!.token),
      }),
    },
    now,
  );
  return { result: "confirmed" as const, registration: registration! };
}
