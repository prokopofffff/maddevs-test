import { zodResolver } from "@hookform/resolvers/zod";
import { eventInputSchema, type EventPatch } from "@app/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { api, ApiError, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { Toast } from "../components/Toast.tsx";
import { errorText } from "../errors.ts";
import { formatEventTime, formatWallTime, plural, utcOffset } from "../format.ts";
import { myEventsKey } from "./MyEventsPage.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

// В форме дата и время — два поля (S7-EventForm); в API уходит одно `startsLocal` (D-015).
const formSchema = eventInputSchema.omit({ startsLocal: true }).extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
});
type FormValues = z.infer<typeof formSchema>;

type OrganizerEvent = Awaited<ReturnType<typeof loadEvent>>;

const loadEvent = (id: string) => api(client.api.organizer.events[":id"].$get({ param: { id } }));
const eventKey = (id: string) => ["organizer", "event", id] as const;

const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const fieldErrors: Partial<Record<keyof FormValues, string>> = {
  title: "Название — от 1 до 200 символов",
  description: "Описание — не длиннее 5000 символов",
  date: "Укажите дату",
  time: "Укажите время начала",
  timezone: "Выберите часовой пояс из списка",
  limit: "Лимит — целое число от 1 до 100 000",
  minAge: "Возраст — целое число от 1 до 120 или пусто",
};

const valuesOf = ({ event: e }: OrganizerEvent): FormValues => {
  const [date = "", time = ""] = e.startsLocal.split("T");
  return { title: e.title, description: e.description, date, time, timezone: e.timezone, limit: e.limit, minAge: e.minAge };
};

/**
 * Правка шлёт только изменённые поля. Без даты и времени момент начала сохраняется,
 * поэтому смена одного пояса — не перенос (D-016).
 */
function patchOf(values: FormValues, dirty: Partial<Record<keyof FormValues, unknown>>): EventPatch {
  const patch: EventPatch = {};
  if (dirty.title) patch.title = values.title;
  if (dirty.description) patch.description = values.description;
  if (dirty.date || dirty.time) patch.startsLocal = `${values.date}T${values.time}`;
  if (dirty.timezone) patch.timezone = values.timezone;
  if (dirty.limit) patch.limit = values.limit;
  if (dirty.minAge) patch.minAge = values.minAge;
  return patch;
}

/** S7-EventForm: `/organizer/events/new` — создание, `/organizer/events/:id/edit` — правка. */
export function EventFormPage() {
  const { id } = useParams();
  const event = useQuery({ queryKey: eventKey(id ?? ""), queryFn: () => loadEvent(id!), enabled: Boolean(id) });

  if (!id) return <EventForm />;
  if (event.isPending) return <PageSkeleton label="Загрузка события" />;
  if (event.error instanceof ApiError && event.error.status === 404) return <NotFoundPage embedded />;
  if (event.isError) return <ErrorBanner title="Не удалось загрузить событие">{errorText(event.error)}</ErrorBanner>;
  return <EventForm loaded={event.data} />;
}

function EventForm({ loaded }: { loaded?: OrganizerEvent }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const hideToast = useCallback(() => setToast(null), []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Правка с лимитом ниже подтверждённых ждёт подтверждения в диалоге (D-032).
  const [overLimit, setOverLimit] = useState<{ patch: EventPatch; excess: number } | null>(null);
  // Перенос или новый минимальный возраст ничего не отменяют — форма только предупреждает (D-017, S7 s7b).
  const [ageWarning, setAgeWarning] = useState<{ count: number; rescheduled: boolean } | null>(null);
  const timezones = useMemo(() => {
    const now = new Date();
    return Intl.supportedValuesOf("timeZone").map((tz) => ({ tz, label: `${tz.replaceAll("_", " ")} (${utcOffset(now, tz)})` }));
  }, []);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: loaded
      ? valuesOf(loaded)
      : { title: "", description: "", date: "", time: "19:00", timezone: browserTimezone, minAge: null },
  });

  const create = useMutation({
    mutationFn: ({ date, time, ...rest }: FormValues) =>
      api(client.api.organizer.events.$post({ json: { ...rest, startsLocal: `${date}T${time}` } })),
    onSuccess: ({ event }) => {
      queryClient.invalidateQueries({ queryKey: myEventsKey });
      navigate(`/organizer/events/${event.id}`);
    },
  });
  const update = useMutation({
    mutationFn: (patch: EventPatch) =>
      api(client.api.organizer.events[":id"].$patch({ param: { id: loaded!.event.id }, json: patch })),
    onSuccess: ({ event, counts, rescheduled, belowMinAgeCount }, patch) => {
      setOverLimit(null);
      const ageChanged = rescheduled || patch.minAge !== undefined;
      setAgeWarning(ageChanged && belowMinAgeCount > 0 ? { count: belowMinAgeCount, rescheduled } : null);
      const next = { ...loaded!, event, counts };
      queryClient.setQueryData(eventKey(event.id), next);
      queryClient.invalidateQueries({ queryKey: myEventsKey });
      form.reset(valuesOf(next));
      setToast(rescheduled ? "Событие перенесено — участникам ушли письма" : "Изменения сохранены");
    },
    // Событие могло начаться, пока форма была открыта: перечитанное событие заблокирует дату и лимит (D-033).
    onError: () => queryClient.invalidateQueries({ queryKey: eventKey(loaded!.event.id) }),
  });
  const remove = useMutation({
    mutationFn: () => api(client.api.organizer.events[":id"].$delete({ param: { id: loaded!.event.id } })),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: eventKey(loaded!.event.id) });
      queryClient.invalidateQueries({ queryKey: myEventsKey });
      navigate("/organizer");
    },
    // Пока диалог был открыт, кто-то мог зарегистрироваться: ошибка в диалоге, кнопка спрячется (D-035).
    onError: () => queryClient.invalidateQueries({ queryKey: eventKey(loaded!.event.id) }),
  });
  const saving = create.isPending || update.isPending;
  const saveError = create.error ?? update.error;

  const [title, date, time, timezone, minAge] = useWatch({
    control: form.control,
    name: ["title", "date", "time", "timezone", "minAge"],
  });
  const { errors, dirtyFields } = form.formState;
  const keepsMoment = loaded && !dirtyFields.date && !dirtyFields.time;
  // Письмо о переносе получат все неотменённые, включая лист ожидания (D-016).
  const notifiesOnMove = !keepsMoment && loaded !== undefined && loaded.counts.confirmed + loaded.counts.waitlisted > 0;
  const previewTime = useMemo(() => {
    if (!date || !time || !timezone) return null;
    // Пояс сменили, а дату и время нет — момент тот же, показываем его на часах нового пояса.
    if (keepsMoment) return formatEventTime(loaded.event.startsAt, timezone);
    // Момент считает сервер (D-015); здесь введённые часы показываются как есть, смещение — приблизительно.
    const wall = `${date}T${time}:00Z`;
    return `${formatWallTime(wall, "UTC")} (${utcOffset(wall, timezone)})`;
  }, [date, time, timezone, keepsMoment, loaded]);

  // После начала дата и лимит не меняются (D-033); поля только для чтения, чтобы значения оставались в форме.
  const started = loaded?.event.started ?? false;
  const field = (name: keyof FormValues) => ({
    className: `field ${errors[name] ? "field--error" : ""}`,
    error: errors[name] && (
      <p className="field__error" id={`event-${name}-error`}>
        <Icon name="info" />
        {fieldErrors[name]}
      </p>
    ),
    aria: {
      "aria-invalid": Boolean(errors[name]),
      "aria-describedby": errors[name] ? `event-${name}-error` : started ? "event-started-hint" : undefined,
    },
  });
  const submit = form.handleSubmit((values) => {
    if (!loaded) return create.mutate(values);
    const patch = patchOf(values, dirtyFields);
    // Число подтверждённых — из последнего снимка; устаревшее безопасно, сохранение ничего не отнимает (D-032).
    const excess = patch.limit === undefined ? 0 : loaded.counts.confirmed - patch.limit;
    if (excess > 0) setOverLimit({ patch, excess });
    else update.mutate(patch);
  });

  return (
    <>
      {toast && <Toast message={toast} onDone={hideToast} />}
      <div className="stack" style={{ gap: "var(--space-2)" }}>
        <Link className="back-link" to="/organizer">
          <Icon name="back" />
          Мои события
        </Link>
        <h1 className="heading page-header__title">{loaded ? "Редактирование события" : "Новое событие"}</h1>
      </div>
      {ageWarning && loaded && (
        <div className="banner banner--warning" role="status">
          <Icon name="warning" />
          <div className="banner__body">
            <p>
              {ageWarning.count} {plural(ageWarning.count, ["участник не проходит", "участника не проходят", "участников не проходят"])}{" "}
              по возрасту {ageWarning.rescheduled ? "на новую дату" : "на день события"}
            </p>
            <p>
              <Link className="s7-banner-link" to={`/organizer/events/${loaded.event.id}`}>
                Показать в списке участников
              </Link>
            </p>
          </div>
        </div>
      )}
      <div className="form-layout">
        <form className="form" aria-label="Параметры события" noValidate onSubmit={submit}>
          {saveError && (
            <ErrorBanner title={loaded ? "Не удалось сохранить изменения" : "Не удалось создать событие"}>
              {errorText(saveError)}
            </ErrorBanner>
          )}
          <div className={field("title").className}>
            <label className="field__label" htmlFor="event-title">
              Название
            </label>
            <input className="field__control" id="event-title" type="text" {...field("title").aria} {...form.register("title")} />
            {field("title").error}
          </div>
          <div className={field("description").className}>
            <label className="field__label" htmlFor="event-description">
              Описание
            </label>
            <textarea
              className="field__control"
              id="event-description"
              rows={4}
              placeholder="О чём событие, где пройдёт, что взять с собой"
              {...field("description").aria}
              {...form.register("description")}
            />
            {field("description").error}
          </div>
          <div className="form-row">
            <div className={field("date").className}>
              <label className="field__label" htmlFor="event-date">
                Дата
              </label>
              <input
                className="field__control"
                id="event-date"
                type="date"
                readOnly={started}
                {...field("date").aria}
                {...form.register("date")}
              />
              {field("date").error}
            </div>
            <div className={field("time").className}>
              <label className="field__label" htmlFor="event-time">
                Время начала
              </label>
              <input
                className="field__control"
                id="event-time"
                type="time"
                readOnly={started}
                {...field("time").aria}
                {...form.register("time")}
              />
              {field("time").error}
            </div>
          </div>
          {started ? (
            <p className="field__hint" id="event-started-hint">
              Событие началось — дату, время и лимит мест изменить нельзя
            </p>
          ) : (
            notifiesOnMove && (
              <p className="field__hint">Это перенос: всем участникам, включая лист ожидания, придёт письмо с новым временем</p>
            )
          )}
          <div className={field("timezone").className}>
            <label className="field__label" htmlFor="event-timezone">
              Часовой пояс
            </label>
            <div className="select">
              <select
                className="field__control"
                id="event-timezone"
                aria-describedby="event-timezone-hint"
                {...form.register("timezone")}
              >
                {timezones.map(({ tz, label }) => (
                  <option key={tz} value={tz}>
                    {label}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" className="select__icon" />
            </div>
            <p className="field__hint" id="event-timezone-hint">
              {loaded
                ? "Смена только пояса не сдвигает начало — время пересчитается на часы нового пояса"
                : "По умолчанию — часовой пояс вашего браузера"}
            </p>
          </div>
          <div className="form-row">
            <div className={field("limit").className}>
              <label className="field__label" htmlFor="event-limit">
                Лимит мест
              </label>
              <input
                className="field__control"
                id="event-limit"
                type="number"
                inputMode="numeric"
                min={1}
                readOnly={started}
                {...field("limit").aria}
                {...form.register("limit", { valueAsNumber: true })}
              />
              {field("limit").error}
            </div>
            <div className={field("minAge").className}>
              <label className="field__label" htmlFor="event-min-age">
                Минимальный возраст <span className="field__optional">· необязательно</span>
              </label>
              <input
                className="field__control"
                id="event-min-age"
                type="number"
                inputMode="numeric"
                placeholder="18"
                aria-describedby={errors.minAge ? "event-minAge-error" : "event-min-age-hint"}
                aria-invalid={Boolean(errors.minAge)}
                {...form.register("minAge", { setValueAs: (v: string) => (v === "" || v === null ? null : Number(v)) })}
              />
              {field("minAge").error ?? (
                <p className="field__hint" id="event-min-age-hint">
                  Проверяется на день события
                </p>
              )}
            </div>
          </div>
          <div className="form__actions">
            <button className="button button--primary" type="submit" disabled={saving}>
              {loaded ? (saving ? "Сохраняем…" : "Сохранить изменения") : saving ? "Создаём…" : "Создать событие"}
            </button>
            <Link className="button button--secondary" to={loaded ? `/organizer/events/${loaded.event.id}` : "/organizer"}>
              Отмена
            </Link>
            {loaded?.registrationCount === 0 && (
              <button className="button button--danger-outline" type="button" onClick={() => setConfirmDelete(true)}>
                Удалить событие
              </button>
            )}
          </div>
        </form>
        <aside className="preview" aria-label="Так увидят участники">
          <p className="preview__title">Так увидят участники</p>
          {minAge ? <span className="badge badge--age">{minAge}+</span> : null}
          <p className="preview__name">{title || "Название события"}</p>
          {previewTime && (
            <p className="event-header__time">
              <Icon name="calendar" />
              {previewTime}
            </p>
          )}
          <p className="text-small text-muted">Время всегда показывается с часовым поясом события — где бы ни был участник.</p>
        </aside>
      </div>
      {overLimit && (
        <ConfirmDialog
          title={`${overLimit.excess} ${plural(overLimit.excess, ["подтверждённый", "подтверждённых", "подтверждённых"])} сверх лимита`}
          text={`Билеты у всех останутся, новых мест не будет, пока подтверждённых не станет меньше ${overLimit.patch.limit}. Сохранить?`}
          confirmLabel={update.isPending ? "Сохраняем…" : "Сохранить"}
          cancelLabel="Изменить лимит"
          pending={update.isPending}
          error={update.isError ? errorText(update.error) : undefined}
          onConfirm={() => update.mutate(overLimit.patch)}
          onCancel={() => {
            setOverLimit(null);
            update.reset();
          }}
        />
      )}
      {confirmDelete && loaded && (
        <ConfirmDialog
          title="Удалить событие?"
          text="Событие пропадёт из «Моих событий», а ссылка для участников перестанет открываться. Вернуть его нельзя."
          confirmLabel={remove.isPending ? "Удаляем…" : "Удалить событие"}
          cancelLabel="Оставить событие"
          pending={remove.isPending}
          error={remove.isError ? errorText(remove.error) : undefined}
          onConfirm={() => remove.mutate()}
          onCancel={() => {
            setConfirmDelete(false);
            remove.reset();
          }}
        />
      )}
    </>
  );
}

