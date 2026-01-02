

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { encryptJson, decryptJson } from "../utils/crypto.server";
import { saveConfigSnapshot } from "./pixel-rollback.server";
import type { Platform } from "./migration.server";
import type { PlanId } from "./billing/plans";
import { canCreatePixelConfig } from "./billing/feature-gates.server";
import { getValidCredentials } from "./credentials.server";
import { sendConversion } from "./platforms/registry";
import { generateDedupeEventId } from "./platforms/interface";

export interface WizardConfig {
  platform: Platform | "pinterest";
  platformId: string;
  credentials: Record<string, string>;
  eventMappings: Record<string, string>;
  environment: "test" | "live";
}

export interface WizardState {
  step: "select" | "credentials" | "mappings" | "review" | "testing";
  selectedPlatforms: string[];
  configs: Record<string, WizardConfig>;
  completedAt?: Date;
}

export function validateWizardConfig(config: WizardConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.platformId || config.platformId.trim() === "") {
    errors.push(`平台 ID 不能为空`);
  }

  if (config.platform === "google") {
    if (!config.credentials.measurementId) {
      errors.push("GA4 Measurement ID 不能为空");
    }
    if (!config.credentials.apiSecret) {
      errors.push("GA4 API Secret 不能为空");
    }
  } else if (config.platform === "meta" || config.platform === "tiktok" || config.platform === "pinterest") {
    if (!config.credentials.pixelId) {
      errors.push("Pixel ID 不能为空");
    }
    if (!config.credentials.accessToken) {
      errors.push("Access Token 不能为空");
    }
  }

  if (!config.eventMappings || Object.keys(config.eventMappings).length === 0) {
    errors.push("至少需要配置一个事件映射");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function saveWizardConfigs(
  shopId: string,
  configs: WizardConfig[]
): Promise<{
  success: boolean;
  savedCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let savedCount = 0;

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true },
  });

  if (shop) {
    const gateCheck = await canCreatePixelConfig(shopId, (shop.plan || "free") as PlanId);
    if (!gateCheck.allowed) {
      return {
        success: false,
        savedCount: 0,
        errors: [gateCheck.reason || "套餐限制：无法创建像素配置"],
      };
    }
  }

  for (const config of configs) {

    const validation = validateWizardConfig(config);
    if (!validation.valid) {
      errors.push(`${config.platform}: ${validation.errors.join(", ")}`);
      continue;
    }

    try {

      let credentials: Record<string, string> = {};
      if (config.platform === "google") {
        credentials = {
          measurementId: config.credentials.measurementId || "",
          apiSecret: config.credentials.apiSecret || "",
        };
      } else {
        credentials = {
          pixelId: config.credentials.pixelId || "",
          accessToken: config.credentials.accessToken || "",
          ...(config.credentials.testEventCode && { testEventCode: config.credentials.testEventCode }),
        };
      }

      const encryptedCredentials = encryptJson(credentials);

      const existingConfig = await prisma.pixelConfig.findUnique({
        where: {
          shopId_platform: {
            shopId,
            platform: config.platform as Platform,
          },
        },
      });

      if (existingConfig && existingConfig.isActive) {
        await saveConfigSnapshot(shopId, config.platform);
      }

      await prisma.pixelConfig.upsert({
        where: {
          shopId_platform: {
            shopId,
            platform: config.platform as Platform,
          },
        },
        update: {
          platformId: config.platformId,
          credentialsEncrypted: encryptedCredentials,
          serverSideEnabled: true,
          eventMappings: config.eventMappings as object,
          environment: config.environment,
          migrationStatus: "in_progress",
          updatedAt: new Date(),
        },
        create: {
          shopId,
          platform: config.platform as Platform,
          platformId: config.platformId,
          credentialsEncrypted: encryptedCredentials,
          serverSideEnabled: true,
          eventMappings: config.eventMappings as object,
          environment: config.environment,
          migrationStatus: "in_progress",
          configVersion: 1,
          rollbackAllowed: false,
        },
      });

      savedCount++;
    } catch (error) {
      logger.error(`Failed to save config for ${config.platform}`, error);
      errors.push(`${config.platform}: ${error instanceof Error ? error.message : "保存失败"}`);
    }
  }

  return {
    success: errors.length === 0,
    savedCount,
    errors,
  };
}

export async function getConfigPreview(shopId: string): Promise<{
  platforms: Array<{
    platform: string;
    platformId: string;
    environment: string;
    eventCount: number;
  }>;
}> {
  const configs = await prisma.pixelConfig.findMany({
    where: {
      shopId,
      isActive: true,
    },
    select: {
      platform: true,
      platformId: true,
      environment: true,
      eventMappings: true,
    },
  });

  return {
    platforms: configs.map((config) => ({
      platform: config.platform,
      platformId: config.platformId || "",
      environment: config.environment,
      eventCount: config.eventMappings
        ? Object.keys(config.eventMappings as Record<string, unknown>).length
        : 0,
    })),
  };
}

export async function saveWizardDraft(
  shopId: string,
  draft: {
    step: "select" | "credentials" | "mappings" | "review" | "testing";
    selectedPlatforms: string[];
    platformConfigs: Record<string, Partial<WizardConfig>>;
    selectedTemplate?: string | null;
  }
): Promise<{ success: boolean; error?: string }> {
  try {

    const { saveMigrationDraft } = await import("./migration-draft.server");

    const configData = {
      selectedPlatforms: draft.selectedPlatforms,
      platformConfigs: Object.fromEntries(
        Object.entries(draft.platformConfigs).map(([platform, config]) => [
          platform,
          {
            credentials: config.credentials || {},
            eventMappings: config.eventMappings || {},
            environment: config.environment || "test",
          },
        ])
      ),
    };

    const step = draft.step === "testing" ? "review" : draft.step;

    const result = await saveMigrationDraft(shopId, step as "select" | "credentials" | "mappings" | "review", configData);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch (error) {
    logger.error("Failed to save wizard draft", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "保存草稿失败",
    };
  }
}

export async function loadWizardDraft(shopId: string): Promise<WizardState | null> {
  try {

    const { getMigrationDraft } = await import("./migration-draft.server");
    const draft = await getMigrationDraft(shopId);

    if (!draft) {
      return null;
    }

    const configs = await prisma.pixelConfig.findMany({
      where: {
        shopId,
        platform: { in: draft.configData.selectedPlatforms },
        isActive: true,
      },
      select: {
        platform: true,
        platformId: true,
        credentialsEncrypted: true,
        eventMappings: true,
        environment: true,
      },
    });

    const configsMap: Record<string, WizardConfig> = {};

    for (const platform of draft.configData.selectedPlatforms) {
      const existingConfig = configs.find((c) => c.platform === platform);
      const draftConfig = draft.configData.platformConfigs[platform] || {};

      let credentials: Record<string, string> = {};
      if (existingConfig?.credentialsEncrypted) {
        try {
          credentials = decryptJson(existingConfig.credentialsEncrypted) as Record<string, string>;
        } catch (error) {
          logger.warn(`Failed to decrypt credentials for ${platform}`, error);

          credentials = draftConfig.credentials || {};
        }
      } else {
        credentials = draftConfig.credentials || {};
      }

      configsMap[platform] = {
        platform: platform as Platform | "pinterest",
        platformId: existingConfig?.platformId || "",
        credentials,
        eventMappings: (existingConfig?.eventMappings as Record<string, string>) || draftConfig.eventMappings || {},
        environment: (existingConfig?.environment as "test" | "live") || draftConfig.environment || "test",
      };
    }

    return {
      step: draft.step,
      selectedPlatforms: draft.configData.selectedPlatforms,
      configs: configsMap,
    };
  } catch (error) {
    logger.error("Failed to load wizard draft", error);
    return null;
  }
}

export async function clearWizardDraft(shopId: string): Promise<{ success: boolean }> {
  try {

    const { deleteMigrationDraft } = await import("./migration-draft.server");
    const result = await deleteMigrationDraft(shopId);

    await prisma.pixelConfig.updateMany({
      where: {
        shopId,
        migrationStatus: "in_progress",
      },
      data: {
        migrationStatus: "not_started",
        clientConfig: null,
      },
    });

    return { success: result };
  } catch (error) {
    logger.error("Failed to clear wizard draft", error);
    return { success: false };
  }
}

export async function validateTestEnvironment(
  shopId: string,
  platform: Platform | "pinterest"
): Promise<{
  valid: boolean;
  message: string;
  details?: {
    eventSent?: boolean;
    responseTime?: number;
    error?: string;
    testEventCode?: string;
    debugViewUrl?: string;
    verificationInstructions?: string;
  };
}> {
  const config = await prisma.pixelConfig.findUnique({
    where: {
      shopId_platform: {
        shopId,
        platform: platform as Platform,
      },
    },
  });

  if (!config) {
    return {
      valid: false,
      message: "配置不存在",
    };
  }

  if (config.environment !== "test") {
    return {
      valid: false,
      message: "当前环境不是测试模式",
    };
  }

  if (!config.credentialsEncrypted) {
    return {
      valid: false,
      message: "凭证未配置",
    };
  }

  try {
    const credentialsResult = getValidCredentials(
      { credentialsEncrypted: config.credentialsEncrypted },
      platform as Platform
    );

    if (!credentialsResult.ok) {
      return {
        valid: false,
        message: `凭证验证失败: ${credentialsResult.error.message}`,
      };
    }

    const details: {
      eventSent?: boolean;
      responseTime?: number;
      error?: string;
      testEventCode?: string;
      debugViewUrl?: string;
      verificationInstructions?: string;
    } = {};

    if (platform === "meta") {
      const credentials = credentialsResult.value.credentials as {
        pixelId?: string;
        accessToken?: string;
        testEventCode?: string;
      };

      if (credentials.testEventCode) {
        details.testEventCode = credentials.testEventCode;
        details.verificationInstructions = `测试事件已发送，请在 Meta Events Manager 的「测试事件」页面查看，使用 Test Event Code: ${credentials.testEventCode}`;
      } else {
        details.verificationInstructions = "建议在 Meta Events Manager 中设置 Test Event Code，以便在测试模式下验证事件。";
      }
    }

    if (platform === "google") {
      const credentials = credentialsResult.value.credentials as {
        measurementId?: string;
        apiSecret?: string;
      };

      if (credentials.measurementId) {
        details.debugViewUrl = `https:
        details.verificationInstructions = `测试事件已发送，请在 GA4 DebugView 中查看：${details.debugViewUrl}`;
      }
    }

    const testEventId = generateDedupeEventId(`test-${Date.now()}`);
    const testData = {
      orderId: `test-order-${Date.now()}`,
      orderNumber: "TEST-001",
      value: 1.0,
      currency: "USD",
      lineItems: [
        {
          productId: "test-product-1",
          name: "Test Product",
          price: 1.0,
          quantity: 1,
        },
      ],
    };

    const startTime = Date.now();
    const sendResult = await sendConversion(
      platform as Platform,
      credentialsResult.value.credentials,
      testData,
      testEventId
    );
    const responseTime = Date.now() - startTime;
    details.responseTime = responseTime;

    if (sendResult.ok && sendResult.value.success) {
      details.eventSent = true;
      return {
        valid: true,
        message: "测试事件发送成功，配置验证通过",
        details,
      };
    } else {
      const errorMessage =
        sendResult.ok && sendResult.value.error
          ? sendResult.value.error.message
          : sendResult.ok
            ? "未知错误"
            : sendResult.error.message;

      details.eventSent = false;
      details.error = errorMessage;
      return {
        valid: false,
        message: `测试事件发送失败: ${errorMessage}`,
        details,
      };
    }
  } catch (error) {
    logger.error("Test environment validation error", {
      shopId,
      platform,
      error,
    });

    return {
      valid: false,
      message: `验证过程出错: ${error instanceof Error ? error.message : "未知错误"}`,
      details: {
        eventSent: false,
        error: error instanceof Error ? error.message : "未知错误",
      },
    };
  }
}

