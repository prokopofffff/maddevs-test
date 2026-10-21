import { afterAll, beforeAll, beforeEach } from "vitest";
import { createDb, type Db } from "../../src/db/client.ts";
import { connectServer, databaseUrl, templateName } from "./databases.ts";

const name = `app_test_${process.env.VITEST_POOL_ID ?? "0"}`;
let db: Db | undefined;

/** База текущего воркера; создаётся из шаблона перед каждым файлом тестов. */
export function testDb(): Db {
  if (!db) throw new Error("testDb() доступна только внутри тестов");
  return db;
}

beforeAll(async () => {
  const server = await connectServer();
  await server.unsafe(`drop database if exists ${name} with (force)`);
  // Два воркера не могут копировать один шаблон одновременно: повторяем, пока шаблон занят.
  for (let attempt = 0; ; attempt++) {
    try {
      await server.unsafe(`create database ${name} template ${templateName}`);
      break;
    } catch (error) {
      if (attempt >= 50 || (error as { code?: string }).code !== "55006") throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await server.end();
  db = createDb(databaseUrl(name), { max: 20 });
});

beforeEach(async () => {
  const tables = await testDb().$client<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'`;
  if (tables.length > 0) {
    await testDb().$client.unsafe(
      `truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`,
    );
  }
});

afterAll(async () => {
  await db?.$client.end();
});
