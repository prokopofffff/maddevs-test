import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "integration",
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/setup/global-setup.ts"],
    setupFiles: ["test/setup/worker-db.ts"],
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
