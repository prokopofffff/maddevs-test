import type { Db } from "./db/client.ts";
import { sweepReminders } from "./domain/reminders.ts";
import { dispatchOutbox } from "./mail/outbox.ts";
import type { MailTransport } from "./mail/transport.ts";

export interface JobsDeps {
  db: Db;
  transport: MailTransport;
  publicUrl: string;
}

/** Один шаг фоновых циклов от заданного момента — так их видят тесты (D-041). */
export function createJobs({ db, transport, publicUrl }: JobsDeps) {
  const dispatch = (now: Date) => dispatchOutbox(db, transport, now);
  const reminders = (now: Date) => sweepReminders(db, { now, publicUrl });
  return {
    dispatch,
    sweepReminders: reminders,
    // Напоминания — перед отправкой: поставленное уходит тем же шагом.
    async runJobs(now: Date) {
      await reminders(now);
      await dispatch(now);
    },
  };
}
