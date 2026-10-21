import { eq } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { events } from "./db/schema.ts";
import { countsFor, type Counts } from "./domain/events.ts";

export type SendCounts = (counts: Counts) => void;

/** Live-счётчики (D-020, SPEC §7): одно `LISTEN` на процесс и карта «событие → открытые потоки». */
export interface Live {
  /** Слушать уведомления; повторный вызов ждёт тот же `LISTEN`. */
  start(): Promise<void>;
  /** Подписка потока: первый снимок уходит сразу, дальше — после каждого изменения. Возвращает отписку. */
  subscribe(eventId: string, send: SendCounts): Promise<() => void>;
  /** Срабатывает в `stop()`: открытые потоки закрываются, иначе `server.close()` их ждал бы вечно. */
  readonly signal: AbortSignal;
  stop(): Promise<void>;
}

const CHANNEL = "event_counts";
/** Пересчёт по уведомлениям — не чаще раза в 200 мс на событие. */
const THROTTLE_MS = 200;

interface Topic {
  streams: Set<SendCounts>;
  timer?: NodeJS.Timeout;
  lastRun: number;
  // Снимки одного события считаются и уходят строго по очереди: более старый не обгонит более новый.
  chain: Promise<void>;
}

export function createLive(db: Db): Live {
  const topics = new Map<string, Topic>();
  let listening: Promise<void> | undefined;
  let unlisten: (() => Promise<void>) | undefined;
  const stopping = new AbortController();
  const stopped = () => stopping.signal.aborted;

  async function snapshot(eventId: string): Promise<Counts | undefined> {
    const [event] = await db
      .select({ id: events.id, seatLimit: events.seatLimit })
      .from(events)
      .where(eq(events.id, eventId));
    return event && (await countsFor(db, [event])).get(event.id);
  }

  function enqueue(eventId: string, topic: Topic, deliver: SendCounts) {
    topic.chain = topic.chain
      .then(async () => {
        const counts = await snapshot(eventId);
        if (counts && !stopped()) deliver(counts);
      })
      .catch((error) => console.error(`live: снимок события ${eventId} не посчитан`, error));
  }

  /** Один пересчёт на всех подписчиков события; уведомления, пришедшие до него, склеиваются. */
  function schedule(eventId: string, topic: Topic) {
    if (topic.timer) return;
    topic.timer = setTimeout(
      () => {
        topic.timer = undefined;
        topic.lastRun = Date.now();
        enqueue(eventId, topic, (counts) => topic.streams.forEach((send) => send(counts)));
      },
      Math.max(0, topic.lastRun + THROTTLE_MS - Date.now()),
    );
  }

  const onNotify = (eventId: string) => {
    const topic = topics.get(eventId);
    if (topic && !stopped()) schedule(eventId, topic);
  };

  // postgres.js зовёт `onlisten` при каждом (пере)подключении слушателя. Уведомления за время разрыва
  // потеряны — свежий снимок всем подписчикам их покрывает.
  const onListen = () => {
    if (!stopped()) topics.forEach((topic, eventId) => schedule(eventId, topic));
  };

  function start() {
    listening ??= db.$client.listen(CHANNEL, onNotify, onListen).then(
      (result) => {
        unlisten = result.unlisten;
      },
      (error: unknown) => {
        listening = undefined;
        throw error;
      },
    );
    return listening;
  }

  return {
    start,
    signal: stopping.signal,

    async subscribe(eventId, send) {
      // Сначала `LISTEN`, потом первый снимок: изменение между ними не потеряется.
      await start();
      let topic = topics.get(eventId);
      if (!topic) {
        topic = { streams: new Set(), lastRun: 0, chain: Promise.resolve() };
        topics.set(eventId, topic);
      }
      const current = topic;
      current.streams.add(send);
      enqueue(eventId, current, (counts) => current.streams.has(send) && send(counts));
      return () => {
        current.streams.delete(send);
        if (current.streams.size > 0 || topics.get(eventId) !== current) return;
        clearTimeout(current.timer);
        topics.delete(eventId);
      };
    },

    async stop() {
      stopping.abort();
      topics.forEach((topic) => clearTimeout(topic.timer));
      topics.clear();
      await listening?.catch(() => {});
      // `UNLISTEN` на оборванном соединении падает — слушать там уже нечего.
      await unlisten?.().catch(() => {});
    },
  };
}
