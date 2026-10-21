import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/** Введённые организатором дата и время в поясе события → момент (D-015). */
export function localToInstant(local: string, timezone: string): Date {
  const [date, time] = local.split("T") as [string, string];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, min] = time.split(":").map(Number) as [number, number];
  return new Date(new TZDate(y, m - 1, d, h, min, timezone).getTime());
}

/** Момент → `YYYY-MM-DDTHH:mm` в поясе события, для формы организатора. */
export function instantToLocal(instant: Date, timezone: string): string {
  return format(new TZDate(instant, timezone), "yyyy-MM-dd'T'HH:mm");
}

/** «UTC+7», «UTC−3:30», «UTC» — смещение пояса в данный момент. */
export function utcOffset(instant: Date, timezone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")?.value;
  return (name ?? "GMT").replace("GMT", "UTC").replace("-", "−");
}

/** «25 октября 2026, 19:00 (UTC+7)» — время в поясе события с подписью смещения, для писем (D-015). */
export function formatEventTime(instant: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} (${utcOffset(instant, timezone)})`;
}
