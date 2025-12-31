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
  } catch (error: unknown) {
    // Handle table not found error (P2022) or other Prisma errors
    if (error && typeof error === "object" && "code" in error) {
      const prismaError = error as { code: string; meta?: { table?: string } };
      if (prismaError.code === "P2022" || prismaError.code === "P2021") {
        // Table or column doesn't exist - migration may not have run yet
        logger.warn("MigrationDraft table not found, migration may be pending", { shopId, step, code: prismaError.code });
        return {
          success: false,
          error: "Migration draft table not available. Please run database migrations.",
        };
      }
    }
    logger.error("Failed to save migration draft", { shopId, step, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

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

    if (draft.expiresAt < new Date()) {

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
  } catch (error: unknown) {
    // Handle table not found error (P2022) or other Prisma errors
    if (error && typeof error === "object" && "code" in error) {
      const prismaError = error as { code: string; meta?: { table?: string } };
      if (prismaError.code === "P2022" || prismaError.code === "P2021") {
        // Table or column doesn't exist - migration may not have run yet
        logger.warn("MigrationDraft table not found, migration may be pending", { shopId, code: prismaError.code });
        return null;
      }
    }
    logger.error("Failed to get migration draft", { shopId, error });
    return null;
  }
}

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

