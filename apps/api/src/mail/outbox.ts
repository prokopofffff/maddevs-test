import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { emailOutbox } from "../db/schema.ts";
import type { Tx } from "../db/tx.ts";
import type { Rendered } from "./templates/layout.ts";
import type { MailTransport } from "./transport.ts";

const BATCH = 20;
const LEASE_MS = 2 * 60_000;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;
export const MAX_ATTEMPTS = 10;

export interface Letter extends Rendered {
  dedupKey: string;
  kind: string;
  to: string;
}

/**
 * Письмо ставится в транзакции действия и рендерится в этот момент — снимок фактов (D-013).
 * Повтор с тем же ключом ничего не делает.
 */
export async function enqueue(tx: Tx, letter: Letter, now: Date) {
  await tx
    .insert(emailOutbox)
    .values({
      dedupKey: letter.dedupKey,
      kind: letter.kind,
      toEmail: letter.to,
      subject: letter.subject,
      text: letter.text,
      html: letter.html,
      createdAt: now,
      nextAttemptAt: now,
    })
    .onConflictDoNothing({ target: emailOutbox.dedupKey });
}

/** Пауза перед попыткой после `attempts` неудач: 30 с · 2^(attempts−1), не больше часа (D-013). */
export const retryDelayMs = (attempts: number) => Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);

/**
 * Один проход отправки (SPEC, раздел 6): захват пачки с арендой, коммит до SMTP,
 * отправка, отметка. Время — параметр, таймеров внутри нет.
 */
export async function dispatchOutbox(db: Db, transport: MailTransport, now: Date) {
  const due = db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      and(
        isNull(emailOutbox.sentAt),
        isNull(emailOutbox.failedAt),
        lte(emailOutbox.nextAttemptAt, now),
        or(isNull(emailOutbox.lockedUntil), lt(emailOutbox.lockedUntil, now)),
      ),
    )
    .orderBy(asc(emailOutbox.id))
    .limit(BATCH)
    .for("update", { skipLocked: true });
  // Один оператор — своя транзакция: аренда закоммичена до разговора с SMTP.
  const claimed = await db
    .update(emailOutbox)
    .set({ lockedUntil: new Date(now.getTime() + LEASE_MS) })
    .where(inArray(emailOutbox.id, due))
    .returning();
  claimed.sort((a, b) => a.id - b.id);

  for (const row of claimed) {
    try {
      await transport.send({
        id: row.id,
        kind: row.kind,
        to: row.toEmail,
        subject: row.subject,
        text: row.text,
        html: row.html,
      });
      await db.update(emailOutbox).set({ sentAt: now, lockedUntil: null }).where(eq(emailOutbox.id, row.id));
    } catch (error) {
      const attempts = row.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      const lastError = error instanceof Error ? error.message : String(error);
      await db
        .update(emailOutbox)
        .set({
          attempts,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
          lockedUntil: null,
          lastError,
          failedAt: failed ? now : null,
        })
        .where(eq(emailOutbox.id, row.id));
      if (failed) console.error(`Письмо ${row.dedupKey} не отправлено после ${attempts} попыток: ${lastError}`);
    }
  }
  return claimed.length;
}

/**
 * Цикл отправки в процессе API: тик каждые 2 с и пинок `wake()` после коммита (D-014).
 * Одновременно идёт не больше одного прохода; пинок во время прохода даёт ещё один следом.
 */
export function createOutboxRunner(pass: () => Promise<unknown>, intervalMs = 2000) {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let again = false;

  const run = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await pass();
        } catch (error) {
          console.error("Проход отправки писем упал:", error);
        }
      } while (again);
    })().finally(() => {
      running = undefined;
    });
    return running;
  };

  return {
    start() {
      timer = setInterval(run, intervalMs);
      void run();
    },
    wake() {
      void run();
    },
    /** Останавливает тик и дожидается текущего прохода. */
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
