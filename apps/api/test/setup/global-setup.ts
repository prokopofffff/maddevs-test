import { createDb, runMigrations } from "../../src/db/client.ts";
import { connectServer, databaseUrl, templateName } from "./databases.ts";

/** Один раз за прогон: шаблонная база с миграциями, из неё каждый файл тестов копирует свою (D-028). */
export default async function setup() {
  const server = await connectServer();
  await server.unsafe(`drop database if exists ${templateName} with (force)`);
  await server.unsafe(`create database ${templateName}`);
  await server.end();

  const db = createDb(databaseUrl(templateName), { max: 1 });
  await runMigrations(db);
  await db.$client.end();
}
