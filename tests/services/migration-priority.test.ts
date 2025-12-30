
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  calculatePriority,
  calculateAssetPriority,
  type PriorityFactors,
  type PriorityResult,
} from "../../app/services/migration-priority.server";
import { createMockPrismaClient } from "../mocks/prisma.mock";

vi.mock("../../app/db.server", () => ({
  default: createMockPrismaClient(),
}));

describe("Migration Priority Service", () => {
  describe("calculatePriority", () => {
    it("should calculate high priority for high risk items", () => {
      const factors: PriorityFactors = {
        riskLevel: "high",
        impactScope: "order_status",
        migrationDifficulty: "easy",
        shopTier: "plus",
      };

      const result = calculatePriority(factors);

      expect(result.priority).toBeGreaterThan(7);
      expect(result.estimatedTimeMinutes).toBeGreaterThan(0);
      expect(result.reasoning).toContain("高风险项");
    });

    it("should calculate medium priority for medium risk items", () => {
      const factors: PriorityFactors = {
        riskLevel: "medium",
        impactScope: "checkout",
        migrationDifficulty: "medium",
        shopTier: "non_plus",
      };

      const result = calculatePriority(factors);

      expect(result.priority).toBeGreaterThanOrEqual(5);
      expect(result.priority).toBeLessThan(9);
      expect(result.reasoning).toContain("中风险项");
    });

    it("should calculate lower priority for low risk items", () => {
      const factors: PriorityFactors = {
        riskLevel: "low",
        impactScope: "other",
        migrationDifficulty: "hard",
        shopTier: null,
      };

      const result = calculatePriority(factors);

      expect(result.priority).toBeLessThan(7);
      expect(result.reasoning).toContain("低风险项");
    });

    it("should prioritize order_status scope", () => {
      const factors: PriorityFactors = {
        riskLevel: "high",
        impactScope: "order_status",
        migrationDifficulty: "medium",
        shopTier: "non_plus",
      };

      const result = calculatePriority(factors);

      expect(result.priority).toBeGreaterThan(8);
      expect(result.reasoning.some((r) => r.includes("订单状态页"))).toBe(true);
    });

    it("should include estimated time", () => {
      const factors: PriorityFactors = {
        riskLevel: "high",
        impactScope: "checkout",
        migrationDifficulty: "easy",
        shopTier: "plus",
      };

      const result = calculatePriority(factors);

      expect(result.estimatedTimeMinutes).toBeGreaterThan(0);
      expect(typeof result.estimatedTimeMinutes).toBe("number");
    });

    it("should handle Plus shop tier with deadline urgency", () => {
      const factors: PriorityFactors = {
        riskLevel: "high",
        impactScope: "order_status",
        migrationDifficulty: "easy",
        shopTier: "plus",
      };

      const result = calculatePriority(factors);

      expect(result.priority).toBeGreaterThan(7);
      expect(result.reasoning.some((r) => r.includes("Plus") || r.includes("自动升级"))).toBe(true);
    });
  });

  describe("calculateAssetPriority", () => {
    it("should return null for non-existent asset", async () => {
      vi.mocked(prisma.auditAsset.findUnique).mockResolvedValue(null);

      const result = await calculateAssetPriority("non-existent-id", null);

      expect(result).toBeNull();
    });

    it("should calculate priority for existing asset", async () => {
      const mockAsset = {
        id: "asset-1",
        shopId: "shop-1",
        riskLevel: "high",
        category: "pixel",
        platform: "google",
        suggestedMigration: "web_pixel",
        details: {
          display_scope: "order_status",
        },
      };

      vi.mocked(prisma.auditAsset.findUnique)
        .mockResolvedValueOnce(mockAsset as any)
        .mockResolvedValueOnce({ dependencies: null } as any);
      vi.mocked(prisma.auditAsset.findMany).mockResolvedValue([]);

      const result = await calculateAssetPriority("asset-1", "plus", "shop-1");

      expect(result).not.toBeNull();
      expect(result?.priority).toBeGreaterThan(0);
      expect(result?.estimatedTimeMinutes).toBeGreaterThan(0);
      expect(Array.isArray(result?.dependencies)).toBe(true);
    });

    it("should detect dependencies for UI extension assets", async () => {
      const mockAsset = {
        id: "asset-1",
        shopId: "shop-1",
        riskLevel: "medium",
        category: "pixel",
        platform: "google",
        suggestedMigration: "ui_extension",
        details: {},
      };

      const mockRelatedAsset = {
        id: "asset-2",
        riskLevel: "high",
        suggestedMigration: "web_pixel",
        category: "pixel",
      };

      vi.mocked(prisma.auditAsset.findUnique)
        .mockResolvedValueOnce(mockAsset as any)
        .mockResolvedValueOnce({ dependencies: null } as any);
      vi.mocked(prisma.auditAsset.findMany).mockResolvedValue([mockRelatedAsset] as any);

      const result = await calculateAssetPriority("asset-1", "non_plus", "shop-1");

      expect(result).not.toBeNull();
      expect(result?.dependencies).toContain("asset-2");
    });
  });
});

