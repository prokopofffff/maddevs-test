import type { Db } from "./db/client.ts";
import type { MailTransport } from "./mail/transport.ts";

export interface JobsDeps {
  db: Db;
  transport: MailTransport;
}

/** Один шаг фоновых циклов от заданного момента — так их видят тесты (D-041). */
export function createJobs(_deps: JobsDeps) {
  return {
    async runJobs(_now: Date) {
      // Циклы отправки и напоминаний ещё не написаны.
    },
  };
}
