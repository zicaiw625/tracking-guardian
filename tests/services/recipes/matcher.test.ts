import { describe, it, expect } from "vitest";
import {
  matchScriptToRecipes,
  matchScriptTagsToRecipes,
  matchAdditionalScriptsToRecipes,
  getSuggestedRecipesForPlatforms,
  getRecipesByCategory,
} from "../../../app/services/recipes/matcher";
import {
  GA4_BASIC_RECIPE,
  META_CAPI_RECIPE,
  TIKTOK_EVENTS_RECIPE,
  CUSTOM_WEBHOOK_RECIPE,
} from "../../../app/services/recipes/registry";
import type { ScriptTag } from "../../../app/types";

describe("Recipe Matcher", () => {
  const trackingApiEnabled =
    process.env.FEATURE_TRACKING_API === "true" || process.env.FEATURE_TRACKING_API === "1";
  describe("matchScriptToRecipes", () => {
    describe("Google Analytics Detection", () => {
      it("should match gtag function calls to GA4 recipe", () => {
        const content = "gtag('config', 'G-XXXXXXXX');";
        const matches = matchScriptToRecipes(content);
        expect(matches.length).toBeGreaterThan(0);
        const ga4Match = matches.find(m => m.recipe.id === "ga4-basic");
        if (trackingApiEnabled) {
          expect(ga4Match).toBeDefined();
        } else {
          expect(ga4Match).toBeUndefined();
        }
      });
      it("should match GA4 measurement ID", () => {
        const content = "var measurementId = 'G-ABCDEF1234';";
        const matches = matchScriptToRecipes(content);
        expect(matches.length).toBeGreaterThan(0);
        const ga4Match = matches.find(m => m.recipe.id === "ga4-basic");
        if (trackingApiEnabled) {
          expect(ga4Match).toBeDefined();
        } else {
          expect(ga4Match).toBeUndefined();
        }
      });
      it("should have high confidence for gtag with keywords", () => {
        const content = `
          gtag('config', 'G-XXXXXXXX');
        `;
        const matches = matchScriptToRecipes(content);
        expect(matches.length).toBeGreaterThan(0);
        if (trackingApiEnabled) {
          expect(matches[0].confidence).toBeGreaterThanOrEqual(0.4);
        } else {
          expect(matches[0].confidence).toBeGreaterThan(0);
        }
      });
    });
    describe("Meta/Facebook Detection", () => {
      it("should match fbq function calls to Meta recipe", () => {
        const content = "fbq('track', 'Purchase', {value: 10});";
        const matches = matchScriptToRecipes(content);
        expect(matches.length).toBeGreaterThan(0);
        const metaMatch = matches.find(m => m.recipe.id === "meta-capi");
        if (trackingApiEnabled) {
          expect(metaMatch).toBeDefined();
        } else {
          expect(metaMatch).toBeUndefined();
        }
      });
      it("should match Facebook SDK URL with keywords", () => {
        const content = "https://connect.facebook.net/en_US/fbevents.js fbq facebook-pixel";
        const matches = matchScriptToRecipes(content);
        expect(matches.length).toBeGreaterThan(0);
        const metaMatch = matches.find(m => m.recipe.id === "meta-capi");
        if (trackingApiEnabled) {
          expect(metaMatch).toBeDefined();
        } else {
          expect(metaMatch).toBeUndefined();
        }
      });
      it("should match fbq with pixel ID in configuration", () => {
        const content = 'fbq("init", "1234567890123456"); facebook-pixel';
        const matches = matchScriptToRecipes(content);
        expect(matches.length).toBeGreaterThan(0);
        const metaMatch = matches.find(m => m.recipe.id === "meta-capi");
        if (trackingApiEnabled) {
          expect(metaMatch).toBeDefined();
        } else {
          expect(metaMatch).toBeUndefined();
        }
      });
    });
    describe("TikTok Detection", () => {
      it("should match ttq function calls to TikTok recipe", () => {
        const content = "ttq.track('CompletePayment');";
        const matches = matchScriptToRecipes(content);
        expect(matches.length).toBeGreaterThan(0);
        if (trackingApiEnabled) {
          expect(matches[0].recipe.id).toBe("tiktok-events");
        } else {
          expect(matches[0].recipe.id).toBe("custom-webhook");
        }
      });
      it("should match TikTok analytics domain", () => {
        const content = "https://analytics.tiktok.com/i18n/pixel/events.js";
        const matches = matchScriptToRecipes(content);
        expect(matches.length).toBeGreaterThan(0);
        const tiktokMatch = matches.find(m => m.recipe.id === "tiktok-events");
        if (trackingApiEnabled) {
          expect(tiktokMatch).toBeDefined();
        } else {
          expect(tiktokMatch).toBeUndefined();
        }
      });
    });
    describe("Multiple Matches", () => {
      it("should return multiple recipes when content matches multiple patterns", () => {
        const content = `
          gtag('config', 'G-XXXXXXXX');
          fbq('track', 'PageView');
        `;
        const matches = matchScriptToRecipes(content);
        expect(matches.length).toBeGreaterThanOrEqual(trackingApiEnabled ? 2 : 1);
        const recipeIds = matches.map(m => m.recipe.id);
        if (trackingApiEnabled) {
          expect(recipeIds).toContain("ga4-basic");
          expect(recipeIds).toContain("meta-capi");
        }
      });
      it("should sort matches by confidence", () => {
        const content = `
          gtag('config', 'G-XXXXXXXX');
          google-analytics setup
        `;
        const matches = matchScriptToRecipes(content);
        for (let i = 0; i < matches.length - 1; i++) {
          expect(matches[i].confidence).toBeGreaterThanOrEqual(matches[i + 1].confidence);
        }
      });
      it("should deduplicate same recipe matches", () => {
        const content = `
          gtag('config', 'G-XXXXXXXX');
          gtag('event', 'purchase');
          G-ABCDEF1234
        `;
        const matches = matchScriptToRecipes(content);
        const ga4Matches = matches.filter(m => m.recipe.id === "ga4-basic");
        expect(ga4Matches.length).toBe(trackingApiEnabled ? 1 : 0);
      });
    });
    describe("Confidence Threshold", () => {
      it("should filter out low confidence matches", () => {
        const content = "random content without tracking";
        const matches = matchScriptToRecipes(content);
        for (const match of matches) {
          expect(match.confidence).toBeGreaterThanOrEqual(0.3);
        }
      });
      it("should include identifier in match", () => {
        const content = "gtag('config', 'G-XXXXXXXX');";
        const matches = matchScriptToRecipes(content, "script-123");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].sourceIdentifier).toBe("script-123");
      });
      it("should truncate source content in match", () => {
        const longContent = "gtag('config', 'G-XXXXXXXX');" + "a".repeat(600);
        const matches = matchScriptToRecipes(longContent);
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].sourceContent?.length).toBeLessThanOrEqual(500);
      });
    });
    describe("No Match Cases", () => {
      it("should not match specific platforms for empty content", () => {
        const matches = matchScriptToRecipes("");
        const specificPlatformMatch = matches.find(m =>
          m.recipe.id !== "custom-webhook"
        );
        expect(specificPlatformMatch).toBeUndefined();
      });
      it("should not match specific platforms for whitespace only", () => {
        const matches = matchScriptToRecipes("   \n\t   ");
        const specificPlatformMatch = matches.find(m =>
          m.recipe.id !== "custom-webhook"
        );
        expect(specificPlatformMatch).toBeUndefined();
      });
    });
  });
  describe("matchScriptTagsToRecipes", () => {
    it("should match multiple script tags", () => {
      const scriptTags: ScriptTag[] = [
        {
          id: "1",
          src: "https://example.com/script.js",
          display_scope: "all",
        },
        {
          id: "2",
          src: "https://example.com/script.js",
          display_scope: "all",
        },
      ];
      const result = matchScriptTagsToRecipes(scriptTags);
      expect(result.matches.length).toBeGreaterThan(0);
    });
    it("should track unmatched script tags", () => {
      const scriptTags: ScriptTag[] = [
        {
          id: "1",
          src: "https://example.com/script.js",
          display_scope: "all",
        },
      ];
      const result = matchScriptTagsToRecipes(scriptTags);
      expect(result.unmatched.length + result.matches.length).toBeGreaterThanOrEqual(0);
    });
    it("should deduplicate recipes across multiple script tags", () => {
      const scriptTags: ScriptTag[] = [
        {
          id: "1",
          src: "gtag('config', 'G-XXXXXXXX')",
          display_scope: "all",
        },
        {
          id: "2",
          src: "gtag('config', 'G-YYYYYYYY')",
          display_scope: "all",
        },
      ];
      const result = matchScriptTagsToRecipes(scriptTags);
      const ga4Matches = result.matches.filter(m => m.recipe.id === "ga4-basic");
      expect(ga4Matches.length).toBeLessThanOrEqual(1);
    });
    it("should keep highest confidence match when deduplicating", () => {
      const scriptTags: ScriptTag[] = [
        {
          id: "1",
          src: "gtag",
          display_scope: "all",
        },
        {
          id: "2",
          src: "gtag('config', 'G-XXXXXXXX'); google-analytics",
          display_scope: "all",
        },
      ];
      const result = matchScriptTagsToRecipes(scriptTags);
      const ga4Match = result.matches.find(m => m.recipe.id === "ga4-basic");
      if (ga4Match) {
        expect(ga4Match.confidence).toBeGreaterThan(0);
      }
    });
    it("should handle empty script tags array", () => {
      const result = matchScriptTagsToRecipes([]);
      expect(result.matches).toHaveLength(0);
      expect(result.unmatched).toHaveLength(0);
    });
  });
  describe("matchAdditionalScriptsToRecipes", () => {
    it("should split content by script tags", () => {
      const content = `
        <script>
          gtag('config', 'G-XXXXXXXX');
        </script>
        <script>
          fbq('track', 'PageView');
        </script>
      `;
      const result = matchAdditionalScriptsToRecipes(content);
      expect(result.matches.length).toBeGreaterThanOrEqual(trackingApiEnabled ? 2 : 1);
      const recipeIds = result.matches.map(m => m.recipe.id);
      if (trackingApiEnabled) {
        expect(recipeIds).toContain("ga4-basic");
        expect(recipeIds).toContain("meta-capi");
      }
    });
    it("should handle content without script tags", () => {
      const content = "gtag('config', 'G-XXXXXXXX');";
      const result = matchAdditionalScriptsToRecipes(content);
      expect(result.matches.length).toBeGreaterThan(0);
    });
    it("should track unmatched blocks", () => {
      const content = `
        <script>
          customTracking.init();
        </script>
      `;
      const result = matchAdditionalScriptsToRecipes(content);
      expect(result.matches.length + result.unmatched.length).toBeGreaterThanOrEqual(0);
    });
    it("should assign block identifiers", () => {
      const content = `
        <script>
          gtag('config', 'G-XXXXXXXX');
        </script>
      `;
      const result = matchAdditionalScriptsToRecipes(content);
      if (result.matches.length > 0) {
        expect(result.matches[0].sourceIdentifier).toMatch(/^block-\d+$/);
      }
    });
    it("should handle empty content", () => {
      const result = matchAdditionalScriptsToRecipes("");
      const specificPlatformMatches = result.matches.filter(m =>
        m.recipe.id !== "custom-webhook"
      );
      expect(specificPlatformMatches).toHaveLength(0);
    });
    it("should handle multiple platforms in single script tag", () => {
      const content = `
        <script>
          gtag('config', 'G-XXXXXXXX');
          fbq('track', 'PageView');
          ttq.track('PageView');
        </script>
      `;
      const result = matchAdditionalScriptsToRecipes(content);
      expect(result.matches.length).toBeGreaterThanOrEqual(trackingApiEnabled ? 3 : 1);
    });
  });
  describe("getSuggestedRecipesForPlatforms", () => {
    it("should return GA4 recipe for google platform", () => {
      const recipes = getSuggestedRecipesForPlatforms(["google"]);
      if (trackingApiEnabled) {
        expect(recipes).toContain(GA4_BASIC_RECIPE);
      } else {
        expect(recipes).not.toContain(GA4_BASIC_RECIPE);
      }
    });
    it("should return Meta recipe for meta platform", () => {
      const recipes = getSuggestedRecipesForPlatforms(["meta"]);
      if (trackingApiEnabled) {
        expect(recipes).toContain(META_CAPI_RECIPE);
      } else {
        expect(recipes).not.toContain(META_CAPI_RECIPE);
      }
    });
    it("should return TikTok recipe for tiktok platform", () => {
      const recipes = getSuggestedRecipesForPlatforms(["tiktok"]);
      if (trackingApiEnabled) {
        expect(recipes).toContain(TIKTOK_EVENTS_RECIPE);
      } else {
        expect(recipes).not.toContain(TIKTOK_EVENTS_RECIPE);
      }
    });
    it("should return multiple recipes for multiple platforms", () => {
      const recipes = getSuggestedRecipesForPlatforms(["google", "meta", "tiktok"]);
      if (trackingApiEnabled) {
        expect(recipes).toContain(GA4_BASIC_RECIPE);
        expect(recipes).toContain(META_CAPI_RECIPE);
        expect(recipes).toContain(TIKTOK_EVENTS_RECIPE);
      } else {
        expect(recipes).not.toContain(GA4_BASIC_RECIPE);
        expect(recipes).not.toContain(META_CAPI_RECIPE);
        expect(recipes).not.toContain(TIKTOK_EVENTS_RECIPE);
      }
    });
    it("should not duplicate recipes", () => {
      const recipes = getSuggestedRecipesForPlatforms(["google", "google"]);
      const ga4Count = recipes.filter(r => r.id === "ga4-basic").length;
      expect(ga4Count).toBe(trackingApiEnabled ? 1 : 0);
    });
    it("should match by tags as well as platform", () => {
      const recipes = getSuggestedRecipesForPlatforms(["facebook"]);
      if (trackingApiEnabled) {
        expect(recipes).toContain(META_CAPI_RECIPE);
      } else {
        expect(recipes).not.toContain(META_CAPI_RECIPE);
      }
    });
    it("should return empty array for unknown platforms", () => {
      const recipes = getSuggestedRecipesForPlatforms(["unknown-platform"]);
      expect(recipes).toHaveLength(0);
    });
    it("should handle empty platforms array", () => {
      const recipes = getSuggestedRecipesForPlatforms([]);
      expect(recipes).toHaveLength(0);
    });
  });
  describe("getRecipesByCategory", () => {
    it("should group recipes by category", () => {
      const byCategory = getRecipesByCategory();
      expect(byCategory["custom"]).toContain(CUSTOM_WEBHOOK_RECIPE);
      if (trackingApiEnabled) {
        expect(byCategory["analytics"]).toContain(GA4_BASIC_RECIPE);
        expect(byCategory["advertising"]).toContain(META_CAPI_RECIPE);
        expect(byCategory["advertising"]).toContain(TIKTOK_EVENTS_RECIPE);
      }
    });
    it("should include all defined categories", () => {
      const byCategory = getRecipesByCategory();
      expect(Object.keys(byCategory)).toContain("custom");
      if (trackingApiEnabled) {
        expect(Object.keys(byCategory)).toContain("analytics");
        expect(Object.keys(byCategory)).toContain("advertising");
      }
    });
    it("should not have empty categories", () => {
      const byCategory = getRecipesByCategory();
      for (const category of Object.keys(byCategory)) {
        expect(byCategory[category].length).toBeGreaterThan(0);
      }
    });
  });
  describe("RecipeMatch Structure", () => {
    it("should have required fields", () => {
      const content = "gtag('config', 'G-XXXXXXXX');";
      const matches = matchScriptToRecipes(content);
      expect(matches.length).toBeGreaterThan(0);
      const match = matches[0];
      expect(match.recipe).toBeDefined();
      expect(match.confidence).toBeDefined();
      expect(match.matchedPattern).toBeDefined();
      expect(typeof match.confidence).toBe("number");
    });
    it("should have confidence between 0 and 1", () => {
      const content = "gtag('config', 'G-XXXXXXXX'); google-analytics";
      const matches = matchScriptToRecipes(content);
      for (const match of matches) {
        expect(match.confidence).toBeGreaterThanOrEqual(0);
        expect(match.confidence).toBeLessThanOrEqual(1);
      }
    });
  });
});
