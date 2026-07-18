import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@agent-diaries/shared": path.resolve(__dirname, "src/shared/index.ts"),
      "@agent-diaries/core": path.resolve(__dirname, "src/core/index.ts"),
      "@agent-diaries/memory": path.resolve(__dirname, "src/memory/index.ts"),
      "@agent-diaries/redis": path.resolve(__dirname, "src/redis/index.ts"),
      "@agent-diaries/postgres": path.resolve(__dirname, "src/postgres/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    setupFiles: [],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json"],
    },
    reporters: ["default", "junit"],
    outputFile: "test-report.junit.xml",
  },
});
