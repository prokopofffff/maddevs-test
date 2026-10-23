import { EVENT_CATEGORIES } from "@app/api/schemas";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, client } from "../../api.ts";
import { FilterSelect, type FilterOption } from "../../components/FilterSelect.tsx";
import { Icon } from "../../components/Icon.tsx";
import { categoryLabel } from "../../format.ts";
import type { CatalogParams } from "./query.ts";

/** Пауза после последней буквы, по истечении которой поиск уходит в адрес (D-062). */
const SEARCH_DELAY_MS = 300;

const AGE_OPTIONS = [
  ["", "Любой"],
  ["0", "0+"],
  ["6", "до 6+"],
  ["12", "до 12+"],
  ["16", "до 16+"],
  ["18", "до 18+"],
] as const;

type Props = {
  params: CatalogParams;
  /** Применяет изменения к адресу; `undefined` у ключа снимает фильтр. `replace` — не плодить записи в истории. */
  onChange: (patch: Partial<CatalogParams>, options?: { replace?: boolean }) => void;
  onReset: () => void;
};

/** Поле поиска: набранное живёт в состоянии, а в адрес уходит с задержкой и без новой записи в истории. */
function SearchBox({ q, onCommit }: { q: string; onCommit: (q: string) => void }) {
  const [text, setText] = useState(q);
  // Что мы сами записали в адрес: отличает свой ответ от внешнего изменения («Назад», «Сбросить»).
  const committed = useRef(q);

  useEffect(() => {
    if (q !== committed.current) {
      committed.current = q;
      setText(q);
    }
  }, [q]);

  useEffect(() => {
    const value = text.trim();
    if (value === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = value;
      onCommit(value);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, onCommit]);

  return (
    <div className="search catalog-search">
      <Icon name="search" className="search__icon" />
      <input
        className="field__control"
        type="search"
        placeholder="Поиск по названию и описанию"
        aria-label="Поиск по названию и описанию"
        maxLength={100}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}

function Chip({ pressed, disabled, onClick, children }: { pressed: boolean; disabled?: boolean; onClick: () => void; children: string }) {
  return (
    <button className="chip" type="button" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * Поиск, чипы и выпадающие списки каталога. Состояния своего нет: всё читается из `params` и пишется обратно в адрес.
 * «Сегодня» и «На неделе» — подмножества «Предстоящих», поэтому делят с ними один параметр `when`.
 */
export function CatalogFilters({ params, onChange, onReset }: Props) {
  const when = params.when ?? "upcoming";
  const past = when === "past";
  const cities = useQuery({
    queryKey: ["catalog-cities"],
    queryFn: async () => (await api(client.api.events.cities.$get())).cities,
    staleTime: 60_000,
  });

  // Город из ссылки показываем, даже если его нет в списке (событий там уже нет или список ещё грузится).
  const cityList = cities.data ?? [];
  const city = params.city ? (cityList.find((c) => c.toLowerCase() === params.city?.toLowerCase()) ?? params.city) : "";
  const cityOptions: FilterOption[] = [
    ["", "Любой"],
    ...(city && !cityList.includes(city) ? [[city, city] as const] : []),
    ...cityList.map((c) => [c, c] as const),
  ];

  const commitSearch = (q: string) => onChange({ q: q || undefined }, { replace: true });
  // Повторное нажатие на «Сегодня» / «На неделе» возвращает «Предстоящие».
  const toggleWhen = (value: "today" | "week") => onChange({ when: when === value ? "upcoming" : value });

  return (
    <div className="catalog-filters">
      <SearchBox q={params.q ?? ""} onCommit={commitSearch} />
      <div className="catalog-filters__row">
        <Chip pressed={!past} onClick={() => onChange({ when: "upcoming" })}>
          Предстоящие
        </Chip>
        <Chip pressed={past} onClick={() => onChange({ when: "past" })}>
          Прошедшие
        </Chip>
        <Chip pressed={when === "today"} disabled={past} onClick={() => toggleWhen("today")}>
          Сегодня
        </Chip>
        <Chip pressed={when === "week"} disabled={past} onClick={() => toggleWhen("week")}>
          На неделе
        </Chip>
        <Chip pressed={params.hasSeats === "1"} onClick={() => onChange({ hasSeats: params.hasSeats === "1" ? undefined : "1" })}>
          Есть места
        </Chip>
        <Chip pressed={params.format === "offline"} onClick={() => onChange({ format: params.format === "offline" ? undefined : "offline" })}>
          Офлайн
        </Chip>
        <Chip pressed={params.format === "online"} onClick={() => onChange({ format: params.format === "online" ? undefined : "online" })}>
          Онлайн
        </Chip>
      </div>
      <div className="catalog-filters__row">
        <FilterSelect label="Город" value={city} options={cityOptions} onChange={(v) => onChange({ city: v || undefined })} />
        <FilterSelect
          label="Категория"
          value={params.category ?? ""}
          options={[["", "Любая"], ...EVENT_CATEGORIES.map((c) => [c, categoryLabel[c]] as const)]}
          onChange={(v) => onChange({ category: (v || undefined) as CatalogParams["category"] })}
        />
        <FilterSelect
          label="Возраст"
          value={params.maxAge ?? ""}
          options={AGE_OPTIONS}
          onChange={(v) => onChange({ maxAge: (v || undefined) as CatalogParams["maxAge"] })}
        />
        <button className="button button--quiet button--sm" type="button" onClick={onReset}>
          Сбросить
        </button>
      </div>
    </div>
  );
}
