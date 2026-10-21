import { expect } from "@playwright/test";
import { mailpitUrl } from "../env.ts";

interface Summary {
  ID: string;
  Subject: string;
}

/** Письма адресату из API Mailpit, от новых к старым. Адреса в тестах уникальные (D-028). */
async function messagesTo(to: string): Promise<Summary[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  if (!res.ok) throw new Error(`Mailpit ${res.status}: запустите \`docker compose up -d\``);
  return (await res.json()).messages;
}

/** Ждёт `count`-е письмо с кодом подтверждения и возвращает код из темы. */
export async function codeFromMail(to: string, count = 1) {
  let codes: string[] = [];
  await expect
    .poll(
      async () => {
        const subjects = (await messagesTo(to)).map((m) => m.Subject);
        codes = subjects.flatMap((s) => s.match(/^Код подтверждения: (\d{6})$/)?.[1] ?? []);
        return codes.length;
      },
      { message: `письмо с кодом №${count} для ${to}`, timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(count);
  return codes[codes.length - count]!;
}

/** Ждёт письмо адресату с темой, начинающейся с `subject`, и возвращает его текст. */
export async function mailText(to: string, subject: string) {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        id = (await messagesTo(to)).find((m) => m.Subject.startsWith(subject))?.ID;
        return id;
      },
      { message: `письмо «${subject}…» для ${to}`, timeout: 10_000 },
    )
    .toBeDefined();
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
  return ((await res.json()) as { Text: string }).Text;
}

/** Личная ссылка из текста письма. */
export const personalLinkIn = (text: string) => text.match(/https?:\/\/\S+\/r\/[\w-]{43}/)![0];
