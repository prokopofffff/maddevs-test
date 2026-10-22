import { catalogQuerySchema } from "@app/api/schemas";
import type { z } from "zod";

/**
 * Фильтры каталога в том виде, в каком они живут в адресе и уходят в API: строками (D-061).
 * Это вход схемы, а не её выход: `maxAge` здесь `"12"`, а не `12`, и умолчания не применены.
 */
export type CatalogParams = z.input<typeof catalogQuerySchema>;

/** Ключи, которые живут в адресе страницы. `tz` и `cursor` — служебные: их добавляет запрос, в ссылку они не попадают. */
const URL_KEYS = ["q", "when", "hasSeats", "format", "city", "category", "maxAge"] as const satisfies readonly (keyof CatalogParams)[];

/**
 * Читает фильтры из адреса. Значение, которое схема API не пропустит, молча отбрасывается:
 * от ссылки, правленной руками, каталог не должен получать `400` (D-062).
 */
export function parseCatalogParams(sp: URLSearchParams): CatalogParams {
  const params: Record<string, string> = {};
  for (const key of URL_KEYS) {
    const value = sp.get(key);
    // Схему берём ту же, что у сервера, чтобы правила не разошлись; сохраняем исходную строку, а не результат разбора.
    if (value !== null && value.trim() !== "" && catalogQuerySchema.shape[key].safeParse(value).success) params[key] = value;
  }
  return params as CatalogParams;
}

/** Собирает адрес из фильтров: без `tz` и `cursor`, а `when=upcoming` опускается как значение по умолчанию. */
export function toSearchParams(params: Partial<CatalogParams>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const key of URL_KEYS) {
    const value = params[key];
    if (value === undefined || value === "" || (key === "when" && value === "upcoming")) continue;
    sp.set(key, value);
  }
  return sp;
}
