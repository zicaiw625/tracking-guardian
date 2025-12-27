import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", "build", "extensions"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: [
        "app/**/*.ts",
        "app/**/*.tsx",
      ],
      exclude: [
        "node_modules",
        "build",
        "extensions",
        "**/*.d.ts",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/types/**",
        "**/schemas/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    setupFiles: ["./tests/setup.ts"],

    testTimeout: 10000,
    hookTimeout: 10000,

    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },

    watch: false,

    reporters: ["default", "html"],
    outputFile: {
      html: "./coverage/test-report.html",
    },
  },
});
