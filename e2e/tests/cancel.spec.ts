import { expect, test } from "@playwright/test";
import { mailText, personalLinkIn } from "../support/mailpit.ts";
import { createEvent, registerParticipant, uniqueEmail } from "../support/setup.ts";

test("отказ и повышение: отказ по личной ссылке из письма отдаёт место первому из листа ожидания", async ({
  page,
  request,
}) => {
  const anna = uniqueEmail("anna");
  const boris = uniqueEmail("boris");
  const eventId = await createEvent(request, { limit: 1 });
  const { token } = await registerParticipant(request, eventId, anna);
  const waiting = await registerParticipant(request, eventId, boris);
  const link = personalLinkIn(await mailText(anna, "Ваш билет"));

  // Почтовый сканер открывает ссылку без JS, человек — с JS: ни то ни другое не отменяет.
  expect((await request.get(link)).status()).toBe(200);
  await page.goto(link);
  await expect(page.getByText("Подтверждена")).toBeVisible();
  await page.getByRole("button", { name: "Отказаться от участия" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Отказаться от участия?" });
  await dialog.getByRole("button", { name: "Оставить регистрацию" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Подтверждена")).toBeVisible();
  expect((await (await request.get(`/api/registrations/${token}`)).json()).status).toBe("confirmed");

  await page.getByRole("button", { name: "Отказаться от участия" }).click();
  await dialog.getByRole("button", { name: "Отказаться от участия" }).click();

  await expect(page.getByText("Регистрация отменена")).toBeVisible();
  await expect(page.getByRole("button", { name: "Отказаться от участия" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Страница события" })).toHaveAttribute("href", `/e/${eventId}`);
  await mailText(anna, "Вы отказались от участия");
  const promoted = await mailText(boris, "Для вас освободилось место");
  const { ticketCode } = await (await request.get(`/api/registrations/${waiting.token}`)).json();
  expect(promoted).toContain(`${ticketCode.slice(0, 4)}-${ticketCode.slice(4)}`);
  await page.goto(personalLinkIn(promoted));
  await expect(page.getByText(`${ticketCode.slice(0, 4)}-${ticketCode.slice(4)}`)).toBeVisible();
});
