import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { errorText } from "../errors.ts";
import { formatEventTime } from "../format.ts";

export const myEventsKey = ["organizer", "events"] as const;

const CreateButton = () => (
  <Link className="button button--primary" to="/organizer/events/new">
    <Icon name="plus" />
    Создать событие
  </Link>
);

/** S6-Events: «Мои события». */
export function MyEventsPage() {
  const events = useQuery({
    queryKey: myEventsKey,
    queryFn: async () => (await api(client.api.organizer.events.$get())).events,
  });

  return (
    <>
      <div className="page-header">
        <div className="page-header__group">
          <h1 className="heading page-header__title">Мои события</h1>
        </div>
        <div className="page-header__actions">
          <CreateButton />
        </div>
      </div>
      {events.isPending && <PageSkeleton label="Загрузка событий" />}
      {events.isError && <ErrorBanner title="Не удалось загрузить события">{errorText(events.error)}</ErrorBanner>}
      {events.data?.length === 0 && (
        <div className="empty-state">
          <span className="empty-state__icon">
            <Icon name="calendar" />
          </span>
          <p className="empty-state__title">Пока нет событий</p>
          <p className="empty-state__text">
            Создайте первое событие и отправьте участникам ссылку — регистрация откроется сразу.
          </p>
          <CreateButton />
        </div>
      )}
      {events.data && events.data.length > 0 && (
        <ul className="event-list">
          {events.data.map((e) => (
            <li className="event-item" key={e.id}>
              <div className="event-item__main">
                <Link className="event-item__title" to={`/organizer/events/${e.id}`}>
                  {e.title}
                </Link>
                <p className="event-item__time">
                  {formatEventTime(e.startsAt, e.timezone)}
                  {e.started && " · началось"}
                </p>
              </div>
              <p className="event-item__counts">
                Подтверждено {e.counts.confirmed} из {e.counts.limit}
                {e.counts.confirmed > e.counts.limit && (
                  <span className="warn-mark warn-mark--inline">{e.counts.confirmed - e.counts.limit} сверх лимита</span>
                )}
                {" · "}Лист ожидания {e.counts.waitlisted} · Пришло {e.counts.checkedIn} из {e.counts.confirmed}
              </p>
              <Icon name="chevronRight" className="event-item__chevron s6-chevron" />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
