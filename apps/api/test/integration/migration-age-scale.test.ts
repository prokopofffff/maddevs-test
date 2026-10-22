import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "../../src/db/client.ts";
import { connectServer, databaseUrl } from "../setup/databases.ts";

/** Своя база, не воркерская: тест останавливает миграции на полпути, а воркерская должна оставаться полной. */
const name = `app_test_migration_${process.env.VITEST_POOL_ID ?? "0"}`;
const realFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let tempFolder: string;

beforeAll(async () => {
  const server = await connectServer();
  await server.unsafe(`drop database if exists ${name} with (force)`);
  await server.unsafe(`create database ${name}`);
  await server.end();
  tempFolder = await mkdtemp(join(tmpdir(), "drizzle-before-catalog-"));
});

afterAll(async () => {
  await rm(tempFolder, { recursive: true, force: true });
  const server = await connectServer();
  await server.unsafe(`drop database if exists ${name} with (force)`);
  await server.end();
});

describe("миграция 0004: поля каталога и шкала возраста (D-059, D-060)", () => {
  it("существующие события становятся онлайн и «другое», а возраст округляется вверх до шкалы", async () => {
    // Состояние до миграции: копия папки с первыми четырьмя записями журнала.
    await cp(realFolder, tempFolder, { recursive: true });
    const journalPath = join(tempFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    journal.entries = journal.entries.slice(0, 4);
    await writeFile(journalPath, JSON.stringify(journal));

    const db = createDb(databaseUrl(name), { max: 1 });
    try {
      await migrate(db, { migrationsFolder: tempFolder });
      await db.$client`insert into users (email, password_hash, created_at) values ('org@example.com', 'x', now())`;
      for (const minAge of [null, 1, 14, 18, 21]) {
        await db.$client`
          insert into events (organizer_id, title, description, starts_at, timezone, seat_limit, min_age, created_at, updated_at)
          values (1, ${`Возраст ${minAge}`}, '', now(), 'UTC', 10, ${minAge}, now(), now())`;
      }

      await runMigrations(db);

      const rows = await db.$client<{ title: string; min_age: number; format: string; category: string; city: string | null; address: string | null }[]>`
        select title, min_age, format, category, city, address from events order by title`;
      expect(rows.map((r) => [r.title, r.min_age])).toEqual([
        ["Возраст 1", 6],
        ["Возраст 14", 16],
        ["Возраст 18", 18],
        ["Возраст 21", 18],
        ["Возраст null", 0],
      ]);
      expect(rows.every((r) => r.format === "online" && r.category === "other" && r.city === null && r.address === null)).toBe(true);
    } finally {
      await db.$client.end();
    }
  });
});
