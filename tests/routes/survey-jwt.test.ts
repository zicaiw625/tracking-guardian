/**
 * P1-4: Survey API JWT Verification Tests
 * 
 * Tests for /api/survey endpoint authentication:
 * - Missing token → 401 Unauthorized
 * - Invalid/forged token → 401 Unauthorized
 * - Valid token → request processed
 * - Shop domain mismatch → 401 Unauthorized
 * 
 * Security model:
 * - CORS is "*" because Shopify extensions run on various domains
 * - Real security comes from JWT signature verification (cryptographic)
 * - Shop domain matching between header and JWT claim
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// Mock all dependencies
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

vi.mock("../../app/utils/rate-limiter", () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({
    isLimited: false,
    remaining: 100,
    resetTime: Date.now() + 60000,
    retryAfter: 0,
  }),
  createRateLimitResponse: vi.fn(),
  SECURITY_HEADERS: {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  },
}));

import prisma from "../../app/db.server";
import { action } from "../../app/routes/api.survey";

// Test secret for JWT signing
const TEST_API_SECRET = "test-api-secret-at-least-16-chars-long";

/**
 * Generate a mock Shopify session token (JWT)
 */
function generateMockJwt(
  payload: {
    iss?: string;
    dest?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    nbf?: number;
    iat?: number;
    jti?: string;
  },
  secret: string = TEST_API_SECRET
): string {
  const header = { alg: "HS256", typ: "JWT" };
  
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iss: "https://test-shop.myshopify.com/admin",
    dest: "https://test-shop.myshopify.com",
    aud: "test-client-id",
    sub: "12345",
    exp: now + 3600, // 1 hour from now
    nbf: now - 60,   // 1 minute ago
    iat: now,
    jti: "unique-token-id-" + Date.now(),
    ...payload,
  };
  
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  
  const signature = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  
  return `${headerB64}.${payloadB64}.${signature}`;
}

describe("P1-4: Survey API JWT Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set the test secret
    process.env.SHOPIFY_API_SECRET = TEST_API_SECRET;
  });

  describe("Missing Token → 401 Unauthorized", () => {
    it("returns 401 when Authorization header is missing", async () => {
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          // No Authorization header
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("Missing authentication token");
    });

    it("returns 401 when Authorization header is empty", async () => {
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": "", // Empty
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
    });
  });

  describe("Invalid/Forged Token → 401 Unauthorized", () => {
    it("returns 401 for completely invalid JWT format", async () => {
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": "Bearer not-a-valid-jwt",
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("Unauthorized");
    });

    it("returns 401 for JWT with invalid signature (forged token)", async () => {
      // Generate a valid-looking JWT but sign with wrong secret
      const forgedToken = generateMockJwt(
        { dest: "https://test-shop.myshopify.com" },
        "wrong-secret-key-not-the-real-one"
      );

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": `Bearer ${forgedToken}`,
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("Invalid signature");
    });

    it("returns 401 for expired JWT", async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = generateMockJwt({
        dest: "https://test-shop.myshopify.com",
        exp: now - 3600, // Expired 1 hour ago
        nbf: now - 7200, // Started 2 hours ago
        iat: now - 7200,
      });

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": `Bearer ${expiredToken}`,
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("expired");
    });

    it("returns 401 for JWT not yet valid (future nbf)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const futureToken = generateMockJwt({
        dest: "https://test-shop.myshopify.com",
        exp: now + 7200, // Expires in 2 hours
        nbf: now + 3600, // Not valid until 1 hour from now
        iat: now,
      });

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": `Bearer ${futureToken}`,
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("not yet valid");
    });

    it("returns 401 for JWT with invalid issuer", async () => {
      const badIssuerToken = generateMockJwt({
        iss: "https://evil-site.com/admin", // Not a Shopify issuer
        dest: "https://test-shop.myshopify.com",
      });

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": `Bearer ${badIssuerToken}`,
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("Invalid issuer");
    });
  });

  describe("Shop Domain Mismatch → 401 Unauthorized", () => {
    it("returns 401 when JWT dest doesn't match shop header", async () => {
      // Token is for shop-a, but request claims to be from shop-b
      const token = generateMockJwt({
        dest: "https://shop-a.myshopify.com",
      });

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "shop-b.myshopify.com", // Different shop!
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("Shop domain mismatch");
    });

    it("returns 401 when shop header is missing", async () => {
      const token = generateMockJwt({
        dest: "https://test-shop.myshopify.com",
      });

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // No X-Shopify-Shop-Domain header
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Missing shop domain");
    });

    it("returns 400 for invalid shop domain format", async () => {
      const token = generateMockJwt({
        dest: "https://test-shop.myshopify.com",
      });

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "not-a-valid-domain.com", // Not myshopify.com
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid shop domain format");
    });
  });

  describe("Valid Token → Request Processed", () => {
    it("returns 200 and creates survey response for valid JWT", async () => {
      const validToken = generateMockJwt({
        dest: "https://test-shop.myshopify.com",
      });

      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id-123",
        shopDomain: "test-shop.myshopify.com",
        isActive: true,
      } as any);

      vi.mocked(prisma.conversionLog.findFirst).mockResolvedValue({
        id: "log-id",
      } as any);

      vi.mocked(prisma.surveyResponse.findFirst).mockResolvedValue(null);

      vi.mocked(prisma.surveyResponse.create).mockResolvedValue({
        id: "survey-id-123",
        shopId: "shop-id-123",
        orderId: "12345",
        rating: 5,
      } as any);

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5,
          source: "social",
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.id).toBe("survey-id-123");
    });

    it("accepts Bearer prefix in Authorization header", async () => {
      const validToken = generateMockJwt({
        dest: "https://test-shop.myshopify.com",
      });

      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id-123",
        shopDomain: "test-shop.myshopify.com",
        isActive: true,
      } as any);

      vi.mocked(prisma.conversionLog.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.surveyResponse.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.surveyResponse.create).mockResolvedValue({
        id: "survey-id",
      } as any);

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": `Bearer ${validToken}`, // With Bearer prefix
        },
        body: JSON.stringify({
          orderId: "12345",
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
    });

    it("updates existing survey response instead of creating duplicate", async () => {
      const validToken = generateMockJwt({
        dest: "https://test-shop.myshopify.com",
      });

      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id-123",
        shopDomain: "test-shop.myshopify.com",
        isActive: true,
      } as any);

      vi.mocked(prisma.conversionLog.findFirst).mockResolvedValue({
        id: "log-id",
      } as any);

      // Existing response found
      vi.mocked(prisma.surveyResponse.findFirst).mockResolvedValue({
        id: "existing-survey-id",
        shopId: "shop-id-123",
        orderId: "12345",
        rating: 3, // Old rating
      } as any);

      vi.mocked(prisma.surveyResponse.update).mockResolvedValue({
        id: "existing-survey-id",
        rating: 5, // Updated rating
      } as any);

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          orderId: "12345",
          rating: 5, // New rating
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toContain("updated");
      expect(prisma.surveyResponse.update).toHaveBeenCalled();
    });
  });

  describe("Shop Status Validation", () => {
    it("returns 404 when shop not found", async () => {
      const validToken = generateMockJwt({
        dest: "https://test-shop.myshopify.com",
      });

      vi.mocked(prisma.shop.findUnique).mockResolvedValue(null);

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          orderId: "12345",
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Shop not found");
    });

    it("returns 403 when shop is not active", async () => {
      const validToken = generateMockJwt({
        dest: "https://test-shop.myshopify.com",
      });

      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id-123",
        shopDomain: "test-shop.myshopify.com",
        isActive: false, // Inactive
      } as any);

      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          orderId: "12345",
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("not active");
    });
  });

  describe("Request Validation", () => {
    it("returns 415 for non-JSON Content-Type", async () => {
      const request = new Request("https://example.com/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "Authorization": "Bearer valid-token",
        },
        body: "not json",
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(415);
    });

    it("returns 405 for non-POST methods (except OPTIONS)", async () => {
      const request = new Request("https://example.com/api/survey", {
        method: "GET",
        headers: {
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
        },
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(405);
    });

    it("returns 204 for OPTIONS (CORS preflight)", async () => {
      const request = new Request("https://example.com/api/survey", {
        method: "OPTIONS",
        headers: {
          "Origin": "https://some-origin.com",
          "Access-Control-Request-Method": "POST",
        },
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(204);
    });
  });
});

/**
 * Cross-Site Request Forgery Prevention
 * 
 * Even though CORS is "*", the JWT signature verification prevents CSRF:
 * - Attacker cannot forge a valid JWT without knowing the API secret
 * - Shop domain in JWT must match the X-Shopify-Shop-Domain header
 */
describe("CSRF Prevention via JWT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_API_SECRET = TEST_API_SECRET;
  });

  it("prevents cross-site writes even with CORS: *", async () => {
    // Attacker site tries to submit survey for victim shop
    // They don't have access to the victim's session token
    const request = new Request("https://example.com/api/survey", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://evil-attacker.com", // Attacker's origin
        "X-Shopify-Shop-Domain": "victim-shop.myshopify.com",
        "Authorization": "Bearer fake-token", // Invalid token
      },
      body: JSON.stringify({
        orderId: "victim-order-123",
        rating: 1,
        feedback: "spam from attacker",
      }),
    });

    const response = await action({ request, params: {}, context: {} });

    // Request is rejected because token is invalid
    expect(response.status).toBe(401);
  });

  it("validates JWT independently of Origin header", async () => {
    // Even if Origin is spoofed, JWT signature must be valid
    const validToken = generateMockJwt({
      dest: "https://test-shop.myshopify.com",
    });

    vi.mocked(prisma.shop.findUnique).mockResolvedValue({
      id: "shop-id",
      isActive: true,
    } as any);
    vi.mocked(prisma.conversionLog.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.surveyResponse.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.surveyResponse.create).mockResolvedValue({
      id: "survey-id",
    } as any);

    const request = new Request("https://example.com/api/survey", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://some-weird-origin.com", // Unusual origin
        "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
        "Authorization": `Bearer ${validToken}`, // But token is valid
      },
      body: JSON.stringify({
        orderId: "12345",
        rating: 5,
      }),
    });

    const response = await action({ request, params: {}, context: {} });

    // Request succeeds because JWT is valid (Origin doesn't matter for auth)
    expect(response.status).toBe(200);
  });
});

