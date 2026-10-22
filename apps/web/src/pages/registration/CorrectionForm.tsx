import { zodResolver } from "@hookform/resolvers/zod";
import { participantDataSchema, type ParticipantData } from "@app/api/schemas";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { ApiError } from "../../api.ts";
import { ErrorBanner } from "../../components/Banner.tsx";
import { Icon } from "../../components/Icon.tsx";
import { errorText } from "../../errors.ts";
import { todayIso } from "../../format.ts";

const hints: Record<keyof ParticipantData, string> = {
  firstName: "Введите имя",
  lastName: "Введите фамилию",
  birthDate: "Укажите дату рождения",
};

/** Дата рождения в будущем — по часам сервера; показываем под полем, как в форме регистрации. */
const futureBirthDate = (error: unknown) =>
  error instanceof ApiError &&
  error.code === "validation_failed" &&
  (error.details.issues as { path: string; message: string }[] | undefined)?.some(
    (i) => i.path === "birthDate" && i.message === "in_future",
  );

/**
 * Форма «Исправить данные» на странице по личной ссылке (D-031): та же схема, что у формы регистрации.
 * Рамки нет — поля из `c-fields`. Отправка создаёт заявку; данные меняются, только когда её примет поддержка.
 */
export function CorrectionForm({
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: ParticipantData;
  pending: boolean;
  error: unknown;
  onSubmit: (data: ParticipantData) => void;
  onCancel: () => void;
}) {
  const form = useForm<ParticipantData>({ resolver: zodResolver(participantDataSchema), defaultValues: initial });
  const serverBirthDate = futureBirthDate(error);

  useEffect(() => {
    form.setFocus("firstName");
  }, [form]);

  const { errors } = form.formState;
  const field = (name: keyof ParticipantData) => {
    const message =
      name === "birthDate" && serverBirthDate
        ? "Дата рождения не может быть в будущем"
        : errors[name]
          ? hints[name]
          : undefined;
    return {
      className: `field ${message ? "field--error" : ""}`,
      control: {
        className: "field__control",
        id: `fix-${name}`,
        "aria-invalid": Boolean(message),
        "aria-describedby": message ? `fix-${name}-error` : undefined,
        ...form.register(name),
      },
      error: message && (
        <p className="field__error" id={`fix-${name}-error`}>
          <Icon name="info" />
          {message}
        </p>
      ),
    };
  };
  const firstName = field("firstName");
  const lastName = field("lastName");
  const birthDate = field("birthDate");

  return (
    <form className="form" noValidate aria-labelledby="fix-title" onSubmit={form.handleSubmit(onSubmit)}>
      <p className="heading heading--section" id="fix-title">
        Исправить данные
      </p>
      <p className="text-muted text-small">
        Заявку проверит поддержка и пришлёт письмо с решением. Email так не меняется: для этого откажитесь от участия и
        зарегистрируйтесь заново.
      </p>
      {error && !serverBirthDate ? <ErrorBanner>{errorText(error)}</ErrorBanner> : null}
      <div className={firstName.className}>
        <label className="field__label" htmlFor="fix-firstName">
          Имя
        </label>
        <input {...firstName.control} type="text" autoComplete="given-name" />
        {firstName.error}
      </div>
      <div className={lastName.className}>
        <label className="field__label" htmlFor="fix-lastName">
          Фамилия
        </label>
        <input {...lastName.control} type="text" autoComplete="family-name" />
        {lastName.error}
      </div>
      <div className={birthDate.className}>
        <label className="field__label" htmlFor="fix-birthDate">
          Дата рождения
        </label>
        <input {...birthDate.control} type="date" autoComplete="bday" min="1900-01-01" max={todayIso()} />
        {birthDate.error}
      </div>
      <div className="form__actions">
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "Отправляем…" : "Отправить заявку"}
        </button>
        <button className="button button--secondary" type="button" disabled={pending} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
