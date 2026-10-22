import { z } from "zod";

/** Перечни и шкала лежат здесь без серверных импортов: веб берёт их же для формы и фильтров (D-059, D-060). */
export const EVENT_FORMATS = ["offline", "online"] as const;
export const EVENT_CATEGORIES = ["meetup", "workshop", "lecture", "conference", "game", "other"] as const;
/** Минимальный возраст; 0 — без ограничения (D-060). */
export const AGE_RATINGS = [0, 6, 12, 16, 18] as const;

export type EventFormat = (typeof EVENT_FORMATS)[number];
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type AgeRating = (typeof AGE_RATINGS)[number];

const timezones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]);

/** Дата и время в поясе события, как их вводит организатор: `YYYY-MM-DDTHH:mm` (D-015). */
export const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

/**
 * Поля без проверки пары «формат — место»: `.partial()` не работает на схеме с refine (zod 4),
 * а правке пара проверяется по слитым значениям в `updateEvent` (D-059).
 * У `minAge` нет `.default`: внутри `.partial()` он сбрасывал бы возраст при каждой правке, умолчание 0 ставит маршрут (D-060).
 */
const eventFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000),
  startsLocal: localDateTimeSchema,
  timezone: z.string().refine((tz) => timezones.has(tz), "unknown_timezone"),
  limit: z.number().int().min(1).max(100_000),
  format: z.enum(EVENT_FORMATS),
  // Пробелы внутри схлопываются: «Нижний   Новгород» и «Нижний Новгород» — один город для фильтра (D-059).
  city: z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(100))
    .nullish(),
  address: z.string().trim().min(1).max(300).nullish(),
  category: z.enum(EVENT_CATEGORIES),
  minAge: z.literal(AGE_RATINGS).optional(),
});

/** Создание: у офлайн-события город и адрес обязательны, у онлайн их нет (D-059). */
export const eventInputSchema = eventFieldsSchema.superRefine((event, ctx) => {
  if (event.format !== "offline") return;
  for (const field of ["city", "address"] as const) {
    if (!event[field]) ctx.addIssue({ code: "custom", path: [field], message: "required" });
  }
});

export type EventInput = z.infer<typeof eventInputSchema>;

/** Правка: те же поля, все необязательны. Без `startsLocal` момент начала сохраняется (D-016). */
export const eventPatchSchema = eventFieldsSchema.partial();

export type EventPatch = z.infer<typeof eventPatchSchema>;
