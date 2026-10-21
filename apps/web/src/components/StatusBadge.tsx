const labels = {
  confirmed: ["badge--confirmed", "Подтверждена"],
  waitlisted: ["badge--waitlist", "Лист ожидания"],
  cancelled: ["badge--cancelled", "Отменена"],
} as const;

export type RegistrationStatus = keyof typeof labels;

export function StatusBadge({ status }: { status: RegistrationStatus }) {
  const [modifier, label] = labels[status];
  return (
    <span className={`badge ${modifier}`}>
      <span className="badge__mark" aria-hidden="true" />
      {label}
    </span>
  );
}
