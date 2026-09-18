import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "bb-plugin-agent-browser",
    globals: true,
    testTimeout: 15_000,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
