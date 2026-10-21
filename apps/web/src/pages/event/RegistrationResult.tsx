import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, client } from "../../api.ts";
import { ErrorBanner } from "../../components/Banner.tsx";
import { Brand } from "../../components/Brand.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageSkeleton } from "../../components/Skeleton.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { Ticket } from "../../components/Ticket.tsx";
import { errorText } from "../../errors.ts";
import { formatEventTime } from "../../format.ts";

export const registrationKey = (token: string) => ["registration", token];

export const useRegistration = (token: string) =>
  useQuery({
    queryKey: registrationKey(token),
    queryFn: () => api(client.api.registrations[":token"].$get({ param: { token } })),
  });

/** S3-Result: «Место ваше» (s3a) или «Вы уже зарегистрированы» (s3c) после верного кода. */
export function RegistrationResult({ result, token }: { result: "confirmed" | "existing"; token: string }) {
  const registration = useRegistration(token);

  if (registration.isPending) return <PageSkeleton label="Загрузка регистрации" />;
  if (registration.isError) {
    return (
      <div className="page page--narrow">
        <Brand />
        <ErrorBanner title="Не удалось загрузить регистрацию">{errorText(registration.error)}</ErrorBanner>
        <Link className="button button--secondary button--block" to={`/r/${token}`}>
          Моя регистрация
        </Link>
      </div>
    );
  }
  const { event, status, ticketCode } = registration.data;
  const confirmed = result === "confirmed";

  return (
    <div className="page page--split">
      <Brand />
      <div className="page__main">
        <div className="result">
          <span className={`result__icon ${confirmed ? "result__icon--success" : "result__icon--info"}`}>
            <Icon name={confirmed ? "check" : "info"} />
          </span>
          <h1 className="heading heading--page">{confirmed ? "Место ваше" : "Вы уже зарегистрированы"}</h1>
          {!confirmed && <StatusBadge status={status} />}
          <div className="event-header">
            <p className="card__title">{event.title}</p>
            <p className="event-header__time">
              <Icon name="calendar" />
              {formatEventTime(event.startsAt, event.timezone)}
            </p>
          </div>
        </div>
      </div>
      <div className="page__side">
        <div className="panel">
          {ticketCode && <Ticket code={ticketCode} large />}
          {confirmed && (
            <p className="result__note">
              <Icon name="info" />
              Билет и ссылка на регистрацию отправлены на почту
            </p>
          )}
          <Link className="button button--secondary button--block" to={`/r/${token}`}>
            {confirmed ? "Моя регистрация" : "Открыть мою регистрацию"}
          </Link>
        </div>
      </div>
    </div>
  );
}
