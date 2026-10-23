import { and, asc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { events, participantProfiles, registrations } from "../db/schema.ts";
import { withTx, type Queryable } from "../db/tx.ts";
import type { ParticipantData } from "../schemas/participant.ts";
import { belowMinAge, isFutureDate } from "./age.ts";
import { withdrawPending } from "./corrections.ts";
import { lockEvent } from "./events.ts";
import { cancel, type MailContext } from "./registrations.ts";

export type Profile = ParticipantData;

const profileColumns = {
  firstName: participantProfiles.firstName,
  lastName: participantProfiles.lastName,
  birthDate: participantProfiles.birthDate,
};

/** Профиль участника или `null`, пока он не заполнен (D-065). */
export async function getProfile(db: Queryable, email: string): Promise<Profile | null> {
  const [row] = await db.select(profileColumns).from(participantProfiles).where(eq(participantProfiles.email, email));
  return row ?? null;
}

/**
 * Профиль под `FOR SHARE`: регистрация в один клик читает его до блокировки события и держит до конца транзакции,
 * поэтому правка профиля (она берёт строку `FOR UPDATE` первой) не проскакивает между чтением и вставкой (D-065).
 * Параллельные регистрации одного email друг друга не ждут.
 */
export async function getProfileShared(tx: Queryable, email: string): Promise<Profile | null> {
  const [row] = await tx
    .select(profileColumns)
    .from(participantProfiles)
    .where(eq(participantProfiles.email, email))
    .for("share");
  return row ?? null;
}

/**
 * Профиль из данных первой регистрации; уже существующий не трогает, в том числе при гонке двух регистраций
 * одного email на разные события. `true` — строку создали мы (D-065).
 */
export async function createProfileIfMissing(tx: Queryable, email: string, data: Profile, now: Date) {
  const inserted = await tx
    .insert(participantProfiles)
    .values({ email, ...data, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ email: participantProfiles.email });
  return inserted.length > 0;
}

/** Выход из транзакции с откатом и готовым ответом: `withTx` повторяет только сбои сериализации и дедлоки. */
export class ProfileRollback<T = SaveProfileResult> extends Error {
  constructor(readonly result: T) {
    super("rollback");
  }
}

export type SaveProfileResult =
  | { error: "birth_date_in_future" }
  | {
      error: "profile_conflicts";
      events: { id: string; title: string; startsAt: string; timezone: string; minAge: number }[];
    }
  | { profile: Profile; updated: number; cancelled: { id: string; title: string }[] };

/**
 * Сохранение профиля с переносом в регистрации (D-065). Затрагиваются неотменённые регистрации email
 * на события, которые ещё не начались, без чекина; остальные остаются как были.
 *
 * Порядок блокировок «профиль → события → регистрации» (D-011, D-065). Первым берётся `FOR UPDATE` строка профиля
 * (нет строки — вставляем и держим её): регистрация в один клик читает профиль `FOR SHARE` до блокировки события,
 * поэтому либо читает уже новые данные, либо правка видит её регистрацию среди кандидатов. Затронутые события берутся
 * `FOR UPDATE` по возрастанию id, и только после этого заново читаются регистрации. Профиль после блокировки события
 * не берётся нигде.
 *
 * Конфликт — регистрация, у которой дата рождения действительно меняется и новая не проходит по `min_age` на день
 * события. Прежняя дата, не проходящая по возрасту после повышения `min_age` организатором, остаётся (D-017):
 * правка опечатки в имени такую регистрацию не отменяет. Конфликты без согласия откатывают транзакцию целиком,
 * в том числе вставленную строку профиля. Отказ — тот же `cancel`, что у личной ссылки: письмо `cancelled` и повышение
 * первого из листа ожидания (D-012). Письма об изменении самих данных нет.
 */
export async function saveProfile(
  db: Db,
  email: string,
  data: Profile,
  { cancelConflicts }: { cancelConflicts: boolean },
  ctx: MailContext,
): Promise<SaveProfileResult> {
  const { now } = ctx;
  if (isFutureDate(data.birthDate, now)) return { error: "birth_date_in_future" };

  try {
    return await withTx(db, async (tx) => {
      // Строка профиля первой: нет её — вставляем с новыми данными (при `409` откатится вместе с транзакцией).
      await tx
        .insert(participantProfiles)
        .values({ email, ...data, createdAt: now, updatedAt: now })
        .onConflictDoNothing();
      await tx
        .select({ email: participantProfiles.email })
        .from(participantProfiles)
        .where(eq(participantProfiles.email, email))
        .for("update");

      // Подходящие регистрации ищем до блокировок событий: нужны только id, сами строки перечитаются под блокировкой.
      const candidates = await tx
        .selectDistinct({ eventId: registrations.eventId })
        .from(registrations)
        .innerJoin(events, eq(events.id, registrations.eventId))
        .where(
          and(
            eq(registrations.email, email),
            ne(registrations.status, "cancelled"),
            isNull(registrations.checkedInAt),
            gt(events.startsAt, now),
          ),
        )
        .orderBy(asc(registrations.eventId));
      const locked = new Map<string, NonNullable<Awaited<ReturnType<typeof lockEvent>>>>();
      for (const { eventId } of candidates) {
        const event = await lockEvent(tx, eventId);
        if (event) locked.set(eventId, event);
      }

      // Только регистрации заблокированных событий: чужие строки не берём, чтобы не нарушить порядок «событие → регистрация».
      const rows =
        locked.size === 0
          ? []
          : (
              await tx
                .select()
                .from(registrations)
                .where(
                  and(
                    eq(registrations.email, email),
                    ne(registrations.status, "cancelled"),
                    isNull(registrations.checkedInAt),
                    inArray(registrations.eventId, [...locked.keys()]),
                  ),
                )
                .orderBy(asc(registrations.eventId), asc(registrations.id))
                .for("update")
            ).flatMap((registration) => {
              const event = locked.get(registration.eventId)!;
              // Событие началось, пока ждали блокировку: уже не трогаем.
              return event.startsAt > now ? [{ registration, event }] : [];
            });

      const isConflict = ({ registration, event }: (typeof rows)[number]) =>
        registration.birthDate !== data.birthDate && belowMinAge(data.birthDate, event);
      const conflicts = rows.filter(isConflict);
      if (conflicts.length > 0 && !cancelConflicts) {
        throw new ProfileRollback({
          error: "profile_conflicts",
          events: conflicts
            .map(({ event }) => event)
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
            .map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt.toISOString(), timezone: e.timezone, minAge: e.minAge })),
        });
      }

      const cancelled: { id: string; title: string }[] = [];
      let updated = 0;
      for (const row of rows) {
        const { registration, event } = row;
        if (isConflict(row)) {
          await cancel(tx, event, registration, ctx);
          cancelled.push({ id: event.id, title: event.title });
          continue;
        }
        if (
          registration.firstName !== data.firstName ||
          registration.lastName !== data.lastName ||
          registration.birthDate !== data.birthDate
        ) {
          updated++;
        }
        await tx.update(registrations).set(data).where(eq(registrations.id, registration.id));
        // Заявка на исправление написана раньше профиля, даже если значения совпали: решение поддержки перезаписало бы их (D-031).
        await withdrawPending(tx, registration.id, now);
      }

      await tx
        .update(participantProfiles)
        .set({ ...data, updatedAt: now })
        .where(eq(participantProfiles.email, email));
      return { profile: data, updated, cancelled };
    });
  } catch (error) {
    if (error instanceof ProfileRollback) return error.result;
    throw error;
  }
}
