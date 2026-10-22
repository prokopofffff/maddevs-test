import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { correctionRequests, events, registrations } from "../db/schema.ts";
import { withTx, type Queryable, type Tx } from "../db/tx.ts";
import { enqueue } from "../mail/outbox.ts";
import { correctionAcceptedMail, correctionRejectedMail } from "../mail/templates/correction.ts";
import type { ParticipantData } from "../schemas/participant.ts";
import { belowMinAge, isFutureDate } from "./age.ts";
import { started, type EventRow } from "./events.ts";
import { personalLink, type MailContext, type RegistrationRow } from "./registrations.ts";

export type CorrectionRow = typeof correctionRequests.$inferSelect;

const proposed = (c: CorrectionRow): ParticipantData => ({
  firstName: c.newFirstName,
  lastName: c.newLastName,
  birthDate: c.newBirthDate,
});

/** Ожидающая заявка, как её видит участник на странице по личной ссылке. */
export const pendingCorrectionView = (c: CorrectionRow) => ({ ...proposed(c), createdAt: c.createdAt.toISOString() });

/** Ожидающая заявка регистрации — не больше одной (частичный уникальный индекс, D-031). */
export async function pendingCorrection(db: Queryable, registrationId: number) {
  const [row] = await db
    .select()
    .from(correctionRequests)
    .where(and(eq(correctionRequests.registrationId, registrationId), eq(correctionRequests.status, "pending")));
  return row;
}

/** Ожидающая заявка уходит из очереди: её заменили новой или регистрацию отменили (D-031). */
export async function withdrawPending(tx: Tx, registrationId: number, now: Date) {
  await tx
    .update(correctionRequests)
    .set({ status: "withdrawn", decidedAt: now })
    .where(and(eq(correctionRequests.registrationId, registrationId), eq(correctionRequests.status, "pending")));
}

/**
 * Подача по личной ссылке (SPEC, раздел 3). Вызывается под блокировкой события со строкой регистрации,
 * прочитанной уже после неё, — как отказ: начало и отмена проверяются в той же транзакции (D-033).
 */
export async function submitCorrection(
  tx: Tx,
  event: EventRow,
  registration: RegistrationRow,
  data: ParticipantData,
  now: Date,
) {
  if (started(event, now)) return { error: "event_started" as const };
  if (registration.status === "cancelled") return { error: "registration_cancelled" as const };
  if (isFutureDate(data.birthDate, now)) return { error: "birth_date_in_future" as const };
  const unchanged =
    data.firstName === registration.firstName &&
    data.lastName === registration.lastName &&
    data.birthDate === registration.birthDate;
  if (unchanged) return { error: "correction_unchanged" as const };

  await withdrawPending(tx, registration.id, now);
  const [inserted] = await tx
    .insert(correctionRequests)
    .values({
      registrationId: registration.id,
      oldFirstName: registration.firstName,
      oldLastName: registration.lastName,
      oldBirthDate: registration.birthDate,
      newFirstName: data.firstName,
      newLastName: data.lastName,
      newBirthDate: data.birthDate,
      status: "pending",
      createdAt: now,
    })
    .returning();
  return { correction: inserted! };
}

/** Очередь поддержки: только ожидающие, от старых к новым; предупреждение — по новой дате рождения (D-017, D-031). */
export async function correctionQueue(db: Queryable) {
  const rows = await db
    .select({ correction: correctionRequests, email: registrations.email, event: events })
    .from(correctionRequests)
    .innerJoin(registrations, eq(registrations.id, correctionRequests.registrationId))
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(eq(correctionRequests.status, "pending"))
    .orderBy(asc(correctionRequests.createdAt), asc(correctionRequests.id));
  return rows.map(({ correction: c, email, event }) => ({
    id: c.id,
    createdAt: c.createdAt.toISOString(),
    event: {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      timezone: event.timezone,
      minAge: event.minAge,
    },
    email,
    old: { firstName: c.oldFirstName, lastName: c.oldLastName, birthDate: c.oldBirthDate },
    new: proposed(c),
    belowMinAgeAfter: belowMinAge(c.newBirthDate, event),
  }));
}

export type Decision = { status: "accepted" } | { status: "rejected"; reason: string | null };

/**
 * Решение поддержки (SPEC, раздел 3). Строка регистрации блокируется до заявки — тот же порядок, что у отказа
 * и подачи («событие → регистрация → заявка»), поэтому они не встают в дедлок. Условный `UPDATE … WHERE status = 'pending'`
 * пропускает одно решение: второе «Принять», «Отклонить» или решение по отозванной заявке получает ноль строк (D-031).
 * Письмо участнику — в той же транзакции (D-013).
 */
export async function decideCorrection(
  db: Db,
  id: number,
  decision: Decision,
  { now, publicUrl, decidedBy }: MailContext & { decidedBy: number },
) {
  return withTx(db, async (tx) => {
    const [ref] = await tx
      .select({ registrationId: correctionRequests.registrationId })
      .from(correctionRequests)
      .where(eq(correctionRequests.id, id));
    if (!ref) return { error: "not_found" as const };
    const [row] = await tx
      .select({ registration: registrations, event: events })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(eq(registrations.id, ref.registrationId))
      .for("update", { of: registrations });
    const { event } = row!;

    const [decided] = await tx
      .update(correctionRequests)
      .set({
        status: decision.status,
        reason: decision.status === "rejected" ? decision.reason : null,
        decidedAt: now,
        decidedBy,
      })
      .where(and(eq(correctionRequests.id, id), eq(correctionRequests.status, "pending")))
      .returning();
    if (!decided) return { error: "correction_not_pending" as const };

    if (decision.status === "accepted") {
      const values = proposed(decided);
      const [registration] = await tx
        .update(registrations)
        .set(values)
        .where(eq(registrations.id, decided.registrationId))
        .returning();
      await enqueue(
        tx,
        {
          dedupKey: `correction:${decided.id}:accepted`,
          kind: "correction_accepted",
          to: registration!.email,
          ...correctionAcceptedMail({ event, values, link: personalLink(publicUrl, registration!.token) }),
        },
        now,
      );
    } else {
      const { registration } = row!;
      await enqueue(
        tx,
        {
          dedupKey: `correction:${decided.id}:rejected`,
          kind: "correction_rejected",
          to: registration.email,
          ...correctionRejectedMail({
            event,
            firstName: registration.firstName,
            proposed: proposed(decided),
            reason: decided.reason,
            link: personalLink(publicUrl, registration.token),
          }),
        },
        now,
      );
    }
    return { error: undefined, status: decided.status };
  });
}
