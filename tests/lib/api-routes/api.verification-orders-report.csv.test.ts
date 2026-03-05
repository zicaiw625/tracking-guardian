import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  shop: {
    findUnique: vi.fn(),
  },
}));

const mockReconciliation = vi.hoisted(() => vi.fn());

vi.mock("../../../app/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: "demo.myshopify.com" },
    })),
  },
}));

vi.mock("../../../app/db.server", () => ({
  default: mockPrisma,
}));

vi.mock("../../../app/services/verification/order-reconciliation.server", () => ({
  performPixelVsOrderReconciliation: mockReconciliation,
}));

import { loader } from "../../../app/lib/api-routes/api.verification-orders-report.csv";

describe("api.verification-orders-report.csv gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks export for plans without reconciliation access", async () => {
    vi.mocked(mockPrisma.shop.findUnique).mockResolvedValue({
      id: "shop-1",
      shopDomain: "demo.myshopify.com",
      plan: "starter",
      entitledUntil: null,
    } as never);

    const response = await loader({
      request: new Request("https://example.com/api/verification-orders-report.csv?hours=24"),
    } as any);

    expect(response.status).toBe(402);
    expect(mockReconciliation).not.toHaveBeenCalled();
  });

  it("allows export for growth and above", async () => {
    vi.mocked(mockPrisma.shop.findUnique).mockResolvedValue({
      id: "shop-1",
      shopDomain: "demo.myshopify.com",
      plan: "growth",
      entitledUntil: null,
    } as never);
    vi.mocked(mockReconciliation).mockResolvedValue({
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      periodEnd: new Date("2026-03-02T00:00:00.000Z"),
      totalOrders: 10,
      ordersWithPixel: 9,
      discrepancyRate: 10,
      missingOrderIds: [],
      valueMismatches: [],
    });

    const response = await loader({
      request: new Request("https://example.com/api/verification-orders-report.csv?hours=24"),
    } as any);

    expect(response.status).toBe(200);
    expect(mockReconciliation).toHaveBeenCalledWith("shop-1", 24);
  });
});
