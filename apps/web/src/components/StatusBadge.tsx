const labels = {
  confirmed: ["badge--confirmed", "Подтверждена"],
  waitlisted: ["badge--waitlist", "Лист ожидания"],
  cancelled: ["badge--cancelled", "Отменена"],
} as const;

export type RegistrationStatus = keyof typeof labels;

/** Бейдж статуса; у листа ожидания — с номером, если он известен. */
export function StatusBadge({ status, position }: { status: RegistrationStatus; position?: number }) {
  const [modifier, label] = labels[status];
  return (
    <span className={`badge ${modifier}`}>
      <span className="badge__mark" aria-hidden="true" />
      {label}
      {status === "waitlisted" && position !== undefined && ` №${position}`}
    </span>
  );
}
