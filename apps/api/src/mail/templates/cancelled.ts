import { formatEventTime, utcOffset } from "../../time.ts";
import { BRAND, eventBlock, headingBlock, layout, type Rendered } from "./layout.ts";

export interface CancelledMail {
  event: { title: string; startsAt: Date; timezone: string };
  firstName: string;
}

/** Подтверждение отказа: билет недействителен, вернуться можно новой регистрацией (рамки нет, блоки `S10-Email`). */
export function cancelledMail({ event, firstName }: CancelledMail): Rendered {
  const time = formatEventTime(event.startsAt, event.timezone);
  const story =
    "Регистрация отменена, билет больше не действует. Если планы изменятся, зарегистрируйтесь заново на странице события.";
  return {
    subject: `Вы отказались от участия: ${event.title}`,
    text: [`${firstName}, вы отказались от участия.`, "", event.title, time, "", story, "", `— ${BRAND}`].join("\n"),
    html: layout(
      [
        headingBlock(`${firstName}, отказ принят`, "Вы отказались от участия"),
        eventBlock(event.title, time, story),
      ],
      `Вы получили это письмо, потому что по личной ссылке из письма о регистрации на событие «${event.title}» нажали «Отказаться от участия». Время указано в часовом поясе события (${utcOffset(event.startsAt, event.timezone)}).`,
    ),
  };
}
