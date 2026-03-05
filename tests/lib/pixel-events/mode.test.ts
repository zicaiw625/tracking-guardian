import { describe, expect, it } from "vitest";
import { inferPixelModeFromMappings } from "../../../app/lib/pixel-events/constants";

describe("inferPixelModeFromMappings", () => {
  it("returns full_funnel when any funnel event exists", () => {
    const mode = inferPixelModeFromMappings({
      checkout_completed: "purchase",
      page_viewed: "PageView",
    });
    expect(mode).toBe("full_funnel");
  });

  it("returns purchase_only when only checkout_completed exists", () => {
    const mode = inferPixelModeFromMappings({
      checkout_completed: "purchase",
    });
    expect(mode).toBe("purchase_only");
  });
});
