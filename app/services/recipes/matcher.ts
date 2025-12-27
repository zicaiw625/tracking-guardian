import type { MigrationRecipe, RecipeDetectionPattern } from "./types";
import { RECIPE_REGISTRY } from "./registry";
import type { ScriptTag } from "../../types";

export interface RecipeMatch {
  recipe: MigrationRecipe;
  confidence: number;
  matchedPattern: RecipeDetectionPattern;
  sourceContent?: string;
  sourceIdentifier?: string;
}

export interface MatchResult {
  matches: RecipeMatch[];
  unmatched: Array<{ content: string; identifier?: string }>;
}

export function matchScriptToRecipes(
  content: string,
  identifier?: string
): RecipeMatch[] {
  const matches: RecipeMatch[] = [];
  for (const recipe of RECIPE_REGISTRY) {
    for (const pattern of recipe.source.detectionPatterns) {
      let matchScore = 0;
      let patternMatches = 0;
      for (const regex of pattern.patterns) {
        if (regex.test(content)) {
          patternMatches++;
        }
      }
      if (patternMatches > 0) {
        matchScore += (patternMatches / pattern.patterns.length) * 0.7;
      }
      if (pattern.keywords && pattern.keywords.length > 0) {
        const lowerContent = content.toLowerCase();
        let keywordMatches = 0;
        for (const keyword of pattern.keywords) {
          if (lowerContent.includes(keyword.toLowerCase())) {
            keywordMatches++;
          }
        }
        if (keywordMatches > 0) {
          matchScore += (keywordMatches / pattern.keywords.length) * 0.3;
        }
      }
      if (matchScore > 0) {
        const confidence = Math.min(matchScore * pattern.confidence, 1);
        if (confidence >= 0.3) {
          matches.push({
            recipe,
            confidence,
            matchedPattern: pattern,
            sourceContent: content.substring(0, 500),
            sourceIdentifier: identifier,
          });
        }
      }
    }
  }
  matches.sort((a, b) => b.confidence - a.confidence);
  const seen = new Set<string>();
  return matches.filter(match => {
    if (seen.has(match.recipe.id)) {
      return false;
    }
    seen.add(match.recipe.id);
    return true;
  });
}

export function matchScriptTagsToRecipes(scriptTags: ScriptTag[]): MatchResult {
  const allMatches: RecipeMatch[] = [];
  const unmatched: Array<{ content: string; identifier?: string }> = [];
  for (const tag of scriptTags) {
    const content = tag.src || "";
    const identifier = tag.id;
    const matches = matchScriptToRecipes(content, identifier);
    if (matches.length > 0) {
      allMatches.push(...matches);
    } else if (content) {
      unmatched.push({ content, identifier });
    }
  }
  const recipeMap = new Map<string, RecipeMatch>();
  for (const match of allMatches) {
    const existing = recipeMap.get(match.recipe.id);
    if (!existing || match.confidence > existing.confidence) {
      recipeMap.set(match.recipe.id, match);
    }
  }
  return {
    matches: Array.from(recipeMap.values()).sort((a, b) => b.confidence - a.confidence),
    unmatched,
  };
}

export function matchAdditionalScriptsToRecipes(content: string): MatchResult {
  const blocks = splitIntoBlocks(content);
  const allMatches: RecipeMatch[] = [];
  const unmatched: Array<{ content: string; identifier?: string }> = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const matches = matchScriptToRecipes(block, `block-${i}`);
    if (matches.length > 0) {
      allMatches.push(...matches);
    } else if (block.trim().length > 10) {
      unmatched.push({ content: block, identifier: `block-${i}` });
    }
  }

  const recipeMap = new Map<string, RecipeMatch>();
  for (const match of allMatches) {
    const existing = recipeMap.get(match.recipe.id);
    if (!existing || match.confidence > existing.confidence) {
      recipeMap.set(match.recipe.id, match);
    }
  }
  return {
    matches: Array.from(recipeMap.values()).sort((a, b) => b.confidence - a.confidence),
    unmatched,
  };
}

function splitIntoBlocks(content: string): string[] {

  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: string[] = [];
  let match;
  while ((match = scriptRegex.exec(content)) !== null) {
    if (match[1] && match[1].trim()) {
      blocks.push(match[1]);
    }
  }

  if (blocks.length === 0) {

    blocks.push(content);
  }
  return blocks;
}

export function getSuggestedRecipesForPlatforms(platforms: string[]): MigrationRecipe[] {
  const recipes: MigrationRecipe[] = [];
  const added = new Set<string>();
  for (const platform of platforms) {
    const platformRecipes = RECIPE_REGISTRY.filter(
      recipe =>
        recipe.source.platform === platform ||
        recipe.tags.includes(platform)
    );
    for (const recipe of platformRecipes) {
      if (!added.has(recipe.id)) {
        recipes.push(recipe);
        added.add(recipe.id);
      }
    }
  }
  return recipes;
}

export function getRecipesByCategory(): Record<string, MigrationRecipe[]> {
  const byCategory: Record<string, MigrationRecipe[]> = {};
  for (const recipe of RECIPE_REGISTRY) {
    if (!byCategory[recipe.category]) {
      byCategory[recipe.category] = [];
    }
    byCategory[recipe.category].push(recipe);
  }
  return byCategory;
}
