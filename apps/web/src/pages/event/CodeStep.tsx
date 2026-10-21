import { useEffect, useState } from "react";
import { ApiError } from "../../api.ts";
import { ErrorBanner } from "../../components/Banner.tsx";
import { Icon } from "../../components/Icon.tsx";
import { errorText } from "../../errors.ts";
import { formatCountdown, plural } from "../../format.ts";

/** Ошибки ввода кода, которые показываются под полем (рамки s2b, s2c). */
function codeError(error: unknown) {
  if (!(error instanceof ApiError)) return;
  if (error.code === "code_invalid") {
    const left = Number(error.details.attemptsLeft);
    return left > 0
      ? `Неверный код, ${plural(left, ["осталась", "осталось", "осталось"])} ${left} ${plural(left, ["попытка", "попытки", "попыток"])}`
      : "Неверный код. Попытки закончились — запросите новый код";
  }
  if (error.code === "code_expired" || error.code === "code_attempts_exceeded") return errorText(error);
}

/** Секунды до момента; тикает раз в секунду. Новый момент — новый экран (`key` у родителя). */
function useSecondsUntil(at: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= at) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [at]);
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** S2-Code: ввод кода из письма, повторная отправка не чаще раза в минуту (D-007). Новый код — новый `key`. */
export function CodeStep({
  email,
  resendAt,
  confirming,
  confirmError,
  resending,
  resendError,
  onConfirm,
  onResend,
  onBack,
}: {
  email: string;
  resendAt: number;
  confirming: boolean;
  confirmError: unknown;
  resending: boolean;
  resendError: unknown;
  onConfirm: (code: string) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [touched, setTouched] = useState(false);
  const wait = useSecondsUntil(resendAt);
  const fieldText = codeError(confirmError) ?? (touched && !/^\d{6}$/.test(code) ? "Введите 6 цифр из письма" : undefined);
  const bannerError = confirmError && !codeError(confirmError) ? confirmError : resendError;

  return (
    <div className="page page--narrow">
      <button className="back-link s2-back" type="button" onClick={onBack}>
        <Icon name="back" />
        Изменить email
      </button>
      <header className="event-header">
        <h1 className="heading heading--page">Введите код</h1>
        <p>
          Мы отправили код на <strong>{email}</strong>
        </p>
      </header>
      <div className="panel">
        {bannerError ? <ErrorBanner>{errorText(bannerError)}</ErrorBanner> : null}
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (/^\d{6}$/.test(code)) onConfirm(code);
          }}
        >
          <div className={`field ${fieldText ? "field--error" : ""}`}>
            <label className="field__label" htmlFor="code">
              Код из письма
            </label>
            <input
              className="field__control code-input"
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="······"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={Boolean(fieldText)}
              aria-describedby={fieldText ? "code-error" : "code-hint"}
            />
            {fieldText ? (
              <p className="field__error" id="code-error">
                <Icon name="info" />
                {fieldText}
              </p>
            ) : (
              <p className="field__hint" id="code-hint">
                6 цифр. Письмо может прийти с задержкой — загляните в «Спам».
              </p>
            )}
          </div>
          <button
            className={`button button--primary button--block ${confirming ? "button--loading" : ""}`}
            type="submit"
            aria-busy={confirming}
          >
            {confirming && <span className="button__spinner" aria-hidden="true" />}
            {confirming ? "Проверяем…" : "Подтвердить"}
          </button>
        </form>
        <button
          className="button button--secondary button--block"
          type="button"
          disabled={wait > 0 || resending}
          onClick={onResend}
        >
          {resending ? "Отправляем…" : wait > 0 ? `Отправить ещё раз через ${formatCountdown(wait)}` : "Отправить ещё раз"}
        </button>
      </div>
    </div>
  );
}
