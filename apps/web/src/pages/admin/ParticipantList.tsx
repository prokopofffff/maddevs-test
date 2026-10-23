import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
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
const supportRegistrationsKey = (eventId: string) => ["support", "event", eventId, "registrations"] as const;

/**
 * Список участников S8: все регистрации, включая отменённые, в порядке сервера (D-051); фильтр по статусу — на клиенте.
 * Время прихода — на часах пояса события. «Снять отметку» — у отмеченных (D-023): «Пришло» уменьшится
 * на всех открытых экранах через live, билет снова пройдёт чекин.
 * `readOnly` — тот же список для поддержки: маршрут `/support/…`, без «Снять отметку» (D-030).
 */
export function ParticipantList({
  eventId,
  timezone,
  minAge,
  empty,
  readOnly = false,
}: {
  eventId: string;
  timezone: string;
  minAge: number;
  /** Что показать, пока регистраций нет совсем. */
  empty: ReactNode;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const uncheck = useMutation({
    mutationFn: (registrationId: number) =>
      api(
        client.api.organizer.events[":id"].checkin[":registrationId"].$delete({
          param: { id: eventId, registrationId: String(registrationId) },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: registrationsKey(eventId) }),
  });
  const list = useQuery({
    queryKey: readOnly ? supportRegistrationsKey(eventId) : registrationsKey(eventId),
    queryFn: async () =>
      (
        await api(
          readOnly
            ? client.api.support.events[":id"].registrations.$get({ param: { id: eventId } })
            : client.api.organizer.events[":id"].registrations.$get({ param: { id: eventId } }),
        )
      ).registrations,
  });

  if (list.isPending) return <PageSkeleton label="Загрузка участников" />;
  if (list.isError) return <ErrorBanner title="Не удалось загрузить участников">{errorText(list.error)}</ErrorBanner>;
  if (list.data.length === 0) return empty;

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
      {uncheck.isError && <ErrorBanner title="Не удалось снять отметку">{errorText(uncheck.error)}</ErrorBanner>}
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
                  <td className="table__cell--nowrap">
                    {r.checkedInAt ? formatClock(r.checkedInAt, timezone) : "—"}
                    {/* Кнопка в ячейке времени, а не отдельной колонкой, как в S8: на 1280 px она уехала бы за край таблицы. */}
                    {r.checkedInAt && !readOnly && (
                      <button
                        className="button button--quiet button--sm uncheck-button"
                        type="button"
                        aria-label={`Снять отметку: ${r.firstName} ${r.lastName}`}
                        disabled={uncheck.isPending && uncheck.variables === r.id}
                        onClick={() => uncheck.mutate(r.id)}
                      >
                        Снять отметку
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
