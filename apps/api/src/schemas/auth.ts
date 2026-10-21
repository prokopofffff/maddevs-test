import { z } from "zod";

/** Email везде обрезается и приводится к нижнему регистру (D-005). */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
