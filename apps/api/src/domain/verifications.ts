import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { emailVerifications } from "../db/schema.ts";
import { withTx, type Tx } from "../db/tx.ts";
import { enqueue } from "../mail/outbox.ts";
import { codeMail } from "../mail/templates/code.ts";
import type { VerificationRequest } from "../schemas/participant.ts";
import { belowMinAge } from "./age.ts";
import { newVerificationCode } from "./codes.ts";
import { lockEvent, started, type EventRow } from "./events.ts";
import { activeRegistration, allocate, type MailContext } from "./registrations.ts";

const CODE_TTL_MS = 10 * 60_000;
const RESEND_MS = 60_000;
export const MAX_CODE_ATTEMPTS = 5;

/** Сегодняшняя дата в UTC: дата рождения позже неё — точно в будущем. */
const isFutureDate = (date: string, now: Date) => date > now.toISOString().slice(0, 10);

/**
 * Выдача кода (SPEC, раздел 4, порядок проверок). Начало и возраст проверяются только у `register`:
 * `lookup` открыт и после начала (D-033). Новый код гасит прежние той же пары и того же назначения (D-039);
 * письмо с кодом — в той же транзакции.
 */
export async function issueVerification(db: Db, event: EventRow, input: VerificationRequest, { now }: MailContext) {
  if (input.purpose === "register") {
    if (started(event, now)) return { error: "registration_closed" as const };
    if (isFutureDate(input.birthDate, now)) return { error: "birth_date_in_future" as const };
    if (belowMinAge(input.birthDate, event)) return { error: "below_min_age" as const, minAge: event.minAge! };
  }
  const form = input.purpose === "register" ? input : undefined;

  const [previous] = await db
    .select({ createdAt: emailVerifications.createdAt })
    .from(emailVerifications)
    .where(and(eq(emailVerifications.eventId, event.id), eq(emailVerifications.email, input.email)))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);
  if (previous && now.getTime() - previous.createdAt.getTime() < RESEND_MS) {
    const retryAfter = Math.ceil((previous.createdAt.getTime() + RESEND_MS - now.getTime()) / 1000);
    return { error: "code_resend_too_soon" as const, retryAfter };
  }

  return withTx(db, async (tx) => {
    await tx
      .update(emailVerifications)
      .set({ expiresAt: now })
      .where(
        and(
          eq(emailVerifications.eventId, event.id),
          eq(emailVerifications.email, input.email),
          eq(emailVerifications.purpose, input.purpose),
          gt(emailVerifications.expiresAt, now),
        ),
      );
    const code = newVerificationCode();
    const [verification] = await tx
      .insert(emailVerifications)
      .values({
        eventId: event.id,
        email: input.email,
        purpose: input.purpose,
        firstName: form?.firstName,
        lastName: form?.lastName,
        birthDate: form?.birthDate,
        code,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        createdAt: now,
      })
      .returning();
    await enqueue(
      tx,
      { dedupKey: `code:${verification!.id}`, kind: "code", to: input.email, ...codeMail({ event, code }) },
      now,
    );
    return { verification: verification!, resendAfter: new Date(now.getTime() + RESEND_MS) };
  });
}

const consume = (tx: Tx, id: number, now: Date) =>
  tx.update(emailVerifications).set({ consumedAt: now }).where(eq(emailVerifications.id, id));

/**
 * Ввод кода (SPEC, раздел 4): строка кода берётся `FOR UPDATE`, попытки считаются без гонки.
 * Верный код `register` ведёт в `allocate`; повтор уже использованного кода — `existing` (D-046).
 * Верный код `lookup` — неотменённая регистрация этого email или `registration_not_found` (D-039).
 */
export async function confirmVerification(db: Db, id: number, code: string, ctx: MailContext) {
  return withTx(db, async (tx) => {
    const [verification] = await tx
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.id, id))
      .for("update");
    if (!verification) return { error: "not_found" as const };
    if (verification.expiresAt <= ctx.now) return { error: "code_expired" as const };
    if (verification.attempts >= MAX_CODE_ATTEMPTS) return { error: "code_attempts_exceeded" as const };
    if (verification.code !== code) {
      await tx
        .update(emailVerifications)
        .set({ attempts: sql`${emailVerifications.attempts} + 1` })
        .where(eq(emailVerifications.id, id));
      return { error: "code_invalid" as const, attemptsLeft: MAX_CODE_ATTEMPTS - verification.attempts - 1 };
    }

    // `lookup` только читает: повтор того же кода снова открывает регистрацию (D-048).
    if (verification.purpose === "lookup") {
      if (!verification.consumedAt) await consume(tx, id, ctx.now);
      const registration = await activeRegistration(tx, verification.eventId, verification.email);
      if (!registration) return { error: "registration_not_found" as const };
      return { result: "found" as const, registration };
    }

    if (verification.consumedAt) {
      const existing = await activeRegistration(tx, verification.eventId, verification.email);
      if (!existing) return { error: "code_expired" as const };
      return { result: "existing" as const, registration: existing };
    }

    await consume(tx, id, ctx.now);
    const event = await lockEvent(tx, verification.eventId);
    // Событие удалено вместе с кодами каскадом: до сюда не дойдём, но тип требует проверки.
    if (!event) return { error: "not_found" as const };
    return allocate(tx, event, verification, ctx);
  });
}
