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

export const registrationFormSchema = participantDataSchema.extend({ email: emailSchema });

/** Запрос кода подтверждения. `lookup` («потерял письмо») приходит своим тикетом. */
export const verificationRequestSchema = registrationFormSchema.extend({ purpose: z.literal("register") });

export const confirmCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

export type ParticipantData = z.infer<typeof participantDataSchema>;
export type RegistrationForm = z.infer<typeof registrationFormSchema>;
export type VerificationRequest = z.infer<typeof verificationRequestSchema>;
