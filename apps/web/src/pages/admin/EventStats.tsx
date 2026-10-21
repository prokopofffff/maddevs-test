import type { ReactNode } from "react";

export interface Counts {
  confirmed: number;
  limit: number;
  waitlisted: number;
  checkedIn: number;
}

const percent = (part: number, whole: number) => `${whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0}%`;

function Bar({ label, value, max, warn = false }: { label: string; value: number; max: number; warn?: boolean }) {
  return (
    <div
      className="stat__bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span className={`stat__bar-fill${warn ? " stat__bar-fill--over" : ""}`} style={{ width: percent(value, max) }} />
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat">
      <p className="stat__label">{label}</p>
      {children}
    </div>
  );
}

/** Три плашки кабинета: «Подтверждено N из L», «Лист ожидания N», «Пришло N из M» (D-021); сверх лимита — пометка (D-032). */
export function EventStats({ counts }: { counts: Counts }) {
  const over = counts.confirmed - counts.limit;
  return (
    <div className="stats">
      <Stat label="Подтверждено">
        <p className="stat__value">
          {counts.confirmed} <span className="stat__total">из {counts.limit}</span>
        </p>
        {over > 0 && <p className="warn-mark">{over} сверх лимита</p>}
        <Bar label="Занято мест" value={counts.confirmed} max={counts.limit} warn={over > 0} />
      </Stat>
      <Stat label="Лист ожидания">
        <p className="stat__value">{counts.waitlisted}</p>
      </Stat>
      <Stat label="Пришло">
        <p className="stat__value">
          {counts.checkedIn} <span className="stat__total">из {counts.confirmed}</span>
        </p>
        <Bar label="Пришло участников" value={counts.checkedIn} max={counts.confirmed} />
      </Stat>
    </div>
  );
}
