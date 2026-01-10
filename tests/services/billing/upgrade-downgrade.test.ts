import { describe, it, expect, vi, beforeEach } from "vitest";
import { BILLING_PLANS, type PlanId, detectPlanFromPrice } from "../../../app/services/billing/plans";

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

vi.mock("../../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import prisma from "../../../app/db.server";

describe("Plan Upgrade/Downgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe("BILLING_PLANS configuration", () => {
    it("should have all required plans defined", () => {
      expect(BILLING_PLANS.free).toBeDefined();
      expect(BILLING_PLANS.starter).toBeDefined();
      expect(BILLING_PLANS.growth).toBeDefined();
      expect(BILLING_PLANS.agency).toBeDefined();
    });
    it("should have increasing prices", () => {
      expect(BILLING_PLANS.free.price).toBe(0);
      expect(BILLING_PLANS.starter.price).toBeLessThan(BILLING_PLANS.growth.price);
      expect(BILLING_PLANS.growth.price).toBeLessThanOrEqual(BILLING_PLANS.agency.price);
    });
    it("should have increasing order limits", () => {
      expect(BILLING_PLANS.free.monthlyOrderLimit).toBeLessThan(
        BILLING_PLANS.starter.monthlyOrderLimit
      );
      expect(BILLING_PLANS.starter.monthlyOrderLimit).toBeLessThan(
        BILLING_PLANS.growth.monthlyOrderLimit
      );
      expect(BILLING_PLANS.growth.monthlyOrderLimit).toBeLessThan(
        BILLING_PLANS.agency.monthlyOrderLimit
      );
    });
    it("should have required features in each plan", () => {
      for (const plan of Object.values(BILLING_PLANS)) {
        expect(plan.name).toBeTruthy();
        expect(typeof plan.price).toBe("number");
        expect(typeof plan.monthlyOrderLimit).toBe("number");
        expect(plan.features).toBeInstanceOf(Array);
      }
    });
  });
  describe("detectPlanFromPrice", () => {
    it("should detect starter plan from price", () => {
      expect(detectPlanFromPrice(49)).toBe("starter");
      expect(detectPlanFromPrice(49.00)).toBe("starter");
      expect(detectPlanFromPrice(99)).toBe("starter");
    });
    it("should detect agency plan from price (growth and agency both use 199)", () => {
      expect(detectPlanFromPrice(199)).toBe("agency");
      expect(detectPlanFromPrice(199.00)).toBe("agency");
    });
    it("should default to free for prices below starter threshold", () => {
      expect(detectPlanFromPrice(0)).toBe("free");
      expect(detectPlanFromPrice(15)).toBe("free");
      expect(detectPlanFromPrice(48)).toBe("free");
    });
    it("should return highest tier for very high prices", () => {
      expect(detectPlanFromPrice(500)).toBe("agency");
      expect(detectPlanFromPrice(1000)).toBe("agency");
    });
  });
  describe("Upgrade Flow Validation", () => {
    const PLAN_HIERARCHY: PlanId[] = ["free", "starter", "growth", "agency"];
    function isValidUpgrade(currentPlan: PlanId, targetPlan: PlanId): boolean {
      const currentIndex = PLAN_HIERARCHY.indexOf(currentPlan);
      const targetIndex = PLAN_HIERARCHY.indexOf(targetPlan);
      return targetIndex > currentIndex;
    }
    it("should allow upgrading from free to starter", () => {
      expect(isValidUpgrade("free", "starter")).toBe(true);
    });
    it("should allow upgrading from free to growth", () => {
      expect(isValidUpgrade("free", "growth")).toBe(true);
    });
    it("should allow upgrading from starter to growth", () => {
      expect(isValidUpgrade("starter", "growth")).toBe(true);
    });
    it("should allow upgrading from growth to agency", () => {
      expect(isValidUpgrade("growth", "agency")).toBe(true);
    });
    it("should not allow same plan upgrade", () => {
      expect(isValidUpgrade("starter", "starter")).toBe(false);
      expect(isValidUpgrade("growth", "growth")).toBe(false);
    });
    it("should not allow downgrading through upgrade flow", () => {
      expect(isValidUpgrade("growth", "starter")).toBe(false);
      expect(isValidUpgrade("agency", "growth")).toBe(false);
    });
  });
  describe("Downgrade Flow Validation", () => {
    function isValidDowngrade(currentPlan: PlanId, targetPlan: PlanId): boolean {
      const hierarchy = ["free", "starter", "growth", "agency"];
      return hierarchy.indexOf(targetPlan) < hierarchy.indexOf(currentPlan);
    }
    it("should allow downgrading to lower tier", () => {
      expect(isValidDowngrade("agency", "growth")).toBe(true);
      expect(isValidDowngrade("growth", "starter")).toBe(true);
      expect(isValidDowngrade("starter", "free")).toBe(true);
    });
    it("should allow downgrading multiple tiers", () => {
      expect(isValidDowngrade("agency", "free")).toBe(true);
      expect(isValidDowngrade("growth", "free")).toBe(true);
    });
    it("should not allow upgrading through downgrade flow", () => {
      expect(isValidDowngrade("free", "starter")).toBe(false);
      expect(isValidDowngrade("starter", "growth")).toBe(false);
    });
  });
  describe("Feature Entitlements", () => {
    function getPlanFeatures(plan: PlanId): readonly string[] {
      return BILLING_PLANS[plan].features;
    }
    function hasFeature(plan: PlanId, feature: string): boolean {
      const features = getPlanFeatures(plan);
      return features.some((f) =>
        f.toLowerCase().includes(feature.toLowerCase())
      );
    }
    it("should have basic features in free plan", () => {
      const features = getPlanFeatures("free");
      expect(features.length).toBeGreaterThan(0);
    });
    it("should have more features in paid plans", () => {
      const freeFeatures = getPlanFeatures("free");
      const starterFeatures = getPlanFeatures("starter");
      const growthFeatures = getPlanFeatures("growth");
      expect(starterFeatures.length).toBeGreaterThanOrEqual(freeFeatures.length);
      expect(growthFeatures.length).toBeGreaterThan(0);
    });
    it("should have agency-specific features", () => {
      const agencyFeatures = getPlanFeatures("agency");
      expect(agencyFeatures.length).toBeGreaterThan(0);
    });
  });
  describe("Limit Adjustments on Plan Change", () => {
    async function updateShopPlan(
      shopDomain: string,
      newPlan: PlanId
    ): Promise<{ success: boolean; newLimit: number }> {
      const planConfig = BILLING_PLANS[newPlan];
      await prisma.shop.update({
        where: { shopDomain },
        data: {
          plan: newPlan,
          monthlyOrderLimit: planConfig.monthlyOrderLimit,
        },
      });
      return {
        success: true,
        newLimit: planConfig.monthlyOrderLimit,
      };
    }
    it("should increase limit on upgrade", async () => {
      vi.mocked(prisma.shop.update).mockResolvedValue({} as any);
      const result = await updateShopPlan("test.myshopify.com", "growth");
      expect(result.newLimit).toBe(BILLING_PLANS.growth.monthlyOrderLimit);
      expect(prisma.shop.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            plan: "growth",
            monthlyOrderLimit: BILLING_PLANS.growth.monthlyOrderLimit,
          }),
        })
      );
    });
    it("should decrease limit on downgrade", async () => {
      vi.mocked(prisma.shop.update).mockResolvedValue({} as any);
      const result = await updateShopPlan("test.myshopify.com", "free");
      expect(result.newLimit).toBe(BILLING_PLANS.free.monthlyOrderLimit);
    });
  });
  describe("Usage Impact on Downgrade", () => {
    interface UsageWarning {
      willExceedLimit: boolean;
      currentUsage: number;
      newLimit: number;
      overage: number;
    }
    function calculateDowngradeImpact(
      currentUsage: number,
      targetPlan: PlanId
    ): UsageWarning {
      const newLimit = BILLING_PLANS[targetPlan].monthlyOrderLimit;
      const willExceedLimit = currentUsage > newLimit;
      const overage = Math.max(0, currentUsage - newLimit);
      return {
        willExceedLimit,
        currentUsage,
        newLimit,
        overage,
      };
    }
    it("should warn when downgrade would exceed new limit", () => {
      const currentUsage = 500;
      const impact = calculateDowngradeImpact(currentUsage, "free");
      expect(impact.willExceedLimit).toBe(true);
      expect(impact.overage).toBeGreaterThan(0);
    });
    it("should not warn when usage is within new limit", () => {
      const currentUsage = 50;
      const impact = calculateDowngradeImpact(currentUsage, "free");
      expect(impact.willExceedLimit).toBe(false);
      expect(impact.overage).toBe(0);
    });
    it("should calculate correct overage", () => {
      const freeLimit = BILLING_PLANS.free.monthlyOrderLimit;
      const currentUsage = freeLimit + 100;
      const impact = calculateDowngradeImpact(currentUsage, "free");
      expect(impact.overage).toBe(100);
    });
  });
  describe("Trial Period Handling", () => {
    interface TrialStatus {
      isTrialing: boolean;
      daysRemaining: number;
      trialEndDate: Date;
    }
    function calculateTrialStatus(
      startDate: Date,
      trialDays: number
    ): TrialStatus {
      const trialEndDate = new Date(startDate);
      trialEndDate.setDate(trialEndDate.getDate() + trialDays);
      const now = new Date();
      const daysRemaining = Math.max(
        0,
        Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      );
      return {
        isTrialing: daysRemaining > 0,
        daysRemaining,
        trialEndDate,
      };
    }
    it("should detect active trial", () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 3);
      const status = calculateTrialStatus(startDate, 7);
      expect(status.isTrialing).toBe(true);
      expect(status.daysRemaining).toBe(4);
    });
    it("should detect expired trial", () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 10);
      const status = calculateTrialStatus(startDate, 7);
      expect(status.isTrialing).toBe(false);
      expect(status.daysRemaining).toBe(0);
    });
    it("should handle zero trial days", () => {
      const startDate = new Date();
      const status = calculateTrialStatus(startDate, 0);
      expect(status.isTrialing).toBe(false);
      expect(status.daysRemaining).toBe(0);
    });
  });
  describe("Concurrent Subscription Prevention", () => {
    function canCreateNewSubscription(
      hasActiveSubscription: boolean,
      status: string
    ): { allowed: boolean; reason?: string } {
      if (hasActiveSubscription && status === "ACTIVE") {
        return {
          allowed: false,
          reason: "Already has an active subscription. Please cancel first.",
        };
      }
      if (status === "PENDING") {
        return {
          allowed: false,
          reason: "A subscription is pending confirmation.",
        };
      }
      return { allowed: true };
    }
    it("should prevent creating subscription with active one", () => {
      const result = canCreateNewSubscription(true, "ACTIVE");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cancel first");
    });
    it("should prevent creating subscription while pending", () => {
      const result = canCreateNewSubscription(false, "PENDING");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("pending confirmation");
    });
    it("should allow creating subscription when no active one", () => {
      const result = canCreateNewSubscription(false, "CANCELLED");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });
  describe("Plan Comparison", () => {
    interface PlanComparison {
      currentPlan: PlanId;
      targetPlan: PlanId;
      priceDifference: number;
      limitDifference: number;
      additionalFeatures: string[];
    }
    function comparePlans(
      currentPlan: PlanId,
      targetPlan: PlanId
    ): PlanComparison {
      const current = BILLING_PLANS[currentPlan];
      const target = BILLING_PLANS[targetPlan];
      const currentFeatureSet = new Set(current.features);
      const additionalFeatures = [...target.features].filter(
        (f) => !currentFeatureSet.has(f)
      );
      return {
        currentPlan,
        targetPlan,
        priceDifference: target.price - current.price,
        limitDifference: target.monthlyOrderLimit - current.monthlyOrderLimit,
        additionalFeatures,
      };
    }
    it("should show positive differences for upgrade", () => {
      const comparison = comparePlans("free", "starter");
      expect(comparison.priceDifference).toBeGreaterThan(0);
      expect(comparison.limitDifference).toBeGreaterThan(0);
    });
    it("should show negative differences for downgrade", () => {
      const comparison = comparePlans("growth", "starter");
      expect(comparison.priceDifference).toBeLessThan(0);
      expect(comparison.limitDifference).toBeLessThan(0);
    });
    it("should identify additional features", () => {
      const comparison = comparePlans("free", "agency");
      expect(comparison.additionalFeatures.length).toBeGreaterThan(0);
    });
  });
});
