import { expect, test } from "@playwright/test";
import { codeFromMail, mailText, personalLinkIn } from "../support/mailpit.ts";
import { createEvent, uniqueEmail } from "../support/setup.ts";

test("регистрация: форма → код из письма → «Место ваше» → письмо с билетом", async ({ page, request }) => {
  const email = uniqueEmail("anna");
  const eventId = await createEvent(request);

  await page.goto(`/e/${eventId}`);
  await page.getByLabel("Имя").fill("Анна");
  await page.getByLabel("Фамилия").fill("Иванова");
  await page.getByLabel("Дата рождения").fill("1994-03-14");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Получить код" }).click();

  await expect(page.getByRole("heading", { name: "Введите код" })).toBeVisible();
  await page.getByLabel("Код из письма").fill(await codeFromMail(email));
  await page.getByRole("button", { name: "Подтвердить" }).click();

  await expect(page.getByRole("heading", { name: "Место ваше" })).toBeVisible();
  const mail = await mailText(email, "Ваш билет");
  const ticket = mail.match(/Код билета: ([A-Z0-9]{4}-[A-Z0-9]{4})/)![1]!;
  await expect(page.getByText(ticket)).toBeVisible();
  const link = personalLinkIn(mail);
  await expect(page.getByRole("link", { name: "Моя регистрация" })).toHaveAttribute("href", new URL(link).pathname);

  await page.goto(link);
  await expect(page.getByText("Подтверждена")).toBeVisible();
  await expect(page.getByText(ticket)).toBeVisible();
});
