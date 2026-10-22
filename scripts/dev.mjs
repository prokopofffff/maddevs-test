// `pnpm dev`: Postgres и Mailpit из compose, затем API и Vite — на свободных портах (D-054, D-055).
// Порт из переменной окружения берётся как есть; иначе — первый свободный, начиная со стандартного.
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";

// Отвечает ли кто-то на порту. Compose публикует порты только на 127.0.0.1, а локальный
// Postgres или Vite слушают и ::1 — поэтому проверяем оба адреса.
const answers = (host, port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(500, () => done(false));
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
const isFree = async (port) => !(await answers("127.0.0.1", port)) && !(await answers("::1", port));

const taken = new Set();
async function freePort(from) {
  let port = from;
  while (taken.has(port) || !(await isFree(port))) port++;
  taken.add(port);
  return port;
}

// Порт уже работающего контейнера. Docker пускает публикацию на 127.0.0.1 поверх занятого
// localhost-порта, и тогда подключения уходят чужому процессу — такой порт не берём.
async function containerPort(service, internal) {
  let out;
  try {
    out = execFileSync("docker", ["compose", "port", service, String(internal)], { encoding: "utf8", stdio: "pipe" });
  } catch {
    return undefined;
  }
  const port = Number(out.trim().match(/:(\d+)$/)?.[1]);
  if (!port || (await answers("::1", port))) return undefined;
  taken.add(port);
  return port;
}

async function pick(name, fallback, container) {
  const fixed = Number(process.env[name]);
  if (fixed) {
    taken.add(fixed);
    return fixed;
  }
  return (container && (await containerPort(...container))) ?? freePort(fallback);
}

const ports = {
  POSTGRES_PORT: await pick("POSTGRES_PORT", 5432, ["postgres", 5432]),
  MAILPIT_SMTP_PORT: await pick("MAILPIT_SMTP_PORT", 1025, ["mailpit", 1025]),
  MAILPIT_UI_PORT: await pick("MAILPIT_UI_PORT", 8025, ["mailpit", 8025]),
  PORT: await pick("PORT", 3000),
  WEB_PORT: await pick("WEB_PORT", 5173),
};
const databaseUrl = process.env.DATABASE_URL ?? `postgres://app:app@localhost:${ports.POSTGRES_PORT}/app`;
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${ports.WEB_PORT}`;
const env = {
  ...process.env,
  ...Object.fromEntries(Object.entries(ports).map(([k, v]) => [k, String(v)])),
  DATABASE_URL: databaseUrl,
  SMTP_PORT: String(ports.MAILPIT_SMTP_PORT),
  PUBLIC_URL: publicUrl,
};

execFileSync("docker", ["compose", "up", "-d", "--wait", "postgres", "mailpit"], { env, stdio: "inherit" });

console.log(`
  Приложение: ${publicUrl}
  API:        http://localhost:${ports.PORT}
  Mailpit:    http://localhost:${ports.MAILPIT_UI_PORT}
  Postgres:   ${databaseUrl}
  Сид:        DATABASE_URL=${databaseUrl} PUBLIC_URL=${publicUrl} pnpm db:seed
`);

const child = spawn("pnpm", ["--parallel", "--filter", "@app/api", "--filter", "@app/web", "dev"], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
// Ctrl+C терминал шлёт всей группе процессов — ждём, пока дочерние завершатся сами.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
