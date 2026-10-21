import { zodResolver } from "@hookform/resolvers/zod";
import { eventInputSchema, type EventPatch } from "@app/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { api, ApiError, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { Toast } from "../components/Toast.tsx";
import { errorText } from "../errors.ts";
import { formatEventTime, formatWallTime, utcOffset } from "../format.ts";
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
    onSuccess: ({ event }) => {
      const next = { ...loaded!, event };
      queryClient.setQueryData(eventKey(event.id), next);
      queryClient.invalidateQueries({ queryKey: myEventsKey });
      form.reset(valuesOf(next));
      setToast("Изменения сохранены");
    },
  });
  const remove = useMutation({
    mutationFn: () => api(client.api.organizer.events[":id"].$delete({ param: { id: loaded!.event.id } })),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: eventKey(loaded!.event.id) });
      queryClient.invalidateQueries({ queryKey: myEventsKey });
      navigate("/organizer");
    },
    onError: () => {
      setConfirmDelete(false);
      // Пока диалог был открыт, кто-то мог зарегистрироваться: кнопка спрячется (D-035).
      queryClient.invalidateQueries({ queryKey: eventKey(loaded!.event.id) });
    },
  });
  const saving = create.isPending || update.isPending;
  const saveError = create.error ?? update.error;

  const [title, date, time, timezone, minAge] = useWatch({
    control: form.control,
    name: ["title", "date", "time", "timezone", "minAge"],
  });
  const { errors, dirtyFields } = form.formState;
  const keepsMoment = loaded && !dirtyFields.date && !dirtyFields.time;
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
    if (loaded) update.mutate(patchOf(values, dirtyFields));
    else create.mutate(values);
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
      <div className="form-layout">
        <form className="form" aria-label="Параметры события" noValidate onSubmit={submit}>
          {saveError && (
            <ErrorBanner title={loaded ? "Не удалось сохранить изменения" : "Не удалось создать событие"}>
              {errorText(saveError)}
            </ErrorBanner>
          )}
          {remove.isError && <ErrorBanner title="Не удалось удалить событие">{errorText(remove.error)}</ErrorBanner>}
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
          {started && (
            <p className="field__hint" id="event-started-hint">
              Событие началось — дату, время и лимит мест изменить нельзя
            </p>
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
      {confirmDelete && loaded && (
        <DeleteDialog
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

/** Диалог по `c-dialog`: удаление необратимо, поэтому подтверждаем (D-035). */
function DeleteDialog({ pending, onConfirm, onCancel }: { pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-text"
      >
        <h2 className="dialog__title" id="delete-dialog-title">
          Удалить событие?
        </h2>
        <p className="dialog__text" id="delete-dialog-text">
          Событие пропадёт из «Моих событий», а ссылка для участников перестанет открываться. Вернуть его нельзя.
        </p>
        <div className="dialog__actions">
          <button className="button button--danger" type="button" disabled={pending} onClick={onConfirm}>
            {pending ? "Удаляем…" : "Удалить событие"}
          </button>
          <button className="button button--secondary" type="button" autoFocus onClick={onCancel}>
            Оставить событие
          </button>
        </div>
      </div>
    </div>
  );
}
