import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
    minAge: integer("min_age"),
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    rescheduledAt: tz("rescheduled_at"),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [
    index("events_organizer_starts_idx").on(t.organizerId, t.startsAt),
    check("events_seat_limit_check", sql`${t.seatLimit} >= 1`),
    check("events_min_age_check", sql`${t.minAge} between 1 and 120`),
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

/** Коды подтверждения email; `register` хранит данные формы до верного кода (D-007, D-039). */
export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    purpose: text("purpose", { enum: ["register", "lookup"] }).notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    birthDate: date("birth_date", { mode: "string" }),
    code: text("code").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: tz("expires_at").notNull(),
    consumedAt: tz("consumed_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [index("email_verifications_event_email_created_idx").on(t.eventId, t.email, t.createdAt.desc())],
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
