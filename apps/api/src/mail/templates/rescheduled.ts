import { formatTicketCode } from "../../schemas/ticket.ts";
import { formatEventTime, utcOffset } from "../../time.ts";
import { BRAND, buttonBlock, codeBlock, eventBlock, headingBlock, layout, paragraphBlock, placeLine, type EventPlace, type Rendered } from "./layout.ts";

interface EventTime {
  startsAt: Date;
  timezone: string;
}

export interface RescheduledMail {
  event: EventTime & EventPlace & { title: string };
  previous: EventTime;
  firstName: string;
  /** Подтверждённая — код билета, лист ожидания — номер в листе на момент переноса. */
  status: { ticketCode: string } | { position: number };
  link: string;
}

/**
 * «Событие перенесено»: старое и новое время, каждое в своём поясе, и статус регистрации (D-016; рамки нет, блоки `S10-Email`).
 * Получают все неотменённые, включая лист ожидания.
 */
export function rescheduledMail({ event, previous, firstName, status, link }: RescheduledMail): Rendered {
  const was = formatEventTime(previous.startsAt, previous.timezone);
  const now = formatEventTime(event.startsAt, event.timezone);
  const place = placeLine(event);
  const ticket = "ticketCode" in status ? formatTicketCode(status.ticketCode) : undefined;
  const waitlist =
    "position" in status
      ? `Вы №${status.position} в листе ожидания. Как только место освободится, оно перейдёт первому в листе — мы пришлём письмо с билетом.`
      : undefined;
  const note = "Если новое время не подходит, по этой ссылке можно отказаться от участия.";
  return {
    subject: `Событие перенесено: ${event.title}`,
    text: [
      `${firstName}, событие перенесено.`,
      "",
      event.title,
      `Новое время: ${now}`,
      place,
      `Было: ${was}`,
      "",
      ticket ? `Ваш билет остаётся в силе. Код билета: ${ticket} — покажите на входе.` : waitlist!,
      "",
      `Моя регистрация: ${link}`,
      note,
      "",
      `— ${BRAND}`,
    ].join("\n"),
    html: layout(
      [
        headingBlock(`${firstName}, изменилось время`, "Событие перенесено"),
        eventBlock(event.title, `Новое время: ${now}`, `Было: ${was}`, place),
        ticket ? codeBlock("Код билета", "Остаётся в силе", ticket) : paragraphBlock(waitlist!),
        buttonBlock("Моя регистрация", link, note),
      ],
      `Вы получили это письмо, потому что зарегистрированы на событие «${event.title}». Время указано в часовом поясе события (${utcOffset(event.startsAt, event.timezone)}).`,
    ),
  };
}
