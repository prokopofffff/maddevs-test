import type { Db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { hashPassword } from "./password.ts";

/**
 * Новая учётная запись; email уже нормализован схемой. Занятый email — `undefined`.
 * Организатора создаёт signup, поддержку — только `pnpm admin:create` (D-030).
 */
export async function createAccount(
  db: Db,
  { email, password, role, now }: { email: string; password: string; role: "organizer" | "support"; now: Date },
) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password), role, createdAt: now })
    .onConflictDoNothing({ target: users.email })
    .returning();
  return user;
}
