/**
 * `pnpm admin:create <email>` — учётная запись поддержки. Открытой регистрации поддержки нет (D-030).
 * Пароль спрашивается без эха; без терминала — первая строка stdin (`echo pass | pnpm admin:create …`).
 */
import { stdin, stdout } from "node:process";
import { createAccount } from "../auth/accounts.ts";
import { createDb, runMigrations } from "../db/client.ts";
import { readEnv } from "../env.ts";
import { emailSchema, signupSchema } from "../schemas/auth.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Строка с терминала без эха; Ctrl+C отменяет. */
function askHidden(prompt: string) {
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  let value = "";
  return new Promise<string>((resolve) => {
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          done();
          return resolve(value);
        }
        if (ch === "\u0003") {
          done();
          fail("Отменено");
        }
        value = ch === "\u007f" || ch === "\b" ? value.slice(0, -1) : value + ch;
      }
    };
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    stdin.on("data", onData);
  });
}

async function readPassword() {
  if (!stdin.isTTY) {
    let input = "";
    for await (const chunk of stdin) input += chunk;
    return input.split(/\r?\n/)[0] ?? "";
  }
  const password = await askHidden("Пароль: ");
  if ((await askHidden("Ещё раз: ")) !== password) fail("Пароли не совпадают");
  return password;
}

const email = emailSchema.safeParse(process.argv[2] ?? "");
if (!email.success) fail("Использование: pnpm admin:create <email>");
const password = await readPassword();
if (!signupSchema.shape.password.safeParse(password).success) fail("Пароль — от 8 до 200 символов");

const db = createDb(readEnv().databaseUrl, { max: 1 });
try {
  // Команду могут запустить раньше первого старта API — схема должна быть на месте (D-009).
  await runMigrations(db);
  const user = await createAccount(db, { email: email.data, password, role: "support", now: new Date() });
  if (!user) fail(`Учётная запись ${email.data} уже есть`);
  console.log(`Поддержка ${user.email} создана`);
} finally {
  await db.$client.end();
}
