import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    alias: {
      obsidian: "./tests/__mocks__/obsidian.ts"
    }
  },
  resolve: {
    alias: {
      obsidian: "./tests/__mocks__/obsidian.ts"
    }
  }
});
