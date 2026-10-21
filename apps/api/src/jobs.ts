import type { Db } from "./db/client.ts";
import { dispatchOutbox } from "./mail/outbox.ts";
import type { MailTransport } from "./mail/transport.ts";

export interface JobsDeps {
  db: Db;
  transport: MailTransport;
}

/** Один шаг фоновых циклов от заданного момента — так их видят тесты (D-041). */
export function createJobs({ db, transport }: JobsDeps) {
  const dispatch = (now: Date) => dispatchOutbox(db, transport, now);
  return {
    dispatch,
    // Проход напоминаний встанет перед отправкой с тикетом R4.
    async runJobs(now: Date) {
      await dispatch(now);
    },
  };
}
