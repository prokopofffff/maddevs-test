import { sql } from "drizzle-orm";
import { hashPassword } from "../auth/password.ts";
import { runMigrations, type Db } from "../db/client.ts";
import { correctionRequests, events, registrations, users } from "../db/schema.ts";
import { withTx, type Tx } from "../db/tx.ts";
import { newRegistrationToken, newTicketCode } from "../domain/codes.ts";
import { instantToLocal, localToInstant } from "../time.ts";

/**
 * Демо-данные для ревьюера (D-010, SPEC §10). Регистрации пишутся прямо в БД — без кодов и писем.
 * Даты считаются от `now`: событие «меньше чем через сутки» после сида попадает под проход напоминаний.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Person = { email: string; firstName: string; lastName: string; birthDate: string };

const people: Person[] = [
  { email: "anna.ivanova@example.com", firstName: "Анна", lastName: "Иванова", birthDate: "1994-03-14" },
  { email: "boris.smirnov@example.com", firstName: "Борис", lastName: "Смирнов", birthDate: "1988-07-02" },
  { email: "vera.kuznetsova@example.com", firstName: "Вера", lastName: "Кузнецова", birthDate: "2001-11-23" },
  { email: "gleb.popov@example.com", firstName: "Глеб", lastName: "Попов", birthDate: "1979-05-30" },
  { email: "darya.sokolova@example.com", firstName: "Дарья", lastName: "Соколова", birthDate: "1996-01-09" },
  { email: "egor.lebedev@example.com", firstName: "Егор", lastName: "Лебедев", birthDate: "1990-09-17" },
  { email: "zhanna.kozlova@example.com", firstName: "Жанна", lastName: "Козлова", birthDate: "1985-12-04" },
  { email: "ilya.novikov@example.com", firstName: "Илья", lastName: "Новиков", birthDate: "2003-04-21" },
  // Фамилия с опечаткой — её исправляет ожидающая заявка поддержки.
  { email: "ksenia.morozova@example.com", firstName: "Ксения", lastName: "Морозва", birthDate: "1999-08-12" },
  { email: "lev.volkov@example.com", firstName: "Лев", lastName: "Волков", birthDate: "1992-02-28" },
];
const person = (i: number) => people[i]!;

export type SeedResult = { status: "not_empty" } | { status: "seeded"; events: { id: string; title: string }[] };

export async function seedDemo(db: Db, now: Date): Promise<SeedResult> {
  const at = (offset: number) => new Date(now.getTime() + offset);
  /** Время `hh:mm` в поясе события через `days` дней от `now`. */
  const dayAt = (days: number, time: string, timezone: string) =>
    localToInstant(`${instantToLocal(at(days * DAY), timezone).slice(0, 10)}T${time}`, timezone);
  const created = at(-30 * DAY);
  const [demoHash, supportHash] = await Promise.all([hashPassword("demo"), hashPassword("support")]);

  return withTx(db, async (tx) => {
    // Два одновременных сида не должны оба увидеть пустую базу.
    await tx.execute(sql`lock table users in share row exclusive mode`);
    const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
    if (existing) return { status: "not_empty" };

    const [demo, demo2] = await tx
      .insert(users)
      .values([
        { email: "demo@example.com", passwordHash: demoHash, role: "organizer", createdAt: created },
        { email: "demo2@example.com", passwordHash: demoHash, role: "organizer", createdAt: created },
        { email: "support@example.com", passwordHash: supportHash, role: "support", createdAt: created },
      ])
      .returning();

    const event = async (values: Omit<typeof events.$inferInsert, "createdAt" | "updatedAt" | "description">) => {
      const [row] = await tx
        .insert(events)
        .values({ description: DESCRIPTION, createdAt: created, updatedAt: created, ...values })
        .returning();
      return row!;
    };

    // Заполненное: все места заняты, трое в листе ожидания. Отказ подтверждённого повышает первого.
    const full = await event({
      organizerId: demo!.id,
      title: "Митап: Postgres под нагрузкой",
      startsAt: dayAt(7, "19:00", "Asia/Novosibirsk"),
      timezone: "Asia/Novosibirsk",
      seatLimit: 5,
      category: "meetup",
      format: "online",
      minAge: 12,
    });
    for (let i = 0; i < 5; i++) await confirmed(tx, full.id, person(i), at(-10 * DAY + i * HOUR));
    for (let i = 5; i < 8; i++) await waitlisted(tx, full.id, person(i), at(-5 * DAY + i * HOUR));

    // Меньше чем через сутки: подтверждённым заранее придёт напоминание, подтверждённому час назад — нет (D-019).
    const soon = await event({
      organizerId: demo!.id,
      title: "Воркшоп: формы на React без боли",
      startsAt: new Date(Math.ceil(at(5 * HOUR).getTime() / HOUR) * HOUR),
      timezone: "Asia/Novosibirsk",
      seatLimit: 20,
      category: "workshop",
      format: "offline",
      city: "Новосибирск",
      address: "ул. Ленина, 12, коворкинг «Точка»",
    });
    for (let i = 0; i < 3; i++) await confirmed(tx, soon.id, person(i), at(-3 * DAY + i * HOUR));
    await confirmed(tx, soon.id, person(3), at(-HOUR));

    // Прошедшее: четверо из шести прошли чекин, одна отказалась до начала.
    const past = await event({
      organizerId: demo!.id,
      title: "Конференция «Бэкенд в Сибири»",
      startsAt: dayAt(-2, "10:00", "Asia/Novosibirsk"),
      timezone: "Asia/Novosibirsk",
      seatLimit: 30,
      category: "conference",
      format: "offline",
      city: "Новосибирск",
      address: "Технопарк, ул. Николаева, 12",
    });
    for (let i = 0; i < 6; i++) {
      const r = await confirmed(tx, past.id, person(i), at(-20 * DAY + i * HOUR));
      if (i < 4) {
        await tx
          .update(registrations)
          .set({ checkedInAt: new Date(past.startsAt.getTime() - 15 * 60_000 + i * 4 * 60_000) })
          .where(sql`${registrations.id} = ${r.id}`);
      }
    }
    const gone = await confirmed(tx, past.id, person(6), at(-20 * DAY));
    await tx
      .update(registrations)
      .set({ status: "cancelled", cancelledAt: at(-5 * DAY) })
      .where(sql`${registrations.id} = ${gone.id}`);

    // С минимальным возрастом; у Ксении — ожидающая заявка на исправление фамилии (D-031).
    const adults = await event({
      organizerId: demo!.id,
      title: "Ночной квиз 18+",
      startsAt: dayAt(14, "21:00", "Europe/Moscow"),
      timezone: "Europe/Moscow",
      seatLimit: 40,
      category: "game",
      format: "offline",
      city: "Москва",
      address: "Бар «Синица», Покровка, 17",
      minAge: 18,
    });
    await confirmed(tx, adults.id, person(0), at(-4 * DAY));
    await confirmed(tx, adults.id, person(1), at(-4 * DAY + HOUR));
    const typo = await confirmed(tx, adults.id, person(8), at(-2 * DAY));
    await tx.insert(correctionRequests).values({
      registrationId: typo.id,
      oldFirstName: typo.firstName,
      oldLastName: typo.lastName,
      oldBirthDate: typo.birthDate,
      newFirstName: typo.firstName,
      newLastName: "Морозова",
      newBirthDate: typo.birthDate,
      status: "pending",
      createdAt: at(-DAY),
    });

    // Событие второго организатора — для проверки изоляции: demo его не видит, и наоборот.
    const other = await event({
      organizerId: demo2!.id,
      title: "Лекция: как устроены очереди",
      startsAt: dayAt(10, "19:00", "Asia/Novosibirsk"),
      timezone: "Asia/Novosibirsk",
      seatLimit: 15,
      category: "lecture",
      format: "offline",
      city: "Новосибирск",
      address: "НГУ, Пирогова, 1, ауд. 313",
    });
    await confirmed(tx, other.id, person(2), at(-6 * DAY));
    await confirmed(tx, other.id, person(9), at(-6 * DAY + HOUR));

    return { status: "seeded", events: [full, soon, past, adults, other].map(({ id, title }) => ({ id, title })) };
  });
}

const DESCRIPTION = "Демо-событие из pnpm db:seed. Даты посчитаны от момента запуска сида.";

async function confirmed(tx: Tx, eventId: string, p: Person, at: Date) {
  const [row] = await tx
    .insert(registrations)
    .values({
      eventId,
      ...p,
      status: "confirmed",
      token: newRegistrationToken(),
      ticketCode: newTicketCode(),
      verifiedAt: at,
      confirmedAt: at,
      createdAt: at,
    })
    .returning();
  return row!;
}

async function waitlisted(tx: Tx, eventId: string, p: Person, at: Date) {
  await tx
    .insert(registrations)
    .values({ eventId, ...p, status: "waitlisted", token: newRegistrationToken(), verifiedAt: at, createdAt: at });
}

/** `pnpm db:reset`: стереть всё, включая журнал миграций, и применить миграции заново (D-010). */
export async function resetDatabase(db: Db) {
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
}

/** Что засеяно и куда идти — вывод `db:seed` и `db:reset`. */
export function printSeeded(result: Extract<SeedResult, { status: "seeded" }>, publicUrl: string) {
  console.log(
    [
      "Демо-данные засеяны.",
      `Вход: ${publicUrl}/login`,
      "  demo@example.com / demo — организатор, четыре события",
      "  demo2@example.com / demo — второй организатор, своё событие",
      "  support@example.com / support — поддержка, одна заявка на исправление",
      "Страницы событий для участников:",
      ...result.events.map((e) => `  ${e.title}: ${publicUrl}/e/${e.id}`),
      "Напоминания событию «меньше чем через сутки» поставит ближайший проход API (раз в минуту) — письма в Mailpit.",
    ].join("\n"),
  );
}
