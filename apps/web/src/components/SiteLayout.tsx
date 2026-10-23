import { Outlet } from "react-router";
import { PublicHeader } from "./PublicHeader.tsx";

/**
 * Одна шапка на всех экранах (D-066): каталог, событие на любом шаге, регистрация, `/me`, вход, кабинеты, 404.
 * Страницы шапку не рисуют. Без неё только экран чекина: он занимает всё окно на входе (D-023).
 */
export function SiteLayout() {
  return (
    <>
      <PublicHeader />
      <Outlet />
    </>
  );
}
