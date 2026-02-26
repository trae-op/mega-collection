import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
        "vitest.config.ts",
        "tsup.config.ts",
        "src/index.ts",
        "src/filter/index.ts",
        "src/search/index.ts",
        "src/sort/index.ts",
        "src/merge/index.ts",
        "src/types.ts",
      ],
    },
  },
});
