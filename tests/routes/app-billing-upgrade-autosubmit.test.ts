import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("app billing upgrade auto-submit guard", () => {
  it("should include one-shot guard state for upgrade auto submit", () => {
    const filePath = resolve(process.cwd(), "app/routes/app.billing.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("attemptedUpgradePlanId");
    expect(source).toContain("attemptedUpgradePlanId !== upgradePlanId");
    expect(source).toContain("setAttemptedUpgradePlanId(upgradePlanId)");
  });
});
