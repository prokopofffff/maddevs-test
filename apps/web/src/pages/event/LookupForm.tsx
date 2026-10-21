import { emailSchema } from "@app/api/schemas";
import { useState } from "react";
import { ErrorBanner } from "../../components/Banner.tsx";
import { Icon } from "../../components/Icon.tsx";
import { errorText } from "../../errors.ts";

/**
 * «Уже регистрировались?» (S1-Event, рамка s1d): email → код → своя регистрация (D-007, D-039).
 * После начала события — единственное действие на странице (D-034). Вернулись «Изменить email» — раскрыта.
 */
export function LookupForm({
  initial,
  pending,
  error,
  onSubmit,
}: {
  initial?: string;
  pending: boolean;
  error: unknown;
  onSubmit: (email: string) => void;
}) {
  const [email, setEmail] = useState(initial ?? "");
  const [touched, setTouched] = useState(false);
  const invalid = touched && !emailSchema.safeParse(email).success;

  return (
    <details className="disclosure" open={initial !== undefined}>
      <summary className="disclosure__summary">
        <span className="disclosure__text">Уже регистрировались? Откройте свою регистрацию</span>
        <Icon name="chevronDown" className="disclosure__chevron" />
      </summary>
      <form
        className="disclosure__body"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (emailSchema.safeParse(email).success) onSubmit(email);
        }}
      >
        {error ? <ErrorBanner>{errorText(error)}</ErrorBanner> : null}
        <div className={`field ${invalid ? "field--error" : ""}`}>
          <label className="field__label" htmlFor="lookup-email">
            Email, указанный при регистрации
          </label>
          <input
            className="field__control"
            id="lookup-email"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? "lookup-email-error" : undefined}
          />
          {invalid && (
            <p className="field__error" id="lookup-email-error">
              <Icon name="info" />
              Введите email, например name@example.com
            </p>
          )}
        </div>
        <button className="button button--secondary button--block" type="submit" disabled={pending}>
          {pending ? "Отправляем код…" : "Получить код"}
        </button>
      </form>
    </details>
  );
}
