import { useEffect, useId, useRef, useState } from "react";
import { ErrorBanner } from "../../components/Banner.tsx";

/**
 * «Отклонить» с необязательной причиной (D-031): `c-dialog` с полем из `c-fields`.
 * Фокус — в поле причины, Escape закрывает, после закрытия фокус возвращается к кнопке строки.
 */
export function RejectDialog({
  who,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  who: string;
  pending: boolean;
  error?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    field.current?.focus();
    return () => opener?.focus();
  }, []);

  return (
    <div
      className="dialog-backdrop dialog-backdrop--fixed"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) onCancel();
      }}
    >
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason);
        }}
      >
        <h2 className="dialog__title" id={`${id}-title`}>
          Отклонить заявку?
        </h2>
        <p className="dialog__text" id={`${id}-text`}>
          Данные останутся прежними. {who} получит письмо — с причиной, если вы её укажете.
        </p>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-reason`}>
            Причина <span className="field__optional">· необязательно</span>
          </label>
          <textarea
            ref={field}
            className="field__control"
            id={`${id}-reason`}
            rows={3}
            maxLength={500}
            placeholder="Например: фамилия не совпадает с документом"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div className="dialog__actions">
          <button className="button button--danger" type="submit" disabled={pending}>
            {pending ? "Отклоняем…" : "Отклонить заявку"}
          </button>
          <button className="button button--secondary" type="button" disabled={pending} onClick={onCancel}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  );
}
