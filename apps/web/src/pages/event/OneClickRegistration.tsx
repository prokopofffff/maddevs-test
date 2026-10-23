import { Link } from "react-router";
import { ApiError } from "../../api.ts";
import { ErrorBanner } from "../../components/Banner.tsx";
import { errorText } from "../../errors.ts";
import { ageOnEventDay, formatBirthDate } from "../../format.ts";

type Props = {
  profile: { firstName: string; lastName: string; birthDate: string };
  event: { startsAt: string; timezone: string; minAge: number };
  pending: boolean;
  error: unknown;
  onRegister: () => void;
};

/**
 * Регистрация одной кнопкой для вошедшего участника с профилем (D-065): данные берёт сервер, поэтому тело пустое.
 * Возраст считаем заранее тем же правилом, что сервер (D-008), и не даём нажать заведомо отклонённое;
 * ответ `422 below_min_age` всё равно показываем — часы и профиль могли разойтись с сервером.
 */
export function OneClickRegistration({ profile, event, pending, error, onRegister }: Props) {
  const tooYoung = event.minAge > 0 && ageOnEventDay(profile.birthDate, event) < event.minAge;
  const belowMinAge = error instanceof ApiError && error.code === "below_min_age" ? Number(error.details.minAge) : undefined;

  return (
    <div className="one-click">
      {error ? (
        <ErrorBanner>
          {belowMinAge ? `Регистрация с ${belowMinAge} лет на день события` : errorText(error)}
        </ErrorBanner>
      ) : null}
      <p className="one-click__who">
        Регистрируем: {profile.firstName} {profile.lastName}, {formatBirthDate(profile.birthDate)} ·{" "}
        <Link className="link" to="/me">
          Изменить
        </Link>
      </p>
      <button
        className="button button--primary button--block"
        type="button"
        disabled={pending || tooYoung}
        aria-describedby={tooYoung ? "one-click-hint" : undefined}
        onClick={onRegister}
      >
        {pending ? "Регистрируем…" : "Зарегистрироваться"}
      </button>
      {tooYoung && (
        <p className="field__hint" id="one-click-hint">
          Регистрация с {event.minAge} лет на день события
        </p>
      )}
    </div>
  );
}
