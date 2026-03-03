import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("app diagnostics race guard", () => {
  it("uses request id guard to prevent stale response override", () => {
    const filePath = resolve(process.cwd(), "app/routes/app.diagnostics.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("latestCorsCheckIdRef");
    expect(source).toContain("const checkId = ++latestCorsCheckIdRef.current");
    expect(source).toContain("if (checkId !== latestCorsCheckIdRef.current)");
  });
});
