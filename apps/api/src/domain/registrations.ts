import { and, asc, eq, ne, sql } from "drizzle-orm";
import { emailVerifications, events, registrations } from "../db/schema.ts";
import { withTx, type Queryable, type Tx } from "../db/tx.ts";
import { enqueue } from "../mail/outbox.ts";
import { cancelledMail } from "../mail/templates/cancelled.ts";
import { confirmedMail } from "../mail/templates/confirmed.ts";
import { promotedMail } from "../mail/templates/promoted.ts";
import { waitlistedMail } from "../mail/templates/waitlisted.ts";
import type { Db } from "../db/client.ts";
import type { ParticipantData } from "../schemas/participant.ts";
import { ageOnEventDay, belowMinAge, isFutureDate } from "./age.ts";
import { newRegistrationToken, newTicketCode } from "./codes.ts";
import { withdrawPending } from "./corrections.ts";
import { countsFor, lockEvent, started, type EventRow } from "./events.ts";
import { createProfileIfMissing, getProfileShared, ProfileRollback } from "./profile.ts";

export type RegistrationRow = typeof registrations.$inferSelect;
export type Verification = typeof emailVerifications.$inferSelect;

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
 * Все регистрации события для организатора, включая отменённые: подтверждённые по времени места,
 * лист ожидания по номеру — `(verified_at, id)` (D-012), отменённые по времени отказа (D-051).
 */
export async function eventRegistrations(db: Queryable, eventId: string) {
  const { status } = registrations;
  const rows = await db
    .select()
    .from(registrations)
    .where(eq(registrations.eventId, eventId))
    .orderBy(
      sql`case ${status} when 'confirmed' then 0 when 'waitlisted' then 1 else 2 end`,
      sql`case ${status} when 'confirmed' then ${registrations.confirmedAt}
        when 'waitlisted' then ${registrations.verifiedAt} else ${registrations.cancelledAt} end`,
      asc(registrations.id),
    );
  let position = 0;
  return rows.map((row) => ({ row, waitlistPosition: row.status === "waitlisted" ? ++position : null }));
}

export interface ParticipantRegistration {
  token: string;
  status: RegistrationRow["status"];
  waitlistPosition?: number;
  ticketCode: string | null;
  checkedInAt: string | null;
  cancelledAt: string | null;
  event: {
    id: string;
    title: string;
    startsAt: string;
    timezone: string;
    format: EventRow["format"];
    city: string | null;
    started: boolean;
  };
}

/**
 * «Мои регистрации» (D-057): все строки email, включая отменённые — повторная регистрация после отказа
 * даёт вторую строку, видны обе (D-007). Порядок — по началу события, внутри события по созданию;
 * деление на «Текущие» и «Прошедшие» — на клиенте. Поля — как у `GET /registrations/:token`:
 * билет только у `confirmed` (D-022), номер в листе ожидания считается на сейчас (D-012).
 */
export async function participantRegistrations(db: Queryable, email: string, now: Date): Promise<ParticipantRegistration[]> {
  const rows = await db
    .select({ registration: registrations, event: events })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(eq(registrations.email, email))
    .orderBy(asc(events.startsAt), asc(registrations.createdAt), asc(registrations.id));
  return Promise.all(
    rows.map(async ({ registration: r, event }) => ({
      token: r.token,
      status: r.status,
      ...(r.status === "waitlisted" ? { waitlistPosition: await waitlistPosition(db, r) } : {}),
      ticketCode: r.status === "confirmed" ? r.ticketCode : null,
      checkedInAt: r.checkedInAt?.toISOString() ?? null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      event: {
        id: event.id,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        timezone: event.timezone,
        format: event.format,
        city: event.city,
        started: started(event, now),
      },
    })),
  );
}

/** Список участников для организатора и поддержки (только чтение): возраст и предупреждение — на день события (D-017). */
export async function registrationList(db: Queryable, event: EventRow) {
  const list = await eventRegistrations(db, event.id);
  return list.map(({ row: r, waitlistPosition }) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    birthDate: r.birthDate,
    ageOnEventDay: ageOnEventDay(r.birthDate, event),
    belowMinAge: belowMinAge(r.birthDate, event),
    status: r.status,
    waitlistPosition,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
  }));
}

/** Кто регистрируется: поля кода `register` (D-007) или сессия участника плюс форма (D-058). */
export type Applicant = { email: string; firstName: string; lastName: string; birthDate: string };

/**
 * Распределение после верного кода `register` или регистрации без кода под сессией участника (SPEC, раздел 3).
 * Вызывается под блокировкой события, поэтому подсчёт и вставка не гоняются с параллельными
 * подтверждениями и друг с другом (D-011, D-058).
 */
export async function allocate(tx: Tx, event: EventRow, applicant: Applicant, { now, publicUrl }: MailContext) {
  if (started(event, now)) throw new DomainError("registration_closed");

  const existing = await activeRegistration(tx, event.id, applicant.email);
  // Данные формы повтора не применяются, писем нет (D-007).
  if (existing) return { result: "existing" as const, registration: existing };

  const counts = (await countsFor(tx, [event])).get(event.id)!;
  const seat = counts.confirmed < event.seatLimit && counts.waitlisted === 0;

  const [inserted] = await tx
    .insert(registrations)
    .values({
      eventId: event.id,
      email: applicant.email,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      birthDate: applicant.birthDate,
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

export type AllocateResult = Awaited<ReturnType<typeof allocate>>;

/**
 * Регистрация без кода под сессией участника (D-058): email уже подтверждён кодом входа, поэтому шага с кодом нет.
 * Данные берутся из тела или, если тело пустое (`data = null`), из профиля — «в один клик» (D-065); нет ни того ни другого —
 * `profile_required`. Порядок проверок как у выдачи кода (SPEC, раздел 4): начало, будущая дата, возраст; сами проверки —
 * под блокировкой события и тем же `allocate`, что у регистрации по коду, так что последнее место делится честно.
 *
 * Порядок блокировок «профиль → событие» (D-065): профиль читается `FOR SHARE` до `lockEvent` и держится до конца
 * транзакции, чтобы правка профиля не прошла между чтением и вставкой. Данные из тела, если профиля ещё нет, создают его
 * тоже до блокировки события; при любом исходе кроме новой регистрации транзакция откатывается вместе с ним.
 */
export async function registerSignedIn(db: Db, eventId: string, email: string, data: ParticipantData | null, ctx: MailContext) {
  type Result =
    | AllocateResult
    | { error: "not_found" | "birth_date_in_future" | "profile_required" }
    | { error: "below_min_age"; minAge: number };
  try {
    return await withTx(db, async (tx): Promise<Result> => {
      const profile = await getProfileShared(tx, email);
      const createdProfile = !profile && data !== null && (await createProfileIfMissing(tx, email, data, ctx.now));
      /** Результат без регистрации не оставляет и созданный профиль. */
      const refuse = (result: Result): Result => {
        if (createdProfile) throw new ProfileRollback(result);
        return result;
      };

      const event = await lockEvent(tx, eventId);
      if (!event) return refuse({ error: "not_found" });
      if (started(event, ctx.now)) throw new DomainError("registration_closed");
      const applicant = data ?? profile;
      if (!applicant) return refuse({ error: "profile_required" });
      if (isFutureDate(applicant.birthDate, ctx.now)) return refuse({ error: "birth_date_in_future" });
      if (belowMinAge(applicant.birthDate, event)) return refuse({ error: "below_min_age", minAge: event.minAge });
      const allocated = await allocate(tx, event, { email, ...applicant }, ctx);
      // Повтор («existing») данных формы не применяет (D-007), значит и профиль из них не берёт.
      return allocated.result === "existing" ? refuse(allocated) : allocated;
    });
  } catch (error) {
    if (error instanceof ProfileRollback) return error.result as Result;
    throw error;
  }
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
  // Ожидающая заявка на исправление уходит из очереди вместе с регистрацией (D-031).
  await withdrawPending(tx, registration.id, now);
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
