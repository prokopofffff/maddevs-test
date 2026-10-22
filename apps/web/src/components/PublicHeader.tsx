import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, client } from "../api.ts";
import { homeFor, meKey, useMe } from "../session.ts";
import { Brand } from "./Brand.tsx";

/**
 * Шапка публичных страниц: каталог, событие, регистрация (D-056).
 * «Мои регистрации» видна всегда: организатор тоже может быть участником. Рядом — вход или кабинет по роли.
 * Сессия участника появится в ветке этой же шапки: рядом с блоком организатора, со своим `Выйти`.
 */
export function PublicHeader() {
  const me = useMe();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api(client.api.auth.logout.$post()),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(meKey, null);
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
        {user ? (
          <>
            <Link className="button button--primary button--sm" to={homeFor(user.role)}>
              {user.role === "support" ? "Поддержка" : "Мои события"}
            </Link>
            <span>{user.email}</span>
            <button
              className="button button--secondary button--sm"
              type="button"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              Выйти
            </button>
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
