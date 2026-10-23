import { and, desc, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { emailVerifications, registrations } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { enqueue } from "../mail/outbox.ts";
import { loginCodeMail } from "../mail/templates/login-code.ts";
import { newVerificationCode } from "./codes.ts";
import type { MailContext } from "./registrations.ts";
import { checkCode, consume } from "./verifications.ts";

const CODE_TTL_MS = 10 * 60_000;
const RESEND_MS = 60_000;

const isLogin = eq(emailVerifications.purpose, "login");

/**
 * Код входа участника (D-057). Уходит на любой email, есть у него регистрации или нет (D-048).
 * Минута между кодами и гашение прежнего считаются по email среди кодов `login`; события у них нет.
 * Письмо с кодом — в той же транзакции.
 */
export async function issueLoginCode(db: Db, email: string, { now }: MailContext) {
  const [previous] = await db
    .select({ createdAt: emailVerifications.createdAt })
    .from(emailVerifications)
    .where(and(isLogin, eq(emailVerifications.email, email)))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);
  if (previous && now.getTime() - previous.createdAt.getTime() < RESEND_MS) {
    const retryAfter = Math.ceil((previous.createdAt.getTime() + RESEND_MS - now.getTime()) / 1000);
    return { error: "code_resend_too_soon" as const, retryAfter };
  }

  return withTx(db, async (tx) => {
    await tx
      .update(emailVerifications)
      .set({ expiresAt: now })
      .where(and(isLogin, eq(emailVerifications.email, email), gt(emailVerifications.expiresAt, now)));
    const [verification] = await tx
      .insert(emailVerifications)
      .values({
        email,
        purpose: "login",
        code: newVerificationCode(),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        createdAt: now,
      })
      .returning();
    await enqueue(
      tx,
      { dedupKey: `login_code:${verification!.id}`, kind: "login_code", to: email, ...loginCodeMail({ code: verification!.code }) },
      now,
    );
    return { verification: verification!, resendAfter: new Date(now.getTime() + RESEND_MS) };
  });
}

/**
 * Ввод кода входа: те же проверки, что у остальных назначений (`checkCode`), строка под `FOR UPDATE`.
 * Код другого назначения отвечаем как «нет такого кода» до проверки самого кода: попытки чужого кода не тратятся
 * и `register` не доходит до сессии (D-057). Повтор верного кода в пределах жизни снова даёт `email`,
 * как повтор `lookup` (D-048): вторая вкладка не получает ошибку, а лишняя сессия безвредна.
 */
export async function confirmLoginCode(db: Db, id: number, code: string, now: Date) {
  return withTx(db, async (tx) => {
    const [row] = await tx
      .select({ purpose: emailVerifications.purpose })
      .from(emailVerifications)
      .where(eq(emailVerifications.id, id));
    if (row?.purpose !== "login") return { error: "not_found" as const };

    const checked = await checkCode(tx, id, code, now);
    if ("error" in checked) return checked;
    const { verification } = checked;
    if (!verification.consumedAt) await consume(tx, id, now);
    return { email: verification.email };
  });
}

/** Данные последней по `created_at` регистрации этого email — предзаполнение формы (D-058). */
export async function lastRegistrationData(db: Db, email: string) {
  const [row] = await db
    .select({
      firstName: registrations.firstName,
      lastName: registrations.lastName,
      birthDate: registrations.birthDate,
    })
    .from(registrations)
    .where(eq(registrations.email, email))
    .orderBy(desc(registrations.createdAt), desc(registrations.id))
    .limit(1);
  return row ?? null;
}
