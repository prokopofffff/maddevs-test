import { formatEventTime, utcOffset } from "../../time.ts";
import {
  BRAND,
  buttonBlock,
  detailsBlock,
  eventBlock,
  headingBlock,
  layout,
  paragraphBlock,
  type Rendered,
} from "./layout.ts";

interface Person {
  firstName: string;
  lastName: string;
  birthDate: string;
}

interface CorrectionMail {
  event: { title: string; startsAt: Date; timezone: string };
  link: string;
}

/** «14.03.1994» из `1994-03-14`. */
const formatDate = (isoDate: string) => isoDate.split("-").reverse().join(".");

const rows = (p: Person): [string, string][] => [
  ["Имя", p.firstName],
  ["Фамилия", p.lastName],
  ["Дата рождения", formatDate(p.birthDate)],
];

const footer = (event: CorrectionMail["event"]) =>
  `Вы получили это письмо, потому что по личной ссылке из письма о регистрации на событие «${event.title}» подали заявку на исправление данных. Время указано в часовом поясе события (${utcOffset(event.startsAt, event.timezone)}).`;

/** «Данные исправлены»: поддержка приняла заявку, в регистрации новые значения (D-031; рамки нет, блоки `S10-Email`). */
export function correctionAcceptedMail({ event, link, values }: CorrectionMail & { values: Person }): Rendered {
  const time = formatEventTime(event.startsAt, event.timezone);
  const story = "Поддержка приняла заявку. Теперь в регистрации такие данные — их сверят с документом на входе.";
  const note = "По этой ссылке открываются билет и данные регистрации.";
  return {
    subject: `Данные исправлены: ${event.title}`,
    text: [
      `${values.firstName}, данные в регистрации исправлены.`,
      "",
      event.title,
      time,
      "",
      story,
      ...rows(values).map(([label, value]) => `${label}: ${value}`),
      "",
      `Моя регистрация: ${link}`,
      "",
      `— ${BRAND}`,
    ].join("\n"),
    html: layout(
      [
        headingBlock(`${values.firstName}, заявка принята`, "Данные исправлены"),
        eventBlock(event.title, time, story),
        detailsBlock(rows(values)),
        buttonBlock("Моя регистрация", link, note),
      ],
      footer(event),
    ),
  };
}

/** «Исправление отклонено»: данные прежние, причина — если поддержка её указала (D-031). */
export function correctionRejectedMail({
  event,
  link,
  firstName,
  proposed,
  reason,
}: CorrectionMail & { firstName: string; proposed: Person; reason: string | null }): Rendered {
  const time = formatEventTime(event.startsAt, event.timezone);
  const story = "Поддержка отклонила заявку, данные в регистрации остались прежними. Вы предлагали:";
  const note = "По этой ссылке можно подать заявку заново, пока событие не началось.";
  return {
    subject: `Исправление отклонено: ${event.title}`,
    text: [
      `${firstName}, исправление данных отклонено.`,
      "",
      event.title,
      time,
      "",
      story,
      ...rows(proposed).map(([label, value]) => `${label}: ${value}`),
      ...(reason ? ["", `Причина: ${reason}`] : []),
      "",
      `Моя регистрация: ${link}`,
      note,
      "",
      `— ${BRAND}`,
    ].join("\n"),
    html: layout(
      [
        headingBlock(`${firstName}, заявка отклонена`, "Исправление отклонено"),
        eventBlock(event.title, time, story),
        detailsBlock(rows(proposed)),
        ...(reason ? [paragraphBlock(`Причина: ${reason}`)] : []),
        buttonBlock("Моя регистрация", link, note),
      ],
      footer(event),
    ),
  };
}
