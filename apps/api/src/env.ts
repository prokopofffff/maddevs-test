/** Переменные окружения с дефолтами из SPEC, раздел 10. */
export function readEnv(env: NodeJS.ProcessEnv = process.env) {
  return {
    databaseUrl: env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app",
    port: Number(env.PORT ?? 3000),
    publicUrl: (env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    cookieSecure: env.COOKIE_SECURE === "1",
  };
}
