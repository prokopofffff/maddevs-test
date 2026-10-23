import { z } from "zod";
import { emailSchema } from "./auth.ts";

const name = z.string().trim().min(1).max(100);

/** Календарная дата `YYYY-MM-DD`, которая существует (не 2026-02-30). */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => !Number.isNaN(Date.parse(d)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "invalid_date");

/**
 * Данные участника — общая схема формы регистрации и формы исправления (D-031).
 * «Не в будущем» сервер проверяет по своим часам, форма — атрибутом `max` поля.
 */
export const participantDataSchema = z.object({
  firstName: name,
  lastName: name,
  birthDate: isoDateSchema.refine((d) => d >= "1900-01-01", "too_early"),
});

/**
 * Правка профиля: те же три поля, что у регистрации, плюс согласие отменить регистрации,
 * на которые новая дата рождения не проходит по возрасту (D-065).
 */
export const profileUpdateSchema = participantDataSchema.extend({ cancelConflicts: z.boolean().optional() });

/**
 * Тело регистрации под сессией участника: данные формы или пустой объект — «в один клик» по профилю (D-065).
 * Неполные данные дают ошибки по полям `participantDataSchema`, а не одну общую ошибку объединения.
 */
export const signedInRegistrationSchema = z.unknown().transform((body, ctx): ParticipantData | null => {
  if (typeof body === "object" && body !== null && !Array.isArray(body) && Object.keys(body).length === 0) return null;
  const parsed = participantDataSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
  return z.NEVER;
});

export const registrationFormSchema = participantDataSchema.extend({ email: emailSchema });

/** Запрос кода подтверждения: `register` — с данными формы, `lookup` («потерял письмо») — только email (D-039). */
export const verificationRequestSchema = z.discriminatedUnion("purpose", [
  registrationFormSchema.extend({ purpose: z.literal("register") }),
  z.object({ purpose: z.literal("lookup"), email: emailSchema }),
]);

export const confirmCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

export type ParticipantData = z.infer<typeof participantDataSchema>;
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
export type RegistrationForm = z.infer<typeof registrationFormSchema>;
export type VerificationRequest = z.infer<typeof verificationRequestSchema>;
