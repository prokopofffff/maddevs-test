import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { api, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Icon } from "../components/Icon.tsx";
import { errorText } from "../errors.ts";
import { CatalogFilters } from "./catalog/CatalogFilters.tsx";
import { EventCard } from "./catalog/EventCard.tsx";
import { parseCatalogParams, toSearchParams, type CatalogParams } from "./catalog/query.ts";

/** Пояс посетителя: по нему сервер считает границы «сегодня» и «на неделе» (D-061). */
const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * `/` — каталог событий без входа (D-056). Фильтры и поиск живут в адресе: подборкой можно поделиться ссылкой,
 * а «Назад» её восстанавливает. Следующие страницы подгружаются по курсору кнопкой «Показать ещё».
 */
export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Каждый разбор даёт новый объект; ключ запроса сравнивается по значению, лишних запросов нет.
  const params = parseCatalogParams(searchParams);

  const events = useInfiniteQuery({
    queryKey: ["catalog", params],
    queryFn: ({ pageParam }) => api(client.api.events.$get({ query: { ...params, tz: browserTimeZone, cursor: pageParam } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // При смене фильтра прежний список остаётся на экране до ответа, а не мигает скелетоном.
    placeholderData: keepPreviousData,
  });

  const change = (patch: Partial<CatalogParams>, options?: { replace?: boolean }) =>
    setSearchParams(toSearchParams({ ...params, ...patch }), { replace: options?.replace });
  const reset = () => setSearchParams(new URLSearchParams());

  const list = events.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <main className="app-main catalog">
      <h1 className="visually-hidden">События</h1>
      <CatalogFilters params={params} onChange={change} onReset={reset} />
      {events.isError ? (
        <ErrorBanner title="Не удалось загрузить события">{errorText(events.error)}</ErrorBanner>
      ) : events.isPending ? (
        <div className="catalog__grid" aria-busy="true" aria-label="Загрузка событий">
          {[0, 1, 2].map((i) => (
            <span key={i} className="skeleton skeleton--card" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__icon">
            <Icon name="search" />
          </span>
          <p className="empty-state__title">Ничего не нашлось</p>
          <button className="button button--secondary" type="button" onClick={reset}>
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <>
          <div className="catalog__grid" aria-busy={events.isPlaceholderData}>
            {list.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
          {events.hasNextPage && (
            <button
              className="button button--secondary catalog__more"
              type="button"
              disabled={events.isFetchingNextPage}
              onClick={() => void events.fetchNextPage()}
            >
              {events.isFetchingNextPage ? "Загружаем…" : "Показать ещё"}
            </button>
          )}
        </>
      )}
    </main>
  );
}
