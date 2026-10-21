import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { api, ApiError, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Brand } from "../components/Brand.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { errorText } from "../errors.ts";
import { formatEventTime, seatsLeft } from "../format.ts";
import { NotFoundPage } from "./NotFoundPage.tsx";

/**
 * S1-Event: описание, время в поясе события, свободные места (D-026).
 * Форма регистрации и «Уже регистрировались?» приходят с тикетами R1 и «потерял письмо».
 */
export function PublicEventPage() {
  const { eventId = "" } = useParams();
  const event = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => api(client.api.events[":id"].$get({ param: { id: eventId } })),
  });

  if (event.isPending) return <PageSkeleton label="Загрузка события" />;
  if (event.error instanceof ApiError && event.error.status === 404) return <NotFoundPage />;

  return (
    <div className="page page--split">
      <Brand />
      {event.isError ? (
        <ErrorBanner title="Не удалось загрузить событие">{errorText(event.error)}</ErrorBanner>
      ) : (
        <>
          <div className="page__main">
            <header className="event-header">
              {event.data.minAge && (
                <div className="event-header__badges">
                  <span className="badge badge--age">{event.data.minAge}+</span>
                </div>
              )}
              <h1 className="heading heading--page">{event.data.title}</h1>
              <p className="event-header__time">
                <Icon name="calendar" />
                {formatEventTime(event.data.startsAt, event.data.timezone)}
              </p>
              {event.data.description && <p style={{ whiteSpace: "pre-line" }}>{event.data.description}</p>}
            </header>
          </div>
          <div className="page__side">
            <div className="panel">
              {event.data.started ? (
                <div className="banner" role="status">
                  <Icon name="info" />
                  <div className="banner__body">
                    <p className="banner__title">Событие началось — регистрация закрыта</p>
                  </div>
                </div>
              ) : event.data.freeSeats > 0 ? (
                <p className="seats seats--available">
                  <Icon name="check" />
                  {seatsLeft(event.data.freeSeats)}
                </p>
              ) : (
                <p className="seats seats--waitlist">
                  <Icon name="clock" />
                  Мест нет — вы встанете в лист ожидания
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
