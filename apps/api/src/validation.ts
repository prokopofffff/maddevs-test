import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

/** `zValidator` с ответом `400 validation_failed` + `issues` (SPEC, раздел 4). */
export const validate = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: "validation_failed" as const,
          issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        400,
      );
    }
  });
