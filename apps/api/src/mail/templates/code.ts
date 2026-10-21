import { formatEventTime, utcOffset } from "../../time.ts";
import { BRAND, codeBlock, eventBlock, headingBlock, layout, paragraphBlock, type Rendered } from "./layout.ts";

export interface CodeMail {
  event: { title: string; startsAt: Date; timezone: string };
  code: string;
}

/** Код подтверждения email (D-007): действует 10 минут. */
export function codeMail({ event, code }: CodeMail): Rendered {
  const time = formatEventTime(event.startsAt, event.timezone);
  return {
    subject: `Код подтверждения: ${code}`,
    text: [
      `Код подтверждения: ${code}`,
      "",
      `Введите его на странице события «${event.title}» (${time}).`,
      "Код действует 10 минут.",
      "",
      `Если вы не регистрировались, просто проигнорируйте письмо. — ${BRAND}`,
    ].join("\n"),
    html: layout(
      [
        headingBlock("Подтвердите email", "Код подтверждения"),
        eventBlock(event.title, time),
        codeBlock("Код", "Действует 10 минут", code),
        paragraphBlock("Введите код на странице события, чтобы закончить регистрацию."),
      ],
      `Кто-то указал этот адрес на странице события «${event.title}». Если это были не вы, просто проигнорируйте письмо. Время указано в часовом поясе события (${utcOffset(event.startsAt, event.timezone)}).`,
    ),
  };
}
