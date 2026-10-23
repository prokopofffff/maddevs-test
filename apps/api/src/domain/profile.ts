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

/** Профиль участника или `null`, пока он не заполнен (D-065). */
export async function getProfile(db: Queryable, email: string): Promise<Profile | null> {
  const [row] = await db
    .select({
      firstName: participantProfiles.firstName,
      lastName: participantProfiles.lastName,
      birthDate: participantProfiles.birthDate,
    })
    .from(participantProfiles)
    .where(eq(participantProfiles.email, email));
  return row ?? null;
}

/**
 * Профиль из данных первой регистрации; уже существующий не трогает, в том числе при гонке двух регистраций
 * одного email на разные события (D-065).
 */
export async function createProfileIfMissing(tx: Queryable, email: string, data: Profile, now: Date) {
  await tx
    .insert(participantProfiles)
    .values({ email, ...data, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
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
 * Порядок блокировок тот же, что у регистрации и отказа, — «событие → регистрации» (D-011): затронутые события
 * берутся под `FOR UPDATE` по возрастанию id, чтобы две правки или правка с регистрацией не встали в дедлок,
 * и только после этого заново читаются регистрации. Конфликты возраста без согласия отвечают до первой записи,
 * так что транзакция ничего не меняет. Отказ — тот же `cancel`, что у личной ссылки: письмо `cancelled` и повышение
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

  return withTx(db, async (tx) => {
    // Подходящие регистрации ищем до блокировок: нужны только id событий, сами строки перечитаются под блокировкой.
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

    const conflicts = rows.filter(({ event }) => belowMinAge(data.birthDate, event));
    if (conflicts.length > 0 && !cancelConflicts) {
      return {
        error: "profile_conflicts" as const,
        events: conflicts
          .map(({ event }) => event)
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
          .map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt.toISOString(), timezone: e.timezone, minAge: e.minAge })),
      };
    }

    const cancelled: { id: string; title: string }[] = [];
    let updated = 0;
    for (const { registration, event } of rows) {
      if (belowMinAge(data.birthDate, event)) {
        await cancel(tx, event, registration, ctx);
        cancelled.push({ id: event.id, title: event.title });
        continue;
      }
      const unchanged =
        registration.firstName === data.firstName &&
        registration.lastName === data.lastName &&
        registration.birthDate === data.birthDate;
      if (unchanged) continue;
      await tx.update(registrations).set(data).where(eq(registrations.id, registration.id));
      // Заявка на исправление говорила о прежних данных; профиль новее, и решение поддержки их бы перезаписало (D-031).
      await withdrawPending(tx, registration.id, now);
      updated++;
    }

    await tx
      .insert(participantProfiles)
      .values({ email, ...data, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: participantProfiles.email, set: { ...data, updatedAt: now } });
    return { profile: data, updated, cancelled };
  });
}
