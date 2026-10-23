-- Ручная правка после drizzle-kit: порядок шагов нужен, чтобы существующие строки прошли новые ограничения (D-059, D-060).
-- 1-3. Формат и категория: старые события не знали про место, поэтому онлайн и «другое».
ALTER TABLE "events" ADD COLUMN "format" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "category" text;--> statement-breakpoint
UPDATE "events" SET "format" = 'online', "category" = 'other';--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "format" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
-- 4-5. Возраст: старая проверка 1..120 снимается, значения округляются вверх до ближайшей ступени шкалы, `null` становится 0.
ALTER TABLE "events" DROP CONSTRAINT "events_min_age_check";--> statement-breakpoint
UPDATE "events" SET "min_age" = CASE WHEN "min_age" IS NULL THEN 0 WHEN "min_age" <= 6 THEN 6 WHEN "min_age" <= 12 THEN 12 WHEN "min_age" <= 16 THEN 16 ELSE 18 END;--> statement-breakpoint
-- 6. Умолчание, NOT NULL, новые ограничения и индексы.
ALTER TABLE "events" ALTER COLUMN "min_age" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "min_age" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_min_age_check" CHECK ("events"."min_age" in (0, 6, 12, 16, 18));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_place_check" CHECK (("events"."format" = 'offline' and "events"."city" is not null and "events"."address" is not null) or ("events"."format" = 'online' and "events"."city" is null and "events"."address" is null));--> statement-breakpoint
CREATE INDEX "events_starts_idx" ON "events" USING btree ("starts_at","id");--> statement-breakpoint
CREATE INDEX "events_city_idx" ON "events" USING btree (lower("city"));
