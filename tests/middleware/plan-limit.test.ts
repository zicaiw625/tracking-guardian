import { describe, it, expect, vi } from "vitest";
import { createContext } from "../../app/middleware/types";
import { withPlanLimit } from "../../app/middleware/plan-limit";

vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => {
      throw new Error("auth failed");
    }),
  },
}));

vi.mock("../../app/services/billing/limits.server", () => ({
  checkPixelDestinationsLimit: vi.fn(),
  checkUiModulesLimit: vi.fn(),
  checkMultiShopLimit: vi.fn(),
}));

describe("withPlanLimit", () => {
  it("fails closed when plan check throws", async () => {
    const request = new Request("https://example.com/app");
    const middleware = withPlanLimit({ limitType: "pixel_destinations" });

    const result = await middleware(createContext(request));
    expect(result.continue).toBe(false);

    if (!result.continue) {
      expect(result.response.status).toBe(401);
    }
  });
});
