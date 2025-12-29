

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { encryptJson } from "../utils/crypto.server";
import type { Platform } from "./migration.server";

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
    const { getValidCredentials } = await import("./credentials.server");
    const { sendConversion } = await import("./platforms/registry");
    const { generateDedupeEventId } = await import("../utils/event-dedup");

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

    if (sendResult.ok && sendResult.value.success) {
      return {
        valid: true,
        message: "测试事件发送成功，配置验证通过",
        details: {
          eventSent: true,
          responseTime,
        },
      };
    } else {
      const errorMessage =
        sendResult.ok && sendResult.value.error
          ? sendResult.value.error.message
          : sendResult.ok
            ? "未知错误"
            : sendResult.error.message;

      return {
        valid: false,
        message: `测试事件发送失败: ${errorMessage}`,
        details: {
          eventSent: false,
          responseTime,
          error: errorMessage,
        },
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

