import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    billingAttempt: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../../../app/services/audit.server", () => ({
  createAuditLog: vi.fn(),
}));

vi.mock("../../../app/services/shop-tier.server", () => ({
  getShopPlan: vi.fn().mockResolvedValue({ partnerDevelopment: false }),
}));

vi.mock("../../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../app/utils/redirect-validation.server", () => ({
  assertSafeRedirect: vi.fn().mockReturnValue({ valid: true }),
}));

import prisma from "../../../app/db.server";
import { BILLING_PLANS } from "../../../app/services/billing/plans";
import {
  createSubscription,
  getSubscriptionStatus,
  handleSubscriptionConfirmation,
  syncSubscriptionStatus,
  type AdminGraphQL,
} from "../../../app/services/billing/subscription.server";

function graphResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ data }),
  };
}

function graphErrorResponse(message: string) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      errors: [{ message }],
    }),
  };
}

describe("Subscription Service", () => {
  let mockAdmin: AdminGraphQL;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdmin = {
      graphql: vi.fn(),
    };
    vi.mocked(prisma.billingAttempt.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.billingAttempt.create).mockResolvedValue({} as never);
    vi.mocked(prisma.billingAttempt.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.shop.findUnique).mockResolvedValue({ id: "shop-1" } as never);
    vi.mocked(prisma.shop.update).mockResolvedValue({} as never);
  });

  it("创建订阅时固定使用 USD 与字符串金额", async () => {
    vi.mocked(mockAdmin.graphql as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        graphResponse({
          appInstallation: {
            allSubscriptions: { edges: [] },
          },
        }) as never
      )
      .mockResolvedValueOnce(
        graphResponse({
          appSubscriptionCreate: {
            appSubscription: {
              id: "gid://shopify/AppSubscription/123",
              status: "PENDING",
            },
            confirmationUrl: "https://example.com/confirm",
            userErrors: [],
          },
        }) as never
      );

    const result = await createSubscription(
      mockAdmin,
      "test-store.myshopify.com",
      "growth",
      "https://example.com/return"
    );

    expect(result.success).toBe(true);
    expect(mockAdmin.graphql).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        variables: expect.objectContaining({
          lineItems: expect.arrayContaining([
            expect.objectContaining({
              plan: expect.objectContaining({
                appRecurringPricingDetails: expect.objectContaining({
                  price: { amount: BILLING_PLANS.growth.price.toFixed(2), currencyCode: "USD" },
                }),
              }),
            }),
          ]),
        }),
      })
    );
    expect(prisma.billingAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shopDomain: "test-store.myshopify.com",
          planId: "growth",
          status: "PENDING",
          confirmationUrl: "https://example.com/confirm",
        }),
      })
    );
  });

  it("同计划 48h 内重复订阅复用 confirmationUrl", async () => {
    vi.mocked(prisma.billingAttempt.findFirst).mockResolvedValue({
      confirmationUrl: "https://example.com/reused",
      subscriptionId: "gid://shopify/AppSubscription/999",
    } as never);

    const result = await createSubscription(
      mockAdmin,
      "test-store.myshopify.com",
      "starter",
      "https://example.com/return"
    );

    expect(result.success).toBe(true);
    expect(result.confirmationUrl).toBe("https://example.com/reused");
    expect(result.subscriptionId).toBe("gid://shopify/AppSubscription/999");
    expect(mockAdmin.graphql).not.toHaveBeenCalled();
  });

  it("CANCELLED 未到期时返回 hasEntitlement=true 且非 active", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(
      graphResponse({
        appInstallation: {
          allSubscriptions: {
            edges: [
              {
                node: {
                  id: "gid://shopify/AppSubscription/111",
                  name: "Tracking Guardian - Starter",
                  status: "CANCELLED",
                  currentPeriodEnd: future,
                  lineItems: [],
                },
              },
            ],
          },
        },
      }) as never
    );

    const status = await getSubscriptionStatus(mockAdmin, "test-store.myshopify.com");
    expect(status.plan).toBe("starter");
    expect(status.hasActiveSubscription).toBe(false);
    expect(status.hasEntitlement).toBe(true);
    expect(status.entitledUntil).toBeDefined();
  });

  it("API 报错时使用 DB fallback，不强制 free", async () => {
    vi.mocked(mockAdmin.graphql as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API unavailable"));
    vi.mocked(prisma.shop.findUnique).mockResolvedValue({
      plan: "growth",
      entitledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } as never);

    const status = await getSubscriptionStatus(mockAdmin, "test-store.myshopify.com");
    expect(status.plan).toBe("growth");
    expect(status.hasEntitlement).toBe(true);
    expect(status.hasActiveSubscription).toBe(false);
  });

  it("确认订阅激活后会将 attempt 标记为 CONFIRMED", async () => {
    const activeSubscriptionPayload = graphResponse({
      appInstallation: {
        allSubscriptions: {
          edges: [
            {
              node: {
                id: "gid://shopify/AppSubscription/123",
                name: "Tracking Guardian - Starter",
                status: "ACTIVE",
                currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                lineItems: [
                  {
                    plan: {
                      pricingDetails: {
                        price: { amount: "29.00", currencyCode: "USD" },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    vi.mocked(mockAdmin.graphql as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(activeSubscriptionPayload as never)
      .mockResolvedValueOnce(activeSubscriptionPayload as never)
      .mockResolvedValueOnce(activeSubscriptionPayload as never);

    const result = await handleSubscriptionConfirmation(
      mockAdmin,
      "test-store.myshopify.com",
      "gid://shopify/AppSubscription/123"
    );

    expect(result.success).toBe(true);
    expect(prisma.billingAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PENDING",
        }),
        data: expect.objectContaining({ status: "CONFIRMED" }),
      })
    );
  });

  it("确认订阅在 PENDING 状态时返回 pending", async () => {
    vi.mocked(mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(
      graphResponse({
        appInstallation: {
          allSubscriptions: {
            edges: [
              {
                node: {
                  id: "gid://shopify/AppSubscription/123",
                  name: "Tracking Guardian - Starter",
                  status: "PENDING",
                },
              },
            ],
          },
        },
      }) as never
    );

    const result = await handleSubscriptionConfirmation(
      mockAdmin,
      "test-store.myshopify.com",
      "gid://shopify/AppSubscription/123"
    );

    expect(result.success).toBe(false);
    expect(result.pending).toBe(true);
    expect(prisma.billingAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("syncSubscriptionStatus 在 GraphQL errors 时不降级写库", async () => {
    vi.mocked(mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(
      graphErrorResponse("query failed") as never
    );

    await syncSubscriptionStatus(mockAdmin, "test-store.myshopify.com");

    expect(prisma.shop.update).not.toHaveBeenCalled();
  });

  it("trialDaysRemaining 使用 confirmedAt 计算", async () => {
    vi.mocked(mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(
      graphResponse({
        appInstallation: {
          allSubscriptions: {
            edges: [
              {
                node: {
                  id: "gid://shopify/AppSubscription/111",
                  name: "Tracking Guardian - Starter",
                  status: "ACTIVE",
                  trialDays: 10,
                },
              },
            ],
          },
        },
      }) as never
    );
    const confirmedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.billingAttempt.findFirst).mockResolvedValue({
      confirmedAt,
    } as never);

    const status = await getSubscriptionStatus(mockAdmin, "test-store.myshopify.com");
    expect(status.isTrialing).toBe(true);
    expect(status.trialDaysRemaining).toBeGreaterThanOrEqual(7);
    expect(status.trialDaysRemaining).toBeLessThanOrEqual(8);
  });

  it("ACTIVE 同计划优先选择有有效 currentPeriodEnd 的订阅", async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(mockAdmin.graphql as ReturnType<typeof vi.fn>).mockResolvedValue(
      graphResponse({
        appInstallation: {
          allSubscriptions: {
            edges: [
              {
                node: {
                  id: "gid://shopify/AppSubscription/no-end",
                  name: "Tracking Guardian - Growth",
                  status: "ACTIVE",
                },
              },
              {
                node: {
                  id: "gid://shopify/AppSubscription/with-end",
                  name: "Tracking Guardian - Growth",
                  status: "ACTIVE",
                  currentPeriodEnd: future,
                },
              },
            ],
          },
        },
      }) as never
    );

    const status = await getSubscriptionStatus(mockAdmin, "test-store.myshopify.com");
    expect(status.subscriptionId).toBe("gid://shopify/AppSubscription/with-end");
  });
});
