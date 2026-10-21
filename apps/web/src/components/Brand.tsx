import { Link } from "react-router";

// Название из шаблона («Явка») не используем: продукт — «Регистрация на мероприятия» (SPEC, раздел 8).
export function Brand({ to = "/" }: { to?: string }) {
  return (
    <Link className="brand" to={to}>
      <span className="brand__mark" aria-hidden="true" />
      Регистрация на мероприятия
    </Link>
  );
}
