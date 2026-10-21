import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, client } from "../../api.ts";
import { ErrorBanner } from "../../components/Banner.tsx";
import { PageSkeleton } from "../../components/Skeleton.tsx";
import { StatusBadge, type RegistrationStatus } from "../../components/StatusBadge.tsx";
import { errorText } from "../../errors.ts";
import { formatClock, formatDate } from "../../format.ts";

const filters = [
  ["all", "Все"],
  ["confirmed", "Подтверждены"],
  ["waitlisted", "Лист ожидания"],
  ["cancelled", "Отменены"],
] as const;

type Filter = (typeof filters)[number][0];

export const registrationsKey = (eventId: string) => ["organizer", "event", eventId, "registrations"] as const;

/**
 * Список участников S8: все регистрации, включая отменённые, в порядке сервера (D-051); фильтр по статусу — на клиенте.
 * Время прихода — на часах пояса события.
 */
export function ParticipantList({ eventId, timezone, minAge }: { eventId: string; timezone: string; minAge: number | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const list = useQuery({
    queryKey: registrationsKey(eventId),
    queryFn: async () =>
      (await api(client.api.organizer.events[":id"].registrations.$get({ param: { id: eventId } }))).registrations,
  });

  if (list.isPending) return <PageSkeleton label="Загрузка участников" />;
  if (list.isError) return <ErrorBanner title="Не удалось загрузить участников">{errorText(list.error)}</ErrorBanner>;

  const shown = filter === "all" ? list.data : list.data.filter((r) => r.status === filter);

  return (
    <>
      <div className="toolbar">
        <div className="segmented s8-filter" role="group" aria-label="Фильтр по статусу">
          {filters.map(([value, label]) => (
            <button
              key={value}
              className="segmented__button"
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__text">Никого с этим статусом</p>
        </div>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Таблица участников, прокручивается по горизонтали">
          <table className="table table--wide">
            <thead>
              <tr>
                <th scope="col">Имя</th>
                <th scope="col">Фамилия</th>
                <th scope="col">Дата рождения</th>
                <th scope="col">Возраст на день события</th>
                <th scope="col">Email</th>
                <th scope="col">Статус</th>
                <th scope="col">Время прихода</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={r.status === "cancelled" ? "table__row--cancelled" : undefined}>
                  <td>{r.firstName}</td>
                  <td>{r.lastName}</td>
                  <td className="table__cell--nowrap">{formatDate(r.birthDate)}</td>
                  <td className="table__cell--nowrap">
                    {r.ageOnEventDay}
                    {r.belowMinAge && <span className="warn-mark warn-mark--inline">младше {minAge}</span>}
                  </td>
                  <td>{r.email}</td>
                  <td className="table__cell--nowrap">
                    <StatusBadge
                      status={r.status as RegistrationStatus}
                      position={r.waitlistPosition ?? undefined}
                    />
                  </td>
                  <td className="table__cell--nowrap">{r.checkedInAt ? formatClock(r.checkedInAt, timezone) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
