import { formatTicketCode } from "../../schemas/ticket.ts";
import { formatEventTime, utcOffset } from "../../time.ts";
import { BRAND, buttonBlock, codeBlock, eventBlock, headingBlock, layout, type Rendered } from "./layout.ts";

export interface ReminderMail {
  event: { title: string; startsAt: Date; timezone: string };
  firstName: string;
  ticketCode: string;
  link: string;
}

/**
 * Напоминание: до начала меньше суток, билет и личная ссылка (D-018; рамки нет, блоки `S10-Email`).
 * Не «завтра»: после простоя первый проход может поставить письмо за несколько часов до начала.
 */
export function reminderMail({ event, firstName, ticketCode, link }: ReminderMail): Rendered {
  const time = formatEventTime(event.startsAt, event.timezone);
  const ticket = formatTicketCode(ticketCode);
  const note = "По этой ссылке можно открыть билет и, если планы изменились, отказаться от участия.";
  return {
    subject: `Скоро начало: ${event.title}`,
    text: [
      `${firstName}, напоминаем: до начала меньше суток.`,
      "",
      event.title,
      time,
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
        headingBlock(`${firstName}, напоминаем`, "До начала меньше суток"),
        eventBlock(event.title, time),
        codeBlock("Код билета", "Покажите на входе", ticket),
        buttonBlock("Моя регистрация", link, note),
      ],
      `Вы получили это письмо, потому что зарегистрированы на событие «${event.title}». Время указано в часовом поясе события (${utcOffset(event.startsAt, event.timezone)}).`,
    ),
  };
}
