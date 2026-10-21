import { zodResolver } from "@hookform/resolvers/zod";
import { eventInputSchema } from "@app/api/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { api, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Icon } from "../components/Icon.tsx";
import { errorText } from "../errors.ts";
import { formatWallTime, utcOffset } from "../format.ts";
import { myEventsKey } from "./MyEventsPage.tsx";

// В форме дата и время — два поля (S7-EventForm); в API уходит одно `startsLocal` (D-015).
const formSchema = eventInputSchema.omit({ startsLocal: true }).extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
});
type FormValues = z.infer<typeof formSchema>;

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

/** S7-EventForm: создание события. Правка (`/organizer/events/:id/edit`) — в тикете «Правка и удаление события». */
export function EventFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const timezones = useMemo(() => {
    const now = new Date();
    return Intl.supportedValuesOf("timeZone").map((tz) => ({ tz, label: `${tz.replaceAll("_", " ")} (${utcOffset(now, tz)})` }));
  }, []);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", description: "", date: "", time: "19:00", timezone: browserTimezone, minAge: null },
  });
  const create = useMutation({
    mutationFn: ({ date, time, ...rest }: FormValues) =>
      api(client.api.organizer.events.$post({ json: { ...rest, startsLocal: `${date}T${time}` } })),
    onSuccess: ({ event }) => {
      queryClient.invalidateQueries({ queryKey: myEventsKey });
      navigate(`/organizer/events/${event.id}`);
    },
  });

  const [title, date, time, timezone, minAge] = useWatch({
    control: form.control,
    name: ["title", "date", "time", "timezone", "minAge"],
  });
  const previewTime = useMemo(() => {
    if (!date || !time || !timezone) return null;
    // Момент считает сервер (D-015); здесь введённые часы показываются как есть, смещение — приблизительно.
    const wall = `${date}T${time}:00Z`;
    return `${formatWallTime(wall, "UTC")} (${utcOffset(wall, timezone)})`;
  }, [date, time, timezone]);

  const { errors } = form.formState;
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
      "aria-describedby": errors[name] ? `event-${name}-error` : undefined,
    },
  });

  return (
    <>
      <div className="stack" style={{ gap: "var(--space-2)" }}>
        <Link className="back-link" to="/organizer">
          <Icon name="back" />
          Мои события
        </Link>
        <h1 className="heading page-header__title">Новое событие</h1>
      </div>
      <div className="form-layout">
        <form
          className="form"
          aria-label="Параметры события"
          noValidate
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
        >
          {create.isError && <ErrorBanner title="Не удалось создать событие">{errorText(create.error)}</ErrorBanner>}
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
              <input className="field__control" id="event-date" type="date" {...field("date").aria} {...form.register("date")} />
              {field("date").error}
            </div>
            <div className={field("time").className}>
              <label className="field__label" htmlFor="event-time">
                Время начала
              </label>
              <input className="field__control" id="event-time" type="time" {...field("time").aria} {...form.register("time")} />
              {field("time").error}
            </div>
          </div>
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
              По умолчанию — часовой пояс вашего браузера
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
                {...form.register("minAge", { setValueAs: (v: string) => (v === "" ? null : Number(v)) })}
              />
              {field("minAge").error ?? (
                <p className="field__hint" id="event-min-age-hint">
                  Проверяется на день события
                </p>
              )}
            </div>
          </div>
          <div className="form__actions">
            <button className="button button--primary" type="submit" disabled={create.isPending}>
              {create.isPending ? "Создаём…" : "Создать событие"}
            </button>
            <Link className="button button--secondary" to="/organizer">
              Отмена
            </Link>
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
    </>
  );
}
