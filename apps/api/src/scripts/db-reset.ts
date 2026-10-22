/** `pnpm db:reset` — стереть базу `DATABASE_URL`, применить миграции и засеять демо-данные (D-010). */
import { createDb } from "../db/client.ts";
import { readEnv } from "../env.ts";
import { printSeeded, resetDatabase, seedDemo } from "../seed/demo.ts";

const env = readEnv();
const db = createDb(env.databaseUrl, { max: 1 });
try {
  await resetDatabase(db);
  console.log(`База ${new URL(env.databaseUrl).pathname.slice(1)} стёрта, миграции применены`);
  const result = await seedDemo(db, new Date());
  if (result.status === "seeded") printSeeded(result, env.publicUrl);
} finally {
  await db.$client.end();
}
