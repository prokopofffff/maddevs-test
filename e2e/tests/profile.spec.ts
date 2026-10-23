import { expect, test, type Page } from "@playwright/test";
import { codeFromMail } from "../support/mailpit.ts";
import { createEvent, dropProfile, uniqueEmail } from "../support/setup.ts";

/** Вход на `/me` по коду из письма — как у участника в браузере. */
async function signIn(page: Page, email: string) {
  await page.goto("/me");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Код из письма").fill(await codeFromMail(email, 1, "Код для входа"));
  await page.getByRole("button", { name: "Подтвердить" }).click();
}

test("профиль: первое заполнение → регистрация одной кнопкой → смена даты рождения отменяет 18+ после подтверждения", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("profile");
  const stamp = uniqueEmail("t");
  const open = { title: `Открытый ${stamp}`, minAge: 0 };
  const adult = { title: `Ночной квиз ${stamp}`, minAge: 18 };
  const another = { title: `Другой взрослый ${stamp}`, minAge: 18 };
  const openId = await createEvent(request, open);
  const adultId = await createEvent(request, adult);
  const anotherId = await createEvent(request, another);
  const racedId = await createEvent(request, { title: `Без профиля ${stamp}`, minAge: 0 });

  // Первый вход: профиля нет — вместо списка форма «Расскажите о себе».
  await signIn(page, email);
  await expect(page.getByRole("heading", { name: "Расскажите о себе" })).toBeVisible();
  await page.getByLabel("Имя").fill("Анна");
  await page.getByLabel("Фамилия").fill("Иванова");
  await page.getByLabel("Дата рождения").fill("1994-03-14");
  await page.getByRole("button", { name: "Сохранить" }).click();
  const profile = page.getByRole("region", { name: "Профиль" });
  await expect(profile).toContainText("Анна Иванова · 14 марта 1994");
  await expect(page.getByText("Вы пока никуда не зарегистрированы")).toBeVisible();
  // @shot me-profile

  // Событие: строка профиля и одна кнопка, формы нет.
  await page.goto(`/e/${openId}`);
  await expect(page.getByText("Регистрируем: Анна Иванова, 14 марта 1994")).toBeVisible();
  await expect(page.getByLabel("Имя")).toHaveCount(0);
  // @shot event-one-click
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByRole("heading", { name: "Место ваше" })).toBeVisible();

  await page.goto(`/e/${adultId}`);
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByRole("heading", { name: "Место ваше" })).toBeVisible();

  // Дата рождения в будущем — ошибка под полем, профиль не меняется.
  await page.goto("/me");
  await profile.getByRole("button", { name: "Изменить" }).click();
  await page.getByLabel("Дата рождения").fill("2999-01-01");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Дата рождения не может быть в будущем")).toBeVisible();

  // Дата 2010 года не проходит на «18+»: диалог перечисляет событие, «Не сохранять» ничего не меняет.
  await page.getByLabel("Дата рождения").fill("2010-05-05");
  await page.getByRole("button", { name: "Сохранить" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Регистрации будут отменены" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${adult.title} — с 18 лет`);
  await expect(dialog).not.toContainText(open.title);
  // Перечень событий входит в описание диалога: скринридер читает его вместе с текстом.
  await expect(dialog).toHaveAccessibleDescription(new RegExp(`${adult.title} — с 18 лет`));
  // @shot conflict-dialog
  await dialog.getByRole("button", { name: "Не сохранять" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Отмена" }).click();
  await expect(profile).toContainText("Анна Иванова · 14 марта 1994");
  await expect(profile.getByRole("button", { name: "Изменить" })).toBeFocused();
  await expect(page.getByRole("listitem").filter({ hasText: adult.title })).toContainText("Место ваше");

  // Повторяем и подтверждаем: регистрация 18+ отменена, открытая осталась, профиль новый.
  await profile.getByRole("button", { name: "Изменить" }).click();
  await page.getByLabel("Имя").fill("Аня");
  await page.getByLabel("Дата рождения").fill("2010-05-05");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await dialog.getByRole("button", { name: "Сохранить и отменить" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`Отменены регистрации: ${adult.title}`)).toBeVisible();
  await expect(profile).toContainText("Аня Иванова · 5 мая 2010");
  // Форма закрылась, фокус не теряется на `body`.
  await expect(profile.getByRole("button", { name: "Изменить" })).toBeFocused();
  await expect(page.getByRole("listitem").filter({ hasText: open.title })).toContainText("Место ваше");
  await page.getByRole("tab", { name: /^Прошедшие/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: adult.title })).toContainText("Отменена");

  // На другое «18+» кнопка выключена заранее, с подсказкой.
  await page.goto(`/e/${anotherId}`);
  await expect(page.getByText("Регистрируем: Аня Иванова, 5 мая 2010")).toBeVisible();
  await expect(page.getByRole("button", { name: "Зарегистрироваться" })).toBeDisabled();
  await expect(page.getByText("Регистрация с 18 лет на день события")).toBeVisible();
  // @shot event-too-young

  // Профиль пропал, пока страница была открыта: `409 profile_required` возвращает форму с пояснением,
  // и регистрация с данными формы снова создаёт профиль.
  await page.goto(`/e/${racedId}`);
  await expect(page.getByText("Регистрируем: Аня Иванова, 5 мая 2010")).toBeVisible();
  await dropProfile(email);
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByText("Профиль не найден — заполните данные ниже")).toBeVisible();
  await page.getByLabel("Имя").fill("Анна");
  await page.getByLabel("Фамилия").fill("Иванова");
  await page.getByLabel("Дата рождения").fill("1994-03-14");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByRole("heading", { name: "Место ваше" })).toBeVisible();
  await page.goto("/me");
  await expect(page.getByRole("region", { name: "Профиль" })).toContainText("Анна Иванова · 14 марта 1994");
});
