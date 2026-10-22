import { z } from "zod";
import { EVENT_CATEGORIES, EVENT_FORMATS, isTimezone } from "./event.ts";

/**
 * Query каталога: фильтры живут в адресе страницы, поэтому всё приходит строками (D-061).
 * `tz` — пояс посетителя: по нему считаются границы «сегодня» и «на неделе».
 */
export const catalogQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  when: z.enum(["upcoming", "past", "today", "week"]).default("upcoming"),
  tz: z.string().refine(isTimezone, "unknown_timezone").default("UTC"),
  hasSeats: z.literal("1").optional(),
  format: z.enum(EVENT_FORMATS).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  category: z.enum(EVENT_CATEGORIES).optional(),
  maxAge: z.enum(["0", "6", "12", "16", "18"]).transform(Number).optional(),
  cursor: z.string().optional(),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
