import { Brand } from "../components/Brand.tsx";

export function NotFoundPage({ embedded = false }: { embedded?: boolean }) {
  const body = (
    <div className="empty-state">
      <p className="empty-state__title">Такой страницы нет</p>
      <p className="empty-state__text">Проверьте ссылку: возможно, в ней опечатка или событие удалено.</p>
    </div>
  );
  if (embedded) return body;
  return (
    <div className="page page--narrow">
      <Brand />
      {body}
    </div>
  );
}
