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
