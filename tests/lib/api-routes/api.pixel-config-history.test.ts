import { describe, it, expect, vi, beforeEach } from "vitest";
import { loader } from "../../../app/lib/api-routes/api.pixel-config-history";
import { getConfigVersionHistory } from "../../../app/services/pixel-rollback.server";

vi.mock("../../../app/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: "demo.myshopify.com" },
    })),
  },
}));

vi.mock("../../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(async () => ({ id: "shop-1" })),
    },
  },
}));

vi.mock("../../../app/services/pixel-rollback.server", () => ({
  getConfigComparison: vi.fn(async () => null),
  getConfigVersionHistory: vi.fn(async () => []),
}));

describe("api.pixel-config-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("caps history limit to 100", async () => {
    const request = new Request(
      "https://example.com/api/pixel-config-history?platform=meta&type=history&limit=9999"
    );

    const response = await loader({ request } as any);
    expect(response.status).toBe(200);
    expect(getConfigVersionHistory).toHaveBeenCalledWith("shop-1", "meta", 100);
  });

  it("returns 400 for invalid limit", async () => {
    const request = new Request(
      "https://example.com/api/pixel-config-history?platform=meta&type=history&limit=-1"
    );

    const response = await loader({ request } as any);
    expect(response.status).toBe(400);
  });
});
