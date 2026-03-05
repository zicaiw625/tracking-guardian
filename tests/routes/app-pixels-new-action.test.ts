import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  shop: {
    findUnique: vi.fn(),
  },
  pixelConfig: {
    findFirst: vi.fn(),
  },
}));

const mockRequireEntitlementOrThrow = vi.hoisted(() => vi.fn());

vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: "demo.myshopify.com" },
      admin: {},
    })),
  },
}));

vi.mock("../../app/i18n.server", () => ({
  i18nServer: {
    getFixedT: vi.fn(async () => ((key: string) => key)),
  },
}));

vi.mock("../../app/db.server", () => ({
  default: mockPrisma,
}));

vi.mock("../../app/utils/plans", () => ({
  isPlanAtLeast: vi.fn(() => true),
}));

vi.mock("../../app/services/billing/plans", () => ({
  normalizePlanId: vi.fn((plan: string) => plan),
}));

vi.mock("../../app/services/billing/effective-plan.server", () => ({
  resolveEffectivePlan: vi.fn(() => "starter"),
}));

vi.mock("../../app/services/migration.server", () => ({
  createWebPixel: vi.fn(),
  getExistingWebPixels: vi.fn(async () => []),
  isOurWebPixel: vi.fn(() => false),
  syncWebPixelMode: vi.fn(),
}));

vi.mock("../../app/services/billing/entitlement.server", () => ({
  requireEntitlementOrThrow: mockRequireEntitlementOrThrow,
}));

vi.mock("../../app/services/db/pixel-config-repository.server", () => ({
  upsertPixelConfig: vi.fn(),
}));

import { action } from "../../app/routes/app.pixels.new/action.server";

describe("app.pixels.new action full_funnel entitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockPrisma.pixelConfig.findFirst).mockResolvedValue(null);
    vi.mocked(mockPrisma.shop.findUnique).mockResolvedValue({
      id: "shop-1",
      shopDomain: "demo.myshopify.com",
      ingestionSecret: null,
      webPixelId: null,
      plan: "starter",
      entitledUntil: null,
    } as any);
  });

  it("returns 403 when starter submits funnel event mappings", async () => {
    vi.mocked(mockRequireEntitlementOrThrow).mockRejectedValue(
      new Response(JSON.stringify({ error: "Feature not available" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const formData = new FormData();
    formData.set("_action", "savePixelConfigs");
    formData.set(
      "configs",
      JSON.stringify([
        {
          platform: "google",
          platformId: "",
          credentials: {},
          serverSideEnabled: false,
          eventMappings: { page_viewed: "page_view" },
          environment: "live",
        },
      ])
    );

    const response = await action({
      request: new Request("http://localhost/app/pixels/new", {
        method: "POST",
        body: formData,
      }),
    } as any);

    expect(response.status).toBe(403);
    expect(mockRequireEntitlementOrThrow).toHaveBeenCalledWith("shop-1", "full_funnel");
  });
});
