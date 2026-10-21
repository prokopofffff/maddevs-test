import { z } from "zod";

/** Код билета показывается как `K7QM-4XPA`, хранится без дефиса (D-022). */
export const formatTicketCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/**
 * Код, как его набрали на входе, → как он хранится: верхний регистр, без пробелов и дефисов,
 * `O` читается как `0`, `I` и `L` — как `1` (D-022).
 */
export const normalizeTicketCode = (input: string) =>
  input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

/** Только символы Crockford Base32, ровно 8; остальное заведомо не билет. */
export const TICKET_CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** Ввод на экране чекина. Неправильный код — не ошибка формы, а «Билет не найден». */
export const checkinSchema = z.object({ code: z.string().max(100) });
