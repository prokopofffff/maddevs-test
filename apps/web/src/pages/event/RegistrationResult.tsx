import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, client } from "../../api.ts";
import { ErrorBanner } from "../../components/Banner.tsx";
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

type Result = "confirmed" | "waitlisted" | "existing";

const icons = {
  confirmed: ["result__icon--success", "check"],
  waitlisted: ["result__icon--waitlist", "clock"],
  existing: ["result__icon--info", "info"],
} as const;

/**
 * S3-Result после верного кода: «Место ваше» (s3a), «Вы №N в листе ожидания» (s3b)
 * или «Вы уже зарегистрированы» (s3c).
 */
export function RegistrationResult({ result, token }: { result: Result; token: string }) {
  const registration = useRegistration(token);

  if (registration.isPending) return <PageSkeleton label="Загрузка регистрации" />;
  if (registration.isError) {
    return (
      <div className="page page--narrow">
        <ErrorBanner title="Не удалось загрузить регистрацию">{errorText(registration.error)}</ErrorBanner>
        <Link className="button button--secondary button--block" to={`/r/${token}`}>
          Моя регистрация
        </Link>
      </div>
    );
  }
  const { event, status, ticketCode, waitlistPosition } = registration.data;
  const [iconModifier, icon] = icons[result];
  const heading = {
    confirmed: "Место ваше",
    waitlisted: `Вы №${waitlistPosition} в листе ожидания`,
    existing: "Вы уже зарегистрированы",
  }[result];

  return (
    <div className="page page--split">
      <div className="page__main">
        <div className="result">
          <span className={`result__icon ${iconModifier}`}>
            <Icon name={icon} />
          </span>
          <h1 className="heading heading--page">{heading}</h1>
          {result === "waitlisted" && <p className="text-muted">Напишем, как только освободится место</p>}
          {result !== "confirmed" && <StatusBadge status={status} position={waitlistPosition} />}
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
          {result === "confirmed" && (
            <p className="result__note">
              <Icon name="info" />
              Билет и ссылка на регистрацию отправлены на почту
            </p>
          )}
          {result === "waitlisted" && (
            <p className="result__note">
              <Icon name="mail" />
              Ссылка на регистрацию отправлена на почту
            </p>
          )}
          <Link className="button button--secondary button--block" to={`/r/${token}`}>
            {result === "existing" ? "Открыть мою регистрацию" : "Моя регистрация"}
          </Link>
        </div>
      </div>
    </div>
  );
}
