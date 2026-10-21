import postgres from "postgres";
import { databaseUrl, port, serverUrl } from "./env.ts";

// `webServer` Playwright: пересоздаёт базу e2e и запускает собранное приложение тем же входом, что `pnpm start`.
const sql = postgres(serverUrl, { max: 1, onnotice: () => {} });
await sql.unsafe("drop database if exists app_e2e with (force)");
await sql.unsafe("create database app_e2e");
await sql.end();

process.env.DATABASE_URL = databaseUrl;
process.env.PORT = String(port);
process.env.PUBLIC_URL = `http://localhost:${port}`;
await import("../apps/api/src/index.ts");
