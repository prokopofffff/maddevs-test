import { formatEventTime, utcOffset } from "../../time.ts";
import { BRAND, buttonBlock, eventBlock, headingBlock, layout, paragraphBlock, type Rendered } from "./layout.ts";

export interface WaitlistedMail {
  event: { title: string; startsAt: Date; timezone: string };
  firstName: string;
  position: number;
  link: string;
}

/** «Вы №N в листе ожидания»: номер на момент регистрации и личная ссылка (рамки нет, блоки `S10-Email`). */
export function waitlistedMail({ event, firstName, position, link }: WaitlistedMail): Rendered {
  const time = formatEventTime(event.startsAt, event.timezone);
  return {
    subject: `Лист ожидания №${position}: ${event.title}`,
    text: [
      `${firstName}, мест пока нет. Вы №${position} в листе ожидания.`,
      "",
      event.title,
      time,
      "",
      "Как только место освободится, оно перейдёт первому в листе — мы пришлём письмо с билетом.",
      "",
      `Моя регистрация: ${link}`,
      "По этой ссылке видно текущий номер в листе и можно отказаться от участия.",
      "",
      `— ${BRAND}`,
    ].join("\n"),
    html: layout(
      [
        headingBlock(`${firstName}, мест пока нет`, `Вы №${position} в листе ожидания`),
        eventBlock(event.title, time),
        paragraphBlock("Как только место освободится, оно перейдёт первому в листе — мы пришлём письмо с билетом."),
        buttonBlock(
          "Моя регистрация",
          link,
          "По этой ссылке видно текущий номер в листе и можно отказаться от участия.",
        ),
      ],
      `Вы получили это письмо, потому что этот адрес указан при регистрации на событие «${event.title}». Если это были не вы, просто проигнорируйте письмо. Время указано в часовом поясе события (${utcOffset(event.startsAt, event.timezone)}).`,
    ),
  };
}
