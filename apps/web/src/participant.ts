import { useQuery } from "@tanstack/react-query";
import { api, ApiError, client } from "./api.ts";

export const participantKey = ["participant"] as const;
/** Дочерний ключ: вход и выход сбрасывают его вместе с `participantKey` (D-057). */
export const participantRegistrationsKey = [...participantKey, "registrations"] as const;

/** Участник по cookie `psid` (D-057): `{ email, profile, lastData }` или `null`, если сессии нет. Как `useMe` для организатора. */
export function useParticipant() {
  return useQuery({
    queryKey: participantKey,
    queryFn: async () => {
      try {
        return await api(client.api.participant.me.$get());
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

/** Регистрации вошедшего участника, по возрастанию начала события. Без сессии не запрашивается. */
export function useParticipantRegistrations(enabled: boolean) {
  return useQuery({
    queryKey: participantRegistrationsKey,
    queryFn: async () => (await api(client.api.participant.registrations.$get())).registrations,
    enabled,
  });
}

/**
 * Куда вернуть после входа: только путь этого приложения (`/e/5`), иначе `/me` (дизайн §8.3).
 * `//host` и `/\host` браузер читает как чужой адрес; пробельные и управляющие символы он выбрасывает
 * из адреса молча, поэтому финальная проверка — разбор относительно подставного origin.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/me";
  try {
    return new URL(next, "http://app.invalid").origin === "http://app.invalid" ? next : "/me";
  } catch {
    return "/me";
  }
}
