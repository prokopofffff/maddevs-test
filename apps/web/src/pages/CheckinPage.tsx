import { formatTicketCode, normalizeTicketCode, TICKET_CODE } from "@app/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { errorText } from "../errors.ts";
import { formatClock, formatDate, plural } from "../format.ts";
import { NotFoundPage } from "./NotFoundPage.tsx";

interface Card {
  code: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  ageOnEventDay: number;
  belowMinAge: boolean;
}

type Result =
  | { kind: "card"; card: Card }
  | { kind: "marked"; name: string }
  | { kind: "rejected"; title: string };

const percent = (part: number, whole: number) => `${whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0}%`;

/**
 * S9-Checkin: код → Enter → карточка участника → «Пропустить» (Enter) → «Отмечен» → фокус снова в поле (D-023).
 * Красные исходы — «Уже прошёл в ЧЧ:ММ», «Билет отменён», «Билет не найден». Строка «Пришло N из M»
 * перечитывается после каждой отметки; live-обновление от соседнего входа — тикет «R5, часть 2».
 */
export function CheckinPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const pass = useRef<HTMLButtonElement>(null);
  // Каждая новая карточка — фокус на «Пропустить»: второй Enter отмечает (D-023). `autoFocus` не годится:
  // карточка, сменившая карточку, — тот же элемент, и фокус остался бы в поле.
  useEffect(() => {
    if (result?.kind === "card") pass.current?.focus();
  }, [result]);
  const eventKey = ["organizer", "event", id];
  const event = useQuery({
    queryKey: eventKey,
    queryFn: () => api(client.api.organizer.events[":id"].$get({ param: { id } })),
  });
  const timezone = event.data?.event.timezone ?? "UTC";

  /** Красный исход: поле снова в фокусе, набранное выделено — следующий код его заменит. */
  const reject = (title: string) => {
    setResult({ kind: "rejected", title });
    input.current?.focus();
    input.current?.select();
  };
  const alreadyPassed = (checkedInAt: string, firstName: unknown, lastName: unknown) =>
    reject(`Уже прошёл в ${formatClock(checkedInAt, timezone)} — ${firstName} ${lastName}`);

  const lookup = useMutation({
    mutationFn: (code: string) =>
      api(client.api.organizer.events[":id"].tickets[":code"].$get({ param: { id, code } })).then((t) => ({ code, t })),
    onSuccess: ({ code, t }) => {
      if (t.status === "cancelled") return reject("Билет отменён");
      if (t.checkedInAt) return alreadyPassed(t.checkedInAt, t.firstName, t.lastName);
      setResult({ kind: "card", card: { code, ...t } });
    },
    onError: (error) => reject(error instanceof ApiError && error.status === 404 ? "Билет не найден" : errorText(error)),
  });

  const mark = useMutation({
    mutationFn: (code: string) => api(client.api.organizer.events[":id"].checkin.$post({ param: { id }, json: { code } })),
    onSuccess: (marked) => {
      setResult({ kind: "marked", name: `${marked.firstName} ${marked.lastName}` });
      setValue("");
      input.current?.focus();
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return reject(errorText(error));
      const { checkedInAt, firstName, lastName } = error.details;
      if (error.code === "already_checked_in") return alreadyPassed(String(checkedInAt), firstName, lastName);
      if (error.code === "ticket_cancelled") return reject("Билет отменён");
      reject(error.code === "ticket_not_found" ? "Билет не найден" : errorText(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: eventKey }),
  });

  if (event.isPending) return <PageSkeleton label="Загрузка чекина" />;
  if (event.error instanceof ApiError && event.error.status === 404) return <NotFoundPage />;
  if (event.isError) return <ErrorBanner title="Не удалось загрузить событие">{errorText(event.error)}</ErrorBanner>;

  const { event: e, counts } = event.data;
  const busy = lookup.isPending || mark.isPending;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || value.trim() === "") return;
    const code = normalizeTicketCode(value);
    // Заведомо не код билета — без запроса.
    if (!TICKET_CODE.test(code)) return reject("Билет не найден");
    lookup.mutate(code);
  };

  return (
    <main className="checkin">
      <header className="checkin__header">
        <div className="checkin__top">
          <Link className="back-link s9-back" to={`/organizer/events/${e.id}`}>
            <Icon name="back" />К событию
          </Link>
        </div>
        <p className="checkin__event">{e.title}</p>
        <p className="checkin__counter">
          Пришло {counts.checkedIn} из {counts.confirmed}
        </p>
        <div
          className="stat__bar"
          role="progressbar"
          aria-label="Пришло участников"
          aria-valuemin={0}
          aria-valuemax={counts.confirmed}
          aria-valuenow={counts.checkedIn}
        >
          <span className="stat__bar-fill" style={{ width: percent(counts.checkedIn, counts.confirmed) }} />
        </div>
      </header>
      <form className="checkin__form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="ticket-code">
          Код билета
        </label>
        <input
          ref={input}
          className="field__control code-input code-input--ticket"
          id="ticket-code"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX"
          autoFocus
          value={value}
          onChange={(ev) => setValue(ev.target.value)}
        />
        <p className="checkin__hint">Введите код и нажмите Enter</p>
      </form>
      {result?.kind === "rejected" ? (
        <div className="checkin__result" role="alert">
          <div className="checkin-status checkin-status--error">
            <Icon name="error" />
            <p className="checkin-status__title">{result.title}</p>
          </div>
        </div>
      ) : (
        <div className="checkin__result" role="status" aria-live="polite">
          {result?.kind === "marked" && (
            <div className="checkin-status checkin-status--success">
              <Icon name="check" />
              <p className="checkin-status__title">Отмечен — {result.name}</p>
            </div>
          )}
          {result?.kind === "card" && (
            <section
              className="checkin-card"
              aria-label={result.card.belowMinAge ? "Участник найден, не проходит по возрасту" : "Участник найден"}
            >
              <div className="checkin-card__head">
                <StatusBadge status="confirmed" />
                <h2 className="checkin-card__name">
                  {result.card.firstName} {result.card.lastName}
                </h2>
              </div>
              {result.card.belowMinAge && e.minAge && (
                <div className="banner banner--warning s9-alert">
                  <Icon name="warning" />
                  <div className="banner__body">
                    <p className="banner__title">
                      Младше {e.minAge} {plural(e.minAge, ["года", "лет", "лет"])} на день события
                    </p>
                  </div>
                </div>
              )}
              <dl className="details">
                <div className="details__row">
                  <dt className="details__term">Дата рождения</dt>
                  <dd className="details__value">
                    {formatDate(result.card.birthDate)} · {result.card.ageOnEventDay}{" "}
                    {plural(result.card.ageOnEventDay, ["год", "года", "лет"])}
                  </dd>
                </div>
              </dl>
              <div className="stack" style={{ gap: "var(--space-2)" }}>
                <p className="text-small text-muted">Код билета</p>
                <p className="ticket-code ticket-code--lg ticket-code--mark">{formatTicketCode(result.card.code)}</p>
              </div>
              <button
                ref={pass}
                className="button button--primary button--lg button--block"
                type="button"
                disabled={mark.isPending}
                onClick={() => mark.mutate(result.card.code)}
              >
                Пропустить
              </button>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
