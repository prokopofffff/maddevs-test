/** `pnpm db:seed` — демо-данные на пустой базе; на непустой отказывается и подсказывает `db:reset` (D-010). */
import { createDb, runMigrations } from "../db/client.ts";
import { readEnv } from "../env.ts";
import { printSeeded, seedDemo } from "../seed/demo.ts";

const env = readEnv();
const db = createDb(env.databaseUrl, { max: 1 });
try {
  // Сид могут запустить раньше первого старта API — схема должна быть на месте (D-009).
  await runMigrations(db);
  const result = await seedDemo(db, new Date());
  if (result.status === "not_empty") {
    console.error(
      "База не пустая — сид не запускается, чтобы не смешать демо-данные с вашими.\n" +
        "Стереть всё и засеять заново: pnpm db:reset (в compose: docker compose exec api pnpm db:reset)",
    );
    process.exitCode = 1;
  } else {
    printSeeded(result, env.publicUrl);
  }
} finally {
  await db.$client.end();
}
