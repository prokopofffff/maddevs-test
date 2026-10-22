import { expect, test } from "@playwright/test";
import { createEvent, registerParticipant, uniqueEmail } from "../support/setup.ts";

test("две вкладки: чекин в одной поднимает «Пришло» в другой без перезагрузки, повторный код — «Уже прошёл»", async ({
  browser,
  request,
}) => {
  // Организатор в двух контекстах с одной сессией — как две вкладки одного браузера (D-021).
  const desk = await browser.newContext();
  const eventId = await createEvent(desk.request);
  const entrance = await browser.newContext({ storageState: await desk.storageState() });
  const { ticketCode } = await registerParticipant(request, eventId, uniqueEmail("anna"));
  await registerParticipant(request, eventId, uniqueEmail("boris"));

  const cabinet = await desk.newPage();
  await cabinet.goto(`/organizer/events/${eventId}`);
  const arrived = cabinet.getByRole("progressbar", { name: "Пришло участников" });
  await expect(arrived).toHaveAttribute("aria-valuenow", "0");
  await expect(arrived).toHaveAttribute("aria-valuemax", "2");
  // Метка в окне пропадёт при любой перезагрузке страницы.
  await cabinet.evaluate(() => Object.assign(window, { notReloaded: true }));

  const checkin = await entrance.newPage();
  await checkin.goto(`/organizer/events/${eventId}/checkin`);
  await expect(checkin.getByText("Пришло 0 из 2")).toBeVisible();
  const code = checkin.getByLabel("Код билета");
  await code.fill(ticketCode.toLowerCase());
  await code.press("Enter");
  await expect(checkin.getByRole("region", { name: "Участник найден" })).toBeVisible();
  await checkin.keyboard.press("Enter");
  await expect(checkin.getByText("Отмечен — Анна Иванова")).toBeVisible();
  await expect(checkin.getByText("Пришло 1 из 2")).toBeVisible();

  await expect(arrived).toHaveAttribute("aria-valuenow", "1");
  await expect(cabinet.getByRole("button", { name: /Снять отметку/ })).toHaveCount(1);
  expect(await cabinet.evaluate(() => "notReloaded" in window)).toBe(true);

  await code.fill(`${ticketCode.slice(0, 4)}-${ticketCode.slice(4)}`);
  await code.press("Enter");
  await expect(checkin.getByRole("alert")).toHaveText(/^Уже прошёл в \d{2}:\d{2} — Анна Иванова$/);
  await expect(checkin.getByText("Пришло 1 из 2")).toBeVisible();
  await expect(arrived).toHaveAttribute("aria-valuenow", "1");

  await desk.close();
  await entrance.close();
});
