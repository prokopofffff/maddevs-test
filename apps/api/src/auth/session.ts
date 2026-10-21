import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";

export const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = Pick<typeof users.$inferSelect, "id" | "email" | "role">;

/** В базе лежит только SHA-256 от значения cookie (D-040). */
const hashSessionId = (id: string) => createHash("sha256").update(id).digest("hex");

export async function createSession(db: Db, userId: number, now: Date) {
  const id = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    idHash: hashSessionId(id),
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return id;
}

export async function findSessionUser(db: Db, id: string, now: Date): Promise<SessionUser | undefined> {
  const [row] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, hashSessionId(id)), gt(sessions.expiresAt, now)));
  return row;
}

export async function deleteSession(db: Db, id: string) {
  await db.delete(sessions).where(eq(sessions.idHash, hashSessionId(id)));
}

export function readSessionCookie(c: Context) {
  return getCookie(c, SESSION_COOKIE);
}

export function writeSessionCookie(c: Context, id: string, secure: boolean) {
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    secure,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
