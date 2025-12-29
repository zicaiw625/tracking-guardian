import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["***.test.tsx"],
    exclude: ["node_modules", "build", "extensions"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: [
        "app*.ts",
        "app*.tsx",
      ],
      exclude: [
        "node_modules",
        "build",
        "extensions",
        "**
*.test.ts",
        "**
types
schemas

