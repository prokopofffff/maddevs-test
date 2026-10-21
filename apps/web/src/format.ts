/** «25 октября 2026, 19:00 (UTC+7)» — время в поясе события с подписью смещения (D-015). */
export function formatEventTime(startsAt: string, timeZone: string) {
  return `${formatWallTime(startsAt, timeZone)} (${utcOffset(startsAt, timeZone)})`;
}

/** «25 октября 2026, 19:00» — дата и время на часах пояса, без подписи смещения. */
export function formatWallTime(at: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

/** «UTC+7», «UTC−3:30», «UTC» — смещение пояса в данный момент. */
export function utcOffset(at: string | Date, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(at))
    .find((p) => p.type === "timeZoneName")?.value;
  return (name ?? "GMT").replace("GMT", "UTC").replace("-", "−");
}

/** «Осталось 3 места», «Осталось 21 место», «Осталось 5 мест». */
export function seatsLeft(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "место" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "места" : "мест";
  return `Осталось ${n} ${word}`;
}
