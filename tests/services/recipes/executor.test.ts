import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GA4_BASIC_RECIPE,
  META_CAPI_RECIPE,
} from "../../../app/services/recipes/registry";

vi.mock("../../../app/db.server", () => ({
  default: {
    appliedRecipe: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    conversionLog: {
      findFirst: vi.fn(),
    },
    pixelEventReceipt: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import prisma from "../../../app/db.server";
import {
  startRecipe,
  updateRecipeConfig,
  validateRecipeConfig,
  executeRecipeStep,
  completeRecipeStep,
  runRecipeValidation,
  getAppliedRecipes,
  getAppliedRecipe,
  rollbackRecipe,
} from "../../../app/services/recipes/executor";

const trackingApiEnabled =
  process.env.FEATURE_TRACKING_API === "true" || process.env.FEATURE_TRACKING_API === "1";

describe("Recipe Executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe("validateRecipeConfig", () => {
    it("should pass validation for valid GA4 config", () => {
      const config = {
        measurementId: "G-ABCDEF1234",
        apiSecret: "test-secret-key",
      };
      const result = validateRecipeConfig(GA4_BASIC_RECIPE, config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should fail validation for missing required fields", () => {
      const config = {
        measurementId: "G-ABCDEF1234",
      };
      const result = validateRecipeConfig(GA4_BASIC_RECIPE, config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes("API Secret"))).toBe(true);
    });
    it("should fail validation for invalid measurement ID format", () => {
      const config = {
        measurementId: "INVALID-ID",
        apiSecret: "test-secret-key",
      };
      const result = validateRecipeConfig(GA4_BASIC_RECIPE, config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Measurement ID"))).toBe(true);
    });
    it("should pass validation for valid Meta config", () => {
      const config = {
        pixelId: "123456789012345",
        accessToken: "test-access-token",
      };
      const result = validateRecipeConfig(META_CAPI_RECIPE, config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should fail validation for invalid pixel ID format", () => {
      const config = {
        pixelId: "invalid",
        accessToken: "test-access-token",
      };
      const result = validateRecipeConfig(META_CAPI_RECIPE, config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Pixel ID"))).toBe(true);
    });
    it("should allow optional fields to be empty", () => {
      const config = {
        pixelId: "123456789012345",
        accessToken: "test-access-token",
        testEventCode: "",
      };
      const result = validateRecipeConfig(META_CAPI_RECIPE, config);
      expect(result.valid).toBe(true);
    });
    it("should validate all required fields", () => {
      const config = {};
      const result = validateRecipeConfig(GA4_BASIC_RECIPE, config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(2);
    });
  });
  describe("startRecipe", () => {
    const mockShopId = "shop-123";
    const mockRecipeId = "ga4-basic";
    it("should create a new applied recipe", async () => {
      const mockApplied = {
        id: "applied-1",
        shopId: mockShopId,
        recipeId: mockRecipeId,
        recipeVersion: "1.0.0",
        status: "configuring",
        config: {},
        completedSteps: [],
        validationResults: [],
      };
      vi.mocked(prisma.appliedRecipe.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.appliedRecipe.create).mockResolvedValue(mockApplied as any);
      const result = await startRecipe(mockShopId, mockRecipeId);
      if (trackingApiEnabled) {
        expect(result).toBeDefined();
        expect(result?.recipeId).toBe(mockRecipeId);
        expect(result?.status).toBe("configuring");
        expect(prisma.appliedRecipe.create).toHaveBeenCalled();
      } else {
        expect(result).toBeNull();
        expect(prisma.appliedRecipe.create).not.toHaveBeenCalled();
      }
    });
    it("should return existing recipe if already in progress", async () => {
      const existingApplied = {
        id: "applied-1",
        shopId: mockShopId,
        recipeId: mockRecipeId,
        status: "in_progress",
        config: {},
        completedSteps: [1],
      };
      vi.mocked(prisma.appliedRecipe.findFirst).mockResolvedValue(existingApplied as any);
      const result = await startRecipe(mockShopId, mockRecipeId);
      if (trackingApiEnabled) {
        expect(result).toBeDefined();
        expect(result?.id).toBe("applied-1");
        expect(prisma.appliedRecipe.create).not.toHaveBeenCalled();
      } else {
        expect(result).toBeNull();
        expect(prisma.appliedRecipe.create).not.toHaveBeenCalled();
      }
    });
    it("should return null for non-existent recipe ID", async () => {
      const result = await startRecipe(mockShopId, "non-existent-recipe");
      expect(result).toBeNull();
      expect(prisma.appliedRecipe.create).not.toHaveBeenCalled();
    });
    it("should save initial config if provided", async () => {
      const initialConfig = { measurementId: "G-TEST123" };
      const mockApplied = {
        id: "applied-1",
        shopId: mockShopId,
        recipeId: mockRecipeId,
        recipeVersion: "1.0.0",
        status: "configuring",
        config: initialConfig,
        completedSteps: [],
        validationResults: [],
      };
      vi.mocked(prisma.appliedRecipe.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.appliedRecipe.create).mockResolvedValue(mockApplied as any);
      await startRecipe(mockShopId, mockRecipeId, initialConfig);
      if (trackingApiEnabled) {
        expect(prisma.appliedRecipe.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              config: initialConfig,
            }),
          })
        );
      } else {
        expect(prisma.appliedRecipe.create).not.toHaveBeenCalled();
      }
    });
    it("should save source identifier if provided", async () => {
      const sourceIdentifier = "script-tag-123";
      const mockApplied = {
        id: "applied-1",
        shopId: mockShopId,
        recipeId: mockRecipeId,
        recipeVersion: "1.0.0",
        status: "configuring",
        config: {},
        completedSteps: [],
        validationResults: [],
        sourceIdentifier,
      };
      vi.mocked(prisma.appliedRecipe.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.appliedRecipe.create).mockResolvedValue(mockApplied as any);
      await startRecipe(mockShopId, mockRecipeId, {}, sourceIdentifier);
      if (trackingApiEnabled) {
        expect(prisma.appliedRecipe.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              sourceIdentifier,
            }),
          })
        );
      } else {
        expect(prisma.appliedRecipe.create).not.toHaveBeenCalled();
      }
    });
  });
  describe("updateRecipeConfig", () => {
    it("should update recipe configuration", async () => {
      const newConfig = { measurementId: "G-NEWID123", apiSecret: "new-secret" };
      const mockUpdated = {
        id: "applied-1",
        config: newConfig,
        updatedAt: new Date(),
      };
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue(mockUpdated as any);
      const result = await updateRecipeConfig("applied-1", newConfig);
      expect(result).toBeDefined();
      expect(prisma.appliedRecipe.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "applied-1" },
          data: expect.objectContaining({
            config: newConfig,
          }),
        })
      );
    });
  });
  describe("executeRecipeStep", () => {
    const mockAppliedRecipe = {
      id: "applied-1",
      shopId: "shop-123",
      recipeId: "ga4-basic",
      status: "in_progress",
      config: { measurementId: "G-TEST123" },
      completedSteps: [],
      Shop: { shopDomain: "test-store.myshopify.com" },
    };
    it("should execute auto action step", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(mockAppliedRecipe as any);
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue({
        ...mockAppliedRecipe,
        completedSteps: [1],
      } as any);
      const result = await executeRecipeStep("applied-1", 1);
      if (trackingApiEnabled) {
        expect(result.success).toBe(true);
        expect(prisma.appliedRecipe.update).toHaveBeenCalled();
      } else {
        expect(result.success).toBe(false);
        expect(prisma.appliedRecipe.update).not.toHaveBeenCalled();
      }
    });
    it("should return error for non-existent applied recipe", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(null);
      const result = await executeRecipeStep("non-existent", 1);
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });
    it("should return error for non-existent step", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(mockAppliedRecipe as any);
      const result = await executeRecipeStep("applied-1", 999);
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });
    it("should update status in database", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(mockAppliedRecipe as any);
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue({
        ...mockAppliedRecipe,
        status: "in_progress",
        completedSteps: [1],
      } as any);
      await executeRecipeStep("applied-1", 1);
      if (trackingApiEnabled) {
        expect(prisma.appliedRecipe.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: "in_progress",
            }),
          })
        );
      } else {
        expect(prisma.appliedRecipe.update).not.toHaveBeenCalled();
      }
    });
  });
  describe("completeRecipeStep", () => {
    const mockAppliedRecipe = {
      id: "applied-1",
      shopId: "shop-123",
      recipeId: "ga4-basic",
      status: "in_progress",
      config: {},
      completedSteps: [1],
    };
    it("should mark step as complete", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(mockAppliedRecipe as any);
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue({
        ...mockAppliedRecipe,
        completedSteps: [1, 2],
      } as any);
      const result = await completeRecipeStep("applied-1", 2);
      if (trackingApiEnabled) {
        expect(result).toBeDefined();
        expect(prisma.appliedRecipe.update).toHaveBeenCalled();
      } else {
        expect(result).toBeNull();
        expect(prisma.appliedRecipe.update).not.toHaveBeenCalled();
      }
    });
    it("should not duplicate already completed steps", async () => {
      const recipeWithStep1 = {
        ...mockAppliedRecipe,
        completedSteps: [1],
      };
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(recipeWithStep1 as any);
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue(recipeWithStep1 as any);
      await completeRecipeStep("applied-1", 1);
      if (trackingApiEnabled) {
        const updateCall = vi.mocked(prisma.appliedRecipe.update).mock.calls[0][0] as any;
        const completedSteps = updateCall.data.completedSteps;
        const step1Count = completedSteps.filter((s: number) => s === 1).length;
        expect(step1Count).toBe(1);
      } else {
        expect(prisma.appliedRecipe.update).not.toHaveBeenCalled();
      }
    });
    it("should change status to validating when all steps complete", async () => {
      const almostComplete = {
        ...mockAppliedRecipe,
        completedSteps: [1, 2, 3],
      };
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(almostComplete as any);
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue({
        ...almostComplete,
        completedSteps: [1, 2, 3, 4],
        status: "validating",
      } as any);
      await completeRecipeStep("applied-1", 4);
      if (trackingApiEnabled) {
        expect(prisma.appliedRecipe.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: "validating",
            }),
          })
        );
      } else {
        expect(prisma.appliedRecipe.update).not.toHaveBeenCalled();
      }
    });
    it("should return null for non-existent recipe", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(null);
      const result = await completeRecipeStep("non-existent", 1);
      expect(result).toBeNull();
    });
  });
  describe("runRecipeValidation", () => {
    const mockAppliedRecipe = {
      id: "applied-1",
      shopId: "shop-123",
      recipeId: "ga4-basic",
      status: "validating",
      config: {},
      completedSteps: [1, 2, 3, 4],
      validationResults: [],
      Shop: { shopDomain: "test-store.myshopify.com" },
    };
    it("should run validation tests", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(mockAppliedRecipe as any);
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue({
        ...mockAppliedRecipe,
        validationResults: [{ testName: "test", passed: false }],
      } as any);
      const results = await runRecipeValidation("applied-1");
      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);
      if (trackingApiEnabled) {
        expect(prisma.appliedRecipe.update).toHaveBeenCalled();
      } else {
        expect(prisma.appliedRecipe.update).not.toHaveBeenCalled();
      }
    });
    it("should pass event_received test when event found", async () => {
      const mockEvent = {
        id: "event-1",
        shopId: "shop-123",
        eventType: "purchase",
        createdAt: new Date(),
        payloadJson: { eventId: "evt-123", data: {} },
      };
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(mockAppliedRecipe as any);
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue(mockEvent as any);
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue({
        ...mockAppliedRecipe,
        status: "completed",
      } as any);
      const results = await runRecipeValidation("applied-1");
      const eventTest = results.find(r => r.testName === "purchase_event_received");
      if (trackingApiEnabled) {
        expect(eventTest?.passed).toBe(true);
      } else {
        expect(eventTest).toBeUndefined();
      }
    });
    it("should fail event_received test when no event found", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(mockAppliedRecipe as any);
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue(mockAppliedRecipe as any);
      const results = await runRecipeValidation("applied-1");
      const eventTest = results.find(r => r.testName === "purchase_event_received");
      if (trackingApiEnabled) {
        expect(eventTest?.passed).toBe(false);
      } else {
        expect(eventTest).toBeUndefined();
      }
    });
    it("should return error for non-existent applied recipe", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(null);
      const results = await runRecipeValidation("non-existent");
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain("not found");
    });
    it("should save validation results to database", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(mockAppliedRecipe as any);
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue(mockAppliedRecipe as any);
      await runRecipeValidation("applied-1");
      if (trackingApiEnabled) {
        expect(prisma.appliedRecipe.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              validationResults: expect.any(Array),
            }),
          })
        );
      } else {
        expect(prisma.appliedRecipe.update).not.toHaveBeenCalled();
      }
    });
  });
  describe("getAppliedRecipes", () => {
    it("should return all applied recipes for a shop", async () => {
      const mockRecipes = [
        { id: "applied-1", recipeId: "ga4-basic", status: "completed" },
        { id: "applied-2", recipeId: "meta-capi", status: "in_progress" },
      ];
      vi.mocked(prisma.appliedRecipe.findMany).mockResolvedValue(mockRecipes as any);
      const results = await getAppliedRecipes("shop-123");
      expect(results).toHaveLength(2);
      expect(prisma.appliedRecipe.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopId: "shop-123" },
          orderBy: { createdAt: "desc" },
        })
      );
    });
    it("should return empty array for shop with no recipes", async () => {
      vi.mocked(prisma.appliedRecipe.findMany).mockResolvedValue([]);
      const results = await getAppliedRecipes("shop-no-recipes");
      expect(results).toHaveLength(0);
    });
  });
  describe("getAppliedRecipe", () => {
    it("should return specific applied recipe", async () => {
      const mockRecipe = {
        id: "applied-1",
        recipeId: "ga4-basic",
        status: "completed",
      };
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(mockRecipe as any);
      const result = await getAppliedRecipe("applied-1");
      expect(result).toBeDefined();
      expect(result?.id).toBe("applied-1");
    });
    it("should return null for non-existent recipe", async () => {
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(null);
      const result = await getAppliedRecipe("non-existent");
      expect(result).toBeNull();
    });
  });
  describe("rollbackRecipe", () => {
    it("should mark recipe as rolled back", async () => {
      const mockRolledBack = {
        id: "applied-1",
        recipeId: "ga4-basic",
        status: "rolled_back",
      };
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue(mockRolledBack as any);
      const result = await rollbackRecipe("applied-1");
      expect(result).toBeDefined();
      expect(result?.status).toBe("rolled_back");
      expect(prisma.appliedRecipe.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "applied-1" },
          data: expect.objectContaining({
            status: "rolled_back",
          }),
        })
      );
    });
  });
  describe("Recipe Workflow Integration", () => {
    it("should support full workflow: start -> configure -> execute -> complete -> validate", async () => {
      const shopId = "shop-123";
      const recipeId = "ga4-basic";
      const config = { measurementId: "G-TEST123", apiSecret: "secret" };
      const validation = validateRecipeConfig(GA4_BASIC_RECIPE, config);
      expect(validation.valid).toBe(true);
      const mockStarted = {
        id: "applied-1",
        shopId,
        recipeId,
        status: "configuring",
        config: {},
        completedSteps: [],
      };
      vi.mocked(prisma.appliedRecipe.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.appliedRecipe.create).mockResolvedValue(mockStarted as any);
      const started = await startRecipe(shopId, recipeId, config);
      if (!trackingApiEnabled) {
        expect(started).toBeNull();
        return;
      }
      expect(started).toBeDefined();
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue({
        ...mockStarted,
        config,
      } as any);
      const updated = await updateRecipeConfig("applied-1", config);
      expect(updated).toBeDefined();
      const mockWithSteps = {
        ...mockStarted,
        Shop: { shopDomain: "test.myshopify.com" },
      };
      vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue(mockWithSteps as any);
      for (let i = 1; i <= 4; i++) {
        vi.mocked(prisma.appliedRecipe.update).mockResolvedValue({
          ...mockWithSteps,
          completedSteps: Array.from({ length: i }, (_, idx) => idx + 1),
          status: i === 4 ? "validating" : "in_progress",
        } as any);
        const stepResult = await executeRecipeStep("applied-1", i);
        expect(stepResult.success).toBe(true);
      }
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue({
        id: "evt-1",
        eventType: "purchase",
        createdAt: new Date(),
        payloadJson: { eventId: "e1", data: {} },
      } as any);
      vi.mocked(prisma.appliedRecipe.update).mockResolvedValue({
        ...mockWithSteps,
        status: "completed",
        completedAt: new Date(),
      } as any);
      const validationResults = await runRecipeValidation("applied-1");
      expect(validationResults.length).toBeGreaterThan(0);
    });
  });
});
