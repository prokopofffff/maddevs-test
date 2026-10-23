import { describe, expect, it } from "vitest";
import { eventInput, signUpOrganizer } from "../support/organizer.ts";
import { testApp } from "../support/test-app.ts";

const setup = async () => {
  const organizer = await signUpOrganizer(testApp({ now: "2026-11-01T09:00:00Z" }).client());
  const create = (overrides: Record<string, unknown> = {}) => organizer.post("/api/organizer/events", eventInput(overrides));
  return { organizer, create };
};

const issuePaths = (res: { body: { issues: { path: string }[] } }) => res.body.issues.map((i) => i.path);

describe("поля события: формат, место, категория, возраст (D-059, D-060)", () => {
  it("офлайн-событие сохраняет город и адрес, пробелы в городе схлопываются", async () => {
    const { create } = await setup();

    const res = await create({ city: "  Нижний   Новгород ", minAge: 12 });

    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({
      format: "offline",
      city: "Нижний Новгород",
      address: "Красный проспект, 1",
      category: "meetup",
      minAge: 12,
    });
  });

  it("офлайн без города или адреса — 400 validation_failed с path city / address", async () => {
    const { create } = await setup();

    const noCity = await create({ city: undefined });
    const noAddress = await create({ address: undefined });
    const blankCity = await create({ city: "   " });
    const neither = await create({ city: null, address: null });

    for (const res of [noCity, noAddress, blankCity, neither]) {
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_failed");
    }
    expect(issuePaths(noCity)).toEqual(["city"]);
    expect(issuePaths(noAddress)).toEqual(["address"]);
    expect(issuePaths(blankCity)).toContain("city");
    expect(issuePaths(neither).sort()).toEqual(["address", "city"]);
  });

  it("онлайн: город и адрес не нужны и не сохраняются", async () => {
    const { create } = await setup();

    const res = await create({ format: "online", city: undefined, address: undefined });
    const withPlace = await create({ format: "online" });

    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({ format: "online", city: null, address: null });
    expect(withPlace.status).toBe(201);
    expect(withPlace.body.event).toMatchObject({ format: "online", city: null, address: null });
  });

  it("minAge вне шкалы (14, 21, -1) — 400; без minAge — 0", async () => {
    const { create } = await setup();

    for (const minAge of [14, 21, -1, null, "12"]) {
      const res = await create({ minAge });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_failed");
      expect(issuePaths(res)).toEqual(["minAge"]);
    }
    for (const minAge of [0, 6, 12, 16, 18]) {
      expect((await create({ minAge })).body.event.minAge).toBe(minAge);
    }
    expect((await create()).body.event.minAge).toBe(0);
  });

  it("формат и категория обязательны, категория вне перечня — 400", async () => {
    const { create } = await setup();

    expect((await create({ category: "party" })).status).toBe(400);
    expect((await create({ category: undefined })).status).toBe(400);
    expect((await create({ format: undefined })).status).toBe(400);
    expect((await create({ format: "hybrid" })).status).toBe(400);
    for (const category of ["meetup", "workshop", "lecture", "conference", "game", "other"]) {
      expect((await create({ category })).body.event.category).toBe(category);
    }
  });

  it("PATCH format: online обнуляет город и адрес; PATCH только title не трогает minAge 18", async () => {
    const { organizer, create } = await setup();
    const { id } = (await create({ minAge: 18 })).body.event;

    const renamed = await organizer.patch(`/api/organizer/events/${id}`, { title: "Новое название" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.event).toMatchObject({ title: "Новое название", minAge: 18, format: "offline", city: "Новосибирск" });

    const online = await organizer.patch(`/api/organizer/events/${id}`, { format: "online", city: "Москва" });
    expect(online.status).toBe(200);
    expect(online.body.event).toMatchObject({ format: "online", city: null, address: null, minAge: 18 });
    expect((await organizer.get(`/api/organizer/events/${id}`)).body.event).toMatchObject({ city: null, address: null });
  });

  it("PATCH format: offline у онлайн-события без city/address — 400 validation_failed", async () => {
    const { organizer, create } = await setup();
    const { id } = (await create({ format: "online", city: undefined, address: undefined })).body.event;

    const none = await organizer.patch(`/api/organizer/events/${id}`, { format: "offline" });
    const onlyCity = await organizer.patch(`/api/organizer/events/${id}`, { format: "offline", city: "Томск" });
    const both = await organizer.patch(`/api/organizer/events/${id}`, { format: "offline", city: "Томск", address: "Ленина, 1" });

    expect(none.status).toBe(400);
    expect(none.body.error).toBe("validation_failed");
    expect(issuePaths(none).sort()).toEqual(["address", "city"]);
    expect(onlyCity.status).toBe(400);
    expect(issuePaths(onlyCity)).toEqual(["address"]);
    expect(both.status).toBe(200);
    expect(both.body.event).toMatchObject({ format: "offline", city: "Томск", address: "Ленина, 1" });
  });

  it("PATCH города и адреса офлайн-события; minAge вне шкалы и категория вне перечня — 400", async () => {
    const { organizer, create } = await setup();
    const { id } = (await create()).body.event;

    const moved = await organizer.patch(`/api/organizer/events/${id}`, { city: "  Санкт-Петербург ", address: "Невский, 1", category: "game" });
    expect(moved.body.event).toMatchObject({ city: "Санкт-Петербург", address: "Невский, 1", category: "game" });

    expect((await organizer.patch(`/api/organizer/events/${id}`, { minAge: 14 })).status).toBe(400);
    expect((await organizer.patch(`/api/organizer/events/${id}`, { category: "party" })).status).toBe(400);
    expect((await organizer.patch(`/api/organizer/events/${id}`, { city: "" })).status).toBe(400);
  });

  it("публичная страница события отдаёт новые поля", async () => {
    const t = testApp({ now: "2026-11-01T09:00:00Z" });
    const organizer = await signUpOrganizer(t.client());
    const { id } = (await organizer.post("/api/organizer/events", eventInput({ format: "online", category: "lecture", minAge: 6 }))).body.event;

    expect((await t.client().get(`/api/events/${id}`)).body).toMatchObject({
      format: "online",
      city: null,
      address: null,
      category: "lecture",
      minAge: 6,
    });
  });
});
