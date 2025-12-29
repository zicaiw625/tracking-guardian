import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../../../app/services/audit.server", () => ({
  createAuditLog: vi.fn(),
}));

vi.mock("../../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import prisma from "../../../app/db.server";
import {
  createSubscription,
  getSubscriptionStatus,
  cancelSubscription,
  syncSubscriptionStatus,
  handleSubscriptionConfirmation,
  type AdminGraphQL,
} from "../../../app/services/billing/subscription.server";
import { BILLING_PLANS } from "../../../app/services/billing/plans";

describe("Subscription Service", () => {
  let mockAdmin: AdminGraphQL;
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdmin = {
      graphql: vi.fn(),
    };
  });
  describe("createSubscription", () => {
    it("should create subscription for starter plan", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appSubscriptionCreate: {
              appSubscription: {
                id: "gid:
                status: "PENDING",
                trialDays: 0,
              },
              confirmationUrl: "https:
              userErrors: [],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({ id: "shop-1" } as any);
      const result = await createSubscription(
        mockAdmin,
        "test-store.myshopify.com",
        "starter",
        "https:
      );
      expect(result.success).toBe(true);
      expect(result.confirmationUrl).toBeDefined();
      expect(result.subscriptionId).toBe("gid:
    });
    it("should return error for free plan", async () => {
      const result = await createSubscription(
        mockAdmin,
        "test-store.myshopify.com",
        "free",
        "https:
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid plan selected");
      expect(mockAdmin.graphql).not.toHaveBeenCalled();
    });
    it("should handle Shopify API errors", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appSubscriptionCreate: {
              appSubscription: null,
              confirmationUrl: null,
              userErrors: [
                { field: "price", message: "Invalid price format" },
              ],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      const result = await createSubscription(
        mockAdmin,
        "test-store.myshopify.com",
        "starter",
        "https:
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid price format");
    });
    it("should handle network errors", async () => {
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error")
      );
      const result = await createSubscription(
        mockAdmin,
        "test-store.myshopify.com",
        "starter",
        "https:
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
    it("should use correct plan pricing", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appSubscriptionCreate: {
              appSubscription: { id: "sub-1", status: "PENDING" },
              confirmationUrl: "https:
              userErrors: [],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({ id: "shop-1" } as any);
      await createSubscription(
        mockAdmin,
        "test-store.myshopify.com",
        "growth",
        "https:
      );
      expect(mockAdmin.graphql).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          variables: expect.objectContaining({
            name: expect.stringContaining(BILLING_PLANS.growth.name),
            lineItems: expect.arrayContaining([
              expect.objectContaining({
                plan: expect.objectContaining({
                  appRecurringPricingDetails: expect.objectContaining({
                    price: { amount: BILLING_PLANS.growth.price, currencyCode: "USD" },
                  }),
                }),
              }),
            ]),
          }),
        })
      );
    });
  });
  describe("getSubscriptionStatus", () => {
    it("should return active subscription status", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appInstallation: {
              activeSubscriptions: [
                {
                  id: "gid:
                  name: "Tracking Guardian - Growth",
                  status: "ACTIVE",
                  trialDays: 0,
                  currentPeriodEnd: "2025-01-27T00:00:00Z",
                  lineItems: [
                    {
                      id: "li-1",
                      plan: {
                        pricingDetails: {
                          price: {
                            amount: "79.00",
                            currencyCode: "USD",
                          },
                          interval: "EVERY_30_DAYS",
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      const status = await getSubscriptionStatus(mockAdmin, "test-store.myshopify.com");
      expect(status.hasActiveSubscription).toBe(true);
      expect(status.plan).toBe("growth");
      expect(status.status).toBe("ACTIVE");
    });
    it("should return free plan when no active subscription", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appInstallation: {
              activeSubscriptions: [],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({ plan: "free" } as any);
      const status = await getSubscriptionStatus(mockAdmin, "test-store.myshopify.com");
      expect(status.hasActiveSubscription).toBe(false);
      expect(status.plan).toBe("free");
    });
    it("should detect trial status", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appInstallation: {
              activeSubscriptions: [
                {
                  id: "sub-1",
                  status: "ACTIVE",
                  trialDays: 7,
                  currentPeriodEnd: futureDate.toISOString(),
                  lineItems: [
                    {
                      plan: {
                        pricingDetails: {
                          price: { amount: "29.00" },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      const status = await getSubscriptionStatus(mockAdmin, "test-store.myshopify.com");
      expect(status.hasActiveSubscription).toBe(true);
      expect(status.isTrialing).toBe(true);
      expect(status.trialDays).toBe(7);
    });
    it("should handle API errors gracefully", async () => {
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("API unavailable")
      );
      const status = await getSubscriptionStatus(mockAdmin, "test-store.myshopify.com");
      expect(status.hasActiveSubscription).toBe(false);
      expect(status.plan).toBe("free");
    });
  });
  describe("cancelSubscription", () => {
    it("should cancel subscription successfully", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appSubscriptionCancel: {
              appSubscription: {
                id: "sub-1",
                status: "CANCELLED",
              },
              userErrors: [],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      vi.mocked(prisma.shop.update).mockResolvedValue({} as any);
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({ id: "shop-1" } as any);
      const result = await cancelSubscription(
        mockAdmin,
        "test-store.myshopify.com",
        "gid:
      );
      expect(result.success).toBe(true);
      expect(prisma.shop.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopDomain: "test-store.myshopify.com" },
          data: expect.objectContaining({
            plan: "free",
          }),
        })
      );
    });
    it("should handle cancellation errors", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appSubscriptionCancel: {
              appSubscription: null,
              userErrors: [
                { field: "id", message: "Subscription not found" },
              ],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      const result = await cancelSubscription(
        mockAdmin,
        "test-store.myshopify.com",
        "invalid-id"
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Subscription not found");
    });
  });
  describe("syncSubscriptionStatus", () => {
    it("should sync active subscription to database", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appInstallation: {
              activeSubscriptions: [
                {
                  id: "sub-1",
                  status: "ACTIVE",
                  trialDays: 0,
                  currentPeriodEnd: "2025-02-27",
                  lineItems: [
                    {
                      plan: {
                        pricingDetails: {
                          price: { amount: "79.00" },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      vi.mocked(prisma.shop.update).mockResolvedValue({} as any);
      await syncSubscriptionStatus(mockAdmin, "test-store.myshopify.com");
      expect(prisma.shop.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopDomain: "test-store.myshopify.com" },
          data: expect.objectContaining({
            plan: "growth",
            monthlyOrderLimit: BILLING_PLANS.growth.monthlyOrderLimit,
          }),
        })
      );
    });
    it("should downgrade to free when no active subscription", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appInstallation: {
              activeSubscriptions: [],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({ plan: "free" } as any);
      vi.mocked(prisma.shop.update).mockResolvedValue({} as any);
      await syncSubscriptionStatus(mockAdmin, "test-store.myshopify.com");
      expect(prisma.shop.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            plan: "free",
            monthlyOrderLimit: BILLING_PLANS.free.monthlyOrderLimit,
          }),
        })
      );
    });
  });
  describe("handleSubscriptionConfirmation", () => {
    it("should activate subscription on confirmation", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appInstallation: {
              activeSubscriptions: [
                {
                  id: "sub-1",
                  status: "ACTIVE",
                  trialDays: 0,
                  currentPeriodEnd: "2025-02-27",
                  lineItems: [
                    {
                      plan: {
                        pricingDetails: {
                          price: { amount: "29.00" },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      vi.mocked(prisma.shop.update).mockResolvedValue({} as any);
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({ id: "shop-1" } as any);
      const result = await handleSubscriptionConfirmation(
        mockAdmin,
        "test-store.myshopify.com",
        "charge-123"
      );
      expect(result.success).toBe(true);
      expect(result.plan).toBe("starter");
    });
    it("should fail when subscription is not active", async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          data: {
            appInstallation: {
              activeSubscriptions: [],
            },
          },
        }),
      };
      (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({ plan: "free" } as any);
      const result = await handleSubscriptionConfirmation(
        mockAdmin,
        "test-store.myshopify.com",
        "charge-123"
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("Subscription not active");
    });
  });
  describe("Plan Detection", () => {
    it("should detect correct plan from price", async () => {
      const testCases = [
        { price: "29.00", expectedPlan: "starter" },
        { price: "79.00", expectedPlan: "growth" },
        { price: "199.00", expectedPlan: "agency" },
      ];
      for (const { price, expectedPlan } of testCases) {
        const mockResponse = {
          json: vi.fn().mockResolvedValue({
            data: {
              appInstallation: {
                activeSubscriptions: [
                  {
                    id: "sub-1",
                    status: "ACTIVE",
                    trialDays: 0,
                    currentPeriodEnd: "2025-02-27",
                    lineItems: [
                      {
                        plan: {
                          pricingDetails: {
                            price: { amount: price },
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          }),
        };
        (mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
        const status = await getSubscriptionStatus(mockAdmin, "test.myshopify.com");
        expect(status.plan).toBe(expectedPlan);
      }
    });
  });
});
