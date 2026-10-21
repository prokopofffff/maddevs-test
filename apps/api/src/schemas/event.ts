import { z } from "zod";

const timezones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]);

/** Дата и время в поясе события, как их вводит организатор: `YYYY-MM-DDTHH:mm` (D-015). */
export const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const eventInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000),
  startsLocal: localDateTimeSchema,
  timezone: z.string().refine((tz) => timezones.has(tz), "unknown_timezone"),
  limit: z.number().int().min(1).max(100_000),
  minAge: z.number().int().min(1).max(120).nullable().optional(),
});

export type EventInput = z.infer<typeof eventInputSchema>;
