import { expect, test } from "@playwright/test";
import { codeFromMail } from "../support/mailpit.ts";
import { createEvent, rewind, uniqueEmail } from "../support/setup.ts";

test("каталог → вход участника по коду → регистрация без кода → «Мои регистрации»", async ({ page, request, browser }) => {
  const email = uniqueEmail("anna");
  const title = `Каталог ${uniqueEmail("t")}`;
  const city = `Тестоград ${Date.now()}`;
  const eventId = await createEvent(request, { title, city, category: "lecture", minAge: 0 });

  // Каталог: фильтр по городу оставляет карточку, у неё бейдж «0+» и нет одинокого «0» (D-060).
  await page.goto("/");
  await page.getByRole("button", { name: /^Город:/ }).click();
  await page.getByRole("option", { name: city }).click();
  const card = page.getByRole("link", { name: new RegExp(title) });
  await expect(card).toBeVisible();
  await expect(card.getByText("0+", { exact: true })).toBeVisible();
  await expect(card.getByText("0", { exact: true })).toHaveCount(0);

  // Гость на странице события идёт во вход и после кода возвращается на неё же.
  await card.click();
  await expect(page).toHaveURL(`/e/${eventId}`);
  await page.getByRole("link", { name: "Войти, чтобы регистрироваться без кода" }).click();
  await expect(page).toHaveURL(`/me?next=/e/${eventId}`);
  // Поле «Email» есть и у формы события: ждём страницу входа, иначе `fill` попадёт в уходящую форму.
  await expect(page.getByRole("heading", { name: "Мои регистрации" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Код из письма").fill(await codeFromMail(email, 1, "Код для входа"));
  await page.getByRole("button", { name: "Подтвердить" }).click();
  await expect(page).toHaveURL(`/e/${eventId}`);

  // Вошедшему поля email нет, код не нужен.
  await expect(page.getByText(`Регистрируем на ${email}`)).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await page.getByLabel("Имя").fill("Анна");
  await page.getByLabel("Фамилия").fill("Иванова");
  await page.getByLabel("Дата рождения").fill("1994-03-14");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByRole("heading", { name: "Место ваше" })).toBeVisible();

  // «Мои регистрации» из шапки: событие во вкладке «Текущие» со статусом «Место ваше».
  await page.goto("/");
  await page.getByRole("link", { name: "Мои регистрации" }).click();
  await expect(page).toHaveURL("/me");
  await expect(page.getByRole("tab", { name: /^Текущие/ })).toHaveAttribute("aria-selected", "true");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText(/^Место ваше/)).toBeVisible();

  // Вернувшийся участник в чистом браузере входит по ссылке другого события: форма уже предзаполнена из `lastData`.
  const other = await createEvent(request, { title: `${title} 2`, city, category: "lecture", minAge: 0 });
  await rewind({ email }); // новый код входа тому же адресу раньше минуты не выдаётся
  const fresh = await browser.newContext();
  const again = await fresh.newPage();
  await again.goto(`/e/${other}`);
  await again.getByRole("link", { name: "Войти, чтобы регистрироваться без кода" }).click();
  await expect(again).toHaveURL(`/me?next=/e/${other}`);
  await expect(again.getByRole("heading", { name: "Мои регистрации" })).toBeVisible();
  await again.getByLabel("Email", { exact: true }).fill(email);
  await again.getByRole("button", { name: "Получить код" }).click();
  await again.getByLabel("Код из письма").fill(await codeFromMail(email, 2, "Код для входа"));
  await again.getByRole("button", { name: "Подтвердить" }).click();
  await expect(again).toHaveURL(`/e/${other}`);
  await expect(again.getByLabel("Имя")).toHaveValue("Анна");
  await expect(again.getByLabel("Фамилия")).toHaveValue("Иванова");
  await expect(again.getByLabel("Дата рождения")).toHaveValue("1994-03-14");
  await fresh.close();
});
