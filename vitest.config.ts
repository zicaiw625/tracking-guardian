import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "app/**/*.{spec,test}.{ts,tsx}"],
    exclude: ["node_modules", "build", "extensions", "app/routes/app.pixels.$id.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["app/**/*.{ts,tsx}"],
      exclude: ["node_modules", "*.d.ts", "**/schemas/**"],
      // P2: Enforce a baseline to prevent accidental coverage regression.
      // Raise these thresholds over time as coverage improves.
      thresholds: {
        lines: 14,
        statements: 14,
        functions: 29,
        branches: 60,
      },
    },
  },
});
