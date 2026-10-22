-- Live-счётчики (D-020, SPEC «Триггеры live»): любое изменение, от которого меняется снимок
-- «подтверждено / лист ожидания / пришло / лимит», шлёт `pg_notify('event_counts', <id события>)`.
-- Уведомление доставляется только при коммите, откат не шлёт ничего, одинаковые уведомления
-- одной транзакции Postgres склеивает. Слушает процесс API (`apps/api/src/live.ts`).
-- Ловит и изменения в обход API: сид, `psql`, второй экземпляр.
CREATE FUNCTION "notify_event_counts"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    PERFORM pg_notify('event_counts', NEW.id::text);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('event_counts', OLD.event_id::text);
  ELSE
    PERFORM pg_notify('event_counts', NEW.event_id::text);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "registrations_counts_insert_delete" AFTER INSERT OR DELETE ON "registrations"
  FOR EACH ROW EXECUTE FUNCTION "notify_event_counts"();
--> statement-breakpoint
CREATE TRIGGER "registrations_counts_update" AFTER UPDATE OF "status", "checked_in_at" ON "registrations"
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status" OR OLD."checked_in_at" IS DISTINCT FROM NEW."checked_in_at")
  EXECUTE FUNCTION "notify_event_counts"();
--> statement-breakpoint
CREATE TRIGGER "events_counts_seat_limit" AFTER UPDATE OF "seat_limit" ON "events"
  FOR EACH ROW
  WHEN (OLD."seat_limit" IS DISTINCT FROM NEW."seat_limit")
  EXECUTE FUNCTION "notify_event_counts"();
