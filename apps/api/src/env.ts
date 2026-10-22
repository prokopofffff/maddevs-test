/** Переменные окружения с дефолтами из SPEC, раздел 10. */
export function readEnv(env: NodeJS.ProcessEnv = process.env) {
  return {
    databaseUrl: env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app",
    port: Number(env.PORT ?? 3000),
    publicUrl: (env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    cookieSecure: env.COOKIE_SECURE === "1",
    smtpHost: env.SMTP_HOST ?? "localhost",
    smtpPort: Number(env.SMTP_PORT ?? 1025),
    mailFrom: env.MAIL_FROM ?? "Регистрация <no-reply@localhost>",
    trustProxy: env.TRUST_PROXY === "1",
    rateLimits: {
      global: Number(env.RATE_LIMIT_GLOBAL ?? 300),
      auth: Number(env.RATE_LIMIT_AUTH ?? 10),
      public: Number(env.RATE_LIMIT_PUBLIC ?? 20),
    },
  };
}
