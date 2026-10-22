# Спецификация: сервис регистрации на мероприятия

Что строим и как оно должно себя вести. Почему так — в `docs/DECISIONS.md`: номер `(D-0xx)` после правила ведёт к мотивировке и отвергнутым альтернативам. Спека на уровне пользовательских историй — issue [«Спека: сервис регистрации на мероприятия»](https://github.com/prokopofffff/maddevs-test/issues/52); этот файл — её подробный контракт (D-042). Термины — из `GLOSSARY.md`, в тексте выделены жирным при первом упоминании в разделе. При расхождении со спецификацией прав `DECISIONS.md`: спецификация правится под решение (D-036).

## 0. Назначение и границы

Организатор создаёт **событие** с **лимитом мест** и делится ссылкой. **Участник** по ссылке регистрируется по email: получает место с **билетом** или встаёт в **лист ожидания**. На входе организатор делает **чекин** по коду билета и видит счётчики live.

- Карта решений: [«Карта: сервис регистрации на мероприятия»](https://github.com/prokopofffff/maddevs-test/issues/1).
- Вне рамок — раздел Out of scope карты: оплата, публичный каталог, реальный почтовый провайдер, деплой, QR, сброс пароля, роль волонтёра, отмена события с письмами (D-035).
- Стек: Node 22 + pnpm (D-003), Hono (D-004), PostgreSQL через Drizzle 0.45 на postgres.js (D-009), Mailpit как SMTP (D-002), фронт Vite + React (D-024), всё локально в `docker compose`.
- Один процесс API обслуживает и API, и собранный фронт (D-024). Rate limit и пинок отправки рассчитаны на один процесс (D-006, D-014).

## 1. Требования

Шесть пунктов «Ожидаемого поведения» из задания. Тест каждого пишется до кода: сначала коммит с падающим тестом, потом реализация (D-029). Эта таблица переносится в README.

| Id | Требование | Правило | Решения | Тест |
|----|-----------|---------|---------|------|
| R1 | Зарегистрировавшийся получает письмо с билетом. Повторная регистрация на тот же email не создаёт второго места | После верного кода — место или лист ожидания и письмо в outbox той же транзакцией; у (событие, email) не больше одной неотменённой регистрации, повтор показывает существующую | D-007, D-011, D-013 | `r1-ticket-and-repeat.test.ts` |
| R2 | Места кончились — новые в лист ожидания. Кто-то отказался — первый из листа получает место и письмо | Распределение под блокировкой события; отказ подтверждённого вызывает «заполнить свободные места» в той же транзакции | D-011, D-012, D-032, D-033 | `r2-waitlist-promotion.test.ts` |
| R3 | Двое на последнее место одновременно: место одному, второй в листе ожидания | Каждое изменение мест — транзакция, первым шагом `SELECT … FROM events … FOR UPDATE` | D-011 | `r3-last-seat-race.test.ts` |
| R4 | За сутки до события всем участникам — напоминание. Ровно одно | Ежеминутный проход ставит письмо с ключом `reminder:<registration_id>:<reschedule_count>`; поздно подтверждённым напоминания нет | D-016, D-018, D-019 | `r4-one-reminder.test.ts` |
| R5 | Билет проходит чекин один раз. Счётчик пришедших обновляется live | Условный `UPDATE … WHERE checked_in_at IS NULL`; SSE-снимок по `NOTIFY` из триггера при коммите | D-020, D-021, D-022 | `r5-checkin-live.test.ts` |
| R6 | Организатор перенёс событие — все участники получают письмо | Перенос под блокировкой события ставит письмо `rescheduled:<registration_id>:<reschedule_count>` каждой неотменённой регистрации, включая лист ожидания | D-016, D-017 | `r6-reschedule.test.ts` |

«Ровно одно напоминание» в README формулируется так: ровно одно на каждое время начала, если место получено больше чем за сутки до начала; иначе его роль играет письмо о месте или о переносе (D-016, D-019). Доставка — at-least-once: дубль возможен только при падении процесса между приёмом письма SMTP и записью `sent_at` (D-013).

## 2. Модель данных

Схема — `apps/api/src/db/schema.ts` (Drizzle), миграции — SQL-файлы `drizzle-kit generate`, триггеры — миграция `--custom`; применяются при старте API до `listen` (D-009). Время — `timestamptz`, дата рождения — `date`. Email везде хранится обрезанным и в нижнем регистре (D-005, D-007).

### `users` — организаторы и поддержка

| Колонка | Тип | Ограничения |
|---|---|---|
| `id` | `bigint identity` | PK |
| `email` | `text` | unique |
| `password_hash` | `text` | `scrypt` из `node:crypto`, соль в строке (D-005) |
| `role` | `text` | `organizer` \| `support`, по умолчанию `organizer` (D-030) |
| `created_at` | `timestamptz` | |

### `sessions`

| Колонка | Тип | Ограничения |
|---|---|---|
| `id_hash` | `text` | PK; SHA-256 от значения cookie (D-040) |
| `user_id` | `bigint` | FK → `users`, `on delete cascade` |
| `created_at`, `expires_at` | `timestamptz` | `expires_at = created_at + 30 дней` (D-005) |

### `events`

| Колонка | Тип | Ограничения |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()`; входит в публичную ссылку (D-040) |
| `organizer_id` | `bigint` | FK → `users` |
| `title` | `text` | 1–200 символов |
| `description` | `text` | 0–5000 символов |
| `starts_at` | `timestamptz` | момент начала (D-015) |
| `timezone` | `text` | IANA-пояс (D-015) |
| `seat_limit` | `integer` | `check (seat_limit >= 1)` (D-032) |
| `min_age` | `integer null` | `check (min_age between 1 and 120)` (D-008) |
| `reschedule_count` | `integer` | по умолчанию 0 (D-016) |
| `rescheduled_at` | `timestamptz null` | момент последнего переноса (D-018) |
| `created_at`, `updated_at` | `timestamptz` | |

Индекс `(organizer_id, starts_at)`. Конца события нет (D-015).

### `email_verifications` — коды подтверждения

| Колонка | Тип | Ограничения |
|---|---|---|
| `id` | `bigint identity` | PK |
| `event_id` | `uuid` | FK → `events`, `on delete cascade` |
| `email` | `text` | |
| `purpose` | `text` | `register` \| `lookup` (D-039) |
| `first_name`, `last_name` | `text null` | данные формы; только у `register` |
| `birth_date` | `date null` | только у `register` |
| `code` | `text` | 6 цифр (D-007, D-040) |
| `attempts` | `integer` | по умолчанию 0, максимум 5 (D-007) |
| `expires_at` | `timestamptz` | `created_at + 10 минут` (D-007) |
| `consumed_at` | `timestamptz null` | момент верного ввода |
| `created_at` | `timestamptz` | |

Индекс `(event_id, email, created_at desc)` — для проверки «не чаще раза в минуту». Новый код для той же пары (событие, email) и того же `purpose` гасит прежние: их `expires_at` ставится в момент выдачи нового (D-039). Старые строки не чистим.

### `registrations`

| Колонка | Тип | Ограничения |
|---|---|---|
| `id` | `bigint identity` | PK |
| `event_id` | `uuid` | FK → `events` |
| `email` | `text` | |
| `first_name`, `last_name` | `text` | 1–100 символов |
| `birth_date` | `date` | (D-008) |
| `status` | `text` | `confirmed` \| `waitlisted` \| `cancelled` |
| `token` | `text` | unique; токен личной ссылки, 32 случайных байта в base64url (D-007, D-040) |
| `ticket_code` | `text null` | 8 символов Crockford Base32, нормализованный (D-022) |
| `verified_at` | `timestamptz` | момент верного кода; позиция в листе ожидания (D-012) |
| `confirmed_at` | `timestamptz null` | момент перехода в `confirmed` (D-018) |
| `cancelled_at` | `timestamptz null` | |
| `checked_in_at` | `timestamptz null` | отметка чекина (D-022) |
| `created_at` | `timestamptz` | |

Индексы:
- `(event_id, status)` — подсчёт счётчиков (D-011);
- частичный unique `(event_id, email) WHERE status <> 'cancelled'` — одна неотменённая регистрация (D-011);
- частичный unique `(ticket_code) WHERE ticket_code IS NOT NULL` (D-022);
- `(event_id, verified_at, id) WHERE status = 'waitlisted'` — порядок листа ожидания (D-012).

**Состояния регистрации.** Все переходы, кроме чекина, идут под блокировкой строки события (раздел 3).

| Из | В | Когда | Условия |
|---|---|---|---|
| — | `confirmed` | верный код, `purpose = register` | до начала; нет неотменённой регистрации этого email; подтверждённых < лимита и лист ожидания пуст |
| — | `waitlisted` | то же | до начала; нет неотменённой; мест нет |
| `waitlisted` | `confirmed` | **повышение** | до начала; первая по `(verified_at, id)`; подтверждённых < лимита |
| `confirmed` | `cancelled` | **отказ** | до начала; `checked_in_at IS NULL` (D-022, D-033) |
| `waitlisted` | `cancelled` | отказ | до начала; повышения не вызывает (D-007) |

`cancelled` — конечное состояние. Повторная регистрация после отказа — новая строка с новым токеном и кодом билета, в конце листа ожидания (D-007, D-012). Билет выдаётся при переходе в `confirmed` и остаётся в отменённой строке, но чекин его не принимает (D-022). Чекин ставит и снимает `checked_in_at` у `confirmed` и состояния не меняет.

**Позиция в листе ожидания** не хранится: 1 + число `waitlisted` того же события с меньшим `(verified_at, id)`.

### `correction_requests` — заявки на исправление (D-031)

| Колонка | Тип | Ограничения |
|---|---|---|
| `id` | `bigint identity` | PK |
| `registration_id` | `bigint` | FK → `registrations` |
| `old_first_name`, `old_last_name`, `old_birth_date` | | значения на момент подачи |
| `new_first_name`, `new_last_name`, `new_birth_date` | | |
| `status` | `text` | `pending` \| `accepted` \| `rejected` \| `withdrawn` |
| `reason` | `text null` | причина отклонения |
| `created_at`, `decided_at` | `timestamptz` | `decided_at` null до решения |
| `decided_by` | `bigint null` | FK → `users` |

Частичный unique `(registration_id) WHERE status = 'pending'`.

### `email_outbox` (D-013)

Колонки: `id bigint identity`, `dedup_key text unique`, `kind`, `to_email`, `subject`, `text`, `html`, `created_at`, `attempts int default 0`, `next_attempt_at`, `locked_until null`, `sent_at null`, `failed_at null`, `last_error null`. Частичный индекс `(next_attempt_at) WHERE sent_at IS NULL AND failed_at IS NULL`.

### Триггеры live (D-020)

- `registrations`: `AFTER INSERT OR DELETE` и `AFTER UPDATE`, если изменились `status` или `checked_in_at` → `pg_notify('event_counts', event_id::text)`.
- `events`: `AFTER UPDATE OF seat_limit` → то же.

## 3. Правила мест

Все правила — функции в `apps/api/src/domain/`, принимают транзакцию и `now` параметром (D-018, D-033). В SQL нет `now()`: только `$now`.

**Транзакция, меняющая места.** Распределение после кода, отказ, изменение лимита, перенос и удаление события — одна транзакция READ COMMITTED. Первый шаг — `SELECT … FROM events WHERE id = $1 FOR UPDATE` (D-011, D-016). Порядок блокировок всегда «событие → регистрации». Обёртка `withTx` повторяет транзакцию до трёх раз на `40001`, `40P01` и нарушении `registrations_ticket_code_key` (коллизия кода билета). Остальные `23505` не повторяются (D-009, D-022).

**Счётчики** не хранятся (D-011). Один запрос `count(*) FILTER (…)` по `(event_id, status)`:
- `confirmed` — `status = 'confirmed'`;
- `waitlisted` — `status = 'waitlisted'`;
- `checkedIn` — `status = 'confirmed' AND checked_in_at IS NOT NULL`;
- плюс `limit = seat_limit`.

Тот же снимок отдают SSE, ответы организатора и публичная страница.

**Свободные места** = `max(0, seat_limit − confirmed)`, и 0, если лист ожидания не пуст или событие началось (глоссарий, D-026, D-033). При `confirmed > seat_limit` событие идёт **сверх лимита**: свободных мест нет (D-032).

**`started(event, now)`** = `now >= starts_at`. Ровно в момент начала уже закрыто (D-033).

**`allocate(tx, event, verification, now)`** — после верного кода с `purpose = register`:
1. `started` → ошибка `registration_closed`.
2. Есть неотменённая регистрация этого email → вернуть её с результатом `existing`. Данные формы не применяются, писем нет (D-007).
3. Иначе новая строка с `verified_at = now`. Если подтверждённых < лимита и лист ожидания пуст — `confirmed`, `confirmed_at = now`, новый код билета, письмо `confirmed`. Иначе `waitlisted`, письмо `waitlisted` (D-011).

**`fillFreeSeats(tx, event, now)`** — после отказа подтверждённого и после изменения лимита (D-012, D-032):
1. `started` → ничего (D-033).
2. `n = seat_limit − confirmed`; если `n <= 0` — ничего.
3. Первые `n` строк `waitlisted` по `(verified_at, id)` `FOR UPDATE` → `confirmed`, `confirmed_at = now`, новый код билета, письмо `promoted`.

Инвариант после каждой транзакции: нет одновременно свободного места и непустого листа ожидания.

**`cancel(tx, registration, now)`** — по личной ссылке (D-007, D-012, D-022):
1. `started` → `event_started`.
2. `checked_in_at IS NOT NULL` → `already_checked_in`.
3. Уже `cancelled` → вернуть как есть, без писем (повтор безопасен).
4. `status = 'cancelled'`, `cancelled_at = now`. Ожидающая заявка на исправление → `withdrawn` (D-031). Письмо `cancelled`.
5. Был `confirmed` → `fillFreeSeats`.

**`updateEvent(tx, event, patch, now)`** — правка организатором:
- Название, описание и минимальный возраст правятся всегда.
- Изменение момента начала — **перенос**: только до начала и только на будущий момент, иначе `event_started` / `starts_in_past`. Сначала `reschedule_count + 1` и `rescheduled_at = now`, затем каждой неотменённой регистрации письмо `rescheduled` (D-016). Смена только пояса при том же моменте — не перенос.
- Изменение лимита — только до начала, иначе `event_started` (D-033). Затем `fillFreeSeats` (D-032).
- Перенос или повышение минимального возраста ничего не отменяют. Ответ содержит `belowMinAgeCount` — число неотменённых регистраций, не проходящих по возрасту на день события (D-017).

**`deleteEvent(tx, event)`** — только если у события нет ни одной строки в `registrations`, включая отменённые; иначе `event_has_registrations` (D-035). Коды подтверждения удаляются каскадом. Письма с кодом, уже стоящие в outbox, уходят как есть.

**Возраст на день события** — полные годы между `birth_date` и календарной датой `starts_at` в поясе события. «Младше минимального» — `min_age` задан и возраст меньше (D-008). Проверяется при запросе кода на регистрацию; после этого только показывается (D-017).

**Код билета** — 8 символов `crypto.randomInt` из `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, показ `XXXX-XXXX`. Нормализация ввода: верхний регистр, без пробелов и дефисов, `O → 0`, `I`/`L → 1` (D-022).

**Чекин** (D-022) строку события не блокирует. Отметка — один запрос:

```sql
UPDATE registrations SET checked_in_at = $now
WHERE event_id = $1 AND ticket_code = $2
  AND status = 'confirmed' AND checked_in_at IS NULL
RETURNING …
```

Ноль строк — запрос по `(event_id, ticket_code)` объясняет причину. Снятие — `UPDATE … SET checked_in_at = NULL WHERE id = $1 AND event_id = $2`, идемпотентно. От начала события не зависит (D-033).

**Заявка на исправление** (D-031):
- Подача — по личной ссылке, только у неотменённой регистрации и до начала; иначе `registration_cancelled` / `event_started` (D-033).
- Прежняя `pending` → `withdrawn` в той же транзакции.
- «Принять»: `UPDATE correction_requests SET status = 'accepted', decided_at, decided_by WHERE id = $1 AND status = 'pending'`, затем новые значения в регистрацию и письмо `correction_accepted`. Ноль строк — `correction_not_pending`.
- «Отклонить»: то же с `rejected`, необязательной `reason` и письмом `correction_rejected`.

## 4. API

Все маршруты под `/api`, тела и ответы — JSON. Схемы zod лежат в `apps/api/src/schemas/` без серверных импортов: их используют и `@hono/zod-validator`, и формы фронта (D-024). Время в ответах — ISO-момент `startsAt` плюс `timezone`; организатору ещё `startsLocal` (`YYYY-MM-DDTHH:mm` в поясе события) для формы. Запрос передаёт `startsLocal` и `timezone`, сервер переводит их в момент через `@date-fns/tz` (D-015).

**Ошибки** — `{ "error": "<code>", …подробности }`. Фронт переводит код в русский текст (D-024). Общие коды:
- `400 validation_failed` + `issues` — схема не прошла;
- `401 unauthorized` — нет сессии;
- `404 not_found` — нет объекта, чужое событие или маршрут не для этой роли (D-005, D-030);
- `429 rate_limited` + `Retry-After` (D-006).

**Корзины rate limit** (D-006): `auth` — 10/мин на signup и login; `public` — 20/мин на действия участника (помечены ★); `global` — 300/мин на всё. Значения из env.

### Вход (D-005)

| Метод и путь | Тело | Ответ | Ошибки |
|---|---|---|---|
| `POST /auth/signup` | `signupSchema {email, password}` | `201 {user}` + cookie `sid` | `409 email_taken` |
| `POST /auth/login` | `loginSchema {email, password}` | `200 {user}` + cookie `sid` | `401 invalid_credentials` |
| `POST /auth/logout` | — | `204`, сессия и cookie удалены | — |
| `GET /auth/me` | — | `200 {user: {id, email, role}}` | `401` |

Cookie `sid`: httpOnly, `SameSite=Lax`, `Path=/`, `Max-Age` 30 дней, `Secure` при `COOKIE_SECURE=1`. Пароль — 8–200 символов. Signup создаёт только `organizer` (D-030).

### Организатор

Все маршруты требуют сессию с ролью `organizer`; событие должно принадлежать ей, иначе `404` (D-005).

| Метод и путь | Тело | Ответ | Ошибки |
|---|---|---|---|
| `GET /organizer/events` | — | `200 {events: [{id, title, startsAt, timezone, started, counts}]}`, по `starts_at` | — |
| `POST /organizer/events` | `eventInputSchema {title, description, startsLocal, timezone, limit, minAge?}` | `201 {event}` | `400 starts_in_past` |
| `GET /organizer/events/:id` | — | `200 {event, counts, publicUrl, registrationCount}` | `404` |
| `PATCH /organizer/events/:id` | `eventPatchSchema` (поля `eventInputSchema`, все необязательны) | `200 {event, counts, rescheduled, belowMinAgeCount}` | `409 event_started`, `400 starts_in_past` |
| `DELETE /organizer/events/:id` | — | `204` | `409 event_has_registrations` |
| `GET /organizer/events/:id/registrations` | — | `200 {registrations: [{id, firstName, lastName, email, birthDate, ageOnEventDay, belowMinAge, status, waitlistPosition, confirmedAt, checkedInAt}]}` | — |
| `GET /organizer/events/:id/live` | — | SSE (раздел 7) | `404` |
| `GET /organizer/events/:id/tickets/:code` | — | `200 {registrationId, firstName, lastName, birthDate, ageOnEventDay, belowMinAge, status, checkedInAt}` | `404 ticket_not_found` |
| `POST /organizer/events/:id/checkin` | `checkinSchema {code}` | `200 {registrationId, firstName, lastName, checkedInAt}` | `409 already_checked_in {firstName, lastName, checkedInAt}`, `409 ticket_cancelled`, `404 ticket_not_found` |
| `DELETE /organizer/events/:id/checkin/:registrationId` | — | `204`, идемпотентно; регистрация другого события не трогается | `404` |

`counts` = `{confirmed, limit, waitlisted, checkedIn}`. `registrationCount` — число строк регистраций, включая отменённые: по нему форма решает, показывать ли «Удалить» (D-035). Список регистраций отдаёт всех, включая отменённых, в порядке «подтверждённые по `confirmed_at` → лист ожидания по номеру → отменённые по `cancelled_at`» (D-051); фильтр — на клиенте.

Валидация события: `title` 1–200, `description` 0–5000, `timezone` из `Intl.supportedValuesOf('timeZone')`, `limit` целое 1–100 000, `minAge` целое 1–120 или `null`. Новое событие — только в будущем.

### Участник

Без входа. Доступ к регистрации даёт токен личной ссылки (D-007).

| Метод и путь | Тело | Ответ | Ошибки |
|---|---|---|---|
| `GET /events/:id` | — | `200 {id, title, description, startsAt, timezone, minAge, freeSeats, started}` | `404` |
| ★ `POST /events/:id/verifications` | `verificationRequestSchema`: `{purpose: "register", email, firstName, lastName, birthDate}` или `{purpose: "lookup", email}` | `201 {verificationId, expiresAt, resendAfter}` | `409 registration_closed` (только `register`), `422 below_min_age {minAge}`, `429 code_resend_too_soon {retryAfter}` |
| ★ `POST /verifications/:id/confirm` | `confirmCodeSchema {code}` | `register`: `200 {result: "confirmed" \| "waitlisted" \| "existing", token, status, waitlistPosition?}`; `lookup`: `200 {result: "found", token}` | `400 code_invalid {attemptsLeft}`, `410 code_expired`, `410 code_attempts_exceeded`, `409 registration_closed`, `404 registration_not_found` (`lookup`) |
| `GET /registrations/:token` | — | `200 {event: {id, title, startsAt, timezone, started}, status, email, firstName, lastName, birthDate, ticketCode, waitlistPosition?, checkedInAt, cancelledAt, pendingCorrection?}`; `ticketCode` — `null`, если регистрация не подтверждена | `404` |
| ★ `POST /registrations/:token/cancel` | — | `200 {status: "cancelled"}` | `409 event_started`, `409 already_checked_in` |
| ★ `POST /registrations/:token/corrections` | `participantDataSchema {firstName, lastName, birthDate}` | `201 {pendingCorrection}` | `409 event_started`, `409 registration_cancelled` |

Порядок проверок в `POST /events/:id/verifications`:
1. Событие не найдено → `404`.
2. `register` после начала → `registration_closed`.
3. `register`, участник младше минимального возраста → `below_min_age`, код не отправляется (D-008).
4. Предыдущий код этой пары (событие, email) выдан меньше минуты назад → `code_resend_too_soon`.

Затем новая строка кода, письмо `code` в outbox, после коммита `outbox.wake()` (D-014). Повторная отправка — тот же запрос с теми же данными. `lookup` открыт и после начала (D-033).

`confirm` в одной транзакции:
1. Код погашен или истёк → `code_expired`.
2. `attempts >= 5` → `code_attempts_exceeded`.
3. Код неверный → `attempts + 1`, `code_invalid`.
4. Код верный → `consumed_at`.

Для `register` дальше идёт `allocate` (раздел 3). Для `lookup` возвращается неотменённая регистрация этого email либо `registration_not_found`; повторный верный ввод того же кода `lookup` снова отвечает `found`, код на запрос уходит на любой email (D-048).

`participantDataSchema` — общая для формы регистрации и формы исправления (D-031): имя и фамилия 1–100 после trim, `birthDate` — существующая дата от 1900-01-01. «Не в будущем» сервер проверяет по своим часам: `400 validation_failed` с `issues: [{path: "birthDate", message: "in_future"}]`; форма — атрибутом `max`.

### Поддержка (D-030, D-031)

Все маршруты требуют роль `support`, остальным — `404`. На организаторских маршрутах поддержка получает `404`: своих событий у неё нет.

| Метод и путь | Тело | Ответ | Ошибки |
|---|---|---|---|
| `GET /support/corrections` | — | `200 {corrections: [{id, createdAt, event: {id, title, startsAt, timezone, minAge}, email, old, new, belowMinAgeAfter}]}` — только `pending`, от старых к новым | — |
| `POST /support/corrections/:id/accept` | — | `200 {status: "accepted"}` | `409 correction_not_pending` |
| `POST /support/corrections/:id/reject` | `rejectSchema {reason?}` | `200 {status: "rejected"}` | `409 correction_not_pending` |
| `GET /support/events` | — | `200 {events: [{id, title, organizerEmail, startsAt, timezone, counts}]}` | — |
| `GET /support/events/:id/registrations` | — | как у организатора, только чтение | `404` |

Два последних маршрута — «если останется время» в тикете поддержки.

## 5. Письма

Каждое письмо ставится `INSERT … ON CONFLICT (dedup_key) DO NOTHING` в транзакции действия и рендерится в этот момент: снимок фактов (D-013). Шаблон — функция TypeScript `(data) → {subject, text, html}` в `apps/api/src/mail/templates/`. HTML — табличная вёрстка 600 px с токенами шаблона (D-025, рамка `S10-Email`). Время — в поясе события с подписью смещения: «25 октября 2026, 19:00 (UTC+7)» (D-015). Код билета — крупным моноширинным шрифтом, без QR (D-023). Личная ссылка — `${PUBLIC_URL}/r/<token>`.

| `kind` | Когда | Кому | `dedup_key` | Содержание |
|---|---|---|---|---|
| `code` | выдан код подтверждения | email из формы | `code:<verification_id>` | код, «действует 10 минут», название события |
| `confirmed` | `allocate` → `confirmed` | участник | `confirmed:<registration_id>` | «Место ваше», время, код билета, личная ссылка |
| `waitlisted` | `allocate` → `waitlisted` | участник | `waitlisted:<registration_id>` | номер в листе ожидания на момент записи, время, личная ссылка с текущим номером (D-049) |
| `promoted` | повышение | участник | `promoted:<registration_id>` | «Освободилось место», время, код билета, личная ссылка |
| `cancelled` | отказ | участник | `cancelled:<registration_id>` | подтверждение отказа |
| `reminder` | проход напоминаний | подтверждённые | `reminder:<registration_id>:<reschedule_count>` | «До начала меньше суток», время, код билета, личная ссылка (D-018); не «завтра»: после простоя письмо может уйти за несколько часов до начала |
| `rescheduled` | перенос | все неотменённые | `rescheduled:<registration_id>:<reschedule_count>` | старое и новое время, каждое в своём поясе (пояс мог смениться вместе с переносом), статус: билет или номер в листе ожидания (D-016) |
| `correction_accepted` | заявка принята | участник | `correction:<request_id>:accepted` | новые значения (D-031) |
| `correction_rejected` | заявка отклонена | участник | `correction:<request_id>:rejected` | причина, если указана |

Повторная регистрация с результатом `existing` писем не шлёт (D-007). Удаление события писем не шлёт (D-035). Письма «мест не осталось» после начала нет (D-034).

## 6. Фоновые циклы

Оба цикла живут в процессе API, без библиотеки (D-013, D-018). Каждый — чистая функция от `now` и таймер вокруг неё.

**`dispatchOutbox(now, transport)`** — каждые 2 с и по `outbox.wake()` после коммита, поставившего письмо (D-014).
1. Захват до 20 строк: `sent_at IS NULL AND failed_at IS NULL AND next_attempt_at <= $now AND (locked_until IS NULL OR locked_until < $now)`, по `id`, `FOR UPDATE SKIP LOCKED`, затем `locked_until = $now + 2 мин`. Транзакция коммитится до SMTP.
2. Отправка через nodemailer: multipart HTML + text, `Message-ID` выводится из `id` строки.
3. Успех → `sent_at`. Ошибка → `attempts + 1`, `next_attempt_at = now + 30 с · 2^(attempts−1)` с потолком 1 ч, `last_error`. После 10 попыток → `failed_at` и запись в лог.

Одновременно работает не больше одного прохода на процесс.

**`sweepReminders(now)`** — раз в минуту и сразу после старта (D-018). Одна транзакция:
1. `SELECT id FROM events WHERE starts_at > $now AND starts_at <= $now + interval '24 hours' FOR SHARE`.
2. Отдельный `SELECT` регистраций `confirmed` этих событий, у которых `GREATEST(confirmed_at, rescheduled_at) < starts_at − interval '24 hours'` (`GREATEST` пропускает `NULL`) и ключа напоминания ещё нет в outbox.
3. Для каждой — письмо рендерится шаблоном и ставится `INSERT … ON CONFLICT (dedup_key) DO NOTHING`, как любое другое (раздел 5). Один `INSERT … SELECT` не подходит: шаблон — функция TypeScript. Однократность держит уникальный ключ, фильтр по outbox лишь не рендерит уже поставленное каждую минуту.

Проход, поставивший письма, пинает `dispatchOutbox`.

**Порядок старта** (`apps/api/src/index.ts`): миграции → `sql.listen('event_counts')` (раздел 7) → циклы → `serve`. По `SIGTERM` и `SIGINT`: перестать принимать запросы, дождаться текущих проходов, закрыть соединения.

## 7. Live (D-020, D-021)

`GET /api/organizer/events/:id/live` — `streamSSE` под сессией владельца.
- Заголовки `Cache-Control: no-cache` и `X-Accel-Buffering: no`; первым сообщением `retry: 3000`; пинг-комментарий каждые 20 с.
- Сообщение одно: `event: counts`, `data: {"confirmed":42,"limit":50,"waitlisted":7,"checkedIn":30}`.
- Снимок уходит сразу при подключении, после каждого уведомления по событию и всем подписчикам в `onlisten` после переподключения слушателя.

В процессе — одно `sql.listen('event_counts', onnotify, onlisten)` и карта «событие → открытые потоки». Пересчёт по уведомлению — не чаще раза в 200 мс на событие, один запрос на всех подписчиков. Подключение потока считается одним запросом rate limit (D-006).

По `SIGTERM` и `SIGINT` открытые потоки закрываются, новый поток получает `503 shutting_down`, `EventSource` переподключается к поднявшемуся процессу. Соединения keep-alive закрываются, когда закроются потоки, остальные обрываются через 5 с: иначе браузер переподключается по старому соединению, и `server.close()` не завершится.

Во фронте `EventSource` пишет снимок в кэш TanStack Query (`setQueryData`) и инвалидирует запрос списка регистраций (D-024). Пока поток в ошибке, экран показывает «Нет связи, переподключаемся…» и последние цифры.

## 8. Экраны

Стили — из `docs/design/template.html`: токены `:root` и семантические классы подключаются глобально, компоненты собираются из нативных элементов, без UI-кита (D-025, D-027). Шрифт Onest — пакет `@fontsource/onest`, собирается в бандл `apps/web` и не грузится с Google Fonts (D-045). CSS шаблона переносится скриптом `apps/web/scripts/extract-template-css.mjs`. Hover-фон `#FAFAF8` выносится в токен. Интерфейс только на русском. Участник и чекин — mobile-first, кабинет — под ноутбук (D-024).

| Маршрут | Рамки шаблона | API | Состояния и заметки |
|---|---|---|---|
| `/e/:eventId` | `S1-Event` (s1a–s1d), `S2-Code` (s2a–s2d), `S3-Result` (s3a–s3c) | `GET /events/:id`, `POST …/verifications`, `POST /verifications/:id/confirm` | «Осталось N мест» / «Мест нет — вы встанете в лист ожидания» (D-026); ошибка возраста; ожидание кода с таймером повтора; неверный и истёкший код; результат «Место ваше» / «Вы №N в листе ожидания» / «Вы уже зарегистрированы» со ссылкой на `/r/:token`. Раскрывашка «Уже регистрировались?» — `lookup`. После начала: «Событие началось — регистрация закрыта», виден только `lookup` (D-034); рамки нет, собирается из `c-banners` |
| `/r/:token` | `S4-MyReg` (s4a–s4e) | `GET /registrations/:token`, `POST …/cancel`, `POST …/corrections` | Подтверждена (билет), лист ожидания (номер), отменена, пришёл; диалог отказа. Форма «Исправить данные» и плашка «Заявка на рассмотрении» — без рамки, из `c-fields` и `c-banners` (D-031). После начала: «Событие началось» без кнопки отказа и формы, у листа ожидания «Событие началось, место не освободилось» (D-034). Подпись доски 04 «доступ по коду из письма» не переносим: доступ — по личной ссылке |
| `/login`, `/signup` | `S5-Login` (s5a, s5b) | `POST /auth/login`, `POST /auth/signup` | После входа: `organizer` → `/organizer`, `support` → `/support` |
| `/organizer` | `S6-Events` (s6a, s6b) | `GET /organizer/events` | Пустое состояние; у события — время и три счётчика |
| `/organizer/events/new`, `/organizer/events/:id/edit` | `S7-EventForm` (s7a–s7c), `c-dialog` | `POST`/`PATCH /organizer/events…`, `DELETE /organizer/events/:id` | Пояс — нативный `<select>` по `Intl.supportedValuesOf('timeZone')`, по умолчанию пояс браузера (D-015, D-025). Диалог «N подтверждённых сверх лимита…» перед сохранением лимита ниже подтверждённых (D-032). После сохранения переноса или минимального возраста — предупреждение «N участников не проходят по возрасту» со ссылкой на список (D-017). Пока дата или время изменены и есть неотменённые регистрации — подсказка, что всем придёт письмо о переносе (D-016). После начала поля даты и лимита заблокированы (D-033). Кнопка «Удалить событие» с диалогом — только при `registrationCount = 0` (D-035); рамки нет |
| `/organizer/events/:id` | `S8-EventAdmin` (s8a), `S8b-EventAdmin-States` (s8b, s8c) | `GET /organizer/events/:id`, `GET …/registrations`, `GET …/live`, `DELETE …/checkin/:registrationId` | Плашки «Подтверждено N из L» (сверх лимита — «N из L · K сверх лимита» предупреждающим цветом), «Лист ожидания N», «Пришло N из M» (D-021, D-032); ссылка для участников с копированием; список с фильтром по статусу; «Снять отметку» у отмеченных (D-023); «Нет связи». На 768 px таблица прокручивается горизонтально |
| `/organizer/events/:id/checkin` | `S9-Checkin` (s9a–s9h) | `GET …/tickets/:code`, `POST …/checkin`, `GET …/live` | Поле в фокусе → Enter → карточка → «Пропустить» (Enter) → «Отмечен» → фокус в поле; жёлтое «Младше N лет на день события»; красные «Уже прошёл в ЧЧ:ММ», «Билет отменён», «Билет не найден»; строка «Пришло N из M» (D-023) |
| `/support` | рамки нет, из `c-table`, `c-badges`, `c-buttons`, `c-dialog` | `GET /support/corrections`, `POST …/accept`, `POST …/reject` | Очередь «было → стало», предупреждение «Будет младше N лет на день события», счётчик ожидающих; отклонение с необязательной причиной (D-031) |
| `/support/events` | рамки нет | `GET /support/events`, `GET /support/events/:id/registrations` | Только чтение; «если останется время» |

Название «Явка» и домен `yavka.example` из шаблона не используем: продукт называется «Регистрация на мероприятия», ссылки строятся от `PUBLIC_URL`.

## 9. Тесты

Две точки тестирования (D-041), Vitest — один проект `integration`.
- **Тестовая сборка приложения.** Фабрика получает базу, часы и почтовый транспорт и возвращает HTTP-приложение и `runJobs(now)` — один шаг `sweepReminders` и `dispatchOutbox`. Тест вызывает только `app.request()`, `runJobs(now)` и читает SSE-ответ; внутренние функции напрямую не вызываются. Исключение — проверка SQL `.for('update')` (D-009).
- Настоящий Postgres из compose: шаблонная база с миграциями, своя база на воркер через `CREATE DATABASE … TEMPLATE`, `TRUNCATE … RESTART IDENTITY CASCADE` между тестами (D-028).
- «В outbox строка `X`» в сценариях ниже проверяется как «после `runJobs(now)` фейковый транспорт получил письмо `X`»; «`sweepReminders(t)`» — как `runJobs(t)`.
- Гонки — параллельными `app.request()` на пуле настоящих соединений, коммитами.
- **Playwright** — вторая точка, только сценарии раздела «E2e».

Файлы требований — `apps/api/test/integration/requirements/`, имя теста начинается с `R<n>:`.

### R1 — письмо с билетом и повторная регистрация

- Дано событие с лимитом 10. Когда участник запрашивает код и вводит его, то регистрация `confirmed` с кодом билета. В outbox ровно одна строка `confirmed:<id>`, в ней код билета и личная ссылка. После `dispatchOutbox` у строки стоит `sent_at`, фейковый транспорт получил письмо.
- Когда тот же email (` Anna@Example.com `) регистрируется снова с другими именем и датой, то ответ `existing` с тем же токеном. Неотменённых регистраций одна, подтверждённых одна, имя прежнее, нового письма о месте нет.
- Когда один и тот же код подтверждается параллельно на двух соединениях (двойной клик, две вкладки), то неотменённая регистрация одна, второй ответ — `existing` (D-046).

### R2 — лист ожидания и повышение

- Дано событие с лимитом 1 и подтверждённой A. Когда регистрируются B и C, то обе `waitlisted` с позициями 1 и 2, в outbox `waitlisted:<B>` и `waitlisted:<C>`.
- Когда A отказывается, то A `cancelled`, B `confirmed` с кодом билета и `confirmed_at`, C — позиция 1. В outbox `cancelled:<A>` и `promoted:<B>`.
- Когда отказывается B из листа ожидания (до повышения), то повышения нет.

### R3 — гонка за последнее место

- Дано событие с лимитом 5 и 4 подтверждёнными. Когда 10 участников одновременно подтверждают коды на 10 соединениях, то подтверждённых ровно 5, в листе ожидания 9 с позициями 1…9. Писем `confirmed` новых — одно, `waitlisted` — девять.
- Первый тест файла проверяет, что SQL от `.for('update')` действительно содержит `FOR UPDATE` (D-009).

### R4 — ровно одно напоминание

Событие начинается в T, регистрация подтверждена в T−48 ч.
- `sweepReminders(T−25 ч)` → 0 напоминаний.
- `sweepReminders(T−24 ч)` → 1.
- Повторный проход → всё ещё 1.
- Два параллельных прохода на разных соединениях → 1.
- Первый проход после «простоя» в T−20 ч → 1.
- Регистрации из листа ожидания и отменённые → 0.
- Проход после T → 0.
- Регистрация или повышение в T−20 ч → 0 (D-019).
- Повышение в T−30 ч → 1 в T−24 ч.

### R5 — однократный чекин и live

- Дан подтверждённый билет. Когда два `POST …/checkin` с одним кодом идут параллельно, то один ответ `200`, второй `409 already_checked_in` с временем первой отметки. `checked_in_at` выставлен один раз.
- Отменённый билет → `409 ticket_cancelled`. Код другого события → `404 ticket_not_found`. Код с дефисом, в нижнем регистре и с `O` вместо `0` находится.
- Снятие отметки → билет снова проходит чекин.
- Live: открыть поток и получить первый снимок. Когда другое соединение делает чекин, то следующий снимок с `checkedIn + 1` приходит в пределах 2 с. Откаченная транзакция снимка не даёт.

### R6 — перенос

- Даны 2 подтверждённых, 1 в листе ожидания, 1 отменённая. Когда событие переносится, то в outbox три строки `rescheduled:<id>:1` со старым и новым временем в поясе события, у отменённой письма нет. Второй перенос → ещё три строки с `:2`.
- Перенос после начала → `409 event_started`; на прошедший момент → `400 starts_in_past`; смена только пояса при том же моменте — не перенос, писем нет.
- Напоминание отправлено, затем перенос на неделю → после прохода за сутки до новой даты второе напоминание с ключом `:1`.
- Перенос внутрь суток до отправки напоминания → напоминаний 0, письмо о переносе есть.
- Перенос на дату, к которой участнику меньше `min_age` → `belowMinAgeCount = 1`, регистрация не отменена (D-017).

### Остальные тесты

Пишутся вместе с кодом в своём тикете. Пункты с ◇ — «если останется время» (D-029, уровень 5).
- Вход: signup, login, logout, `401` без сессии; чужое событие → `404`; поддержка на организаторских маршрутах → `404`, организатор на `/support/*` → `404`; ◇ 11-й вход за минуту → `429`.
- События: создание в прошлом → `400`; удаление без регистраций → `204`; с одной отменённой → `409 event_has_registrations`.
- Коды: неверный код уменьшает `attemptsLeft`; шестая попытка → `code_attempts_exceeded`; через 10 минут → `code_expired`; повтор раньше минуты → `429 code_resend_too_soon`; младше минимального возраста → `422`, кода в outbox нет; `lookup` после начала открывает регистрацию.
- После начала: регистрация → `registration_closed`; код, запрошенный до и введённый после начала → `registration_closed`; отказ → `event_started`; отказ за секунду до начала повышает первого из листа; лимит → `409`; описание правится (D-033).
- Сверх лимита: 50 → 40 оставляет 50 с билетами без писем; регистрация уходит в лист ожидания; отказ при 50 из 40 не повышает; при 40 из 40 следующий отказ повышает; снимок отдаёт `confirmed > limit` (D-032). Увеличение лимита повышает первых из листа.
- Отказ после чекина → `409 already_checked_in`.
- Поддержка: принять с письмом и новыми значениями; отклонить с причиной; повторная подача заменяет заявку; два параллельных «Принять» → один `200`, один `409`; отказ закрывает заявку (D-031).
- ◇ Outbox: ошибка транспорта → backoff; истёкшая аренда забирается повторно; `failed_at` после 10 попыток.
- ◇ Через ту же точку: возраст на день события на границе дня рождения; письма содержат код билета и личную ссылку. Нормализация кода — в R5, backoff — в пункте outbox выше.

### E2e (Playwright, Chromium)

`webServer` (`e2e/server.ts`) — собранное приложение на отдельном порту, своя база `app_e2e` (пересоздаётся на каждый запуск), поднятые лимиты rate limit, SMTP в compose-Mailpit. Адреса уникальные, письма ищутся в API Mailpit по получателю (D-028). Часы тест не двигает: «прошла минута» и «событие началось» — сдвигом моментов в базе e2e (D-047).
1. **Две вкладки:** организатор в двух контекстах, чекин в одном → «Пришло» растёт в другом без перезагрузки; повторный код → «Уже прошёл в …».
2. **Регистрация:** форма → код из Mailpit → «Место ваше» → письмо с билетом в Mailpit.
3. **Отказ и повышение:** событие с лимитом 1 и листом ожидания → отказ по личной ссылке из письма → первому из листа приходит письмо «Освободилось место».
4. **Потерял письмо:** зарегистрированный участник, событие началось → на странице события только «Регистрация закрыта» и «Уже регистрировались?» → email → код из Mailpit → `/r/:token` с билетом (D-047).

## 10. Конфигурация и запуск

**Структура репозитория** (D-024):

```
apps/api/      Hono, домен, схема БД, циклы, письма, сид; src/schemas/ — общие zod-схемы
apps/web/      Vite + React; стили из шаблона
e2e/           Playwright
docs/          SPEC, DECISIONS, DEVLOG, PROMPTS, design/
compose.yaml   postgres, mailpit, api
```

ESLint `no-restricted-imports` в `apps/web`: из `apps/api` разрешены только `import type` и `apps/api/src/schemas` (D-029).

**`compose.yaml`:**
- `postgres` — образ `postgres:17`, порт 5432 на localhost;
- `mailpit` — `axllent/mailpit`, SMTP 1025 и UI 8025 на localhost;
- `api` — сборка из корневого `Dockerfile` (Node 22, pnpm через corepack), порт 3000.

Порты Postgres и Mailpit открыты наружу для тестов (D-028).

**Переменные окружения:**

| Имя | По умолчанию | Назначение |
|---|---|---|
| `DATABASE_URL` | `postgres://app:app@localhost:5432/app` | база приложения |
| `TEST_DATABASE_URL` | `postgres://app:app@localhost:5432/postgres` | сервер для тестовых баз и базы e2e |
| `MAILPIT_URL` | `http://localhost:8025` | API Mailpit для e2e |
| `E2E_PORT` | `3100` | порт приложения в e2e |
| `PORT` | `3000` | |
| `PUBLIC_URL` | `http://localhost:3000` | основа ссылок в письмах и «ссылки для участников» |
| `SMTP_HOST`, `SMTP_PORT` | `localhost`, `1025` | Mailpit |
| `MAIL_FROM` | `Регистрация <no-reply@localhost>` | |
| `TRUST_PROXY` | `0` | `1` — брать IP из `X-Forwarded-For` (D-006) |
| `RATE_LIMIT_GLOBAL`, `RATE_LIMIT_AUTH`, `RATE_LIMIT_PUBLIC` | `300`, `10`, `20` | в минуту на IP |
| `COOKIE_SECURE` | `0` | |

**Команды (корень):**

| Команда | Что делает |
|---|---|
| `pnpm dev` | API с перезапуском и Vite с прокси `/api` (`xfwd: true`, API с `TRUST_PROXY=1`) |
| `pnpm build` / `pnpm start` | сборка фронта и API; один процесс отдаёт оба (D-024) |
| `pnpm test` | Vitest `integration`; без compose падает с подсказкой «Запустите `docker compose up -d`» (D-028) |
| `pnpm e2e` | Playwright; сам собирает фронт и поднимает приложение, compose должен быть запущен |
| `pnpm lint`, `pnpm typecheck` | |
| `pnpm db:generate` | `drizzle-kit generate` |
| `pnpm db:seed` / `pnpm db:reset` | демо-данные; на непустой базе сид отказывается и подсказывает `db:reset` (D-010) |
| `pnpm admin:create <email>` | учётная запись поддержки, пароль спрашивает (D-030) |

**Демо-сид** (D-010, D-018, D-030). Даты считаются от момента запуска.
- `demo@example.com` / `demo` — события:
  - заполненное, с листом ожидания;
  - начинается меньше чем через сутки, с регистрациями, подтверждёнными больше чем за сутки до начала: после сида придут напоминания;
  - прошедшее, с чекинами;
  - с минимальным возрастом.
- `demo2@example.com` / `demo` — своё событие, для проверки изоляции.
- `support@example.com` / `support` — поддержка, одна ожидающая заявка на исправление.

**CI** — `.github/workflows/ci.yml` на push и PR (D-029):
- job `check`: typecheck, lint, `pnpm test`, с Postgres и Mailpit как services;
- job `e2e` после него: сборка и Playwright; отчёт и трейсы — артефактом при падении.
