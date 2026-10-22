import { BRAND, codeBlock, headingBlock, layout, paragraphBlock, type Rendered } from "./layout.ts";

export interface LoginCodeMail {
  code: string;
}

/** Код входа в «Мои регистрации» (D-057): действует 10 минут; события в письме нет, код не привязан к нему. */
export function loginCodeMail({ code }: LoginCodeMail): Rendered {
  return {
    subject: `Код для входа: ${code}`,
    text: [
      `Код для входа: ${code}`,
      "",
      "Введите его на странице входа в «Мои регистрации».",
      "Код действует 10 минут.",
      "",
      `Если вы не запрашивали вход, просто проигнорируйте письмо. — ${BRAND}`,
    ].join("\n"),
    html: layout(
      [
        headingBlock("Код для входа", "Вход в «Мои регистрации»"),
        codeBlock("Код", "Действует 10 минут", code),
        paragraphBlock("Введите код на странице входа, чтобы увидеть свои регистрации."),
      ],
      "Кто-то запросил вход с этим адресом. Если это были не вы, просто проигнорируйте письмо: без кода никто ничего не увидит.",
    ),
  };
}
