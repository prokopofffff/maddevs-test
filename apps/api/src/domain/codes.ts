import { randomBytes, randomInt } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Код билета: 8 символов Crockford Base32, 40 бит (D-022). */
export function newTicketCode() {
  let code = "";
  for (let i = 0; i < 8; i++) code += CROCKFORD[randomInt(CROCKFORD.length)];
  return code;
}

/** Код подтверждения email: 6 цифр, хранится как есть (D-007, D-040). */
export const newVerificationCode = () => String(randomInt(1_000_000)).padStart(6, "0");

/** Токен личной ссылки: 32 случайных байта base64url (D-040). */
export const newRegistrationToken = () => randomBytes(32).toString("base64url");
