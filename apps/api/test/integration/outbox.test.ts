import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvent, requestCode } from "../support/participant.ts";
import { testApp } from "../support/test-app.ts";

const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe("отправка писем", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ошибка транспорта — повтор с растущей паузой: 30 с, затем 60 с", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    await requestCode(t.client(), eventId);
    const start = t.clock.now();

    t.mailbox.failNext(2);
    await t.runJobs(start);
    await t.runJobs(at(start, 29_999));
    expect(t.mailbox.sent).toEqual([]);

    await t.runJobs(at(start, 30_000)); // вторая ошибка
    await t.runJobs(at(start, 30_000 + 59_999));
    expect(t.mailbox.sent).toEqual([]);

    await t.runJobs(at(start, 30_000 + 60_000));
    expect(t.mailbox.ofKind("code")).toHaveLength(1);
  });

  it("аренда упавшего прохода истекает через 2 минуты, письмо забирает следующий проход", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    await requestCode(t.client(), eventId);
    const start = t.clock.now();

    const { entered, release } = t.mailbox.hangNext();
    const stuck = t.runJobs(start);
    await entered;

    await t.runJobs(at(start, 2 * 60_000));
    expect(t.mailbox.sent).toEqual([]);
    await t.runJobs(at(start, 2 * 60_000 + 1));
    expect(t.mailbox.ofKind("code")).toHaveLength(1);

    release();
    await stuck;
  });

  it("после 10 неудачных попыток письмо помечается как неотправленное и больше не берётся", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    await requestCode(t.client(), eventId);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const hour = 60 * 60_000;

    t.mailbox.failNext(10);
    for (let i = 0; i < 10; i++) await t.runJobs(at(t.clock.now(), i * hour));
    expect(error).toHaveBeenCalledWith(expect.stringContaining("после 10 попыток"));

    await t.runJobs(at(t.clock.now(), 20 * hour));
    expect(t.mailbox.sent).toEqual([]);
  });
});
