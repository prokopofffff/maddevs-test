import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", ".context/**", "apps/api/drizzle/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/api/**/*.ts", "**/*.mjs", "*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/api/test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Серверный код не должен попасть в бандл: из API — только типы и общие схемы (D-024, D-029).
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@app/api(?!/schemas$)",
              allowTypeImports: true,
              message: "Из apps/api во фронт можно импортировать только типы и @app/api/schemas.",
            },
            {
              group: ["**/api/src/**"],
              message: "Импортируйте из @app/api/schemas или только типы из @app/api/app.",
            },
          ],
        },
      ],
    },
  },
);
