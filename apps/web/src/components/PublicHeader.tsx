import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, client } from "../api.ts";
import { participantKey, participantRegistrationsKey, useParticipant } from "../participant.ts";
import { homeFor, meKey, useMe } from "../session.ts";
import { Brand } from "./Brand.tsx";

/** `email · Выйти` — блок одной сессии; у организатора и участника он свой, выход тоже (дизайн §8.1). */
function SessionBlock({ email, pending, onLogout }: { email: string; pending: boolean; onLogout: () => void }) {
  return (
    <>
      <span>{email}</span>
      <button className="button button--secondary button--sm" type="button" disabled={pending} onClick={onLogout}>
        Выйти
      </button>
    </>
  );
}

/**
 * Шапка публичных страниц: каталог, событие, регистрация, `/me` (D-056).
 * «Мои регистрации» видна всегда: организатор тоже может быть участником. Рядом — вход или кабинет по роли.
 * Сессии организатора (`sid`) и участника (`psid`) независимы (D-057): при обеих показываются обе пары `email · Выйти`.
 */
export function PublicHeader() {
  const me = useMe();
  const participant = useParticipant();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api(client.api.auth.logout.$post()),
    onSuccess: () => {
      // Кэш организатора сбрасываем целиком, но сессия участника при этом не кончается.
      const participantData = queryClient.getQueryData(participantKey);
      queryClient.clear();
      queryClient.setQueryData(meKey, null);
      if (participantData !== undefined) queryClient.setQueryData(participantKey, participantData);
    },
  });
  const participantLogout = useMutation({
    mutationFn: () => api(client.api.participant.logout.$post()),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: participantRegistrationsKey });
      queryClient.setQueryData(participantKey, null);
    },
  });

  const user = me.data;
  return (
    <header className="app-header">
      <Brand to="/" />
      <div className="app-header__user">
        <Link className="button button--secondary button--sm" to="/me">
          Мои регистрации
        </Link>
        {participant.data && (
          <SessionBlock
            email={participant.data.email}
            pending={participantLogout.isPending}
            onLogout={() => participantLogout.mutate()}
          />
        )}
        {user ? (
          <>
            <Link className="button button--primary button--sm" to={homeFor(user.role)}>
              {user.role === "support" ? "Поддержка" : "Мои события"}
            </Link>
            <SessionBlock email={user.email} pending={logout.isPending} onLogout={() => logout.mutate()} />
          </>
        ) : (
          // Пока сессия грузится, акцентную кнопку не рисуем: иначе у вошедшего она мигнёт «Организаторам».
          !me.isPending && (
            <Link className="button button--primary button--sm" to="/login">
              Организаторам
            </Link>
          )
        )}
      </div>
    </header>
  );
}
