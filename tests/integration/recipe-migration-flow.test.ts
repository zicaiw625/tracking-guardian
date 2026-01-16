import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    appliedRecipe: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    shop: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    scanReport: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    conversionLog: {
      findFirst: vi.fn(),
    },
    pixelConfig: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import prisma from "../../app/db.server";
import {
  matchScriptToRecipes,
  matchScriptTagsToRecipes,
  matchAdditionalScriptsToRecipes,
} from "../../app/services/recipes/matcher";
import {
  RECIPE_REGISTRY,
  getRecipeById,
} from "../../app/services/recipes/registry";
import {
  startRecipe,
  updateRecipeConfig,
  validateRecipeConfig,
  completeRecipeStep,
  getAppliedRecipes,
} from "../../app/services/recipes/executor";

describe("Recipe Migration Flow Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe("Complete GA4 Migration Flow", () => {
    const shopId = "shop-test-123";
    const shopDomain = "test-store.myshopify.com";
    it("should complete full GA4 migration workflow", async () => {
      const scriptContent = `
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEF1234"></script>
        <script>
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-ABCDEF1234');
        </script>
      `;
      const matches = matchScriptToRecipes(scriptContent);
      expect(matches.length).toBeGreaterThan(0);
      const ga4Match = matches.find(m => m.recipe.id === "ga4-basic");
      expect(ga4Match).toBeDefined();
      expect(ga4Match!.confidence).toBeGreaterThan(0.5);
      const config = {
        measurementId: "G-ABCDEF1234",
        apiSecret: "test-api-secret-123",
      };
      const recipe = getRecipeById("ga4-basic")!;
      const validation = validateRecipeConfig(recipe, config);
      expect(validation.valid).toBe(true);
      const mockApplied = {
        id: "applied-ga4-1",
        shopId,
        recipeId: "ga4-basic",
        recipeVersion: "1.0.0",
        status: "configuring",
        config: {},
        completedSteps: [],
        validationResults: [],
      };
      vi.mocked(prisma.appliedRecipe.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.appliedRecipe.create).mockResolvedValue(mockApplied as any);
      const applied = await startRecipe(shopId, "ga4-basic", config);
      expect(applied).toBeDefined();
      expect(applied?.recipeId).toBe("ga4-basic");
      for (let step = 1; step <= 4; step++) {
        vi.mocked(prisma.appliedRecipe.findUnique).mockResolvedValue({
          ...mockApplied,
          completedSteps: Array.from({ length: step - 1 }, (_, i) => i + 1),
        } as any);
        vi.mocked(prisma.appliedRecipe.update).mockResolvedValue({
          ...mockApplied,
          completedSteps: Array.from({ length: step }, (_, i) => i + 1),
          status: step === 4 ? "validating" : "in_progress",
        } as any);
        const result = await completeRecipeStep(mockApplied.id, step);
        expect(result).toBeDefined();
      }
      const lastUpdate = vi.mocked(prisma.appliedRecipe.update).mock.calls.slice(-1)[0];
      expect(lastUpdate[0].data).toMatchObject({
        status: "validating",
      });
    });
  });
  describe("Complete Meta CAPI Migration Flow", () => {
    const shopId = "shop-meta-123";
    it("should complete full Meta CAPI migration workflow", async () => {
      const scriptContent = `
        <script>
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          fbq('init', '1234567890123456');
          fbq('track', 'PageView');
        </script>
      `;
      const matches = matchScriptToRecipes(scriptContent);
      const metaMatch = matches.find(m => m.recipe.id === "meta-capi");
      expect(metaMatch).toBeDefined();
      const config = {
        pixelId: "1234567890123456",
        accessToken: "test-access-token-abc123",
        testEventCode: "TEST12345",
      };
      const recipe = getRecipeById("meta-capi")!;
      const validation = validateRecipeConfig(recipe, config);
      expect(validation.valid).toBe(true);
      const mockApplied = {
        id: "applied-meta-1",
        shopId,
        recipeId: "meta-capi",
        recipeVersion: "1.0.0",
        status: "configuring",
        config,
        completedSteps: [],
        validationResults: [],
      };
      vi.mocked(prisma.appliedRecipe.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.appliedRecipe.create).mockResolvedValue(mockApplied as any);
      const applied = await startRecipe(shopId, "meta-capi", config);
      expect(applied).toBeDefined();
    });
  });
  describe("Multi-Platform Detection", () => {
    it("should detect and recommend multiple recipes for complex scripts", async () => {
      const complexScript = `
        <!-- Google Analytics -->
        gtag('config', 'G-XXXXXXXX'); google-analytics
        <!-- Facebook Pixel -->
        fbq('track', 'PageView'); facebook-pixel
        <!-- TikTok Pixel -->
        ttq.track('ViewContent');
        <!-- Fairing Survey -->
        fairing survey post-purchase-survey
      `;
      const result = matchAdditionalScriptsToRecipes(complexScript);
      const recipeIds = result.matches.map(m => m.recipe.id);
      expect(recipeIds).toContain("ga4-basic");
      expect(recipeIds).toContain("meta-capi");
      expect(recipeIds).toContain("tiktok-events");
      expect(recipeIds.length).toBeGreaterThanOrEqual(3);
    });
    it("should prioritize matches by confidence", async () => {
      const scriptContent = "gtag('config', 'G-XXXXXXXX'); google-analytics setup";
      const matches = matchScriptToRecipes(scriptContent);
      for (let i = 0; i < matches.length - 1; i++) {
        expect(matches[i].confidence).toBeGreaterThanOrEqual(matches[i + 1].confidence);
      }
    });
  });
  describe("ScriptTag Batch Processing", () => {
    it("should process multiple script tags and deduplicate recipes", async () => {
      const scriptTags = [
        { id: "st-1", src: "gtag('config', 'G-XXXXXXXX')", display_scope: "all" },
        { id: "st-2", src: "gtag('event', 'purchase')", display_scope: "order_status" },
        { id: "st-3", src: "fbq('track', 'Purchase')", display_scope: "order_status" },
      ];
      const result = matchScriptTagsToRecipes(scriptTags);
      const ga4Matches = result.matches.filter(m => m.recipe.id === "ga4-basic");
      expect(ga4Matches.length).toBeLessThanOrEqual(1);
    });
  });
  describe("Applied Recipes Management", () => {
    const shopId = "shop-mgmt-123";
    it("should track multiple applied recipes for a shop", async () => {
      const mockRecipes = [
        { id: "ar-1", recipeId: "ga4-basic", status: "completed", createdAt: new Date() },
        { id: "ar-2", recipeId: "meta-capi", status: "in_progress", createdAt: new Date() },
        { id: "ar-3", recipeId: "survey-migration", status: "configuring", createdAt: new Date() },
      ];
      vi.mocked(prisma.appliedRecipe.findMany).mockResolvedValue(mockRecipes as any);
      const recipes = await getAppliedRecipes(shopId);
      expect(recipes).toHaveLength(3);
      expect(prisma.appliedRecipe.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopId },
          orderBy: { createdAt: "desc" },
        })
      );
    });
    it("should not create duplicate in-progress recipes", async () => {
      const existingRecipe = {
        id: "ar-existing",
        shopId,
        recipeId: "ga4-basic",
        status: "in_progress",
      };
      vi.mocked(prisma.appliedRecipe.findFirst).mockResolvedValue(existingRecipe as any);
      const result = await startRecipe(shopId, "ga4-basic");
      expect(result?.id).toBe("ar-existing");
      expect(prisma.appliedRecipe.create).not.toHaveBeenCalled();
    });
  });
  describe("Configuration Validation", () => {
    it("should validate all recipe configurations", () => {
      for (const recipe of RECIPE_REGISTRY) {
        const emptyResult = validateRecipeConfig(recipe, {});
        const requiredFields = recipe.configFields.filter(f => f.required);
        if (requiredFields.length > 0) {
          expect(emptyResult.valid).toBe(false);
          expect(emptyResult.errors.length).toBeGreaterThanOrEqual(requiredFields.length);
        }
      }
    });
    it("should accept valid configurations for all recipes", () => {
      const validConfigs: Record<string, Record<string, unknown>> = {
        "ga4-basic": {
          measurementId: "G-ABCDEF1234",
          apiSecret: "test-secret",
        },
        "meta-capi": {
          pixelId: "123456789012345",
          accessToken: "access-token",
        },
        "tiktok-events": {
          pixelId: "test-pixel-id",
          accessToken: "tiktok-access-token",
        },
        "survey-migration": {
          surveyTitle: "Test Survey",
          surveyQuestion: "How did you hear about us?",
        },
        "custom-webhook": {
          endpointUrl: "https://example.com/webhook",
          authType: "bearer",
          authValue: "token123",
        },
      };
      for (const recipe of RECIPE_REGISTRY) {
        const config = validConfigs[recipe.id];
        if (config) {
          const result = validateRecipeConfig(recipe, config);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      }
    });
  });
  describe("Migration Steps Workflow", () => {
    it("should have correct step sequence for all recipes", () => {
      for (const recipe of RECIPE_REGISTRY) {
        const steps = recipe.steps;
        for (let i = 0; i < steps.length; i++) {
          expect(steps[i].order).toBe(i + 1);
        }
        for (const step of steps) {
          expect(step.title).toBeTruthy();
          expect(step.description).toBeTruthy();
          expect(step.actionType).toMatch(/^(auto|manual|config)$/);
          expect(typeof step.estimatedMinutes).toBe("number");
        }
      }
    });
    it("should calculate total estimated time correctly", () => {
      for (const recipe of RECIPE_REGISTRY) {
        const totalMinutes = recipe.steps.reduce(
          (sum, step) => sum + step.estimatedMinutes,
          0
        );
        expect(recipe.estimatedTimeMinutes).toBe(totalMinutes);
      }
    });
  });
  describe("Error Handling in Migration Flow", () => {
    it("should handle invalid recipe ID gracefully", async () => {
      const result = await startRecipe("shop-123", "non-existent-recipe");
      expect(result).toBeNull();
    });
    it("should handle validation errors for config fields", () => {
      const recipe = getRecipeById("ga4-basic")!;
      const invalidConfig = {
        measurementId: "INVALID-FORMAT",
        apiSecret: "secret",
      };
      const result = validateRecipeConfig(recipe, invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Measurement ID"))).toBe(true);
    });
    it("should handle missing required fields", () => {
      const recipe = getRecipeById("meta-capi")!;
      const incompleteConfig = {
        pixelId: "123456789012345",
      };
      const result = validateRecipeConfig(recipe, incompleteConfig);
      expect(result.valid).toBe(false);
    });
  });
  describe("Recipe Source Detection", () => {
    it("should identify recipes with correct source types", () => {
      const ga4Recipe = getRecipeById("ga4-basic")!;
      expect(ga4Recipe.source.type).toBe("script_tag");
      const surveyRecipe = getRecipeById("survey-migration")!;
      expect(surveyRecipe.source.type).toBe("additional_scripts");
      const metaRecipe = getRecipeById("meta-capi")!;
      expect(metaRecipe.source.type).toBe("script_tag");
    });
    it("should return matched recipe source type for detected content", () => {
      const gaContent = "gtag('config', 'G-XXXXXXXX'); google-analytics";
      const gaMatches = matchScriptToRecipes(gaContent);
      const ga4Match = gaMatches.find(m => m.recipe.id === "ga4-basic");
      expect(ga4Match).toBeDefined();
      expect(ga4Match!.recipe.source.type).toBe("script_tag");
    });
  });
  describe("Parallel Recipe Execution", () => {
    it("should allow multiple recipes to be in progress", async () => {
      const shopId = "shop-parallel-123";
      const recipes = ["ga4-basic", "meta-capi", "tiktok-events"];
      vi.mocked(prisma.appliedRecipe.findFirst).mockResolvedValue(null);
      let createCount = 0;
      vi.mocked(prisma.appliedRecipe.create).mockImplementation(async () => {
        createCount++;
        return {
          id: `applied-${createCount}`,
          shopId,
          recipeId: recipes[createCount - 1],
          status: "configuring",
          config: {},
          completedSteps: [],
          validationResults: [],
        } as any;
      });
      for (const recipeId of recipes) {
        const result = await startRecipe(shopId, recipeId);
        expect(result).toBeDefined();
      }
      expect(createCount).toBe(3);
    });
  });
});
