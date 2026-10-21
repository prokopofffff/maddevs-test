import { defineConfig, devices } from "@playwright/test";
import { baseUrl } from "./env.ts";

/** E2e на собранном приложении, только Chromium (D-028, D-047). */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: baseUrl, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --dir .. build && tsx server.ts",
    url: baseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
  },
});
