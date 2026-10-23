import { useCallback, useState } from "react";
import { Link } from "react-router";
import { ErrorBanner } from "../components/Banner.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { Toast } from "../components/Toast.tsx";
import { errorText } from "../errors.ts";
import { useParticipant, useParticipantRegistrations } from "../participant.ts";
import { ParticipantLogin } from "./me/ParticipantLogin.tsx";
import { ProfileBlock } from "./me/ProfileBlock.tsx";
import { ProfileEditor, type SavedProfile } from "./me/ProfileEditor.tsx";
import { isCurrent, RegistrationRow } from "./me/RegistrationRow.tsx";

type Tab = "current" | "past";

/**
 * `/me` — «Мои регистрации» (дизайн §8.3, D-057). Без сессии участника — форма входа по коду на этой же странице.
 * С сессией без профиля — первая форма «Расскажите о себе» (D-065); с профилем — блок профиля и две вкладки: текущие по возрастанию начала, прошедшие и отменённые по убыванию.
 */
export function MyRegistrationsPage() {
  const participant = useParticipant();
  if (participant.isPending) {
    return <PageSkeleton label="Загрузка" />;
  }
  if (participant.isError) {
    return (
      <div className="page page--narrow">
        <ErrorBanner title="Не удалось проверить вход">{errorText(participant.error)}</ErrorBanner>
      </div>
    );
  }
  return participant.data ? <Registrations participant={participant.data} /> : <ParticipantLogin />;
}

type Participant = NonNullable<ReturnType<typeof useParticipant>["data"]>;

function Registrations({ participant }: { participant: Participant }) {
  const registrations = useParticipantRegistrations(true);
  const hasProfile = participant.profile !== null;
  const [tab, setTab] = useState<Tab>("current");
  const [toast, setToast] = useState<string | null>(null);
  const hideToast = useCallback(() => setToast(null), []);
  // Правка профиля отменила регистрации с неподходящим возрастом (D-065): сообщаем, какие именно.
  const onSaved = ({ cancelled }: SavedProfile) => {
    if (cancelled.length > 0) setToast(`Отменены регистрации: ${cancelled.map((c) => c.title).join(", ")}`);
  };

  const all = registrations.data ?? [];
  // С сервера — по возрастанию начала; прошедшие переворачиваем.
  const current = all.filter(isCurrent);
  const past = all.filter((r) => !isCurrent(r)).reverse();
  const shown = tab === "current" ? current : past;

  return (
    <>
      <div className="page page--narrow">
        <h1 className="heading heading--page">Мои регистрации</h1>
        {participant.profile ? (
          <ProfileBlock profile={participant.profile} onSaved={onSaved} />
        ) : (
          <section className="panel profile" aria-label="Профиль">
            <h2 className="heading heading--section">Расскажите о себе</h2>
            <p className="text-muted">
              Эти данные подставятся в регистрацию — на событие можно будет записаться одной кнопкой.
            </p>
            <ProfileEditor initial={participant.lastData ?? undefined} submitLabel="Сохранить" onSaved={onSaved} />
          </section>
        )}
        {hasProfile && registrations.isPending && <PageSkeleton label="Загрузка регистраций" />}
        {hasProfile && registrations.isError && (
          <ErrorBanner title="Не удалось загрузить регистрации">{errorText(registrations.error)}</ErrorBanner>
        )}
        {hasProfile && registrations.data && all.length === 0 && (
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
        {hasProfile && registrations.data && all.length > 0 && (
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
      {toast && <Toast message={toast} onDone={hideToast} />}
    </>
  );
}
