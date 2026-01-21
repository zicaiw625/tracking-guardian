import "./survey-jwt-env";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@shopify/shopify-app-session-storage-prisma", () => ({
  PrismaSessionStorage: class {
    constructor(_prisma: unknown) {}
  },
}));

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
    },
    conversionLog: {
      findFirst: vi.fn(),
    },
    surveyResponse: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../app/middleware/rate-limit", () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({
    allowed: true,
    resetAt: Date.now() + 60000,
    retryAfter: undefined,
  }),
  withRateLimit: (_config: unknown) => (handler: (a: unknown) => Promise<Response>) => handler,
  pathShopKeyExtractor: () => "key",
}));

vi.mock("../../app/utils/public-auth", () => ({
  authenticatePublic: vi.fn(),
  normalizeDestToShopDomain: (d: string) => {
    try {
      return new URL(d).hostname;
    } catch {
      return d.replace(/^https?:\/\//, "").split("/")[0];
    }
  },
  handlePublicPreflight: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  addSecurityHeaders: (r: Response) => r,
}));

vi.mock("../../app/services/ui-extension.server", () => ({
  canUseModule: vi.fn().mockResolvedValue({ allowed: true }),
  getUiModuleConfigs: vi.fn().mockResolvedValue([{ moduleKey: "survey", isEnabled: true }]),
}));

import { authenticatePublic } from "../../app/utils/public-auth";
import prisma from "../../app/db.server";
import { action } from "../../app/routes/api.survey/route";

const authSuccess = {
  sessionToken: { dest: "https://test-shop.myshopify.com" },
  cors: (r: Response) => r,
};

describe("P1-4: Survey API (authenticatePublic)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticatePublic).mockResolvedValue(authSuccess);
  });
  describe("Missing / Invalid auth → 401", () => {
    it("returns 401 when authenticatePublic rejects (no valid session token)", async () => {
      vi.mocked(authenticatePublic).mockRejectedValue(new Error("not authenticated"));
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer any" },
        body: JSON.stringify({ orderId: "12345", rating: 5 }),
      });
      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("Unauthorized");
    });
    it("returns 401 for invalid or forged token (authenticatePublic rejects)", async () => {
      vi.mocked(authenticatePublic).mockRejectedValue(new Error("Invalid signature"));
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer not-a-valid-jwt" },
        body: JSON.stringify({ orderId: "12345", rating: 5 }),
      });
      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("Unauthorized");
    });
  });

  describe("Valid session → request processed", () => {
    it("returns 200 and creates survey response when authenticatePublic resolves", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id-123",
        shopDomain: "test-shop.myshopify.com",
        isActive: true,
      } as any);
      vi.mocked(prisma.surveyResponse.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.surveyResponse.create).mockResolvedValue({
        id: "survey-id-123",
        shopId: "shop-id-123",
        orderId: "12345",
      } as any);
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer session-token" },
        body: JSON.stringify({ orderId: "12345", rating: 5, source: "social" }),
      });
      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.id).toBe("survey-id-123");
    });
    it("updates existing survey response instead of creating duplicate", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id-123",
        shopDomain: "test-shop.myshopify.com",
        isActive: true,
      } as any);
      vi.mocked(prisma.surveyResponse.findFirst).mockResolvedValue({
        id: "existing-survey-id",
        shopId: "shop-id-123",
        orderId: "12345",
      } as any);
      vi.mocked(prisma.surveyResponse.update).mockResolvedValue({
        id: "existing-survey-id",
      } as any);
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer session-token" },
        body: JSON.stringify({ orderId: "12345", rating: 5 }),
      });
      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toContain("updated");
      expect(prisma.surveyResponse.update).toHaveBeenCalled();
    });
  });

  describe("Shop status validation", () => {
    it("returns 404 when shop not found", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue(null);
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer session-token" },
        body: JSON.stringify({ orderId: "12345", rating: 5 }),
      });
      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Shop not found");
    });
    it("returns 403 when shop is not active", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id-123",
        shopDomain: "test-shop.myshopify.com",
        isActive: false,
      } as any);
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer session-token" },
        body: JSON.stringify({ orderId: "12345", rating: 5 }),
      });
      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("not active");
    });
  });

  describe("Request validation", () => {
    it("returns 415 for non-JSON Content-Type", async () => {
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: { "Content-Type": "text/plain", "Authorization": "Bearer session-token" },
        body: "not json",
      });
      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(415);
    });
    it("returns 405 for non-POST methods (except OPTIONS)", async () => {
      const request = new Request("https://example.com/api/survey", {
        method: "GET",
        headers: {},
      });
      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(405);
    });
    it("returns 204 for OPTIONS (CORS preflight)", async () => {
      const request = new Request("https://example.com/api/survey", {
        method: "OPTIONS",
        headers: { "Origin": "https://test-shop.myshopify.com", "Access-Control-Request-Method": "POST" },
      });
      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(204);
    });
  });
});

describe("CSRF prevention (authenticatePublic)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when authenticatePublic rejects (e.g. fake token)", async () => {
    vi.mocked(authenticatePublic).mockRejectedValue(new Error("invalid"));
    const request = new Request("https://example.com/api/survey", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://attacker.example.com",
        "Authorization": "Bearer fake-token",
      },
      body: JSON.stringify({ orderId: "victim-order-123", rating: 1 }),
    });
    const response = await action({ request, params: {}, context: {} });
    expect(response.status).toBe(401);
  });

  it("returns 200 when authenticatePublic resolves (Origin does not affect auth)", async () => {
    vi.mocked(authenticatePublic).mockResolvedValue(authSuccess);
    vi.mocked(prisma.shop.findUnique).mockResolvedValue({ id: "shop-id", isActive: true } as any);
    vi.mocked(prisma.surveyResponse.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.surveyResponse.create).mockResolvedValue({ id: "survey-id" } as any);
    const request = new Request("https://example.com/api/survey", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://attacker.example.com",
        "Authorization": "Bearer session-token",
      },
      body: JSON.stringify({ orderId: "12345", rating: 5 }),
    });
    const response = await action({ request, params: {}, context: {} });
    expect(response.status).toBe(200);
  });
});
