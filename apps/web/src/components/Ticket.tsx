import { formatTicketCode } from "@app/api/schemas";

/** Билет из шаблона: подпись и крупный код. Внутри `.panel` вырезы-«надрывы» в цвет панели. */
export function Ticket({ code, large = false }: { code: string; large?: boolean }) {
  return (
    <div className="ticket s3-ticket--panel">
      <div className="ticket__main">
        <p className="ticket__label">Код билета</p>
        <p className="ticket__note">Покажите на входе</p>
      </div>
      <div className="ticket__stub">
        <p className={`ticket-code ${large ? "ticket-code--lg" : ""}`}>{formatTicketCode(code)}</p>
      </div>
    </div>
  );
}
