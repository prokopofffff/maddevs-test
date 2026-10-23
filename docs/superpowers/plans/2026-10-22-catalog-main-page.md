# Каталог на главной и вход участника — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` становится каталогом событий с поиском и фильтрами. У события появляются формат, город, адрес, категория и возраст по шкале. Участник входит по коду на email, видит свои регистрации и регистрируется без кода.

**Architecture:** Hono API (`apps/api`) получает три модуля:
- `domain/catalog.ts` — каталог;
- `auth/participant-session.ts` и `routes/participant.ts` — вход участника;
- `registerSignedIn` в `domain/registrations.ts` — регистрация без кода.

Регистрация без кода идёт через тот же `allocate` под блокировкой события. React-фронт (`apps/web`) получает общую шапку `PublicHeader`, страницы `CatalogPage` и `MyRegistrationsPage` и правки страницы события и формы организатора. Схемы zod живут в `apps/api/src/schemas` и общие для API и фронта (D-024).

**Tech Stack:** Node 22, pnpm, Hono, Drizzle 0.45 на postgres.js, zod 4, Vite + React, React Router, TanStack Query, react-hook-form, Vitest на настоящем Postgres, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-catalog-main-page-design.md` — дизайн, разделы ниже ссылаются на него как «дизайн §N». Контракт системы — `docs/SPEC.md`.

## Global Constraints

- Журнал по `CLAUDE.md`:
  - каждый коммит с кодом несёт запись в `docs/DEVLOG.md`;
  - время записи берётся из `date "+%Y-%m-%d %H:%M %z"`;
  - в записи «Проверка: <команда> → <результат>».
- Расхождение кода с `docs/SPEC.md` правится в том же коммите (D-036, D-038).
- Интерфейс только на русском. Стили — классы и токены `apps/web/src/styles/template.css`, без UI-кита (D-025).
- Точки тестирования — только тестовая сборка `testApp()` и Playwright (D-041). Новые тесты пишутся до кода, первый прогон красный.
- Email везде нормализуется `emailSchema` (`trim().toLowerCase()`).
- Значения из дизайна, дословно:
  - формат `offline` | `online`;
  - категории `meetup` | `workshop` | `lecture` | `conference` | `game` | `other` (митап, воркшоп, лекция, конференция, игра, другое);
  - шкала возраста `0, 6, 12, 16, 18`;
  - город 1–100 символов, адрес 1–300;
  - страница каталога 24 события;
  - сессия участника 30 дней;
  - код входа 10 минут, 5 попыток, не чаще раза в минуту.
- Rate limit: новые действия участника (`POST /participant/verifications`, `…/confirm`, `POST /events/:id/registrations`) идут в корзину `limits.public` (D-006).
- Команды: `pnpm --filter @app/api test` (нужен `docker compose up -d` или `pnpm dev`; при сдвинутом порте — `TEST_DATABASE_URL`), `pnpm typecheck`, `pnpm lint`, `pnpm e2e`.

## Review Focus

1. **`minAge = 0` в JSX.** Сейчас бейдж рисуется как `{e.minAge && <…/>}`, и при 0 React выведет «0». Все такие места переходят на `<AgeBadge minAge={…} />`, а он рисует «0+» явно. Тест — e2e шага каталога (Task 12): у события 0+ на странице есть бейдж «0+» и нет одинокой «0».
2. **Код `login` на старом `confirm`.** `POST /verifications/:id/confirm` с id кода `login` не должен дойти до `allocate` с `event_id = null`. Ожидается `404 not_found`. Обратный случай: код `register` на `/participant/verifications/:id/confirm` тоже даёт `404`. Тест — в Task 6.
3. **`default` в zod и `partial()`.** В zod 4 `.default()` срабатывает и внутри `.partial()`. Если поставить `minAge: ….default(0)`, каждый PATCH будет обнулять возраст. Умолчание ставится в маршруте: `input.minAge ?? 0`. Тест — в Task 1: PATCH только `title` у события 18+ оставляет `minAge: 18`.
4. **Спецсимволы и регистр в поиске.** `q="100%"` не должен совпадать со всем подряд, `q="ПОСТГРЕС"` должен находить «Постгрес». Тест — в Task 3.
5. **Курсор на равных `starts_at`.** Два события в одну минуту на границе страницы не должны дублироваться или теряться. Битый курсор даёт `400 validation_failed`, а не 500. Тест — в Task 3.

---

### Task 0: Решения и спецификация

**Files:**
- Modify: `docs/DECISIONS.md` (в конец), `docs/SPEC.md`, `docs/DEVLOG.md`

**Interfaces:** Produces: номера D-056 … D-061, на них ссылаются комментарии кода и DEVLOG следующих задач.

- [ ] **Step 1: Записать D-056 … D-061** по формату `CLAUDE.md`. Время — `date`. Контекст, «Выбрали» и альтернативы берутся из дизайна, в «Выбрали» помечается «(выбор пользователя)» или «(решено агентом)», как в дизайне.
  - D-056 — публичный каталог на `/`, в нём все события. Снимает «вне рамок» из SPEC §0. Альтернатива: флаг «показывать в каталоге».
  - D-057 — вход участника: код на email, своя таблица `participant_sessions` и cookie `psid`, без строки в `users`. Уточняет D-007. Альтернативы: роль `participant` в `users`; magic link.
  - D-058 — регистрация без кода под сессией участника, предзаполнение из последней регистрации, `myRegistration` на странице события.
  - D-059 — формат, город, адрес и категория события. Город и адрес — свободный текст, известная проблема из DEVLOG 21:17. Адрес попадает в письма. Ссылки на трансляцию нет. Альтернативы: справочник городов, геокодинг.
  - D-060 — шкала возраста 0/6/12/16/18 вместо 1–120, 0 вместо `null`, миграция округляет вверх. Уточняет D-008. Альтернатива: шкала только в фильтре.
  - D-061 — каталог API:
    - `ILIKE` с экранированием;
    - «сегодня» и «на неделе» в поясе посетителя;
    - курсор `(starts_at, id)`, 24 на страницу;
    - фильтры в query-параметрах адреса.

    Альтернативы: `tsvector`, `pg_trgm`, номера страниц.
- [ ] **Step 2: Править `docs/SPEC.md`:**
  - §0 — убрать «публичный каталог» из «вне рамок» и добавить «ссылка на трансляцию, справочник городов, геокодинг»;
  - §2 — колонки `events`, `participant_sessions`, `purpose = login`, `event_id null`;
  - §4 — новые маршруты (дизайн §7);
  - §5 — письмо `login_code` и строка места;
  - §8 — экраны `/`, `/me` и правки `/e/:id`, `/organizer/events/new|edit`, `/login`.

  Правила утвердительные, со ссылками `(D-0xx)`, без мотивировки (D-036).
- [ ] **Step 3: DEVLOG и коммит**

```bash
git add docs/DECISIONS.md docs/SPEC.md docs/DEVLOG.md
git commit -m "Решения D-056–D-061 и спецификация каталога и входа участника"
```

---

### Task 1: Поля события и шкала возраста в API

**Files:**
- Modify: `apps/api/src/schemas/event.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/domain/age.ts`, `apps/api/src/domain/events.ts` (`updateEvent`), `apps/api/src/domain/verifications.ts:26`, `apps/api/src/routes/organizer.ts` (`organizerEvent`, `POST /events`), `apps/api/src/routes/public.ts` (`GET /events/:id`), `apps/api/src/routes/support.ts:63`, `apps/api/src/seed/demo.ts`
- Create: `apps/api/drizzle/0004_event_catalog_fields.sql` (через `db:generate`, затем ручная правка), `apps/api/test/integration/event-fields.test.ts`, `apps/api/test/integration/migration-age-scale.test.ts`
- Modify tests: `apps/api/test/support/organizer.ts` (`eventInput`), `e2e/support/setup.ts` (`createEvent`), `apps/api/test/integration/public-event.test.ts`, `organizer-event-edit.test.ts`, `organizer-events.test.ts`, `support.test.ts:403`, `demo-seed.test.ts:48`

**Interfaces:**
- Produces (в `apps/api/src/schemas/event.ts`, без серверных импортов):
  ```ts
  export const EVENT_FORMATS = ["offline", "online"] as const;
  export const EVENT_CATEGORIES = ["meetup", "workshop", "lecture", "conference", "game", "other"] as const;
  export const AGE_RATINGS = [0, 6, 12, 16, 18] as const;
  export type EventFormat = (typeof EVENT_FORMATS)[number];
  export type EventCategory = (typeof EVENT_CATEGORIES)[number];
  export type AgeRating = (typeof AGE_RATINGS)[number];
  ```
- Produces: в `EventRow` появляются `format`, `city: string | null`, `address: string | null`, `category`, `minAge: number`.
- Produces: тело `GET /api/events/:id` = `{id, title, description, startsAt, timezone, format, city, address, category, minAge, freeSeats, started}`. Организаторское `organizerEvent` и `GET /support/events` получают те же четыре поля.
- Produces: `eventInput()` в тестах по умолчанию передаёт `format: "offline", city: "Новосибирск", address: "Красный проспект, 1", category: "meetup"`.

- [ ] **Step 1: Написать падающие тесты `event-fields.test.ts`**

```ts
it("офлайн-событие сохраняет город и адрес, пробелы в городе схлопываются", async () => {
  // POST eventInput({ city: "  Нижний   Новгород ", minAge: 12 }) → 201
  expect(res.body.event).toMatchObject({ format: "offline", city: "Нижний Новгород", address: "Красный проспект, 1", category: "meetup", minAge: 12 });
});
it("офлайн без города или адреса → 400 validation_failed с path city / address", …);
it("онлайн: город и адрес не нужны и не сохраняются", async () => {
  // POST eventInput({ format: "online", city: undefined, address: undefined }) → city: null, address: null
});
it("minAge вне шкалы (14, 21, -1) → 400; без minAge → 0", …);
it("PATCH format: online обнуляет город и адрес; PATCH только title не трогает minAge 18", …); // Review Focus 3
it("PATCH format: offline у онлайн-события без city/address → 400 validation_failed", …);
it("категория вне перечня → 400", …);
```

Сначала обновляются `eventInput()` и `e2e/support/setup.ts` (тот же набор полей), затем существующие тесты:
- `organizer-event-edit.test.ts`: `minAge: 21` → `16`, `minAge: null` → `0`;
- `support.test.ts:403`: `minAge: null` → `0`;
- `public-event.test.ts`: в `toEqual` добавляются четыре поля;
- `demo-seed.test.ts:48`: `minAge !== null` → `minAge > 0`.

- [ ] **Step 2: Запустить и увидеть красное**

Run: `pnpm --filter @app/api test event-fields public-event organizer-event-edit`
Expected: FAIL (поля не сохраняются, `minAge: 21` уже не проходит).

- [ ] **Step 3: Схемы zod**
  - В `eventInputSchema`:
    - `format: z.enum(EVENT_FORMATS)`;
    - `category: z.enum(EVENT_CATEGORIES)`;
    - `city: z.string().transform(s => s.replace(/\s+/g, " ").trim()).pipe(z.string().min(1).max(100)).nullish()`;
    - `address: z.string().trim().min(1).max(300).nullish()`;
    - `minAge: z.literal(AGE_RATINGS).optional()` — без `.default` (Review Focus 3).
  - `superRefine` на полной схеме: у `offline` нет `city` → issue `{path: ["city"], message: "required"}`, то же для `address`.
  - `eventPatchSchema = eventInputSchema` без refine, `.partial()`. Проверка пары делается в `updateEvent` по слитым значениям.
- [ ] **Step 4: Схема БД и миграция.** В `events`:
  - `format: text("format", { enum: EVENT_FORMATS }).notNull()`;
  - `city`, `address` — `text`;
  - `category: text("category", { enum: EVENT_CATEGORIES }).notNull()`;
  - `minAge: integer("min_age").notNull().default(0)`;
  - check `events_min_age_check`: `min_age in (0, 6, 12, 16, 18)`;
  - check `events_place_check`: `(format = 'offline' and city is not null and address is not null) or (format = 'online' and city is null and address is null)`;
  - индекс `events_starts_idx (starts_at, id)`;
  - индекс `events_city_idx` по `lower(city)`.

  Run: `pnpm --filter @app/api db:generate --name event_catalog_fields`. Затем SQL правится руками, порядок такой:
  1. колонки добавляются `null`able;
  2. `update events set format = 'online', category = 'other'`;
  3. `set not null`;
  4. `drop constraint events_min_age_check`;
  5. `update events set min_age = case when min_age is null then 0 when min_age <= 6 then 6 when min_age <= 12 then 12 when min_age <= 16 then 16 else 18 end`;
  6. `set default 0`, `set not null`, новые check и индексы.
- [ ] **Step 5: Тест миграции `migration-age-scale.test.ts`**
  - Тест создаёт свою базу `app_test_migration_${VITEST_POOL_ID}`.
  - Копирует `apps/api/drizzle` во временную папку и оставляет в `meta/_journal.json` первые четыре записи.
  - Делает `migrate` по ней, вставляет пользователя и события с `min_age` `null`, 1, 14, 18, 21.
  - Делает `migrate` по настоящей папке.
  - Проверка: `min_age` = 0, 6, 16, 18, 18; у всех `format = 'online'`, `category = 'other'`, `city is null`.
- [ ] **Step 6: Домен и маршруты**
  - `belowMinAge`: `event.minAge > 0 && …`.
  - `verifications.ts:26`: `minAge: event.minAge` без `!`.
  - `POST /organizer/events` пишет новые поля, `minAge: input.minAge ?? 0`. У `online` `city` и `address` — `null`.
  - `updateEvent`: слитый `format`. Если он `online` — `city`/`address` равны `null`. Если `offline` и после слияния нет `city` или `address` — `{ error: "place_required", fields: ("city" | "address")[] }`. Маршрут отвечает `400 validation_failed` с `issues: fields.map(path => ({ path, message: "required" }))`.
  - `GET /events/:id`, `organizerEvent`, `GET /support/events` отдают поля.
- [ ] **Step 7: Сид.** Пять событий получают значения из дизайна §10:

| Событие | Категория | Формат и место | Возраст |
|---|---|---|---|
| Митап | `meetup` | `online` | 12 |
| Воркшоп | `workshop` | Новосибирск, «ул. Ленина, 12, коворкинг «Точка»» | 0 |
| Конференция | `conference` | Новосибирск, «Технопарк, ул. Николаева, 12» | 0 |
| Квиз | `game` | Москва, «Бар «Синица», Покровка, 17» | 18 |
| Лекция | `lecture` | Новосибирск, «НГУ, Пирогова, 1, ауд. 313» | 0 |

- [ ] **Step 8: Прогон**

Run: `pnpm --filter @app/api test` → все зелёные. `pnpm typecheck` падает только в `apps/web` (фронт правится в Task 2) — это допустимо только внутри ветки до Task 2. Если CI запускается на каждый PR, Task 1 и Task 2 идут одним PR.

- [ ] **Step 9: DEVLOG, SPEC (если расходится), коммит**

```bash
git commit -m "Формат, город, адрес, категория и шкала возраста у события (D-059, D-060)"
```

---

### Task 2: Поля события во фронте

**Files:**
- Create: `apps/web/src/components/AgeBadge.tsx`
- Modify: `apps/web/src/format.ts`, `apps/web/src/pages/EventFormPage.tsx`, `PublicEventPage.tsx:143`, `EventAdminPage.tsx:55`, `support/SupportEventPage.tsx:33`, `CheckinPage.tsx:178`, `admin/ParticipantList.tsx:37` (`minAge: number`), `SupportPage.tsx:139`

**Interfaces:**
- Consumes: `EVENT_CATEGORIES`, `AGE_RATINGS`, `EventFormat` из `@app/api/schemas`.
- Produces (в `apps/web/src/format.ts`):
  - `categoryLabel: Record<EventCategory, string>` («Митап», «Воркшоп», «Лекция», «Конференция», «Игра», «Другое»);
  - `placeText(e: { format: EventFormat; city: string | null }): string` — `"Онлайн"` или город;
  - `fullPlace(e: { format; city; address }): string` — `"Онлайн"` или `"Новосибирск, ул. Ленина, 12"`.
- Produces: `<AgeBadge minAge={number} />` всегда рисует `<span className="badge badge--age">{minAge}+</span>`.

- [ ] **Step 1: `AgeBadge` и замена всех `{x.minAge && …}`.** В `CheckinPage` и `SupportPage` предупреждение остаётся только при `minAge > 0` — сравнение явное, не по истинности (Review Focus 1).
- [ ] **Step 2: Форма организатора**
  - «Формат» — две радиокнопки без выбранного значения по умолчанию.
  - «Город» и «Адрес» — видны и обязательны только при «Офлайн».
  - «Категория» — `<select>` с пустым первым пунктом «Выберите категорию».
  - «Возрастное ограничение» — `<select>` из `AGE_RATINGS`, по умолчанию 0+.
  - Ошибки `validation_failed` с `path` `city`/`address` показываются под полями.
  - Подсказка D-017 о возрасте остаётся.
- [ ] **Step 3: Страница события `/e/:id`** — под временем строка категории и `fullPlace`.
- [ ] **Step 4: Проверка**

Run: `pnpm typecheck && pnpm lint` → без ошибок. `pnpm e2e` → четыре существующих сценария зелёные.

Вручную через `pnpm dev` и сид:
- создать офлайн-событие → город и адрес видны на `/e/:id`;
- переключить на онлайн → поля скрыты, после сохранения на странице «Онлайн».

Скриншот формы — в `.context/`.

- [ ] **Step 5: DEVLOG, коммит** `"Форма и страница события: формат, место, категория, бейдж возраста 0+"`

---

### Task 3: Каталог API

**Files:**
- Create: `apps/api/src/schemas/catalog.ts`, `apps/api/src/domain/catalog.ts`, `apps/api/test/integration/catalog.test.ts`
- Modify: `apps/api/src/schemas/index.ts`, `apps/api/src/routes/public.ts`

**Interfaces:**
- Produces (`schemas/catalog.ts`):
  ```ts
  export const catalogQuerySchema = z.object({
    q: z.string().trim().max(100).optional(),
    when: z.enum(["upcoming", "past", "today", "week"]).default("upcoming"),
    tz: z.string().refine(isTimezone).default("UTC"),
    hasSeats: z.literal("1").optional(),
    format: z.enum(EVENT_FORMATS).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    category: z.enum(EVENT_CATEGORIES).optional(),
    maxAge: z.enum(["0", "6", "12", "16", "18"]).transform(Number).optional(),
    cursor: z.string().optional(),
  });
  export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
  ```
  `isTimezone(tz: string): boolean` экспортируется из `schemas/event.ts` (множество поясов уже там) и используется в `eventInputSchema` вместо локального `refine`.
- Produces (`domain/catalog.ts`):
  - `listCatalog(db: Queryable, query: CatalogQuery, now: Date): Promise<{ events: CatalogEvent[]; nextCursor: string | null } | { error: "invalid_cursor" }>`;
  - `catalogCities(db: Queryable, now: Date): Promise<string[]>`;
  - `type CatalogEvent = { id; title; startsAt: string; timezone; format; city; category; minAge; freeSeats: number; started: boolean }`.
- Produces: маршруты `GET /api/events` и `GET /api/events/cities`. `/events/cities` объявляется до `/events/:id`.

- [ ] **Step 1: Падающие тесты `catalog.test.ts`.** События создаются через `createEvent(t, {...})`, часы — `testApp({ now: "2026-11-01T09:00:00Z" })`.

```ts
it("по умолчанию — только предстоящие, по возрастанию начала; прошедшие — по убыванию", …);
it("ответ не содержит email, имён, адреса и описания", async () => {
  expect(Object.keys(res.body.events[0]).sort()).toEqual(
    ["category", "city", "format", "freeSeats", "id", "minAge", "startsAt", "started", "timezone", "title"]);
});
it("q ищет в названии и описании без учёта регистра; '100%' и '_' не работают как шаблон", …); // Review Focus 4
it("today и week — в поясе tz: событие в 23:30 по Asia/Novosibirsk попадает в today для tz=Asia/Novosibirsk и не попадает для tz=Europe/London", …);
it("hasSeats=1 исключает заполненное и событие с листом ожидания", …);
it("format, city (без учёта регистра), category, maxAge=12 (0+, 6+, 12+ да; 16+ нет) — по одному и вместе", …);
it("курсор: 30 событий, 5 из них в одну минуту на границе — две страницы 24 + 6 без дублей и пропусков", …); // Review Focus 5
it("битый курсор → 400 validation_failed", …);
it("cities: города предстоящих офлайн-событий без учёта регистра, по алфавиту, написание самого раннего", …);
```

- [ ] **Step 2: Красное** — `pnpm --filter @app/api test catalog` → FAIL 404.
- [ ] **Step 3: `listCatalog`**
  - Один `select` из `events` с условиями.
  - `when`: `upcoming`/`today`/`week` — `starts_at > now`; `past` — `starts_at <= now`. Верхняя граница `today` — начало следующего дня в `tz`, `week` — начало дня `today + 7` в `tz` (`TZDate` из `@date-fns/tz`, `startOfDay`, `addDays`).
  - `q`: `or(ilike(title, p), ilike(description, p))`, где `p = '%' + q.replace(/[\\%_]/g, "\\$&") + '%'`.
  - `hasSeats`: `seat_limit > (select count(*) … status = 'confirmed') and not exists (… status = 'waitlisted')`.
  - `city`: `lower(city) = lower($1)`.
  - `maxAge`: `min_age <= $1`.
  - Курсор — `base64url(JSON.stringify([startsAtIso, id]))`. Условие `(starts_at, id) > (…)` для возрастания, `<` для `past`. Порядок `starts_at, id` в ту же сторону.
  - `limit 25`: 25-я строка означает, что есть `nextCursor`.
  - `freeSeats` и счётчики — существующие `countsFor` + `freeSeats` (D-026).
- [ ] **Step 4: `catalogCities`** — `select distinct on (lower(city)) city … where format = 'offline' and starts_at > now order by lower(city), starts_at`, затем сортировка `localeCompare(…, "ru")`.
- [ ] **Step 5: Зелёное** — `pnpm --filter @app/api test` → PASS.
- [ ] **Step 6: DEVLOG, коммит** `"Каталог API: поиск, фильтры, курсор (D-061)"`

---

### Task 4: Общая шапка и каталог на `/`

**Files:**
- Create: `apps/web/src/components/PublicHeader.tsx`, `apps/web/src/pages/CatalogPage.tsx`, `apps/web/src/pages/catalog/CatalogFilters.tsx`, `apps/web/src/pages/catalog/EventCard.tsx`, `apps/web/src/pages/catalog/query.ts`
- Modify: `apps/web/src/main.tsx` (`/` → `CatalogPage`), `apps/web/src/styles/app.css`, `apps/web/src/pages/AuthPage.tsx` (ссылка «← Все события» на `/`), `PublicEventPage.tsx` и `MyRegistrationPage.tsx` (`<Brand />` → `<PublicHeader />`)

**Interfaces:**
- Consumes: `GET /api/events`, `GET /api/events/cities` (Task 3), `useMe()` из `session.ts`, `categoryLabel`, `placeText`, `AgeBadge` (Task 2).
- Produces:
  - `parseCatalogParams(sp: URLSearchParams): CatalogQuery`;
  - `toSearchParams(q: Partial<CatalogQuery>): URLSearchParams` (без `tz` и `cursor`, `when=upcoming` опускается);
  - `<PublicHeader />` без пропсов. Читает `useMe()`, а с Task 7 ещё и `useParticipant()`. До Task 7 участника нет: только «Мои регистрации» ссылкой на `/me` и «Организаторам» / кабинет.

- [ ] **Step 1: `PublicHeader`** по таблице дизайна §8.1.
  - «Мои регистрации» есть всегда: `<Link className="button button--secondary button--sm" to="/me">`.
  - Гость видит «Организаторам» → `/login`, кнопка `button--primary`.
  - Организатор видит «Мои события» → `/organizer`, поддержка — «Поддержка» → `/support`, плюс `email · Выйти` (как в `AccountLayout`).
- [ ] **Step 2: `CatalogPage`**
  - Состояние — `useSearchParams`.
  - Поле поиска с задержкой 300 мс пишет `q` с `replace: true`.
  - Чипы: «Предстоящие» / «Прошедшие» — взаимоисключающие; «Сегодня», «На неделе» — тоже взаимоисключающие, при «Прошедших» `disabled`; «Есть места»; «Офлайн» / «Онлайн» — повторное нажатие снимает.
  - Выпадающие: город из `/events/cities`, категория, возраст («Любой», «0+», «до 6+», «до 12+», «до 16+», «до 18+»).
  - «Сбросить» очищает параметры.
  - `useInfiniteQuery` с ключом `["catalog", query]`, в запрос добавляется `tz: Intl.DateTimeFormat().resolvedOptions().timeZone`. «Показать ещё» — `fetchNextPage`.
  - Пустое состояние: «Ничего не нашлось» и кнопка «Сбросить фильтры».
- [ ] **Step 3: `EventCard`**
  - строка `categoryLabel · placeText`;
  - название;
  - `formatEventTime`;
  - плашка: `started` → «Регистрация закрыта», `freeSeats > 0` → `seatsLeft(n)`, иначе «Лист ожидания»;
  - `AgeBadge`.

  Вся карточка — `<Link to={`/e/${id}`}>`. Сетка `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`, на 375 px — одна колонка.
- [ ] **Step 4: Проверка**

Run: `pnpm typecheck && pnpm lint` → чисто.

Вручную через `pnpm dev` и сид:
- `/` показывает четыре предстоящих события;
- «Прошедшие» — конференцию;
- «Город: Москва» — квиз;
- «до 12+» скрывает квиз;
- ссылка `/?city=Москва` после перезагрузки сохраняет фильтр;
- `/login` по-прежнему ведёт в кабинет.

Скриншоты 1280 и 375 px — в `.context/`.

- [ ] **Step 5: DEVLOG, коммит** `"Главная — каталог событий, общая шапка (D-056)"`

---

### Task 5: Код входа участника и сессия (API)

**Files:**
- Create: `apps/api/src/auth/participant-session.ts`, `apps/api/src/domain/participant-login.ts`, `apps/api/src/mail/templates/login-code.ts`, `apps/api/src/routes/participant.ts`, `apps/api/drizzle/0005_participant_login.sql`, `apps/api/test/integration/participant-login.test.ts`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/domain/verifications.ts`, `apps/api/src/http.ts` (`participantEmail: string` в `Variables`), `apps/api/src/app.ts` (route и rate limit), `apps/api/test/support/mailbox.ts` (`lastCode(to, kind = "code")`), `apps/api/test/support/participant.ts`

**Interfaces:**
- Produces (`schema.ts`):
  - `participantSessions` (`idHash` PK, `email`, `createdAt`, `expiresAt`);
  - у `emailVerifications`: `eventId` без `.notNull()`, `purpose` с enum `["register", "lookup", "login"]`;
  - check `email_verifications_event_check`: `(purpose = 'login') = (event_id is null)`;
  - индекс `email_verifications_login_idx (email, created_at desc) where purpose = 'login'`.
- Produces (`verifications.ts`): `checkCode(tx: Tx, id: number, code: string, now: Date): Promise<{ verification: Verification } | { error: "not_found" | "code_expired" | "code_attempts_exceeded" } | { error: "code_invalid"; attemptsLeft: number }>`. Это вынесенные из `confirmVerification` проверки «нет кода / истёк / попытки кончились / неверный код (+1 попытка)» под `FOR UPDATE`. `confirmVerification` вызывает его и отвечает `not_found`, если `purpose === "login"` (Review Focus 2).
- Produces (`participant-session.ts`):
  - `PARTICIPANT_COOKIE = "psid"`;
  - `createParticipantSession(db, email, now): Promise<string>`;
  - `findParticipantEmail(db, id, now): Promise<string | undefined>`;
  - `deleteParticipantSession(db, id)`;
  - `read/write/clearParticipantCookie(c, …)` — по образцу `auth/session.ts`, тот же SHA-256 и TTL 30 дней.
- Produces (`routes/participant.ts`):
  - `requireParticipant` — middleware, кладёт `c.var.participantEmail`, без сессии `401 unauthorized`;
  - `optionalParticipant` — то же без 401.
- Produces (`domain/participant-login.ts`):
  - `issueLoginCode(db, email, ctx: MailContext): Promise<{ verification; resendAfter: Date } | { error: "code_resend_too_soon"; retryAfter: number }>`;
  - `confirmLoginCode(db, id, code, now): Promise<{ email: string } | <ошибки checkCode>>`.
- Produces: маршруты `POST /api/participant/verifications {email}`, `POST /api/participant/verifications/:id/confirm {code}`, `GET /api/participant/me`, `POST /api/participant/logout` — тела по дизайну §7.2. `lastData` — последняя по `created_at` регистрация этого email или `null`.
- Produces (тестовые хелперы `participant.ts`): `signInParticipant(t: TestApp, email = "anna@example.com"): Promise<Client>` — код, письмо, ввод, возвращает клиента с cookie.

- [ ] **Step 1: Падающие тесты `participant-login.test.ts`**

```ts
it("код уходит на email без регистраций; после кода cookie psid и /participant/me → {email, lastData: null}", …);
it("lastData — из последней регистрации этого email", …);
it("повтор раньше минуты → 429 code_resend_too_soon {retryAfter}; через минуту — новый код гасит прежний", …);
it("пять неверных кодов → code_attempts_exceeded; истёкший через 10 минут → 410 code_expired", …);
it("код login на /api/verifications/:id/confirm → 404; код register на /participant/verifications/:id/confirm → 404", …); // Review Focus 2
it("logout удаляет сессию: /participant/me → 401", …);
it("сессия участника не открывает /organizer/events и /support/corrections (401)", …);
it("письмо login_code: тема «Код для входа: NNNNNN», в тексте «10 минут»", …);
```

- [ ] **Step 2: Красное** — `pnpm --filter @app/api test participant-login` → FAIL.
- [ ] **Step 3: Схема и миграция**
  - Run: `pnpm --filter @app/api db:generate --name participant_login`.
  - Проверить, что SQL снимает `not null` с `event_id` и добавляет check и таблицу.
- [ ] **Step 4: Реализация** по Interfaces.
  - Лимит раз в минуту для `login` — по `(email, purpose = 'login')`.
  - Гашение прежних — у кодов `login` того же email.
  - Письмо — `enqueue(tx, { dedupKey: \`login_code:${id}\`, kind: "login_code", to, ...loginCodeMail({ code }) }, now)`, затем `outbox.wake()`.
  - Шаблон — по образцу `code.ts`, без `eventBlock`, заголовок «Вход в «Мои регистрации»».
  - В `app.ts`: `.use("/participant/verifications", limits.public)`, `.use("/participant/verifications/:id/confirm", limits.public)`, `.route("/participant", participantRoutes)` до `.route("/", publicRoutes)`.
- [ ] **Step 5: Зелёное** — `pnpm --filter @app/api test` → PASS.
- [ ] **Step 6: DEVLOG, коммит** `"Вход участника по коду на email (D-057)"`

---

### Task 6: Мои регистрации (API)

**Files:**
- Create: `apps/api/test/integration/participant-registrations.test.ts`
- Modify: `apps/api/src/domain/registrations.ts`, `apps/api/src/routes/participant.ts`, `apps/api/src/db/schema.ts` (индекс `registrations_email_created_idx (email, created_at desc)`), миграция `0006_registrations_email_idx.sql`

**Interfaces:**
- Produces: `participantRegistrations(db: Queryable, email: string, now: Date): Promise<ParticipantRegistration[]>`, где

  ```ts
  type ParticipantRegistration = {
    token: string;
    status: "confirmed" | "waitlisted" | "cancelled";
    waitlistPosition?: number;
    ticketCode: string | null;
    checkedInAt: string | null;
    cancelledAt: string | null;
    event: { id; title; startsAt; timezone; format; city; started };
  };
  ```

  `ticketCode` — только у `confirmed` (как в `GET /registrations/:token`). Порядок — по `events.starts_at` возрастанию; деление на вкладки — на фронте.
- Produces: `GET /api/participant/registrations` → `200 {registrations}`.

- [ ] **Step 1: Падающие тесты**

```ts
it("отдаёт только регистрации своего email, включая отменённые и повторную после отказа (две строки)", …);
it("у листа ожидания — текущий номер; у отменённой ticketCode null; started по часам", …);
it("без сессии → 401", …);
```

- [ ] **Step 2: Красное → реализация → зелёное** (`pnpm --filter @app/api test participant-registrations`).
- [ ] **Step 3: DEVLOG, коммит** `"Список регистраций участника (D-057)"`

---

### Task 7: Страница `/me` и шапка с участником

**Files:**
- Create: `apps/web/src/participant.ts`, `apps/web/src/pages/MyRegistrationsPage.tsx`, `apps/web/src/pages/me/ParticipantLogin.tsx`, `apps/web/src/pages/me/RegistrationRow.tsx`
- Modify: `apps/web/src/main.tsx` (маршрут `/me`), `apps/web/src/components/PublicHeader.tsx`, `apps/web/src/errors.ts` (если нужен текст для `unauthorized`)

**Interfaces:**
- Produces (`participant.ts`):
  - `participantKey = ["participant"] as const`;
  - `useParticipant()` — `{ email, lastData } | null` (401 → `null`, `staleTime: Infinity`, как `useMe`);
  - `safeNext(next: string | null): string` — путь, если начинается с одного `/` и не с `//`, иначе `"/me"`.
- Consumes: `CodeStep` (`pages/event/CodeStep.tsx`, пропсы `email, resendAt, confirming, confirmError, resending, resendError, onConfirm, onResend, onBack`), маршруты Task 5 и 6.

- [ ] **Step 1: `ParticipantLogin`**
  - Шаг email → `POST /participant/verifications`.
  - Затем `CodeStep` → `POST …/confirm`.
  - При успехе `setQueryData(participantKey, …)`, инвалидировать `participantKey`, `navigate(safeNext(searchParams.get("next")))`.
  - Повтор и `code_resend_too_soon` — как на `PublicEventPage`.
- [ ] **Step 2: `MyRegistrationsPage`**
  - Без участника — `ParticipantLogin`.
  - С участником — «Мои регистрации», вкладки «Текущие · N» / «Прошедшие · N».
  - Деление: текущие — `!event.started && status !== "cancelled"`, по возрастанию начала. Прошедшие — остальные, по убыванию.
  - Статусы строки — таблица дизайна §8.3, классы `badge`. «Открыть» → `/r/:token`.
  - Пустое состояние — «Вы пока никуда не зарегистрированы» и ссылка «Посмотреть события» на `/`.
- [ ] **Step 3: `PublicHeader`** — при участнике `email · Выйти`. «Выйти» → `POST /participant/logout`, `setQueryData(participantKey, null)`. При двух сессиях две пары «email · Выйти» (дизайн §8.1).
- [ ] **Step 4: Проверка**

Run: `pnpm typecheck && pnpm lint`.

Вручную:
- `/me` → `anna.ivanova@example.com` → код из Mailpit → видны текущие («Митап» в листе ожидания или подтверждена) и прошедшие («Конференция» — «Пришли»);
- «Выйти» → снова форма;
- `/me?next=//evil.com` после входа остаётся на `/me`.

Скриншот — в `.context/`.

- [ ] **Step 5: DEVLOG, коммит** `"Страница «Мои регистрации» и вход участника в шапке"`

---

### Task 8: Регистрация без кода (API)

**Files:**
- Create: `apps/api/test/integration/signed-in-registration.test.ts`
- Modify: `apps/api/src/domain/registrations.ts` (`allocate`, новый `registerSignedIn`), `apps/api/src/domain/verifications.ts` (вызов `allocate`), `apps/api/src/routes/public.ts` (`POST /events/:id/registrations`, `myRegistration` в `GET /events/:id`), `apps/api/src/app.ts` (rate limit)

**Interfaces:**
- Produces: `type Applicant = { email: string; firstName: string; lastName: string; birthDate: string }`; `allocate(tx, event, applicant: Applicant, ctx)`. Тело то же, вызов из `confirmVerification` передаёт поля кода с `!`.
- Produces: `registerSignedIn(db: Db, eventId: string, email: string, data: ParticipantData, ctx: MailContext): Promise<AllocateResult | { error: "not_found" | "birth_date_in_future" } | { error: "below_min_age"; minAge: number }>`. Внутри `withTx` → `lockEvent` → `started` → `DomainError("registration_closed")` → `belowMinAge` → `allocate`.
- Produces: `POST /api/events/:id/registrations` (`requireParticipant`, `participantDataSchema`) — ответ как у `confirm` для `register`, ошибки `401`, `404`, `409 registration_closed`, `422 below_min_age {minAge}`, `400 validation_failed`. `GET /api/events/:id` под `optionalParticipant` добавляет `myRegistration: { token, status } | null`; у гостя поля нет.

- [ ] **Step 1: Падающие тесты**

```ts
it("вошедший участник получает место без кода; письмо confirmed уходит, email из сессии", …);
it("мест нет → waitlisted с номером; повтор → existing с тем же token, писем нет", …);
it("младше minAge → 422 below_min_age {minAge: 18}; после начала → 409 registration_closed; без сессии → 401", …);
it("гонка: лимит 1, обычная регистрация по коду и регистрация без кода параллельно → ровно один confirmed", …); // как r3
it("GET /events/:id: у вошедшего с регистрацией — myRegistration {token, status}; у гостя поля нет", …);
```

- [ ] **Step 2: Красное → реализация → зелёное** (`pnpm --filter @app/api test`; весь набор, чтобы R1–R3 не сломались от смены сигнатуры `allocate`).
- [ ] **Step 3: DEVLOG, коммит** `"Регистрация без кода для вошедшего участника (D-058)"`

---

### Task 9: Страница события для вошедшего участника

**Files:**
- Modify: `apps/web/src/pages/PublicEventPage.tsx`, `apps/web/src/pages/event/RegistrationForm.tsx`

**Interfaces:**
- Consumes: `useParticipant()` (Task 7), `POST /api/events/:id/registrations`, `myRegistration` (Task 8).
- Produces:
  - `RegistrationForm` получает `lockedEmail?: string`: поле email заменяется текстом «Регистрируем на {email}», схема — `participantDataSchema`;
  - `onSubmit` при `lockedEmail` отдаёт `ParticipantData`.

- [ ] **Step 1:** Ключ запроса события включает `participant?.email`, чтобы `myRegistration` перечитывался после входа и выхода.
- [ ] **Step 2: Участник вошёл**
  - `myRegistration` есть → панель «Вы уже зарегистрированы» и `Link` на `/r/:token`.
  - Нет → `RegistrationForm lockedEmail` с `initial` из `lastData` → мутация `POST …/registrations` → `RegistrationResult`.
  - «Уже регистрировались?» скрыто.
- [ ] **Step 3: Гость** — как раньше. Под формой ссылка «Войти, чтобы регистрироваться без кода» → `/me?next=/e/:id`.
- [ ] **Step 4: Проверка**

Run: `pnpm typecheck && pnpm lint && pnpm e2e` → четыре старых сценария зелёные.

Вручную: вошёл → «Лекция» → форма с подставленным именем → «Место ваше» → `/me` показывает её.

- [ ] **Step 5: DEVLOG, коммит** `"Страница события: регистрация без кода и ссылка на свою регистрацию"`

---

### Task 10: Место события в письмах

**Files:**
- Modify: `apps/api/src/mail/templates/layout.ts` (`eventBlock`), `confirmed.ts`, `promoted.ts`, `reminder.ts`, `rescheduled.ts`, места вызова в `domain/registrations.ts`, `domain/events.ts`, `domain/reminders.ts`
- Create: `apps/api/test/integration/mail-place.test.ts`

**Interfaces:**
- Produces:
  - `placeLine(event: { format: EventFormat; city: string | null; address: string | null }): string` в `layout.ts` — `"Онлайн"` или `"Новосибирск, Красный проспект, 1"`;
  - `eventBlock(title, time, note?, place?)`.
- Produces: тип `event` в `ConfirmedMail` и трёх соседних шаблонах расширяется до `{ title; startsAt; timezone; format; city; address }`. В тексте письма строка места идёт сразу после времени.

- [ ] **Step 1: Падающий тест.**
  - Офлайн-событие → регистрация → `runJobs` → письмо `confirmed` содержит «Новосибирск, Красный проспект, 1» в `text` и `html`.
  - Онлайн-событие → «Онлайн».
  - Перенос → в письме `rescheduled` есть строка места.
  - Повышение → строка места есть в `promoted`.
  - Напоминание → строка места есть в `reminder`.
- [ ] **Step 2: Красное → реализация → зелёное** (`pnpm --filter @app/api test`).
- [ ] **Step 3: DEVLOG, коммит** `"Место события в письмах (D-059)"`

---

### Task 11: Сид, README, состояние проекта

**Files:**
- Modify: `README.md`, `apps/api/test/integration/demo-seed.test.ts`

- [ ] **Step 1: Тест сида**
  - `GET /api/events/cities` после сида → `["Москва", "Новосибирск"]`, Митап — онлайн.
  - `GET /api/events` после сида отдаёт четыре предстоящих.
  - `GET /api/events?when=past` — одно (конференция).
- [ ] **Step 2: README**
  - Таблица событий `demo` с колонками «Формат и город», «Категория», «Возраст».
  - В «Что проверить руками» пункты:
    - **Каталог:** фильтр «Москва» → квиз; «до 12+» без квиза; «Прошедшие» → конференция;
    - **Вход участника:** «Мои регистрации» → `anna.ivanova@example.com` → код в Mailpit → «Митап», «Воркшоп», «Конференция — пришли»;
    - **Регистрация без кода:** «Лекция» → место без письма с кодом.
  - В «Состояние проекта»: город и адрес — свободный текст, без справочника и геокодинга; ссылки на трансляцию нет.
- [ ] **Step 3: Проверка**

Run: `docker compose exec api pnpm db:reset`, затем пункты README руками; `pnpm --filter @app/api test demo-seed` → PASS.

- [ ] **Step 4: DEVLOG, коммит** `"Сид и README: каталог, вход участника"`

---

### Task 12: E2e — каталог, вход, регистрация без кода

**Files:**
- Create: `e2e/tests/catalog-signin.spec.ts`
- Modify: `e2e/support/mailpit.ts` (если `codeFromMail` берёт только тему «Код подтверждения» — добавить параметр темы)

- [ ] **Step 1: Сценарий**
  1. `createEvent(request, { title: \`Каталог ${uniqueEmail("t")}\`, city: "Тестоград", category: "lecture", minAge: 0 })`.
  2. `page.goto("/")` → выбор «Город: Тестоград» → карточка видна, у неё бейдж «0+» и нет одиночного текста «0» (Review Focus 1).
  3. Клик по карточке → «Войти, чтобы регистрироваться без кода» → email → код из Mailpit → возврат на `/e/:id`.
  4. Имя и фамилия, дата рождения → «Место ваше».
  5. Шапка «Мои регистрации» → вкладка «Текущие» содержит событие со статусом «Место ваше».
- [ ] **Step 2: Прогон** — `pnpm e2e` → 5 passed.
- [ ] **Step 3: DEVLOG, коммит** `"E2e: каталог, вход участника, регистрация без кода"`

---

### Task 13: Финальная проверка и PR

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm --filter @app/api test && pnpm e2e` → всё зелёное, числа тестов — в DEVLOG.
- [ ] **Step 2:** Сверка `docs/SPEC.md` с кодом по разделам §0, §2, §4, §5, §8. Расхождения правятся.
- [ ] **Step 3:** DEVLOG «итог задачи», коммит, push ветки, PR в `main` со ссылками на D-056–D-061, дизайн и план. CI `check` и `e2e` зелёные.
