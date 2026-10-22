import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { EventRow } from "./events.ts";

/** Полные годы между датой рождения и календарной датой начала в поясе события (D-008). */
export function ageOnEventDay(birthDate: string, event: Pick<EventRow, "startsAt" | "timezone">) {
  const eventDay = format(new TZDate(event.startsAt, event.timezone), "yyyy-MM-dd");
  const years = Number(eventDay.slice(0, 4)) - Number(birthDate.slice(0, 4));
  // `MM-DD` сравниваются строкой: день рождения в этом году ещё не наступил — минус год.
  return eventDay.slice(5) < birthDate.slice(5) ? years - 1 : years;
}

/** «Младше минимального» — минимальный возраст задан и возраст на день события меньше. */
export const belowMinAge = (birthDate: string, event: Pick<EventRow, "startsAt" | "timezone" | "minAge">) =>
  event.minAge !== null && ageOnEventDay(birthDate, event) < event.minAge;

/** Сегодняшняя дата в UTC: дата рождения позже неё — точно в будущем. */
export const isFutureDate = (date: string, now: Date) => date > now.toISOString().slice(0, 10);
