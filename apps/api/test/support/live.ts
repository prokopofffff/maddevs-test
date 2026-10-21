import { onTestFinished } from "vitest";
import type { Client } from "./test-app.ts";

export interface Counts {
  confirmed: number;
  limit: number;
  waitlisted: number;
  checkedIn: number;
}

/** Сообщение SSE как его видит `EventSource`; блок из одних комментариев (`: ping`) сообщением не считается. */
export interface Message {
  event?: string;
  data?: string;
  retry?: number;
}

function parse(block: string): Message | undefined {
  const message: Message = {};
  let fields = 0;
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const at = line.indexOf(":");
    const field = at < 0 ? line : line.slice(0, at);
    const value = at < 0 ? "" : line.slice(at + 1).replace(/^ /, "");
    fields++;
    if (field === "event") message.event = value;
    else if (field === "data") message.data = message.data === undefined ? value : `${message.data}\n${value}`;
    else if (field === "retry") message.retry = Number(value);
  }
  return fields > 0 ? message : undefined;
}

/**
 * Поток `GET …/live` организатора — как его читает экран: сообщения по одному, с таймаутом.
 * Закрывается сам в конце теста.
 */
export async function openLive(organizer: Client, eventId: string) {
  const res = await organizer.open(`/api/organizer/events/${eventId}/live`);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  // Незавершённое чтение переживает таймаут: следующий вызов дождётся того же куска.
  let pending: ReturnType<typeof reader.read> | undefined;
  const close = () => reader.cancel().catch(() => {});
  onTestFinished(close);

  /** Следующее сообщение или `undefined`, если за `ms` его не было. */
  async function next(ms: number): Promise<Message | undefined> {
    const deadline = Date.now() + ms;
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const message = parse(block);
        if (message) return message;
        continue;
      }
      const left = deadline - Date.now();
      if (left <= 0) return undefined;
      pending ??= reader.read();
      let timer: NodeJS.Timeout | undefined;
      const chunk = await Promise.race([
        pending,
        new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), left))),
      ]);
      clearTimeout(timer);
      if (chunk === "timeout") return undefined;
      pending = undefined;
      if (chunk.done) throw new Error("поток закрылся");
      buffer += chunk.value;
    }
  }

  /** Снимок счётчиков, если пришёл за `ms`, иначе `undefined` — для проверки «снимка нет». */
  async function countsWithin(ms: number): Promise<Counts | undefined> {
    const deadline = Date.now() + ms;
    for (;;) {
      const message = await next(deadline - Date.now());
      if (!message) return undefined;
      if (message.event === "counts") return JSON.parse(message.data!) as Counts;
    }
  }

  /** Следующий снимок счётчиков; нет за `ms` — ошибка. */
  async function counts(ms = 2000): Promise<Counts> {
    const snapshot = await countsWithin(ms);
    if (!snapshot) throw new Error(`снимка не было ${ms} мс`);
    return snapshot;
  }

  return { status: res.status, headers: res.headers, next, counts, countsWithin, close };
}
