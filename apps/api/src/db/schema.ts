import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { EVENT_CATEGORIES, EVENT_FORMATS } from "../schemas/event.ts";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["organizer", "support"] }).notNull().default("organizer"),
  createdAt: tz("created_at").notNull(),
});

export const sessions = pgTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: tz("created_at").notNull(),
  expiresAt: tz("expires_at").notNull(),
});

/** Сессия участника: отдельная от `sessions` сущность без строки в `users` (D-057). */
export const participantSessions = pgTable("participant_sessions", {
  idHash: text("id_hash").primaryKey(),
  email: text("email").notNull(),
  createdAt: tz("created_at").notNull(),
  expiresAt: tz("expires_at").notNull(),
});

/**
 * Профиль участника: имя, фамилия и дата рождения для регистрации в один клик; один на email (D-065).
 * Отдельная таблица, а не строка `users`: у участника учётной записи нет (D-057).
 */
export const participantProfiles = pgTable("participant_profiles", {
  email: text("email").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  birthDate: date("birth_date", { mode: "string" }).notNull(),
  createdAt: tz("created_at").notNull(),
  updatedAt: tz("updated_at").notNull(),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizerId: bigint("organizer_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    startsAt: tz("starts_at").notNull(),
    timezone: text("timezone").notNull(),
    seatLimit: integer("seat_limit").notNull(),
    format: text("format", { enum: EVENT_FORMATS }).notNull(),
    city: text("city"),
    address: text("address"),
    category: text("category", { enum: EVENT_CATEGORIES }).notNull(),
    /** Шкала 0/6/12/16/18; 0 — без ограничения (D-060). */
    minAge: integer("min_age").notNull().default(0),
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    rescheduledAt: tz("rescheduled_at"),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [
    index("events_organizer_starts_idx").on(t.organizerId, t.startsAt),
    // Лента каталога идёт по `(starts_at, id)`, фильтр и список городов — по `lower(city)` (D-061).
    index("events_starts_idx").on(t.startsAt, t.id),
    index("events_city_idx").on(sql`lower(${t.city})`),
    check("events_seat_limit_check", sql`${t.seatLimit} >= 1`),
    check("events_min_age_check", sql`${t.minAge} in (0, 6, 12, 16, 18)`),
    check(
      "events_place_check",
      sql`(${t.format} = 'offline' and ${t.city} is not null and ${t.address} is not null) or (${t.format} = 'online' and ${t.city} is null and ${t.address} is null)`,
    ),
  ],
);

export const registrations = pgTable(
  "registrations",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    email: text("email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    birthDate: date("birth_date", { mode: "string" }).notNull(),
    status: text("status", { enum: ["confirmed", "waitlisted", "cancelled"] }).notNull(),
    token: text("token").notNull().unique(),
    ticketCode: text("ticket_code"),
    verifiedAt: tz("verified_at").notNull(),
    confirmedAt: tz("confirmed_at"),
    cancelledAt: tz("cancelled_at"),
    checkedInAt: tz("checked_in_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    index("registrations_event_status_idx").on(t.eventId, t.status),
    // «Мои регистрации» читают все строки email, свежие первыми (D-057).
    index("registrations_email_created_idx").on(t.email, t.createdAt.desc()),
    uniqueIndex("registrations_event_email_active_key")
      .on(t.eventId, t.email)
      .where(sql`${t.status} <> 'cancelled'`),
    uniqueIndex("registrations_ticket_code_key")
      .on(t.ticketCode)
      .where(sql`${t.ticketCode} is not null`),
    index("registrations_waitlist_idx")
      .on(t.eventId, t.verifiedAt, t.id)
      .where(sql`${t.status} = 'waitlisted'`),
  ],
);

/** Заявки на исправление имени, фамилии и даты рождения; на регистрацию не больше одной ожидающей (D-031). */
export const correctionRequests = pgTable(
  "correction_requests",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    registrationId: bigint("registration_id", { mode: "number" })
      .notNull()
      .references(() => registrations.id),
    oldFirstName: text("old_first_name").notNull(),
    oldLastName: text("old_last_name").notNull(),
    oldBirthDate: date("old_birth_date", { mode: "string" }).notNull(),
    newFirstName: text("new_first_name").notNull(),
    newLastName: text("new_last_name").notNull(),
    newBirthDate: date("new_birth_date", { mode: "string" }).notNull(),
    status: text("status", { enum: ["pending", "accepted", "rejected", "withdrawn"] }).notNull(),
    reason: text("reason"),
    createdAt: tz("created_at").notNull(),
    decidedAt: tz("decided_at"),
    decidedBy: bigint("decided_by", { mode: "number" }).references(() => users.id),
  },
  (t) => [
    uniqueIndex("correction_requests_pending_key")
      .on(t.registrationId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Коды подтверждения email; `register` хранит данные формы до верного кода (D-007, D-039).
 * У `login` события нет: `event_id` пуст ровно у него (D-057).
 */
export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    purpose: text("purpose", { enum: ["register", "lookup", "login"] }).notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    birthDate: date("birth_date", { mode: "string" }),
    code: text("code").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: tz("expires_at").notNull(),
    consumedAt: tz("consumed_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    index("email_verifications_event_email_created_idx").on(t.eventId, t.email, t.createdAt.desc()),
    // Минута между кодами и гашение прежнего у `login` идут по email (D-057).
    index("email_verifications_login_idx")
      .on(t.email, t.createdAt.desc())
      .where(sql`${t.purpose} = 'login'`),
    check("email_verifications_event_check", sql`(${t.purpose} = 'login') = (${t.eventId} is null)`),
  ],
);

/** Письма ставятся в транзакции действия и уходят циклом отправки (D-013). */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    dedupKey: text("dedup_key").notNull().unique(),
    kind: text("kind").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    html: text("html").notNull(),
    createdAt: tz("created_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: tz("next_attempt_at").notNull(),
    lockedUntil: tz("locked_until"),
    sentAt: tz("sent_at"),
    failedAt: tz("failed_at"),
    lastError: text("last_error"),
  },
  (t) => [
    index("email_outbox_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.sentAt} is null and ${t.failedAt} is null`),
  ],
);
