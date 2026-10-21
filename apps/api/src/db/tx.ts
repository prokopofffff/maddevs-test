import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { Db } from "./client.ts";
import type * as schema from "./schema.ts";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** И пул, и транзакция: для запросов, которым всё равно, где выполняться. */
export type Queryable = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

const MAX_ATTEMPTS = 3;

interface PgError {
  code?: string;
  constraint_name?: string;
}

/** Drizzle оборачивает ошибку драйвера в `DrizzleQueryError`; код Postgres лежит в `cause`. */
function pgError(error: unknown): PgError {
  const e = error as PgError & { cause?: unknown };
  return e?.code ? e : ((e?.cause as PgError | undefined) ?? {});
}

function retryable(error: unknown) {
  const { code, constraint_name } = pgError(error);
  // Сериализация, дедлок и коллизия кода билета (D-009, D-022); прочие `23505` — ошибка логики.
  return (
    code === "40001" || code === "40P01" || (code === "23505" && constraint_name === "registrations_ticket_code_key")
  );
}

/** Транзакция READ COMMITTED с повтором до трёх раз (SPEC, раздел 3). */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !retryable(error)) throw error;
    }
  }
}
