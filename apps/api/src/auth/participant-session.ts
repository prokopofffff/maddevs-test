import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/client.ts";
import { participantSessions } from "../db/schema.ts";

/** Отдельная от `sid` cookie: сессия участника не открывает организаторские и поддержечные маршруты (D-057). */
export const PARTICIPANT_COOKIE = "psid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** В базе лежит только SHA-256 от значения cookie, как у `sessions` (D-040). */
const hashSessionId = (id: string) => createHash("sha256").update(id).digest("hex");

export async function createParticipantSession(db: Db, email: string, now: Date) {
  const id = randomBytes(32).toString("base64url");
  await db.insert(participantSessions).values({
    idHash: hashSessionId(id),
    email,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return id;
}

export async function findParticipantEmail(db: Db, id: string, now: Date): Promise<string | undefined> {
  const [row] = await db
    .select({ email: participantSessions.email })
    .from(participantSessions)
    .where(and(eq(participantSessions.idHash, hashSessionId(id)), gt(participantSessions.expiresAt, now)));
  return row?.email;
}

export async function deleteParticipantSession(db: Db, id: string) {
  await db.delete(participantSessions).where(eq(participantSessions.idHash, hashSessionId(id)));
}

export function readParticipantCookie(c: Context) {
  return getCookie(c, PARTICIPANT_COOKIE);
}

export function writeParticipantCookie(c: Context, id: string, secure: boolean) {
  setCookie(c, PARTICIPANT_COOKIE, id, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    secure,
  });
}

export function clearParticipantCookie(c: Context) {
  deleteCookie(c, PARTICIPANT_COOKIE, { path: "/" });
}
