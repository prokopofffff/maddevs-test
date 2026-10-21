import { formatTicketCode } from "../../schemas/ticket.ts";
import { formatEventTime, utcOffset } from "../../time.ts";
import { BRAND, buttonBlock, codeBlock, eventBlock, headingBlock, layout, type Rendered } from "./layout.ts";

export interface ConfirmedMail {
  event: { title: string; startsAt: Date; timezone: string };
  firstName: string;
  ticketCode: string;
  link: string;
}

/** «Место ваше»: билет и личная ссылка (рамка `S10-Email`, s10a). */
export function confirmedMail({ event, firstName, ticketCode, link }: ConfirmedMail): Rendered {
  const time = formatEventTime(event.startsAt, event.timezone);
  const ticket = formatTicketCode(ticketCode);
  return {
    subject: `Ваш билет: ${event.title}`,
    text: [
      `${firstName}, вы зарегистрированы. Место ваше.`,
      "",
      event.title,
      time,
      "",
      `Код билета: ${ticket} — покажите на входе.`,
      "",
      `Моя регистрация: ${link}`,
      "По этой ссылке можно открыть билет и, если планы изменились, отказаться от участия.",
      "",
      `— ${BRAND}`,
    ].join("\n"),
    html: layout(
      [
        headingBlock(`${firstName}, вы зарегистрированы`, "Место ваше"),
        eventBlock(event.title, time),
        codeBlock("Код билета", "Покажите на входе", ticket),
        buttonBlock(
          "Моя регистрация",
          link,
          "По этой ссылке можно открыть билет и, если планы изменились, отказаться от участия.",
        ),
      ],
      `Вы получили это письмо, потому что этот адрес указан при регистрации на событие «${event.title}». Если это были не вы, просто проигнорируйте письмо. Время указано в часовом поясе события (${utcOffset(event.startsAt, event.timezone)}).`,
    ),
  };
}
