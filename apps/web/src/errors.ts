import { ApiError } from "./api.ts";

const messages: Record<string, string> = {
  invalid_credentials: "Неверный email или пароль",
  email_taken: "Этот email уже зарегистрирован — войдите",
  starts_in_past: "Это время уже прошло — выберите момент в будущем",
  validation_failed: "Проверьте поля формы",
  not_found: "Такой страницы нет",
  unauthorized: "Войдите, чтобы продолжить",
  rate_limited: "Слишком много запросов — подождите минуту",
  registration_closed: "Событие началось — регистрация закрыта",
  code_expired: "Код истёк — запросите новый",
  code_attempts_exceeded: "Попытки закончились — запросите новый код",
  code_resend_too_soon: "Код уже отправлен — новый можно запросить через минуту",
  registration_not_found: "Регистрации на этот email нет",
  event_has_registrations: "На событие уже зарегистрировались — удалить его нельзя",
  already_checked_in: "Вы уже прошли на событие — отказаться нельзя",
  ticket_cancelled: "Билет отменён",
  ticket_not_found: "Билет не найден",
  event_started: "Событие уже началось — это действие недоступно",
  not_implemented: "Перенос события пока недоступен",
  registration_cancelled: "Регистрация отменена — исправить данные уже нельзя",
  correction_unchanged: "Данные совпадают с текущими — исправлять нечего",
  correction_not_pending: "Заявку уже решили или участник её заменил",
};

/** Код ошибки API → русский текст (D-024). */
export function errorText(error: unknown) {
  if (error instanceof ApiError) return messages[error.code] ?? "Что-то пошло не так — попробуйте ещё раз";
  return "Нет связи с сервером — проверьте соединение и повторите";
}
