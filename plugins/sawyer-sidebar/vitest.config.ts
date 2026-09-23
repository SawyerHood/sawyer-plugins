import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-sawyer-sidebar",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
