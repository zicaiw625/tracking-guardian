import { describe, expect, it } from "vitest";
import { createConsentManager } from "../../extensions/tracking-pixel/src/consent";

describe("consent manager compatibility", () => {
  it("accepts analyticsAllowed alias", () => {
    const consentManager = createConsentManager();
    consentManager.updateFromStatus(
      {
        analyticsAllowed: true,
        marketingAllowed: false,
      },
      "init"
    );
    expect(consentManager.analyticsAllowed).toBe(true);
  });
});
