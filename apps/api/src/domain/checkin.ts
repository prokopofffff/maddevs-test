import { and, eq, isNull } from "drizzle-orm";
import { registrations } from "../db/schema.ts";
import type { Queryable } from "../db/tx.ts";
import { normalizeTicketCode, TICKET_CODE } from "../schemas/ticket.ts";
import type { RegistrationRow } from "./registrations.ts";

/** Билет события по коду в любом написании; код другого события не находится (D-022). */
export async function findTicket(db: Queryable, eventId: string, input: string): Promise<RegistrationRow | undefined> {
  const code = normalizeTicketCode(input);
  if (!TICKET_CODE.test(code)) return undefined;
  const [row] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.ticketCode, code)));
  return row;
}

export type CheckinResult =
  | { registration: RegistrationRow; error?: undefined }
  | { error: "already_checked_in"; registration: RegistrationRow }
  | { error: "ticket_cancelled" | "ticket_not_found" };

/**
 * Отметка чекина (SPEC, раздел 3). Строку события не блокирует и от начала события не зависит (D-022, D-033).
 * Однократность держит условный `UPDATE`: параллельный запрос ждёт блокировку строки, после коммита
 * первого перепроверяет `WHERE` и обновляет ноль строк. Причину нуля объясняет второй запрос.
 */
export async function checkIn(db: Queryable, eventId: string, input: string, now: Date): Promise<CheckinResult> {
  const code = normalizeTicketCode(input);
  if (!TICKET_CODE.test(code)) return { error: "ticket_not_found" };
  for (let attempt = 1; ; attempt++) {
    const [marked] = await db
      .update(registrations)
      .set({ checkedInAt: now })
      .where(
        and(
          eq(registrations.eventId, eventId),
          eq(registrations.ticketCode, code),
          eq(registrations.status, "confirmed"),
          isNull(registrations.checkedInAt),
        ),
      )
      .returning();
    if (marked) return { registration: marked };

    const found = await findTicket(db, eventId, code);
    if (!found) return { error: "ticket_not_found" };
    if (found.status === "cancelled") return { error: "ticket_cancelled" };
    // Между двумя запросами отметку могли снять — тогда билет снова проходит, пробуем ещё раз.
    if (found.checkedInAt || attempt >= 3) return { error: "already_checked_in", registration: found };
  }
}
