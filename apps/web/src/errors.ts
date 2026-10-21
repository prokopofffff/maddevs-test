import { ApiError } from "./api.ts";

const messages: Record<string, string> = {
  invalid_credentials: "Неверный email или пароль",
  email_taken: "Этот email уже зарегистрирован — войдите",
  starts_in_past: "Это время уже прошло — выберите момент в будущем",
  validation_failed: "Проверьте поля формы",
  not_found: "Такой страницы нет",
  unauthorized: "Войдите, чтобы продолжить",
  rate_limited: "Слишком много запросов — подождите минуту",
};

/** Код ошибки API → русский текст (D-024). */
export function errorText(error: unknown) {
  if (error instanceof ApiError) return messages[error.code] ?? "Что-то пошло не так — попробуйте ещё раз";
  return "Нет связи с сервером — проверьте соединение и повторите";
}
