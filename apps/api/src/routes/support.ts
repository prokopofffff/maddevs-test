import { Hono } from "hono";
import { correctionQueue, decideCorrection, type Decision } from "../domain/corrections.ts";
import { apiError, type Env } from "../http.ts";
import { rejectSchema } from "../schemas/support.ts";
import { validate } from "../validation.ts";
import { requireRole, requireUser } from "./auth.ts";

const ID = /^[1-9]\d{0,15}$/;

type Vars = Env["Variables"];

/** Решение по заявке из пути `:id`; кривой id — тот же `404`, что и несуществующий. */
function decide({ db, clock, config, user }: Vars, id: string, decision: Decision) {
  if (!ID.test(id)) return { error: "not_found" as const };
  return decideCorrection(db, Number(id), decision, { now: clock.now(), publicUrl: config.publicUrl, decidedBy: user.id });
}

/** Маршруты поддержки: только роль `support`, организатору — `404` (D-030, D-031). */
export const supportRoutes = new Hono<Env>()
  .use(requireUser, requireRole("support"))
  .get("/corrections", async (c) => c.json({ corrections: await correctionQueue(c.var.db) }, 200))
  .post("/corrections/:id/accept", async (c) => {
    const result = await decide(c.var, c.req.param("id"), { status: "accepted" });
    if (result.error === "not_found") return apiError(c, 404, result.error);
    if (result.error) return apiError(c, 409, result.error);
    // Решение и письмо закоммичены — отправка стартует сразу (D-014).
    c.var.outbox.wake();
    return c.json({ status: "accepted" as const }, 200);
  })
  .post("/corrections/:id/reject", validate("json", rejectSchema), async (c) => {
    const { reason } = c.req.valid("json");
    const result = await decide(c.var, c.req.param("id"), { status: "rejected", reason });
    if (result.error === "not_found") return apiError(c, 404, result.error);
    if (result.error) return apiError(c, 409, result.error);
    c.var.outbox.wake();
    return c.json({ status: "rejected" as const }, 200);
  });
