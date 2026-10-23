import { useEffect, useId, useRef } from "react";
import { ErrorBanner } from "./Banner.tsx";

interface ConfirmDialogProps {
  title: string;
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  error?: string;
  /** Содержимое между текстом и кнопками — например, список затронутого. */
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Диалог подтверждения опасного действия (`c-dialog`). Фокус — на безопасной кнопке,
 * Escape закрывает, после закрытия фокус возвращается туда, откуда диалог открыли.
 */
export function ConfirmDialog({ title, text, confirmLabel, cancelLabel, pending, error, children, onConfirm, onCancel }: ConfirmDialogProps) {
  const id = useId();
  const safe = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    safe.current?.focus();
    return () => opener?.focus();
  }, []);

  return (
    <div
      className="dialog-backdrop dialog-backdrop--fixed"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) onCancel();
      }}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
      >
        <h2 className="dialog__title" id={`${id}-title`}>
          {title}
        </h2>
        {/* Текст и перечень внутри одного описания: скринридер читает и список затронутого. */}
        <div className="dialog__body" id={`${id}-text`}>
          <p className="dialog__text">{text}</p>
          {children}
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div className="dialog__actions">
          <button className="button button--danger" type="button" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button ref={safe} className="button button--secondary" type="button" disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
