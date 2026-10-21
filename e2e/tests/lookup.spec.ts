import { expect, test } from "@playwright/test";
import { codeFromMail } from "../support/mailpit.ts";
import { createEvent, registerParticipant, rewind, uniqueEmail } from "../support/setup.ts";

test("потерял письмо: после начала события email и код открывают регистрацию с билетом", async ({ page, request }) => {
  const email = uniqueEmail("anna");
  const eventId = await createEvent(request);
  const { ticketCode } = await registerParticipant(request, eventId, email);
  await rewind({ email, eventId });

  await page.goto(`/e/${eventId}`);
  await expect(page.getByText("Событие началось — регистрация закрыта")).toBeVisible();
  await expect(page.getByLabel("Имя")).toHaveCount(0);

  await page.getByText("Уже регистрировались? Откройте свою регистрацию").click();
  await page.getByLabel("Email, указанный при регистрации").fill(email.toUpperCase());
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Код из письма").fill(await codeFromMail(email, 2));
  await page.getByRole("button", { name: "Подтвердить" }).click();

  await expect(page).toHaveURL(/\/r\/[\w-]{43}$/);
  await expect(page.getByText(`${ticketCode.slice(0, 4)}-${ticketCode.slice(4)}`)).toBeVisible();
  await expect(page.getByText("Событие началось", { exact: true })).toBeVisible();
});
