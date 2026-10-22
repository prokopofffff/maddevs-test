import { describe, expect, it } from "vitest";
import { cancel, confirmedTicket, createEvent, participant, register } from "../support/participant.ts";
import { testApp } from "../support/test-app.ts";

// Событие по умолчанию — 20 ноября 2026, 19:00 в Новосибирске, «Красный проспект, 1» (D-059).
const T = new Date("2026-11-20T12:00:00Z");
const PLACE = "Новосибирск, Красный проспект, 1";
const both = (m: { text: string; html: string }) => [m.text, m.html];

describe("Место события в письмах (D-059)", () => {
  it("confirmed: у офлайн-события в text и html строка «город, адрес», у онлайн — «Онлайн»", async () => {
    const t = testApp();
    const offline = await createEvent(t);
    const online = await createEvent(t, { format: "online", city: undefined, address: undefined });

    await register(t, offline.eventId, participant({ email: "off@example.com" }));
    await register(t, online.eventId, participant({ email: "on@example.com" }));
    await t.runJobs(t.clock.now());

    const [toOffline] = t.mailbox.ofKind("confirmed", "off@example.com");
    const [toOnline] = t.mailbox.ofKind("confirmed", "on@example.com");
    for (const body of both(toOffline!)) expect(body).toContain(PLACE);
    for (const body of both(toOnline!)) expect(body).toContain("Онлайн");
    for (const body of both(toOnline!)) expect(body).not.toContain("Новосибирск,");
  });

  it("confirmed: в тексте строка места идёт сразу после времени, в html адрес экранируется", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { address: "ул. <Ленина> & Ко, 5" });

    await register(t, eventId);
    await t.runJobs(t.clock.now());

    const [letter] = t.mailbox.ofKind("confirmed");
    expect(letter!.text).toContain("20 ноября 2026, 19:00 (UTC+7)\nНовосибирск, ул. <Ленина> & Ко, 5\n");
    expect(letter!.html).toContain("Новосибирск, ул. &lt;Ленина&gt; &amp; Ко, 5");
    expect(letter!.html).not.toContain("<Ленина>");
  });

  it("promoted: письмо о повышении из листа ожидания содержит место", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t, { limit: 1 });
    const a = await register(t, eventId, participant({ email: "a@example.com" }));
    await register(t, eventId, participant({ email: "b@example.com" }));
    await cancel(t.client(), a.body.token);

    await t.runJobs(t.clock.now());

    const [letter] = t.mailbox.ofKind("promoted", "b@example.com");
    for (const body of both(letter!)) expect(body).toContain(PLACE);
  });

  it("reminder: напоминание содержит место", async () => {
    const t = testApp();
    const { eventId } = await createEvent(t);
    t.clock.set(new Date(T.getTime() - 48 * 60 * 60_000));
    await confirmedTicket(t, eventId);

    await t.runJobs(new Date(T.getTime() - 24 * 60 * 60_000));

    const [letter] = t.mailbox.ofKind("reminder");
    for (const body of both(letter!)) expect(body).toContain(PLACE);
  });

  it("rescheduled: письмо о переносе содержит место — и подтверждённым, и из листа ожидания", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t, { limit: 1 });
    await register(t, eventId, participant({ email: "a@example.com" }));
    await register(t, eventId, participant({ email: "b@example.com" }));

    await organizer.patch(`/api/organizer/events/${eventId}`, { startsLocal: "2026-11-21T19:00" });
    await t.runJobs(t.clock.now());

    expect(t.mailbox.ofKind("rescheduled")).toHaveLength(2);
    for (const letter of t.mailbox.ofKind("rescheduled")) for (const body of both(letter)) expect(body).toContain(PLACE);
  });

  it("rescheduled: перенос вместе со сменой места показывает новое место", async () => {
    const t = testApp();
    const { eventId, organizer } = await createEvent(t);
    await register(t, eventId);

    await organizer.patch(`/api/organizer/events/${eventId}`, {
      startsLocal: "2026-11-21T19:00",
      format: "online",
    });
    await t.runJobs(t.clock.now());

    const [letter] = t.mailbox.ofKind("rescheduled");
    for (const body of both(letter!)) expect(body).toContain("Онлайн");
    for (const body of both(letter!)) expect(body).not.toContain(PLACE);
  });
});
