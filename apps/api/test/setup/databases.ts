import postgres from "postgres";

export const serverUrl = process.env.TEST_DATABASE_URL ?? "postgres://app:app@localhost:5432/postgres";
export const templateName = "app_test_template";

export function databaseUrl(name: string) {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Соединение с сервером тестовых баз; без поднятого compose падает с подсказкой (D-028). */
export async function connectServer() {
  const sql = postgres(serverUrl, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  try {
    await sql`select 1`;
  } catch (error) {
    await sql.end({ timeout: 0 });
    throw new Error(
      `Postgres недоступен по TEST_DATABASE_URL (${serverUrl}). Запустите \`docker compose up -d\`.`,
      { cause: error },
    );
  }
  return sql;
}
