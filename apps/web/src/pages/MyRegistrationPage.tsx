import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { ParticipantData } from "@app/api/schemas";
import { api, ApiError, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { PublicHeader } from "../components/PublicHeader.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { Ticket } from "../components/Ticket.tsx";
import { errorText } from "../errors.ts";
import { formatClock, formatDate, formatEventTime } from "../format.ts";
import { registrationKey, useRegistration } from "./event/RegistrationResult.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { CorrectionForm } from "./registration/CorrectionForm.tsx";

const dialogText = {
  confirmed:
    "Ваше место достанется следующему в листе ожидания. Вернуть его можно только новой регистрацией, если места останутся.",
  waitlisted: "Вы выйдете из листа ожидания. Вернуться можно только новой регистрацией — в конец листа.",
};

/**
 * S4-MyReg: регистрация по личной ссылке — билет (s4a), номер в листе ожидания (s4b), отказ (s4c)
 * или «Пришёл» (s4d) и данные участника. Открытие ссылки ничего не меняет: отказ — только кнопкой и диалогом (s4e).
 * Форма «Исправить данные» создаёт заявку для поддержки; пока она ждёт — плашка «Заявка на рассмотрении» (D-031).
 */
export function MyRegistrationPage() {
  const { token = "" } = useParams();
  const registration = useRegistration(token);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({
    mutationFn: () => api(client.api.registrations[":token"].cancel.$post({ param: { token } })),
    onSuccess: () => setConfirming(false),
    // `409`: событие началось или чекин уже был — повтор не поможет, причину покажет перечитанная страница.
    // Остальные ошибки остаются в диалоге, отказ можно повторить.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setConfirming(false);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: registrationKey(token) }),
  });
  const [correcting, setCorrecting] = useState(false);
  const correct = useMutation({
    mutationFn: (json: ParticipantData) =>
      api(client.api.registrations[":token"].corrections.$post({ param: { token }, json })),
    onSuccess: () => setCorrecting(false),
    // `409`: событие началось или регистрация отменена в другой вкладке — форма больше не нужна, причину покажет страница.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setCorrecting(false);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: registrationKey(token) }),
  });

  if (registration.isPending) return <PageSkeleton label="Загрузка регистрации" />;
  // Время чекина — на часах пояса события (D-015).
  const arrivedAt =
    registration.data?.checkedInAt && formatClock(registration.data.checkedInAt, registration.data.event.timezone);
  if (registration.error instanceof ApiError && registration.error.status === 404) return <NotFoundPage />;

  return (
    <>
      <PublicHeader />
      <div className="page page--split">
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
                {arrivedAt ? (
                  <span className="badge badge--arrived">
                    <Icon name="check" />
                    Пришёл {arrivedAt}
                  </span>
                ) : (
                  <StatusBadge status={registration.data.status} position={registration.data.waitlistPosition} />
                )}
                {registration.data.status === "cancelled" && (
                  <>
                    <p className="heading heading--section">Регистрация отменена</p>
                    {!registration.data.event.started && (
                      <p className="text-muted text-small">
                        Если планы изменятся, зарегистрируйтесь заново на странице события.
                      </p>
                    )}
                  </>
                )}
                {registration.data.status === "waitlisted" && !registration.data.event.started && (
                  <p className="seats seats--waitlist">
                    <Icon name="clock" />
                    Вы №{registration.data.waitlistPosition} в листе ожидания — напишем, как только освободится место
                  </p>
                )}
                {arrivedAt && (
                  // После чекина отказ закрыт (D-022); билет больше не нужен — рамка s4d его не показывает.
                  <div className="banner" role="status">
                    <Icon name="info" />
                    <div className="banner__body">
                      <p className="banner__title">Вы уже прошли на событие в {arrivedAt}</p>
                      <p>Отказаться от участия уже нельзя</p>
                    </div>
                  </div>
                )}
                {registration.data.event.started && !arrivedAt && (
                  <div className="banner" role="status">
                    <Icon name="info" />
                    <div className="banner__body">
                      <p className="banner__title">
                        {registration.data.status === "waitlisted"
                          ? "Событие началось, место не освободилось"
                          : "Событие началось"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="page__side">
              <div className="panel">
                {registration.data.ticketCode && !arrivedAt && <Ticket code={registration.data.ticketCode} />}
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
                {registration.data.pendingCorrection && !correcting && (
                  <div className="banner" role="status">
                    <Icon name="clock" />
                    <div className="banner__body">
                      <p className="banner__title">Заявка на рассмотрении</p>
                      <p>
                        Предложено: {registration.data.pendingCorrection.firstName}{" "}
                        {registration.data.pendingCorrection.lastName},{" "}
                        {formatDate(registration.data.pendingCorrection.birthDate)}
                      </p>
                      <p>Поддержка пришлёт письмо с решением</p>
                    </div>
                  </div>
                )}
                {correct.isError && !correcting && <ErrorBanner>{errorText(correct.error)}</ErrorBanner>}
                {/* Подача — только у неотменённой и до начала (D-031, D-033). */}
                {registration.data.status !== "cancelled" &&
                  !registration.data.event.started &&
                  (correcting ? (
                    <CorrectionForm
                      initial={
                        registration.data.pendingCorrection ?? {
                          firstName: registration.data.firstName,
                          lastName: registration.data.lastName,
                          birthDate: registration.data.birthDate,
                        }
                      }
                      pending={correct.isPending}
                      error={correct.error}
                      onSubmit={(data) => correct.mutate(data)}
                      onCancel={() => setCorrecting(false)}
                    />
                  ) : (
                    <button
                      className="button button--secondary button--block"
                      type="button"
                      onClick={() => {
                        correct.reset();
                        setCorrecting(true);
                      }}
                    >
                      {registration.data.pendingCorrection ? "Изменить заявку" : "Исправить данные"}
                    </button>
                  ))}
                {registration.data.status === "cancelled" ? (
                  <Link className="button button--secondary button--block" to={`/e/${registration.data.event.id}`}>
                    Страница события
                  </Link>
                ) : (
                  // После начала и после чекина отказ закрыт — кнопки нет (D-033, D-034).
                  !registration.data.event.started &&
                  !registration.data.checkedInAt && (
                    <button
                      className="button button--danger-outline button--block"
                      type="button"
                      onClick={() => {
                        cancel.reset();
                        setConfirming(true);
                      }}
                    >
                      Отказаться от участия
                    </button>
                  )
                )}
              </div>
            </div>
            {confirming && registration.data.status !== "cancelled" && (
              <ConfirmDialog
                title="Отказаться от участия?"
                text={dialogText[registration.data.status]}
                confirmLabel="Отказаться от участия"
                cancelLabel="Оставить регистрацию"
                pending={cancel.isPending}
                error={cancel.isError ? errorText(cancel.error) : undefined}
                onConfirm={() => cancel.mutate()}
                onCancel={() => setConfirming(false)}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
