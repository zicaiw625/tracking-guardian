import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("app billing upgrade auto-submit guard", () => {
  it("should include one-shot ref guard for upgrade auto submit", () => {
    const filePath = resolve(process.cwd(), "app/routes/app.billing.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("attemptedUpgradeRef");
    expect(source).toContain("attemptedUpgradeRef.current === upgradePlanId");
    expect(source).toContain("attemptedUpgradeRef.current = upgradePlanId");
  });

  it("should keep app bridge remote redirect and upgrade query cleanup", () => {
    const filePath = resolve(process.cwd(), "app/routes/app.billing.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("Redirect.Action.REMOTE");
    expect(source).toContain("window.history.replaceState");
    expect(source).toContain("url.searchParams.delete(\"upgrade\")");
  });
});
