import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { api, client } from "../api.ts";
import { homeFor, meKey, useMe } from "../session.ts";
import { Brand } from "./Brand.tsx";
import { PageSkeleton } from "./Skeleton.tsx";

/**
 * Кабинет организатора или поддержки: без сессии — на вход, с другой ролью — в свой кабинет (D-030).
 * `bare` — без шапки: экран чекина на входе занимает всё окно (S9).
 */
export function AccountLayout({ role, bare = false }: { role: "organizer" | "support"; bare?: boolean }) {
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
  if (me.data.role !== role) return <Navigate to={homeFor(me.data.role)} replace />;
  if (bare) return <Outlet />;

  return (
    <>
      <header className="app-header">
        <Brand to={homeFor(role)} />
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
