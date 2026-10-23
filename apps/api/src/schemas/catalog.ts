import { z } from "zod";
import { EVENT_CATEGORIES, EVENT_FORMATS } from "./event.ts";

/**
 * Пояс, который понимает рантайм. Не `isTimezone`: список `Intl.supportedValuesOf` в Node отдаёт старые
 * написания (Asia/Calcutta, Europe/Kiev), а Safari присылает новые (Asia/Kolkata, Europe/Kyiv) — и посетитель
 * получил бы 400 и пустую главную. Границы дня считает тот же `Intl` (через TZDate), так что проверка точная (D-061).
 */
const isKnownTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * Query каталога: фильтры живут в адресе страницы, поэтому всё приходит строками (D-061).
 * `tz` — пояс посетителя: по нему считаются границы «сегодня» и «на неделе».
 */
export const catalogQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  when: z.enum(["upcoming", "past", "today", "week"]).default("upcoming"),
  tz: z.string().refine(isKnownTimezone, "unknown_timezone").default("UTC"),
  hasSeats: z.literal("1").optional(),
  format: z.enum(EVENT_FORMATS).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  category: z.enum(EVENT_CATEGORIES).optional(),
  maxAge: z.enum(["0", "6", "12", "16", "18"]).transform(Number).optional(),
  cursor: z.string().optional(),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
