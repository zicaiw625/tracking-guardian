import { describe, it, expect } from "vitest";
import {
  RECIPE_REGISTRY,
  GA4_BASIC_RECIPE,
  META_CAPI_RECIPE,
  TIKTOK_EVENTS_RECIPE,
  SURVEY_MIGRATION_RECIPE,
  CUSTOM_WEBHOOK_RECIPE,
  getRecipeById,
  getRecipesByCategory,
  getRecipesByPlatform,
  getStableRecipes,
  searchRecipes,
} from "../../../app/services/recipes/registry";
import type { MigrationRecipe } from "../../../app/services/recipes/types";

describe("Recipe Registry", () => {
  describe("RECIPE_REGISTRY", () => {
    it("should contain all predefined recipes", () => {
      expect(RECIPE_REGISTRY).toHaveLength(5);
      expect(RECIPE_REGISTRY).toContain(GA4_BASIC_RECIPE);
      expect(RECIPE_REGISTRY).toContain(META_CAPI_RECIPE);
      expect(RECIPE_REGISTRY).toContain(TIKTOK_EVENTS_RECIPE);
      expect(RECIPE_REGISTRY).toContain(SURVEY_MIGRATION_RECIPE);
      expect(RECIPE_REGISTRY).toContain(CUSTOM_WEBHOOK_RECIPE);
    });
    it("should have unique IDs for all recipes", () => {
      const ids = RECIPE_REGISTRY.map(r => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
    it("should have valid structure for all recipes", () => {
      for (const recipe of RECIPE_REGISTRY) {
        expect(recipe.id).toBeTruthy();
        expect(recipe.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(recipe.name).toBeTruthy();
        expect(recipe.description).toBeTruthy();
        expect(recipe.category).toBeTruthy();
        expect(recipe.difficulty).toMatch(/^(easy|medium|advanced)$/);
        expect(recipe.status).toMatch(/^(stable|beta|deprecated)$/);
        expect(recipe.source).toBeDefined();
        expect(recipe.source.type).toBeTruthy();
        expect(recipe.source.platform).toBeTruthy();
        expect(recipe.source.detectionPatterns).toBeInstanceOf(Array);
        expect(recipe.target).toBeDefined();
        expect(recipe.target.type).toBeTruthy();
        expect(typeof recipe.target.fullSupport).toBe("boolean");
        expect(recipe.steps).toBeInstanceOf(Array);
        expect(recipe.steps.length).toBeGreaterThan(0);
        expect(recipe.configFields).toBeInstanceOf(Array);
        expect(recipe.validationTests).toBeInstanceOf(Array);
        expect(recipe.tags).toBeInstanceOf(Array);
        expect(recipe.tags.length).toBeGreaterThan(0);
      }
    });
  });
  describe("GA4_BASIC_RECIPE", () => {
    it("should have correct ID and category", () => {
      expect(GA4_BASIC_RECIPE.id).toBe("ga4-basic");
      expect(GA4_BASIC_RECIPE.category).toBe("analytics");
    });
    it("should detect gtag function calls", () => {
      const pattern = GA4_BASIC_RECIPE.source.detectionPatterns[0];
      expect(pattern.patterns[0].test("gtag('event', 'purchase')")).toBe(true);
    });
    it("should detect GA4 measurement IDs", () => {
      const pattern = GA4_BASIC_RECIPE.source.detectionPatterns[0];
      expect(pattern.patterns[1].test("G-ABCDEF1234")).toBe(true);
    });
    it("should have required config fields", () => {
      const fields = GA4_BASIC_RECIPE.configFields;
      const measurementId = fields.find(f => f.key === "measurementId");
      const apiSecret = fields.find(f => f.key === "apiSecret");
      expect(measurementId).toBeDefined();
      expect(measurementId?.required).toBe(true);
      expect(apiSecret).toBeDefined();
      expect(apiSecret?.required).toBe(true);
    });
    it("should validate measurement ID format", () => {
      const measurementId = GA4_BASIC_RECIPE.configFields.find(f => f.key === "measurementId");
      const pattern = new RegExp(measurementId!.validationPattern!);
      expect(pattern.test("G-ABCDEF1234")).toBe(true);
      expect(pattern.test("G-123")).toBe(true);
      expect(pattern.test("invalid")).toBe(false);
      expect(pattern.test("UA-12345")).toBe(false);
    });
  });
  describe("META_CAPI_RECIPE", () => {
    it("should have correct ID and category", () => {
      expect(META_CAPI_RECIPE.id).toBe("meta-capi");
      expect(META_CAPI_RECIPE.category).toBe("advertising");
    });
    it("should detect fbq function calls", () => {
      const pattern = META_CAPI_RECIPE.source.detectionPatterns[0];
      expect(pattern.patterns[0].test("fbq('track', 'Purchase')")).toBe(true);
    });
    it("should detect Facebook connect script", () => {
      const pattern = META_CAPI_RECIPE.source.detectionPatterns[0];
      expect(pattern.patterns[1].test("connect.facebook.net/en_US/fbevents.js")).toBe(true);
    });
    it("should detect pixel ID in various formats", () => {
      const pattern = META_CAPI_RECIPE.source.detectionPatterns[0];
      expect(pattern.patterns[2].test('pixel_id: "1234567890123456"')).toBe(true);
      expect(pattern.patterns[2].test("pixel-id: 123456789012345")).toBe(true);
    });
    it("should validate pixel ID format", () => {
      const pixelId = META_CAPI_RECIPE.configFields.find(f => f.key === "pixelId");
      const pattern = new RegExp(pixelId!.validationPattern!);
      expect(pattern.test("123456789012345")).toBe(true);
      expect(pattern.test("1234567890123456")).toBe(true);
      expect(pattern.test("12345678901234567")).toBe(false);
      expect(pattern.test("invalid")).toBe(false);
    });
    it("should have optional test event code field", () => {
      const testEventCode = META_CAPI_RECIPE.configFields.find(f => f.key === "testEventCode");
      expect(testEventCode).toBeDefined();
      expect(testEventCode?.required).toBe(false);
    });
  });
  describe("TIKTOK_EVENTS_RECIPE", () => {
    it("should have correct ID and category", () => {
      expect(TIKTOK_EVENTS_RECIPE.id).toBe("tiktok-events");
      expect(TIKTOK_EVENTS_RECIPE.category).toBe("advertising");
    });
    it("should detect ttq function calls", () => {
      const pattern = TIKTOK_EVENTS_RECIPE.source.detectionPatterns[0];
      expect(pattern.patterns[0].test("ttq.track('CompletePayment')")).toBe(true);
      expect(pattern.patterns[0].test("ttq('track')")).toBe(true);
    });
    it("should detect TikTok analytics domain", () => {
      const pattern = TIKTOK_EVENTS_RECIPE.source.detectionPatterns[0];
      expect(pattern.patterns[1].test("analytics.tiktok.com/pixel")).toBe(true);
    });
  });
  describe("SURVEY_MIGRATION_RECIPE", () => {
    it("should have correct ID and category", () => {
      expect(SURVEY_MIGRATION_RECIPE.id).toBe("survey-migration");
      expect(SURVEY_MIGRATION_RECIPE.category).toBe("survey");
    });
    it("should target checkout_ui extension", () => {
      expect(SURVEY_MIGRATION_RECIPE.target.type).toBe("checkout_ui");
    });
    it("should detect known survey providers", () => {
      const pattern = SURVEY_MIGRATION_RECIPE.source.detectionPatterns[0];
      const testContent = "fairing enquirelabs knocommerce zigpoll";
      for (const regex of pattern.patterns) {
        expect(regex.test(testContent)).toBe(true);
      }
    });
    it("should have default values for config fields", () => {
      const surveyTitle = SURVEY_MIGRATION_RECIPE.configFields.find(f => f.key === "surveyTitle");
      const surveyQuestion = SURVEY_MIGRATION_RECIPE.configFields.find(f => f.key === "surveyQuestion");
      expect(surveyTitle?.defaultValue).toBeDefined();
      expect(surveyQuestion?.defaultValue).toBeDefined();
    });
    it("should have manual validation tests", () => {
      const manualTests = SURVEY_MIGRATION_RECIPE.validationTests.filter(t => t.type === "manual");
      expect(manualTests.length).toBeGreaterThan(0);
    });
  });
  describe("CUSTOM_WEBHOOK_RECIPE", () => {
    it("should have correct ID and category", () => {
      expect(CUSTOM_WEBHOOK_RECIPE.id).toBe("custom-webhook");
      expect(CUSTOM_WEBHOOK_RECIPE.category).toBe("custom");
    });
    it("should require HTTPS for webhook URL", () => {
      const endpointUrl = CUSTOM_WEBHOOK_RECIPE.configFields.find(f => f.key === "endpointUrl");
      const pattern = new RegExp(endpointUrl!.validationPattern!);
      expect(pattern.test("https:
      expect(pattern.test("http:
    });
    it("should support multiple auth types", () => {
      const authType = CUSTOM_WEBHOOK_RECIPE.configFields.find(f => f.key === "authType");
      expect(authType?.options).toHaveLength(4);
      expect(authType?.options?.map(o => o.value)).toEqual(["none", "bearer", "basic", "header"]);
    });
    it("should have medium difficulty", () => {
      expect(CUSTOM_WEBHOOK_RECIPE.difficulty).toBe("medium");
    });
  });
  describe("getRecipeById", () => {
    it("should return recipe when found", () => {
      const recipe = getRecipeById("ga4-basic");
      expect(recipe).toBeDefined();
      expect(recipe?.id).toBe("ga4-basic");
    });
    it("should return undefined when not found", () => {
      const recipe = getRecipeById("non-existent");
      expect(recipe).toBeUndefined();
    });
    it("should be case-sensitive", () => {
      const recipe = getRecipeById("GA4-BASIC");
      expect(recipe).toBeUndefined();
    });
  });
  describe("getRecipesByCategory", () => {
    it("should return recipes for analytics category", () => {
      const recipes = getRecipesByCategory("analytics");
      expect(recipes).toContain(GA4_BASIC_RECIPE);
    });
    it("should return recipes for advertising category", () => {
      const recipes = getRecipesByCategory("advertising");
      expect(recipes).toContain(META_CAPI_RECIPE);
      expect(recipes).toContain(TIKTOK_EVENTS_RECIPE);
    });
    it("should return empty array for non-existent category", () => {
      const recipes = getRecipesByCategory("non-existent");
      expect(recipes).toHaveLength(0);
    });
  });
  describe("getRecipesByPlatform", () => {
    it("should return recipes by source platform", () => {
      const googleRecipes = getRecipesByPlatform("google");
      expect(googleRecipes).toContain(GA4_BASIC_RECIPE);
    });
    it("should return recipes by tag", () => {
      const metaRecipes = getRecipesByPlatform("meta");
      expect(metaRecipes).toContain(META_CAPI_RECIPE);
      const facebookRecipes = getRecipesByPlatform("facebook");
      expect(facebookRecipes).toContain(META_CAPI_RECIPE);
    });
    it("should return empty array for non-existent platform", () => {
      const recipes = getRecipesByPlatform("non-existent");
      expect(recipes).toHaveLength(0);
    });
  });
  describe("getStableRecipes", () => {
    it("should return only stable recipes", () => {
      const stableRecipes = getStableRecipes();
      expect(stableRecipes.length).toBeGreaterThan(0);
      for (const recipe of stableRecipes) {
        expect(recipe.status).toBe("stable");
      }
    });
    it("should include all predefined stable recipes", () => {
      const stableRecipes = getStableRecipes();
      expect(stableRecipes).toContain(GA4_BASIC_RECIPE);
      expect(stableRecipes).toContain(META_CAPI_RECIPE);
      expect(stableRecipes).toContain(TIKTOK_EVENTS_RECIPE);
      expect(stableRecipes).toContain(SURVEY_MIGRATION_RECIPE);
      expect(stableRecipes).toContain(CUSTOM_WEBHOOK_RECIPE);
    });
  });
  describe("searchRecipes", () => {
    it("should find recipes by name", () => {
      const results = searchRecipes("GA4");
      expect(results).toContain(GA4_BASIC_RECIPE);
    });
    it("should find recipes by description", () => {
      const results = searchRecipes("gtag.js");
      expect(results).toContain(GA4_BASIC_RECIPE);
    });
    it("should find recipes by tags", () => {
      const results = searchRecipes("facebook");
      expect(results).toContain(META_CAPI_RECIPE);
    });
    it("should be case-insensitive", () => {
      const resultsLower = searchRecipes("google");
      const resultsUpper = searchRecipes("GOOGLE");
      const resultsMixed = searchRecipes("GoOgLe");
      expect(resultsLower).toContain(GA4_BASIC_RECIPE);
      expect(resultsUpper).toContain(GA4_BASIC_RECIPE);
      expect(resultsMixed).toContain(GA4_BASIC_RECIPE);
    });
    it("should return empty array for no matches", () => {
      const results = searchRecipes("xyz-no-match-123");
      expect(results).toHaveLength(0);
    });
    it("should find multiple recipes for broad queries", () => {
      const results = searchRecipes("pixel");
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });
  describe("Recipe Steps Validation", () => {
    it("should have sequential step orders", () => {
      for (const recipe of RECIPE_REGISTRY) {
        const orders = recipe.steps.map(s => s.order).sort((a, b) => a - b);
        for (let i = 0; i < orders.length; i++) {
          expect(orders[i]).toBe(i + 1);
        }
      }
    });
    it("should have valid action types for all steps", () => {
      const validActionTypes = ["auto", "manual", "config"];
      for (const recipe of RECIPE_REGISTRY) {
        for (const step of recipe.steps) {
          expect(validActionTypes).toContain(step.actionType);
        }
      }
    });
    it("should have autoAction defined for auto steps", () => {
      for (const recipe of RECIPE_REGISTRY) {
        for (const step of recipe.steps) {
          if (step.actionType === "auto") {
            expect(step.autoAction).toBeDefined();
          }
        }
      }
    });
  });
  describe("Recipe Config Fields Validation", () => {
    it("should have valid field types", () => {
      const validTypes = ["text", "password", "select", "checkbox", "textarea"];
      for (const recipe of RECIPE_REGISTRY) {
        for (const field of recipe.configFields) {
          expect(validTypes).toContain(field.type);
        }
      }
    });
    it("should have options for select fields", () => {
      for (const recipe of RECIPE_REGISTRY) {
        for (const field of recipe.configFields) {
          if (field.type === "select") {
            expect(field.options).toBeDefined();
            expect(field.options?.length).toBeGreaterThan(0);
          }
        }
      }
    });
    it("should have unique keys within each recipe", () => {
      for (const recipe of RECIPE_REGISTRY) {
        const keys = recipe.configFields.map(f => f.key);
        const uniqueKeys = new Set(keys);
        expect(uniqueKeys.size).toBe(keys.length);
      }
    });
  });
  describe("Recipe Validation Tests Structure", () => {
    it("should have valid test types", () => {
      const validTypes = ["event_received", "parameter_check", "timing_check", "manual"];
      for (const recipe of RECIPE_REGISTRY) {
        for (const test of recipe.validationTests) {
          expect(validTypes).toContain(test.type);
        }
      }
    });
    it("should have expectedEvent for event_received tests", () => {
      for (const recipe of RECIPE_REGISTRY) {
        for (const test of recipe.validationTests) {
          if (test.type === "event_received") {
            expect(test.expectedEvent).toBeDefined();
          }
        }
      }
    });
    it("should have requiredParams for parameter_check tests", () => {
      for (const recipe of RECIPE_REGISTRY) {
        for (const test of recipe.validationTests) {
          if (test.type === "parameter_check") {
            expect(test.requiredParams).toBeDefined();
            expect(test.requiredParams?.length).toBeGreaterThan(0);
          }
        }
      }
    });
  });
});
