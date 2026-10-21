import { Icon } from "./Icon.tsx";

export function ErrorBanner({ id, title, children }: { id?: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="banner banner--error" id={id} role="alert">
      <Icon name="error" />
      <div className="banner__body">
        {title && <p className="banner__title">{title}</p>}
        <p>{children}</p>
      </div>
    </div>
  );
}

/** Live-поток оборван (D-021, S8b): цифры на экране — последние полученные. */
export function OfflineBanner() {
  return (
    <div className="banner banner--warning" role="status">
      <Icon name="offline" />
      <div className="banner__body">
        <p className="banner__title">Нет связи, переподключаемся…</p>
        <p>Цифры ниже — на момент обрыва</p>
      </div>
    </div>
  );
}
