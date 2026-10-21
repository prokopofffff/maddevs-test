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
