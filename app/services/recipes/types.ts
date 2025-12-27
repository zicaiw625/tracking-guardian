export type RecipeCategory =
  | "analytics"
  | "advertising"
  | "survey"
  | "upsell"
  | "affiliate"
  | "messaging"
  | "behavior"
  | "custom";

export type RecipeSourceType =
  | "script_tag"
  | "additional_scripts"
  | "theme_snippet"
  | "app_integration";

export type RecipeTargetType =
  | "app_web_pixel"
  | "server_capi"
  | "checkout_ui"
  | "theme_app_embed"
  | "official_app"
  | "webhook_integration";

export type RecipeDifficulty = "easy" | "medium" | "advanced";

export type RecipeStatus = "stable" | "beta" | "deprecated";

export interface RecipeDetectionPattern {
  patterns: RegExp[];
  keywords?: string[];
  urlPatterns?: RegExp[];
  confidence: number;
}

export interface RecipeConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "checkbox" | "textarea";
  description?: string;
  required: boolean;
  defaultValue?: string | boolean;
  options?: Array<{ value: string; label: string }>;
  validationPattern?: string;
  validationMessage?: string;
}

export interface RecipeMigrationStep {
  order: number;
  title: string;
  description: string;
  actionType: "auto" | "manual" | "config";
  autoAction?: string;
  estimatedMinutes?: number;
  helpUrl?: string;
}

export interface RecipeValidationTest {
  name: string;
  description: string;
  type: "event_received" | "parameter_check" | "timing_check" | "manual";
  expectedEvent?: string;
  requiredParams?: string[];
  timeoutSeconds?: number;
}

export interface MigrationRecipe {
  id: string;
  version: string;
  name: string;
  description: string;
  longDescription?: string;
  category: RecipeCategory;
  difficulty: RecipeDifficulty;
  status: RecipeStatus;
  source: {
    type: RecipeSourceType;
    platform: string;
    detectionPatterns: RecipeDetectionPattern[];
  };
  target: {
    type: RecipeTargetType;
    officialAppUrl?: string;
    fullSupport: boolean;
  };
  configFields: RecipeConfigField[];
  steps: RecipeMigrationStep[];
  validationTests: RecipeValidationTest[];
  trackedEvents: string[];
  estimatedTimeMinutes: number;
  tags: string[];
  icon?: string;
  docsUrl?: string;
  changelog?: Array<{
    version: string;
    date: string;
    changes: string[];
  }>;
}

export type AppliedRecipeStatus =
  | "pending"
  | "configuring"
  | "in_progress"
  | "validating"
  | "completed"
  | "failed"
  | "rolled_back";

export interface AppliedRecipe {
  id: string;
  shopId: string;
  recipeId: string;
  recipeVersion: string;
  status: AppliedRecipeStatus;
  config: Record<string, unknown>;
  completedSteps: number[];
  validationResults: Array<{
    testName: string;
    passed: boolean;
    message?: string;
    timestamp: string;
  }>;
  errorMessage?: string;
  sourceIdentifier?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface RecipeExecutionContext {
  shopId: string;
  shopDomain: string;
  recipe: MigrationRecipe;
  config: Record<string, unknown>;
  appliedRecipeId: string;
  hasAdminAccess: boolean;
}

export interface RecipeStepResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  nextStepOverride?: number;
}

export interface RecipeValidationResult {
  testName: string;
  passed: boolean;
  message?: string;
  details?: Record<string, unknown>;
}
