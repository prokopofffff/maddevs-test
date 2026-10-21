import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { api, client } from "../api.ts";
import { meKey, useMe } from "../session.ts";
import { Brand } from "./Brand.tsx";
import { PageSkeleton } from "./Skeleton.tsx";

/**
 * Кабинет организатора: без сессии — на вход, с ролью поддержки — к себе.
 * `bare` — без шапки: экран чекина на входе занимает всё окно (S9).
 */
export function OrganizerLayout({ bare = false }: { bare?: boolean }) {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api(client.api.auth.logout.$post()),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(meKey, null);
      navigate("/login");
    },
  });

  if (me.isPending) return <PageSkeleton label="Загрузка кабинета" />;
  if (me.isError || !me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (me.data.role !== "organizer") return <Navigate to="/support" replace />;
  if (bare) return <Outlet />;

  return (
    <>
      <header className="app-header">
        <Brand to="/organizer" />
        <div className="app-header__user">
          <span>{me.data.email}</span>
          <button
            className="button button--secondary button--sm"
            type="button"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            Выйти
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}
