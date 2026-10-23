import { formatTicketCode } from "@app/api/schemas";
import type { InferResponseType } from "hono/client";
import { Link } from "react-router";
import type { client } from "../../api.ts";
import { formatEventTime, placeText } from "../../format.ts";

export type MyRegistration = InferResponseType<
  typeof client.api.participant.registrations.$get,
  200
>["registrations"][number];

/** Деление «Текущие» / «Прошедшие» (дизайн §8.3): отменённая регистрация — всегда в прошедших. */
export const isCurrent = (r: MyRegistration) => !r.event.started && r.status !== "cancelled";

/** Плашка статуса по таблице дизайна §8.3: класс бейджа и текст. */
function statusBadge(r: MyRegistration): { className: string; text: string } {
  if (r.status === "cancelled") return { className: "badge--cancelled", text: "Отменена" };
  if (r.status === "confirmed") {
    if (r.checkedInAt) return { className: "badge--arrived", text: "Пришли" };
    if (r.event.started) return { className: "badge--cancelled", text: "Не отмечены на входе" };
    return {
      className: "badge--confirmed",
      text: r.ticketCode ? `Место ваше · билет ${formatTicketCode(r.ticketCode)}` : "Место ваше",
    };
  }
  // Лист ожидания: после начала место уже не освободится (D-034).
  if (r.event.started) return { className: "badge--cancelled", text: "Место не освободилось" };
  return {
    className: "badge--waitlist",
    text: r.waitlistPosition ? `Лист ожидания · №${r.waitlistPosition}` : "Лист ожидания",
  };
}

/** Строка списка «Мои регистрации»: название, время и место, статус, «Открыть» → `/r/:token`. */
export function RegistrationRow({ registration }: { registration: MyRegistration }) {
  const { event } = registration;
  const badge = statusBadge(registration);
  return (
    <li className="event-item reg-item">
      <div className="event-item__main">
        <span className="event-item__title">{event.title}</span>
        <p className="event-item__time">
          {[formatEventTime(event.startsAt, event.timezone), placeText(event)].filter(Boolean).join(" · ")}
        </p>
        <span className={`badge ${badge.className}`}>
          <span className="badge__mark" aria-hidden="true" />
          {badge.text}
        </span>
      </div>
      <Link className="button button--secondary button--sm" to={`/r/${registration.token}`}>
        Открыть
        <span className="visually-hidden">: {event.title}</span>
      </Link>
    </li>
  );
}
