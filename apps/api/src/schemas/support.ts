import { z } from "zod";

/** «Отклонить» с необязательной причиной; пустая после trim — без причины (D-031). */
export const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((r) => r || null),
});

export type RejectInput = z.input<typeof rejectSchema>;
