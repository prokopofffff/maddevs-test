import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { Toast } from "../components/Toast.tsx";
import { errorText } from "../errors.ts";
import { formatEventTime } from "../format.ts";
import { EventStats } from "./admin/EventStats.tsx";
import { ParticipantList } from "./admin/ParticipantList.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

/**
 * S8-EventAdmin: плашки, ссылка для участников, список участников с фильтром, «Редактировать», «Открыть чекин».
 * Данные — при загрузке; live и «Снять отметку» приходят своими тикетами.
 */
export function EventAdminPage() {
  const { id = "" } = useParams();
  const [toast, setToast] = useState<string | null>(null);
  const hideToast = useCallback(() => setToast(null), []);
  const event = useQuery({
    queryKey: ["organizer", "event", id],
    queryFn: () => api(client.api.organizer.events[":id"].$get({ param: { id } })),
  });

  if (event.isPending) return <PageSkeleton label="Загрузка события" />;
  if (event.error instanceof ApiError && event.error.status === 404) return <NotFoundPage embedded />;
  if (event.isError) return <ErrorBanner title="Не удалось загрузить событие">{errorText(event.error)}</ErrorBanner>;

  const { event: e, counts, publicUrl, registrationCount } = event.data;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setToast("Ссылка скопирована");
    } catch {
      setToast("Не удалось скопировать — выделите ссылку и скопируйте вручную");
    }
  };

  return (
    <>
      {toast && <Toast message={toast} onDone={hideToast} />}
      <Link className="back-link s8-back" to="/organizer">
        <Icon name="back" />
        Мои события
      </Link>
      <div className="page-header">
        <div className="page-header__group">
          {e.minAge && (
            <div className="event-header__badges">
              <span className="badge badge--age">{e.minAge}+</span>
            </div>
          )}
          <h1 className="heading page-header__title">{e.title}</h1>
          <p className="page-header__meta">
            <Icon name="calendar" />
            {formatEventTime(e.startsAt, e.timezone)}
            {e.started && " · событие началось"}
          </p>
        </div>
        <div className="page-header__actions">
          <Link className="button button--secondary" to={`/organizer/events/${e.id}/edit`}>
            Редактировать
          </Link>
          <Link className="button button--primary" to={`/organizer/events/${e.id}/checkin`}>
            Открыть чекин
          </Link>
        </div>
      </div>
      <section className="stack" aria-labelledby="stats-heading">
        <div className="section-header">
          <h2 className="heading heading--section" id="stats-heading">
            Регистрации
          </h2>
        </div>
        <EventStats counts={counts} />
      </section>
      <div className="copy-link">
        <div className="field copy-link__field s8-copy">
          <label className="field__label" htmlFor="public-link">
            Ссылка для участников
          </label>
          <input
            className="field__control field__control--mono s8-link"
            id="public-link"
            type="text"
            readOnly
            value={publicUrl}
            onFocus={(ev) => ev.currentTarget.select()}
          />
        </div>
        <button className="button button--secondary" type="button" onClick={copy}>
          <Icon name="copy" />
          Скопировать
        </button>
      </div>
      <section className="stack" aria-labelledby="people-heading">
        <div className="section-header">
          <h2 className="heading heading--section" id="people-heading">
            Участники
          </h2>
        </div>
        {registrationCount === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Icon name="calendar" />
            </span>
            <p className="empty-state__title">Пока никого</p>
            <p className="empty-state__text">Отправьте ссылку на событие — зарегистрировавшиеся появятся здесь сразу.</p>
            <button className="button button--secondary" type="button" onClick={copy}>
              Скопировать ссылку
            </button>
          </div>
        ) : (
          <ParticipantList eventId={e.id} timezone={e.timezone} minAge={e.minAge} />
        )}
      </section>
    </>
  );
}
