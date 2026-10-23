import { zodResolver } from "@hookform/resolvers/zod";
import { participantDataSchema, type ParticipantData } from "@app/api/schemas";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { ErrorBanner } from "../../components/Banner.tsx";
import { errorText } from "../../errors.ts";
import { todayIso } from "../../format.ts";
import { FieldError, fieldError, hints } from "../event/RegistrationForm.tsx";

type Props = {
  initial?: ParticipantData;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (data: ParticipantData) => void;
  onCancel?: () => void;
};

/**
 * Три поля профиля: имя, фамилия, дата рождения (D-065). Проверки и тексты ошибок — как у формы регистрации;
 * «дата в будущем» от сервера — под полем, остальные ошибки — баннером.
 */
export function ProfileForm({ initial, submitLabel, pendingLabel, pending, error, onSubmit, onCancel }: Props) {
  const form = useForm<ParticipantData>({
    resolver: zodResolver(participantDataSchema),
    defaultValues: { firstName: "", lastName: "", birthDate: "", ...initial },
  });
  const server = fieldError(error);
  const serverField = server?.field;

  useEffect(() => {
    if (serverField) form.setFocus(serverField as keyof ParticipantData);
  }, [serverField, error, form]);

  const field = (name: keyof ParticipantData) => {
    const message = server?.field === name ? server.text : form.formState.errors[name] ? hints[name] : undefined;
    return {
      className: `field ${message ? "field--error" : ""}`,
      control: {
        className: "field__control",
        id: `profile-${name}`,
        "aria-invalid": Boolean(message),
        "aria-describedby": message ? `profile-${name}-error` : undefined,
        ...form.register(name),
      },
      error: message && <FieldError id={`profile-${name}-error`}>{message}</FieldError>,
    };
  };
  const firstName = field("firstName");
  const lastName = field("lastName");
  const birthDate = field("birthDate");

  return (
    <form className="form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      {error && !server ? <ErrorBanner>{errorText(error)}</ErrorBanner> : null}
      <div className="form-row">
        <div className={firstName.className}>
          <label className="field__label" htmlFor="profile-firstName">
            Имя
          </label>
          <input {...firstName.control} type="text" autoComplete="given-name" placeholder="Анна" />
          {firstName.error}
        </div>
        <div className={lastName.className}>
          <label className="field__label" htmlFor="profile-lastName">
            Фамилия
          </label>
          <input {...lastName.control} type="text" autoComplete="family-name" placeholder="Иванова" />
          {lastName.error}
        </div>
      </div>
      <div className={birthDate.className}>
        <label className="field__label" htmlFor="profile-birthDate">
          Дата рождения
        </label>
        <input {...birthDate.control} type="date" autoComplete="bday" min="1900-01-01" max={todayIso()} />
        {birthDate.error}
      </div>
      <div className="profile__actions">
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {onCancel && (
          <button className="button button--secondary" type="button" disabled={pending} onClick={onCancel}>
            Отмена
          </button>
        )}
      </div>
    </form>
  );
}
