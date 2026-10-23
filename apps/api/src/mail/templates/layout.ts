/**
 * Каркас HTML-письма по рамке `S10-Email`: таблицы, inline-стили, карточка 600 px,
 * на узком экране — флюидная (D-025). Шаблоны собирают письмо из блоков ниже.
 */

import type { EventFormat } from "../../schemas/event.ts";

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

export const BRAND = "Регистрация на мероприятия";

const FONT = "Onest,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono','Courier New',monospace";
const INK = "#0F0F10";
const MUTED = "#5A5A5E";
const LINE = "#D9D9D5";
const ACCENT = "#D4FF3A";

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const row = (style: string, content: string) =>
  `<tr><td style="${style}font-family:${FONT};">${content}</td></tr>`;

/** Подзаголовок и крупный заголовок письма. */
export const headingBlock = (eyebrow: string, heading: string) =>
  row(
    "padding:32px 32px 8px;",
    `<p style="margin:0 0 12px;font-size:14px;line-height:20px;font-weight:600;color:${MUTED};">${escapeHtml(eyebrow)}</p>` +
      `<h1 style="margin:0;font-size:40px;line-height:44px;font-weight:800;letter-spacing:-1.6px;color:${INK};">${escapeHtml(heading)}</h1>`,
  );

/** Место события для письма: офлайн — «город, адрес», онлайн — «Онлайн» (D-059). */
export interface EventPlace {
  format: EventFormat;
  city: string | null;
  address: string | null;
}

/** Строка места: у офлайн-события город и адрес есть всегда (D-059), у онлайн их нет. */
export const placeLine = ({ format, city, address }: EventPlace) =>
  format === "online" ? "Онлайн" : [city, address].filter(Boolean).join(", ");

/**
 * Название события и время в его поясе; `place` — строка места сразу под временем (адрес — свободный текст
 * организатора, экранируется как всё остальное); `note` — абзац под ними, как пояснение в s10b.
 */
export const eventBlock = (title: string, time: string, note?: string, place?: string) =>
  row(
    "padding:16px 32px 24px;",
    `<p style="margin:0 0 4px;font-size:18px;line-height:26px;font-weight:700;color:${INK};">${escapeHtml(title)}</p>` +
      `<p style="margin:0;font-size:16px;line-height:24px;color:${INK};">${escapeHtml(time)}</p>` +
      (place ? `<p style="margin:0;font-size:16px;line-height:24px;color:${INK};">${escapeHtml(place)}</p>` : "") +
      (note ? `<p style="margin:16px 0 0;font-size:16px;line-height:24px;color:${INK};">${escapeHtml(note)}</p>` : ""),
  );

/** Рамка с подписью и крупным моноширинным кодом — билет или код подтверждения (D-023). */
export const codeBlock = (label: string, note: string, code: string) =>
  `<tr><td style="padding:0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${INK};border-radius:14px;border-collapse:separate;"><tbody>` +
  `<tr><td style="padding:14px 20px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:700;color:${INK};">${escapeHtml(label)}</td>` +
  `<td align="right" style="padding:14px 20px;font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED};">${escapeHtml(note)}</td></tr>` +
  `<tr><td colspan="2" align="center" bgcolor="${ACCENT}" style="padding:24px 8px;font-size:36px;line-height:40px;letter-spacing:2px;background:${ACCENT};border-top:2px dashed ${INK};border-radius:0 0 12px 12px;font-family:${MONO};font-weight:800;color:${INK};white-space:nowrap;">${escapeHtml(code)}</td></tr>` +
  `</tbody></table></td></tr>`;

/** Кнопка-ссылка и пояснение под ней. */
export const buttonBlock = (label: string, href: string, note: string) =>
  row(
    "padding:28px 32px 8px;",
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td bgcolor="${ACCENT}" style="background:${ACCENT};border:2px solid ${INK};border-radius:8px;">` +
      `<a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:${INK};text-decoration:none;">${escapeHtml(label)}</a>` +
      `</td></tr></tbody></table>` +
      `<p style="margin:14px 0 0;font-size:14px;line-height:20px;color:${MUTED};">${escapeHtml(note)}</p>` +
      `<p style="margin:8px 0 0;font-size:12px;line-height:18px;color:${MUTED};word-break:break-all;">${escapeHtml(href)}</p>`,
  );

/** Абзац обычного текста. */
export const paragraphBlock = (text: string) =>
  row("padding:24px 32px 0;", `<p style="margin:0;font-size:16px;line-height:24px;color:${INK};">${escapeHtml(text)}</p>`);

/** Пары «подпись — значение» строками, как список данных участника в S4. */
export const detailsBlock = (rows: [label: string, value: string][]) =>
  row(
    "padding:16px 32px 0;",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody>` +
      rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED};">${escapeHtml(label)}</td>` +
            `<td align="right" style="padding:8px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:16px;line-height:24px;font-weight:700;color:${INK};">${escapeHtml(value)}</td></tr>`,
        )
        .join("") +
      `</tbody></table>`,
  );

/** Письмо целиком: фон, карточка, шапка с названием сервиса, блоки и мелкий текст внизу. */
export function layout(blocks: string[], footer: string) {
  return (
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#F3F3F1;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F3F1" style="background:#F3F3F1;"><tbody><tr><td align="center" style="padding:32px 12px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px;max-width:100%;background:#FFFFFF;border:2px solid ${INK};border-radius:14px;border-collapse:separate;"><tbody>` +
    `<tr><td style="padding:24px 32px;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:20px;line-height:24px;font-weight:800;letter-spacing:-0.5px;color:${INK};">` +
    `<span style="display:inline-block;width:12px;height:12px;background:${ACCENT};border:2px solid ${INK};border-radius:4px;margin-right:8px;"></span>${BRAND}</td></tr>` +
    blocks.join("") +
    row(
      "padding:28px 32px 32px;",
      `<p style="margin:0;padding-top:20px;border-top:1px solid ${LINE};font-size:12px;line-height:18px;color:${MUTED};">${escapeHtml(footer)}</p>`,
    ) +
    `</tbody></table></td></tr></tbody></table></body></html>`
  );
}
