import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon.tsx";

export type FilterOption = readonly [value: string, text: string];

/**
 * Выпадающий фильтр в стиле чипов: пилюля «Город: Любой» и список под ней (D-064).
 * Первый пункт — «любое значение» (`""`); выбранный фильтр красит пилюлю как нажатый чип.
 * Клавиатура — как у нативного списка: стрелки, Home/End, Enter/пробел выбирают, Escape закрывает.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex(([v]) => v === value),
  );
  const selectedText = options[selectedIndex]?.[1] ?? "";

  // Клик мимо закрывает список; фокус при этом уходит туда, куда кликнули.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    setActive(selectedIndex);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (index: number) => {
    const option = options[index];
    if (option && option[0] !== value) onChange(option[0]);
    close();
  };

  const onTriggerKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show();
    }
  };

  const onListKeyDown = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, active + 1),
      ArrowUp: () => Math.max(0, active - 1),
      Home: () => 0,
      End: () => last,
    };
    if (moves[e.key]) {
      e.preventDefault();
      setActive(moves[e.key]!());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="filter-select" ref={root}>
      <button
        ref={trigger}
        className="chip filter-select__trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-pressed={value !== ""}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="filter-select__label">{label}:</span> {selectedText}
        <Icon name="chevronDown" className="filter-select__icon" />
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          className="filter-select__list"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-option-${active}`}
          onKeyDown={onListKeyDown}
        >
          {options.map(([optionValue, text], index) => (
            <li
              key={optionValue}
              id={`${id}-option-${index}`}
              data-index={index}
              className="filter-select__option"
              role="option"
              aria-selected={index === selectedIndex}
              data-active={index === active || undefined}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {text}
              {index === selectedIndex && <Icon name="check" className="filter-select__check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
