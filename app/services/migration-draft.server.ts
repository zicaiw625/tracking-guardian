import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export type WizardStep = "select" | "credentials" | "mappings" | "review";

export interface MigrationDraftData {
  selectedPlatforms: string[];
  platformConfigs: Record<
    string,
    {
      credentials: Record<string, string>;
      eventMappings: Record<string, string>;
      environment: "test" | "live";
    }
  >;
}

const DRAFT_EXPIRY_DAYS = 7;

/**
 * 保存迁移向导草稿
 */
export async function saveMigrationDraft(
  shopId: string,
  step: WizardStep,
  configData: MigrationDraftData
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DRAFT_EXPIRY_DAYS);

    const draft = await prisma.migrationDraft.upsert({
      where: { shopId },
      create: {
        shopId,
        step,
        configData: configData as object,
        expiresAt,
      },
      update: {
        step,
        configData: configData as object,
        expiresAt,
        updatedAt: new Date(),
      },
    });

    logger.info("Migration draft saved", { shopId, step, draftId: draft.id });
    return { success: true, id: draft.id };
  } catch (error) {
    logger.error("Failed to save migration draft", { shopId, step, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * 获取迁移向导草稿
 */
export async function getMigrationDraft(
  shopId: string
): Promise<{ step: WizardStep; configData: MigrationDraftData } | null> {
  try {
    const draft = await prisma.migrationDraft.findUnique({
      where: { shopId },
    });

    if (!draft) {
      return null;
    }

    // 检查是否过期
    if (draft.expiresAt < new Date()) {
      // 删除过期草稿
      await prisma.migrationDraft.delete({
        where: { id: draft.id },
      });
      logger.info("Expired migration draft deleted", { shopId, draftId: draft.id });
      return null;
    }

    return {
      step: draft.step as WizardStep,
      configData: draft.configData as unknown as MigrationDraftData,
    };
  } catch (error) {
    logger.error("Failed to get migration draft", { shopId, error });
    return null;
  }
}

/**
 * 删除迁移向导草稿
 */
export async function deleteMigrationDraft(shopId: string): Promise<boolean> {
  try {
    await prisma.migrationDraft.deleteMany({
      where: { shopId },
    });
    logger.info("Migration draft deleted", { shopId });
    return true;
  } catch (error) {
    logger.error("Failed to delete migration draft", { shopId, error });
    return false;
  }
}

/**
 * 清理过期的草稿（用于 cron 任务）
 */
export async function cleanupExpiredDrafts(): Promise<number> {
  try {
    const result = await prisma.migrationDraft.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    logger.info("Expired migration drafts cleaned up", { count: result.count });
    return result.count;
  } catch (error) {
    logger.error("Failed to cleanup expired drafts", { error });
    return 0;
  }
}

