import { Link, useParams } from "react-router";
import { AgeBadge } from "../../components/AgeBadge.tsx";
import { ErrorBanner } from "../../components/Banner.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageSkeleton } from "../../components/Skeleton.tsx";
import { errorText } from "../../errors.ts";
import { formatEventTime } from "../../format.ts";
import { EventStats } from "../admin/EventStats.tsx";
import { ParticipantList } from "../admin/ParticipantList.tsx";
import { NotFoundPage } from "../NotFoundPage.tsx";
import { useSupportEvents } from "./SupportEventsPage.tsx";

/**
 * Событие глазами поддержки: плашки и список участников S8 только на чтение — без ссылки, правки,
 * чекина и «Снять отметку» (D-030). Отдельного маршрута события нет: шапка берётся из списка событий.
 */
export function SupportEventPage() {
  const { id = "" } = useParams();
  const events = useSupportEvents();

  if (events.isPending) return <PageSkeleton label="Загрузка события" />;
  if (events.isError) return <ErrorBanner title="Не удалось загрузить событие">{errorText(events.error)}</ErrorBanner>;
  const e = events.data.find((x) => x.id === id);
  if (!e) return <NotFoundPage embedded />;

  return (
    <>
      <Link className="back-link" to="/support/events">
        <Icon name="back" />
        События
      </Link>
      <div className="page-header">
        <div className="page-header__group">
          <div className="event-header__badges">
            <AgeBadge minAge={e.minAge} />
          </div>
          <h1 className="heading page-header__title">{e.title}</h1>
          <p className="page-header__meta">
            <Icon name="calendar" />
            {formatEventTime(e.startsAt, e.timezone)} · {e.organizerEmail}
          </p>
        </div>
      </div>
      <EventStats counts={e.counts} />
      <section className="stack" aria-labelledby="people-heading">
        <div className="section-header">
          <h2 className="heading heading--section" id="people-heading">
            Участники
          </h2>
        </div>
        <ParticipantList
          readOnly
          eventId={e.id}
          timezone={e.timezone}
          minAge={e.minAge}
          empty={
            <div className="empty-state">
              <p className="empty-state__title">Пока никого</p>
            </div>
          }
        />
      </section>
    </>
  );
}
