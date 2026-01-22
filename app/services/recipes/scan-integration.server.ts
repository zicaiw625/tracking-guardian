import { matchScriptTagsToRecipes, matchAdditionalScriptsToRecipes } from "./matcher";
import { startRecipe } from "./executor";
import type { ScriptTag } from "../../types";
import { logger } from "../../utils/logger.server";

export interface ScanRecipeMatch {
  recipeId: string;
  recipeName: string;
  confidence: number;
  sourceType: "script_tag" | "additional_script";
  sourceIdentifier?: string;
  sourceContent?: string;
  canApply: boolean;
}

export async function matchScanResultsToRecipes(
  scriptTags: ScriptTag[],
  additionalScripts?: string
): Promise<ScanRecipeMatch[]> {
  const matches: ScanRecipeMatch[] = [];
  
  if (scriptTags.length > 0) {
    const scriptTagMatches = matchScriptTagsToRecipes(scriptTags);
    for (const match of scriptTagMatches.matches) {
      matches.push({
        recipeId: match.recipe.id,
        recipeName: match.recipe.name,
        confidence: match.confidence,
        sourceType: "script_tag",
        sourceIdentifier: match.sourceIdentifier,
        sourceContent: match.sourceContent,
        canApply: match.recipe.status === "stable",
      });
    }
  }
  
  if (additionalScripts && additionalScripts.trim().length > 0) {
    const additionalMatches = matchAdditionalScriptsToRecipes(additionalScripts);
    for (const match of additionalMatches.matches) {
      const existing = matches.find(m => m.recipeId === match.recipe.id);
      if (!existing || match.confidence > existing.confidence) {
        const index = existing ? matches.indexOf(existing) : matches.length;
        if (existing) {
          matches[index] = {
            ...existing,
            confidence: Math.max(existing.confidence, match.confidence),
            sourceType: "additional_script",
            sourceIdentifier: match.sourceIdentifier,
            sourceContent: match.sourceContent,
          };
        } else {
          matches.push({
            recipeId: match.recipe.id,
            recipeName: match.recipe.name,
            confidence: match.confidence,
            sourceType: "additional_script",
            sourceIdentifier: match.sourceIdentifier,
            sourceContent: match.sourceContent,
            canApply: match.recipe.status === "stable",
          });
        }
      }
    }
  }
  
  return matches.sort((a, b) => b.confidence - a.confidence);
}

export async function applyRecipeFromScan(
  shopId: string,
  recipeId: string,
  sourceIdentifier?: string,
  initialConfig?: Record<string, unknown>
): Promise<{ success: boolean; appliedRecipeId?: string; error?: string }> {
  try {
    const applied = await startRecipe(shopId, recipeId, initialConfig || {}, sourceIdentifier);
    if (!applied) {
      return { success: false, error: "Recipe not found or already in progress" };
    }
    return { success: true, appliedRecipeId: applied.id };
  } catch (error) {
    logger.error("Failed to apply recipe from scan", {
      shopId,
      recipeId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
