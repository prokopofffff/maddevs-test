import { useParams } from "react-router";
import { ApiError } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Brand } from "../components/Brand.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { Ticket } from "../components/Ticket.tsx";
import { errorText } from "../errors.ts";
import { formatDate, formatEventTime } from "../format.ts";
import { useRegistration } from "./event/RegistrationResult.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

/**
 * S4-MyReg (s4a): регистрация по личной ссылке — билет и данные участника.
 * Отказ, лист ожидания и заявка на исправление приходят своими тикетами.
 */
export function MyRegistrationPage() {
  const { token = "" } = useParams();
  const registration = useRegistration(token);

  if (registration.isPending) return <PageSkeleton label="Загрузка регистрации" />;
  if (registration.error instanceof ApiError && registration.error.status === 404) return <NotFoundPage />;

  return (
    <div className="page page--split">
      <Brand />
      {registration.isError ? (
        <ErrorBanner title="Не удалось загрузить регистрацию">{errorText(registration.error)}</ErrorBanner>
      ) : (
        <>
          <div className="page__main">
            <header className="event-header">
              <p className="eyebrow">Моя регистрация</p>
              <h1 className="heading heading--page">{registration.data.event.title}</h1>
              <p className="event-header__time">
                <Icon name="calendar" />
                {formatEventTime(registration.data.event.startsAt, registration.data.event.timezone)}
              </p>
            </header>
            <div className="stack">
              <StatusBadge status={registration.data.status} />
              {registration.data.event.started && (
                <div className="banner" role="status">
                  <Icon name="info" />
                  <div className="banner__body">
                    <p className="banner__title">Событие началось</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="page__side">
            <div className="panel">
              {registration.data.ticketCode && <Ticket code={registration.data.ticketCode} />}
              <dl className="details">
                <div className="details__row">
                  <dt className="details__term">Участник</dt>
                  <dd className="details__value">
                    {registration.data.firstName} {registration.data.lastName}
                  </dd>
                </div>
                <div className="details__row">
                  <dt className="details__term">Дата рождения</dt>
                  <dd className="details__value">{formatDate(registration.data.birthDate)}</dd>
                </div>
                <div className="details__row">
                  <dt className="details__term">Email</dt>
                  <dd className="details__value">{registration.data.email}</dd>
                </div>
              </dl>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
