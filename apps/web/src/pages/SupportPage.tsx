import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api, ApiError, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { Toast } from "../components/Toast.tsx";
import { errorText } from "../errors.ts";
import { formatDate, formatEventTime, formatWallTime, plural } from "../format.ts";
import { RejectDialog } from "./support/RejectDialog.tsx";
import { SupportNav } from "./support/SupportNav.tsx";

export const correctionsKey = ["support", "corrections"] as const;

type Person = { firstName: string; lastName: string; birthDate: string };

const fields = [
  ["firstName", "Имя", (p: Person) => p.firstName],
  ["lastName", "Фамилия", (p: Person) => p.lastName],
  ["birthDate", "Дата рождения", (p: Person) => formatDate(p.birthDate)],
] as const;

/** Время подачи — на часах браузера поддержки: заявки идут из разных поясов. */
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** «Было» или «стало» столбиком; в «стало» изменённое поле выделено. */
function PersonCell({ person, before }: { person: Person; before?: Person }) {
  return (
    <ul className="person-diff">
      {fields.map(([key, label, show]) => {
        const changed = before !== undefined && person[key] !== before[key];
        return (
          <li key={key}>
            <span className="visually-hidden">{label}: </span>
            {changed ? <mark className="person-diff__changed">{show(person)}</mark> : show(person)}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Очередь поддержки (D-031): ожидающие заявки от старых к новым, «было → стало», предупреждение о возрасте,
 * счётчик ожидающих. «Принять» — как есть, «Отклонить» — диалог с необязательной причиной.
 * Рамки нет — `c-table`, `c-badges`, `c-buttons`, `c-dialog`. Уведомлений о новых заявках нет:
 * очередь перечитывается раз в 30 с и при возврате на вкладку.
 */
export function SupportPage() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const hideToast = useCallback(() => setToast(null), []);
  const [rejecting, setRejecting] = useState<{ id: number; who: string } | null>(null);
  const queue = useQuery({
    queryKey: correctionsKey,
    queryFn: async () => (await api(client.api.support.corrections.$get())).corrections,
    refetchInterval: 30_000,
  });
  const decide = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }): Promise<{ status: "accepted" | "rejected" }> =>
      reason === undefined
        ? api(client.api.support.corrections[":id"].accept.$post({ param: { id: String(id) } }))
        : api(client.api.support.corrections[":id"].reject.$post({ param: { id: String(id) }, json: { reason } })),
    onSuccess: ({ status }) => {
      setRejecting(null);
      setToast(status === "accepted" ? "Данные исправлены, участнику ушло письмо" : "Заявка отклонена, участнику ушло письмо");
    },
    // `409`: заявку уже решили или участник её заменил — диалог не нужен, очередь перечитается.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setRejecting(null);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: correctionsKey }),
  });

  return (
    <>
      {toast && <Toast message={toast} onDone={hideToast} />}
      <SupportNav />
      <div className="page-header">
        <div className="page-header__group">
          <h1 className="heading page-header__title">Заявки на исправление</h1>
          {queue.data && (
            <p className="page-header__meta">
              {queue.data.length === 0
                ? "Ожидающих нет"
                : `${queue.data.length} ${plural(queue.data.length, ["заявка ждёт", "заявки ждут", "заявок ждут"])} решения`}
            </p>
          )}
        </div>
      </div>
      {queue.isPending && <PageSkeleton label="Загрузка заявок" />}
      {queue.isError && <ErrorBanner title="Не удалось загрузить заявки">{errorText(queue.error)}</ErrorBanner>}
      {decide.isError && !rejecting && <ErrorBanner title="Решение не сохранено">{errorText(decide.error)}</ErrorBanner>}
      {queue.data?.length === 0 && (
        <div className="empty-state">
          <span className="empty-state__icon">
            <Icon name="check" />
          </span>
          <p className="empty-state__title">Заявок нет</p>
          <p className="empty-state__text">
            Участники подают заявки по личной ссылке из письма. Новые появятся здесь, старые — сверху.
          </p>
        </div>
      )}
      {queue.data && queue.data.length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Очередь заявок, прокручивается по горизонтали">
          <table className="table table--wide">
            <thead>
              <tr>
                <th scope="col">Подана</th>
                <th scope="col">Событие</th>
                <th scope="col">Email</th>
                <th scope="col">Было</th>
                <th scope="col">Стало</th>
                <th scope="col">
                  <span className="visually-hidden">Решение</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {queue.data.map((c) => {
                const busy = decide.isPending && decide.variables.id === c.id;
                const who = `${c.old.firstName} ${c.old.lastName}`;
                return (
                  <tr key={c.id}>
                    <td className="table__cell--nowrap">{formatWallTime(c.createdAt, browserZone)}</td>
                    <td>
                      <p className="support-event__title">{c.event.title}</p>
                      <p className="text-muted">{formatEventTime(c.event.startsAt, c.event.timezone)}</p>
                    </td>
                    <td>{c.email}</td>
                    <td>
                      <PersonCell person={c.old} />
                    </td>
                    <td>
                      <PersonCell person={c.new} before={c.old} />
                      {c.belowMinAgeAfter && (
                        <span className="warn-mark support-warning">
                          Будет младше {c.event.minAge} лет на день события
                        </span>
                      )}
                    </td>
                    <td className="table__cell--nowrap">
                      <div className="support-actions">
                        <button
                          className="button button--primary button--sm"
                          type="button"
                          aria-label={`Принять заявку: ${who}`}
                          disabled={busy}
                          onClick={() => decide.mutate({ id: c.id })}
                        >
                          Принять
                        </button>
                        <button
                          className="button button--secondary button--sm"
                          type="button"
                          aria-label={`Отклонить заявку: ${who}`}
                          disabled={busy}
                          onClick={() => {
                            decide.reset();
                            setRejecting({ id: c.id, who });
                          }}
                        >
                          Отклонить
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rejecting && (
        <RejectDialog
          who={rejecting.who}
          pending={decide.isPending}
          error={decide.isError ? errorText(decide.error) : undefined}
          onConfirm={(reason) => decide.mutate({ id: rejecting.id, reason })}
          onCancel={() => setRejecting(null)}
        />
      )}
    </>
  );
}
