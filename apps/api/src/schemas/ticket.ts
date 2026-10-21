/** Код билета показывается как `K7QM-4XPA`, хранится без дефиса (D-022). */
export const formatTicketCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
