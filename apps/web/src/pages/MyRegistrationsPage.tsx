import { useState } from "react";
import { Link } from "react-router";
import { ErrorBanner } from "../components/Banner.tsx";
import { Icon } from "../components/Icon.tsx";
import { PublicHeader } from "../components/PublicHeader.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { errorText } from "../errors.ts";
import { useParticipant, useParticipantRegistrations } from "../participant.ts";
import { ParticipantLogin } from "./me/ParticipantLogin.tsx";
import { isCurrent, RegistrationRow } from "./me/RegistrationRow.tsx";

type Tab = "current" | "past";

/**
 * `/me` — «Мои регистрации» (дизайн §8.3, D-057). Без сессии участника — форма входа по коду на этой же странице.
 * С сессией — две вкладки: текущие по возрастанию начала, прошедшие и отменённые по убыванию.
 */
export function MyRegistrationsPage() {
  const participant = useParticipant();
  if (participant.isPending) {
    return (
      <>
        <PublicHeader />
        <PageSkeleton label="Загрузка" />
      </>
    );
  }
  if (participant.isError) {
    return (
      <>
        <PublicHeader />
        <div className="page page--narrow">
          <ErrorBanner title="Не удалось проверить вход">{errorText(participant.error)}</ErrorBanner>
        </div>
      </>
    );
  }
  return participant.data ? <Registrations /> : <ParticipantLogin />;
}

function Registrations() {
  const registrations = useParticipantRegistrations(true);
  const [tab, setTab] = useState<Tab>("current");

  const all = registrations.data ?? [];
  // С сервера — по возрастанию начала; прошедшие переворачиваем.
  const current = all.filter(isCurrent);
  const past = all.filter((r) => !isCurrent(r)).reverse();
  const shown = tab === "current" ? current : past;

  return (
    <>
      <PublicHeader />
      <div className="page page--narrow">
        <h1 className="heading heading--page">Мои регистрации</h1>
        {registrations.isPending && <PageSkeleton label="Загрузка регистраций" />}
        {registrations.isError && (
          <ErrorBanner title="Не удалось загрузить регистрации">{errorText(registrations.error)}</ErrorBanner>
        )}
        {registrations.data && all.length === 0 && (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Icon name="calendar" />
            </span>
            <p className="empty-state__title">Вы пока никуда не зарегистрированы</p>
            <Link className="button button--primary" to="/">
              Посмотреть события
            </Link>
          </div>
        )}
        {registrations.data && all.length > 0 && (
          <>
            <div className="tabs" role="tablist" aria-label="Регистрации">
              <button
                className="tabs__link"
                type="button"
                role="tab"
                aria-selected={tab === "current"}
                onClick={() => setTab("current")}
              >
                Текущие · {current.length}
              </button>
              <button
                className="tabs__link"
                type="button"
                role="tab"
                aria-selected={tab === "past"}
                onClick={() => setTab("past")}
              >
                Прошедшие · {past.length}
              </button>
            </div>
            {shown.length === 0 ? (
              <p className="text-muted">{tab === "current" ? "Текущих регистраций нет" : "Прошедших регистраций нет"}</p>
            ) : (
              <ul className="event-list" role="tabpanel">
                {shown.map((r) => (
                  <RegistrationRow key={r.token} registration={r} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}
