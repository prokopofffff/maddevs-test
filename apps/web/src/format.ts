import type { EventCategory, EventFormat } from "@app/api/schemas";

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

/** Форма слова для числа: `plural(3, ["место", "места", "мест"])` → «места». */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

/** «Осталось 3 места», «Осталось 21 место», «Осталось 5 мест». */
export function seatsLeft(n: number) {
  return `Осталось ${n} ${plural(n, ["место", "места", "мест"])}`;
}

/** «14.03.1994» из `1994-03-14`. */
export const formatDate = (isoDate: string) => isoDate.split("-").reverse().join(".");

/** Сегодняшняя дата `YYYY-MM-DD` по часам браузера — для `max` у поля даты рождения. */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** «0:45» — оставшиеся секунды таймера. */
export const formatCountdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** «19:04» — время на часах пояса события. */
export const formatClock = (at: string, timeZone: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));

/** Подписи категорий события (D-059). */
export const categoryLabel: Record<EventCategory, string> = {
  meetup: "Митап",
  workshop: "Воркшоп",
  lecture: "Лекция",
  conference: "Конференция",
  game: "Игра",
  other: "Другое",
};

/** «Онлайн» или город — короткая подпись места для карточек и списков (D-059). */
export const placeText = (e: { format: EventFormat; city: string | null }) => (e.format === "online" ? "Онлайн" : (e.city ?? ""));

/** «Онлайн» или «Новосибирск, ул. Ленина, 12» — полное место для страницы события (D-059). */
export const fullPlace = (e: { format: EventFormat; city: string | null; address: string | null }) =>
  e.format === "online" ? "Онлайн" : [e.city, e.address].filter(Boolean).join(", ");
