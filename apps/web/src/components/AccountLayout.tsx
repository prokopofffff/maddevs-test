import { Navigate, Outlet, useLocation } from "react-router";
import { homeFor, useMe } from "../session.ts";
import { PageSkeleton } from "./Skeleton.tsx";

/**
 * Кабинет организатора или поддержки: без сессии — на вход, с другой ролью — в свой кабинет (D-030).
 * Шапку рисует общий `SiteLayout` (D-066); `bare` — экран чекина вне него, на всё окно (S9).
 */
export function AccountLayout({ role, bare = false }: { role: "organizer" | "support"; bare?: boolean }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <PageSkeleton label="Загрузка кабинета" />;
  if (me.isError || !me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (me.data.role !== role) return <Navigate to={homeFor(me.data.role)} replace />;
  if (bare) return <Outlet />;

  return (
    <main className="app-main">
      <Outlet />
    </main>
  );
}
