import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "bb-plugin-better-notes",
    testTimeout: 15_000,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
