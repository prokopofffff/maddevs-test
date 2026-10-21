// Стили приложения берутся из шаблона дизайна как есть (D-025, D-027):
// из <style> выкидываются только правила страницы-спецификации (.spec-*),
// hover-фон #FAFAF8 становится токеном --color-hover (SPEC, раздел 8).
import { readFileSync, writeFileSync } from "node:fs";

const template = readFileSync(new URL("../../../docs/design/template.html", import.meta.url), "utf8");
const style = template.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!style) throw new Error("В docs/design/template.html нет <style>");

const specStart = style.indexOf("/* =====================================================================\n   СТРАНИЦА-СПЕЦИФИКАЦИЯ");
const specEnd = style.indexOf(".s2-back");
if (specStart < 0 || specEnd < specStart) throw new Error("Не нашёл границы блока страницы-спецификации");

const css = (style.slice(0, specStart) + style.slice(specEnd))
  .replace("--color-focus: #0F0F10;", "--color-focus: #0F0F10;\n  --color-hover: #FAFAF8;")
  .replaceAll("background: #FAFAF8;", "background: var(--color-hover);");

if (css.includes("#FAFAF8;\n") && !css.includes("--color-hover: #FAFAF8;")) throw new Error("hover-фон не вынесен в токен");

writeFileSync(
  new URL("../src/styles/template.css", import.meta.url),
  `/* Сгенерировано scripts/extract-template-css.mjs из docs/design/template.html — не править руками. */\n${css.trim()}\n`,
);
