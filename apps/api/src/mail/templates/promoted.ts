import { formatTicketCode } from "../../schemas/ticket.ts";
import { formatEventTime, utcOffset } from "../../time.ts";
import { BRAND, buttonBlock, codeBlock, eventBlock, headingBlock, layout, placeLine, type EventPlace, type Rendered } from "./layout.ts";

export interface PromotedMail {
  event: { title: string; startsAt: Date; timezone: string } & EventPlace;
  firstName: string;
  ticketCode: string;
  link: string;
}

/** «Для вас освободилось место»: повышение из листа ожидания, билет и личная ссылка (рамка `S10-Email`, s10b). */
export function promotedMail({ event, firstName, ticketCode, link }: PromotedMail): Rendered {
  const time = formatEventTime(event.startsAt, event.timezone);
  const place = placeLine(event);
  const ticket = formatTicketCode(ticketCode);
  const story =
    "Один из участников отказался от участия, и место перешло к вам по очереди. Регистрация подтверждена, ваш билет — ниже.";
  const note =
    "По этой ссылке можно открыть билет и, если планы изменились, отказаться от участия — тогда место достанется следующему в листе ожидания.";
  return {
    subject: `Для вас освободилось место: ${event.title}`,
    text: [
      `${firstName}, вы были в листе ожидания. Для вас освободилось место.`,
      "",
      event.title,
      time,
      place,
      "",
      story,
      "",
      `Код билета: ${ticket} — покажите на входе.`,
      "",
      `Моя регистрация: ${link}`,
      note,
      "",
      `— ${BRAND}`,
    ].join("\n"),
    html: layout(
      [
        headingBlock(`${firstName}, вы были в листе ожидания`, "Для вас освободилось место"),
        eventBlock(event.title, time, story, place),
        codeBlock("Код билета", "Покажите на входе", ticket),
        buttonBlock("Моя регистрация", link, note),
      ],
      `Вы получили это письмо, потому что этот адрес указан при регистрации на событие «${event.title}», а вы были в листе ожидания. Если это были не вы, просто проигнорируйте письмо. Время указано в часовом поясе события (${utcOffset(event.startsAt, event.timezone)}).`,
    ),
  };
}
