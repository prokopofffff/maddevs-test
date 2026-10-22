import { NavLink } from "react-router";

/** Разделы поддержки: очередь заявок и события только на чтение (D-030, D-031). */
export function SupportNav() {
  return (
    <nav className="tabs" aria-label="Разделы поддержки">
      <NavLink className="tabs__link" to="/support" end>
        Заявки
      </NavLink>
      <NavLink className="tabs__link" to="/support/events">
        События
      </NavLink>
    </nav>
  );
}
