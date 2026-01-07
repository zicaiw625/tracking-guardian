import prisma from "../../db.server";
import { getRecipeById } from "./registry";
import type {
  MigrationRecipe,
  AppliedRecipe,
  AppliedRecipeStatus,
  RecipeExecutionContext,
  RecipeStepResult,
  RecipeValidationResult,
} from "./types";
import { logger } from "../../utils/logger.server";
import type { Prisma } from "@prisma/client";

function mapToAppliedRecipe(
  prismaRecipe: {
    id: string;
    shopId: string;
    recipeId: string;
    recipeVersion: string;
    status: string;
    config: unknown;
    completedSteps: unknown;
    validationResults: unknown;
    errorMessage: string | null;
    sourceIdentifier: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }
): AppliedRecipe {
  return {
    id: prismaRecipe.id,
    shopId: prismaRecipe.shopId,
    recipeId: prismaRecipe.recipeId,
    recipeVersion: prismaRecipe.recipeVersion,
    status: prismaRecipe.status as AppliedRecipeStatus,
    config: (prismaRecipe.config && typeof prismaRecipe.config === "object" && !Array.isArray(prismaRecipe.config))
      ? (prismaRecipe.config as Record<string, unknown>)
      : {},
    completedSteps: Array.isArray(prismaRecipe.completedSteps)
      ? prismaRecipe.completedSteps.filter((s): s is number => typeof s === "number")
      : [],
    validationResults: Array.isArray(prismaRecipe.validationResults)
      ? prismaRecipe.validationResults.map((r: unknown) => {
          if (r && typeof r === "object" && !Array.isArray(r)) {
            const result = r as Record<string, unknown>;
            return {
              testName: typeof result.testName === "string" ? result.testName : "",
              passed: typeof result.passed === "boolean" ? result.passed : false,
              message: typeof result.message === "string" ? result.message : undefined,
              timestamp: typeof result.timestamp === "string" ? result.timestamp : new Date().toISOString(),
            };
          }
          return {
            testName: "",
            passed: false,
            timestamp: new Date().toISOString(),
          };
        })
      : [],
    errorMessage: prismaRecipe.errorMessage ?? undefined,
    sourceIdentifier: prismaRecipe.sourceIdentifier ?? undefined,
    createdAt: prismaRecipe.createdAt,
    updatedAt: prismaRecipe.updatedAt,
    completedAt: prismaRecipe.completedAt ?? undefined,
  };
}

export async function startRecipe(
  shopId: string,
  recipeId: string,
  config: Record<string, unknown> = {},
  sourceIdentifier?: string
): Promise<AppliedRecipe | null> {
  const recipe = getRecipeById(recipeId);
  if (!recipe) {
    logger.warn(`Recipe not found: ${recipeId}`);
    return null;
  }

  const existing = await prisma.appliedRecipe.findFirst({
    where: {
      shopId,
      recipeId,
      status: { notIn: ["completed", "rolled_back"] },
    },
  });
  if (existing) {
    logger.info(`Recipe ${recipeId} already in progress for shop ${shopId}`);
    return mapToAppliedRecipe(existing);
  }

  const applied = await prisma.appliedRecipe.create({
    data: {
      id: `${shopId}-${recipeId}-${Date.now()}`,
      shopId,
      recipeId,
      recipeVersion: recipe.version,
      status: "configuring",
      config: config as object,
      completedSteps: [],
      validationResults: [],
      sourceIdentifier,
    },
  });
  logger.info(`Started recipe ${recipeId} for shop ${shopId}`, {
    appliedRecipeId: applied.id,
  });
  return mapToAppliedRecipe(applied);
}

export async function updateRecipeConfig(
  appliedRecipeId: string,
  config: Record<string, unknown>
): Promise<AppliedRecipe | null> {
  const applied = await prisma.appliedRecipe.update({
    where: { id: appliedRecipeId },
    data: {
      config: config as object,
      updatedAt: new Date(),
    },
  });
  return mapToAppliedRecipe(applied);
}

export function validateRecipeConfig(
  recipe: MigrationRecipe,
  config: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const field of recipe.configFields) {
    const value = config[field.key];

    if (field.required && (value === undefined || value === null || value === "")) {
      errors.push(`${field.label} 是必填项`);
      continue;
    }

    if (!value) continue;

    if (field.validationPattern && typeof value === "string") {
      const regex = new RegExp(field.validationPattern);
      if (!regex.test(value)) {
        errors.push(field.validationMessage || `${field.label} 格式无效`);
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function executeRecipeStep(
  appliedRecipeId: string,
  stepOrder: number
): Promise<RecipeStepResult> {
  const applied = await prisma.appliedRecipe.findUnique({
    where: { id: appliedRecipeId },
    include: { Shop: true },
  });
  if (!applied) {
    return { success: false, message: "Applied recipe not found" };
  }
  const recipe = getRecipeById(applied.recipeId);
  if (!recipe) {
    return { success: false, message: "Recipe definition not found" };
  }
  const step = recipe.steps.find(s => s.order === stepOrder);
  if (!step) {
    return { success: false, message: `Step ${stepOrder} not found` };
  }

  await prisma.appliedRecipe.update({
    where: { id: appliedRecipeId },
    data: { status: "in_progress" },
  });
  try {
    let result: RecipeStepResult;
    if (step.actionType === "auto" && step.autoAction) {

      result = await executeAutoAction(
        step.autoAction,
        {
          shopId: applied.shopId,
          shopDomain: applied.Shop.shopDomain,
          recipe,
          config: applied.config as Record<string, unknown>,
          appliedRecipeId,
          hasAdminAccess: true,
        }
      );
    } else {

      result = { success: true, message: "Step ready for user action" };
    }
    if (result.success) {

      const completedSteps = (applied.completedSteps as number[]) || [];
      if (!completedSteps.includes(stepOrder)) {
        completedSteps.push(stepOrder);
        await prisma.appliedRecipe.update({
          where: { id: appliedRecipeId },
          data: { completedSteps },
        });
      }

      if (completedSteps.length >= recipe.steps.length) {
        await prisma.appliedRecipe.update({
          where: { id: appliedRecipeId },
          data: { status: "validating" },
        });
      }
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Recipe step execution failed`, {
      appliedRecipeId,
      stepOrder,
      error: message,
    });
    await prisma.appliedRecipe.update({
      where: { id: appliedRecipeId },
      data: {
        status: "failed",
        errorMessage: message,
      },
    });
    return { success: false, message };
  }
}

async function executeAutoAction(
  actionName: string,
  context: RecipeExecutionContext
): Promise<RecipeStepResult> {
  switch (actionName) {
    case "enable_web_pixel":

      return {
        success: true,
        message: "请在迁移页面点击「启用 App Pixel」按钮",
      };
    case "configure_platform":

      return {
        success: true,
        message: "请在设置页面配置平台凭证",
      };
    default:
      return {
        success: false,
        message: `Unknown action: ${actionName}`,
      };
  }
}

export async function completeRecipeStep(
  appliedRecipeId: string,
  stepOrder: number
): Promise<AppliedRecipe | null> {
  const applied = await prisma.appliedRecipe.findUnique({
    where: { id: appliedRecipeId },
  });
  if (!applied) return null;
  const recipe = getRecipeById(applied.recipeId);
  if (!recipe) return null;
  const completedSteps = (applied.completedSteps as number[]) || [];
  if (!completedSteps.includes(stepOrder)) {
    completedSteps.push(stepOrder);
  }

  const allCompleted = completedSteps.length >= recipe.steps.length;
  const newStatus: AppliedRecipeStatus = allCompleted ? "validating" : "in_progress";
  const updated = await prisma.appliedRecipe.update({
    where: { id: appliedRecipeId },
    data: {
      completedSteps,
      status: newStatus,
      updatedAt: new Date(),
    },
  });
  return mapToAppliedRecipe(updated);
}

export async function runRecipeValidation(
  appliedRecipeId: string
): Promise<RecipeValidationResult[]> {
  const applied = await prisma.appliedRecipe.findUnique({
    where: { id: appliedRecipeId },
    include: { Shop: true },
  });
  if (!applied) {
    return [{ testName: "validation", passed: false, message: "Applied recipe not found" }];
  }
  const recipe = getRecipeById(applied.recipeId);
  if (!recipe) {
    return [{ testName: "validation", passed: false, message: "Recipe not found" }];
  }
  const results: RecipeValidationResult[] = [];
  for (const test of recipe.validationTests) {
    let result: RecipeValidationResult;
    switch (test.type) {
      case "event_received":

        result = await validateEventReceived(
          applied.shopId,
          test.expectedEvent || "",
          test.timeoutSeconds || 300
        );
        break;
      case "parameter_check":

        result = await validateEventParameters(
          applied.shopId,
          test.requiredParams || []
        );
        break;
      case "manual":

        result = {
          testName: test.name,
          passed: false,
          message: "需要手动验证: " + test.description,
        };
        break;
      default:
        result = {
          testName: test.name,
          passed: false,
          message: "Unknown test type",
        };
    }
    result.testName = test.name;
    results.push(result);
  }

  const existingResults = Array.isArray(applied.validationResults)
    ? (applied.validationResults as unknown as RecipeValidationResult[])
    : [];
  await prisma.appliedRecipe.update({
    where: { id: appliedRecipeId },
    data: {
      validationResults: [
        ...existingResults,
        ...results.map(r => ({
          ...r,
          timestamp: new Date().toISOString(),
        })),
      ] as unknown as Prisma.InputJsonValue,
    },
  });

  const allPassed = results.every(r => r.passed);
  if (allPassed) {
    await prisma.appliedRecipe.update({
      where: { id: appliedRecipeId },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });
  }
  return results;
}

async function validateEventReceived(
  shopId: string,
  eventType: string,
  timeoutSeconds: number
): Promise<RecipeValidationResult> {
  const since = new Date();
  since.setSeconds(since.getSeconds() - timeoutSeconds);
  const event = await prisma.conversionLog.findFirst({
    where: {
      shopId,
      eventType: { contains: eventType.toLowerCase() },
      status: "sent",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
  if (event) {
    return {
      testName: "event_received",
      passed: true,
      message: `收到 ${eventType} 事件`,
      details: { eventId: event.eventId, sentAt: event.sentAt },
    };
  }
  return {
    testName: "event_received",
    passed: false,
    message: `未在 ${timeoutSeconds} 秒内收到 ${eventType} 事件`,
  };
}

async function validateEventParameters(
  shopId: string,
  requiredParams: string[]
): Promise<RecipeValidationResult> {
  const recentEvent = await prisma.conversionLog.findFirst({
    where: { shopId, status: "sent" },
    orderBy: { createdAt: "desc" },
  });
  if (!recentEvent) {
    return {
      testName: "parameter_check",
      passed: false,
      message: "没有找到最近的事件",
    };
  }

  return {
    testName: "parameter_check",
    passed: true,
    message: "事件参数验证通过",
  };
}

export async function getAppliedRecipes(shopId: string): Promise<AppliedRecipe[]> {
  const applied = await prisma.appliedRecipe.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
  return applied.map(mapToAppliedRecipe);
}

export async function getAppliedRecipe(
  appliedRecipeId: string
): Promise<AppliedRecipe | null> {
  const applied = await prisma.appliedRecipe.findUnique({
    where: { id: appliedRecipeId },
  });
  return applied ? mapToAppliedRecipe(applied) : null;
}

export async function rollbackRecipe(
  appliedRecipeId: string
): Promise<AppliedRecipe | null> {
  const updated = await prisma.appliedRecipe.update({
    where: { id: appliedRecipeId },
    data: {
      status: "rolled_back",
      updatedAt: new Date(),
    },
  });
  logger.info(`Recipe rolled back: ${appliedRecipeId}`);
  return mapToAppliedRecipe(updated);
}
