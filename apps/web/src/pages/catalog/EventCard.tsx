import type { InferResponseType } from "hono/client";
import { Link } from "react-router";
import type { client } from "../../api.ts";
import { AgeBadge } from "../../components/AgeBadge.tsx";
import { categoryLabel, formatEventTime, placeText, seatsLeft } from "../../format.ts";

export type CatalogEvent = InferResponseType<typeof client.api.events.$get, 200>["events"][number];

/** Плашка мест: у начавшихся регистрация закрыта, у полных — лист ожидания. */
function Availability({ event }: { event: CatalogEvent }) {
  if (event.started) {
    return (
      <span className="badge badge--cancelled">
        <span className="badge__mark" aria-hidden="true" />
        Регистрация закрыта
      </span>
    );
  }
  return event.freeSeats > 0 ? (
    <span className="badge badge--confirmed">
      <span className="badge__mark" aria-hidden="true" />
      {seatsLeft(event.freeSeats)}
    </span>
  ) : (
    <span className="badge badge--waitlist">
      <span className="badge__mark" aria-hidden="true" />
      Лист ожидания
    </span>
  );
}

/** Карточка события в каталоге: вся целиком — ссылка на страницу события. */
export function EventCard({ event }: { event: CatalogEvent }) {
  return (
    <Link className="event-card" to={`/e/${event.id}`}>
      <span className="eyebrow">{[categoryLabel[event.category], placeText(event)].filter(Boolean).join(" · ")}</span>
      <span className="event-card__title">{event.title}</span>
      <span className="event-card__time">{formatEventTime(event.startsAt, event.timezone)}</span>
      <span className="event-card__badges">
        <Availability event={event} />
        <AgeBadge minAge={event.minAge} />
      </span>
    </Link>
  );
}
