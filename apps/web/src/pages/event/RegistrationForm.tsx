import { zodResolver } from "@hookform/resolvers/zod";
import { registrationFormSchema, type RegistrationForm as FormData } from "@app/api/schemas";
import { useEffect } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { ApiError } from "../../api.ts";
import { ErrorBanner } from "../../components/Banner.tsx";
import { Icon } from "../../components/Icon.tsx";
import { errorText } from "../../errors.ts";
import { todayIso } from "../../format.ts";

const empty: FormData = { firstName: "", lastName: "", birthDate: "", email: "" };

const hints: Record<keyof FormData, string> = {
  firstName: "Введите имя",
  lastName: "Введите фамилию",
  birthDate: "Укажите дату рождения",
  email: "Введите email, например name@example.com",
};

/** Ошибка сервера, относящаяся к конкретному полю, — под полем; остальные — баннером. */
function fieldError(error: unknown): { field: keyof FormData; text: string } | undefined {
  if (!(error instanceof ApiError)) return;
  if (error.code === "below_min_age") {
    return { field: "birthDate", text: `Регистрация с ${error.details.minAge} лет на день события` };
  }
  const issues = error.code === "validation_failed" ? (error.details.issues as { path: string; message: string }[]) : [];
  if (issues?.some((i) => i.path === "birthDate" && i.message === "in_future")) {
    return { field: "birthDate", text: "Дата рождения не может быть в будущем" };
  }
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p className="field__error" id={id}>
      <Icon name="info" />
      {children}
    </p>
  );
}

/** S1-Event: форма регистрации. Значения переживают возврат с экрана кода («Изменить email»). */
export function RegistrationForm({
  initial,
  pending,
  error,
  onSubmit,
}: {
  initial?: FormData;
  pending: boolean;
  error: unknown;
  onSubmit: (data: FormData) => void;
}) {
  const form = useForm<FormData>({ resolver: zodResolver(registrationFormSchema), defaultValues: initial ?? empty });
  const server = fieldError(error);
  const serverField = server?.field;

  useEffect(() => {
    if (serverField) form.setFocus(serverField);
  }, [serverField, error, form]);

  const errors: FieldErrors<FormData> = form.formState.errors;
  const field = (name: keyof FormData) => {
    const message = server?.field === name ? server.text : errors[name] ? hints[name] : undefined;
    return {
      className: `field ${message ? "field--error" : ""}`,
      control: {
        className: "field__control",
        id: `reg-${name}`,
        "aria-invalid": Boolean(message),
        "aria-describedby": message ? `reg-${name}-error` : name === "email" ? "reg-email-hint" : undefined,
        ...form.register(name),
      },
      error: message && <FieldError id={`reg-${name}-error`}>{message}</FieldError>,
    };
  };
  const firstName = field("firstName");
  const lastName = field("lastName");
  const birthDate = field("birthDate");
  const email = field("email");

  return (
    <form className="form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      {error && !server ? <ErrorBanner>{errorText(error)}</ErrorBanner> : null}
      <div className="form-row">
        <div className={firstName.className}>
          <label className="field__label" htmlFor="reg-firstName">
            Имя
          </label>
          <input {...firstName.control} type="text" autoComplete="given-name" placeholder="Анна" />
          {firstName.error}
        </div>
        <div className={lastName.className}>
          <label className="field__label" htmlFor="reg-lastName">
            Фамилия
          </label>
          <input {...lastName.control} type="text" autoComplete="family-name" placeholder="Иванова" />
          {lastName.error}
        </div>
      </div>
      <div className={birthDate.className}>
        <label className="field__label" htmlFor="reg-birthDate">
          Дата рождения
        </label>
        <input {...birthDate.control} type="date" autoComplete="bday" min="1900-01-01" max={todayIso()} />
        {birthDate.error}
      </div>
      <div className={email.className}>
        <label className="field__label" htmlFor="reg-email">
          Email
        </label>
        <input {...email.control} type="email" autoComplete="email" placeholder="name@example.com" />
        {email.error ?? (
          <p className="field__hint" id="reg-email-hint">
            На него придёт код подтверждения
          </p>
        )}
      </div>
      <button className="button button--primary button--block" type="submit" disabled={pending}>
        {pending ? "Отправляем код…" : "Получить код"}
      </button>
    </form>
  );
}
