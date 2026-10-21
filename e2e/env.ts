/** Окружение e2e: compose-Postgres и compose-Mailpit, приложение — на своём порту (D-028, D-047). */
export const port = Number(process.env.E2E_PORT ?? 3100);
export const baseUrl = `http://localhost:${port}`;
export const serverUrl = process.env.TEST_DATABASE_URL ?? "postgres://app:app@localhost:5432/postgres";
export const mailpitUrl = (process.env.MAILPIT_URL ?? "http://localhost:8025").replace(/\/+$/, "");

/** Своя база e2e рядом с тестовыми — данные приложения не трогает. */
export const databaseUrl = (() => {
  const url = new URL(serverUrl);
  url.pathname = "/app_e2e";
  return url.toString();
})();
