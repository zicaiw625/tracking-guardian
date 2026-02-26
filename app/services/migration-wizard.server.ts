import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../db.server";
import { postJson } from "../utils/http";
import { logger } from "../utils/logger.server";
import { encryptJson, decryptJson } from "../utils/crypto.server";
import { saveConfigSnapshot } from "./pixel-rollback.server";
import type { Platform } from "./migration.server";
import type { PlanId } from "./billing/plans";
import { canCreatePixelConfig } from "./billing/feature-gates.server";
import { getValidCredentials } from "./credentials.server";
import { PLATFORM_ENDPOINTS } from "../utils/config.shared";

export interface WizardConfig {
  platform: Platform | "pinterest";
  platformId: string;
  credentials: Record<string, string>;
  eventMappings: Record<string, string>;
  environment: "test" | "live";
  serverSideEnabled?: boolean;
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
  const v1SupportedPlatforms = ["google", "meta", "tiktok"];
  if (!v1SupportedPlatforms.includes(config.platform)) {
    errors.push(`Platform ${config.platform} is not supported in v1.0. v1.0 only supports: ${v1SupportedPlatforms.join(", ")}.`);
  }
  if (!config.platformId || config.platformId.trim() === "") {
    errors.push(`Platform ID cannot be empty`);
  }
  if (config.platform === "google") {
    if (!config.credentials.measurementId) {
      errors.push("GA4 Measurement ID cannot be empty");
    }
    if (!config.credentials.apiSecret) {
      errors.push("GA4 API Secret cannot be empty");
    }
  } else if (config.platform === "meta" || config.platform === "tiktok") {
    if (!config.credentials.pixelId) {
      errors.push("Pixel ID cannot be empty");
    }
    if (!config.credentials.accessToken) {
      errors.push("Access Token cannot be empty");
    }
  }
  if (!config.eventMappings || Object.keys(config.eventMappings).length === 0) {
    errors.push("At least one event mapping must be configured");
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
        errors: [gateCheck.reason || "Plan limit reached: cannot create pixel configuration"],
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
      const normalizedPlatformId = config.platformId.trim();
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
          shopId_platform_environment_platformId: {
            shopId,
            platform: config.platform as Platform,
            environment: (config.environment || "live") as string,
            platformId: normalizedPlatformId,
          },
        },
      });
      if (existingConfig && existingConfig.isActive) {
        const existingMappings = existingConfig.eventMappings as Record<string, string> | null;
        const newMappings = config.eventMappings || {};
        const mappingsChanged = JSON.stringify(existingMappings) !== JSON.stringify(newMappings);
        if (mappingsChanged) {
          await saveConfigSnapshot(shopId, config.platform, config.environment || "live");
        }
      }
      await prisma.pixelConfig.upsert({
        where: {
          shopId_platform_environment_platformId: {
            shopId,
            platform: config.platform as Platform,
            environment: (config.environment || "live") as string,
            platformId: normalizedPlatformId,
          },
        },
        update: {
          platformId: normalizedPlatformId,
          credentialsEncrypted: encryptedCredentials,
          serverSideEnabled: config.serverSideEnabled ?? false,
          eventMappings: config.eventMappings as object,
          environment: config.environment || "live",
          migrationStatus: "in_progress",
          ...(existingConfig && existingConfig.isActive && JSON.stringify(existingConfig.eventMappings) !== JSON.stringify(config.eventMappings) ? {
            configVersion: { increment: 1 },
            rollbackAllowed: true,
          } : {}),
          updatedAt: new Date(),
        },
        create: {
          id: randomUUID(),
          shopId,
      platform: config.platform as Platform,
      platformId: normalizedPlatformId,
      credentialsEncrypted: encryptedCredentials,
      serverSideEnabled: config.serverSideEnabled ?? false,
      eventMappings: config.eventMappings as object,
      environment: config.environment || "live",
          migrationStatus: "in_progress",
          configVersion: 1,
          rollbackAllowed: false,
          updatedAt: new Date(),
        },
      });
      savedCount++;
    } catch (error) {
      logger.error(`Failed to save config for ${config.platform}`, error);
      errors.push(`${config.platform}: ${error instanceof Error ? error.message : "Save failed"}`);
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
      error: error instanceof Error ? error.message : "Failed to save draft",
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
          logger.warn(`Failed to decrypt credentials for ${platform}`, { error: error instanceof Error ? error.message : String(error) });
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
        clientConfig: Prisma.JsonNull,
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
  const config = await prisma.pixelConfig.findFirst({
    where: {
      shopId,
      platform: platform as Platform,
      environment: "test",
    },
  });
  if (!config) {
    return {
      valid: false,
      message: "Configuration not found",
    };
  }
  if (config.environment !== "test") {
    return {
      valid: false,
      message: "Current environment is not test mode",
    };
  }
  if (!config.credentialsEncrypted) {
    return {
      valid: false,
      message: "Credentials not configured",
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
        message: `Credential validation failed: ${credentialsResult.error.message}`,
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
        details.verificationInstructions = `Test event sent. Please check in Meta Events Manager under 'Test Events' using Test Event Code: ${credentials.testEventCode}`;
      } else {
        details.verificationInstructions = "We recommend setting up a Test Event Code in Meta Events Manager to verify events in test mode.";
      }
    }
    if (platform === "google") {
      const credentials = credentialsResult.value.credentials as {
        measurementId?: string;
        apiSecret?: string;
      };
      if (credentials.measurementId) {
        details.debugViewUrl = `https://analytics.google.com/analytics/web/#/debug/${credentials.measurementId}`;
        details.verificationInstructions = `Test event sent. Please check in GA4 DebugView: ${details.debugViewUrl}`;
      }
    }
    const startTime = Date.now();
    let eventSent = false;
    let sendError: string | undefined;
    if (platform === "google") {
      const credentials = credentialsResult.value.credentials as { measurementId?: string; apiSecret?: string };
      const measurementId = credentials.measurementId ?? "";
      const apiSecret = credentials.apiSecret ?? "";
      const url = PLATFORM_ENDPOINTS.GA4_MEASUREMENT_PROTOCOL(measurementId, apiSecret);
      const body = {
        client_id: `test-${startTime}`,
        events: [
          {
            name: "purchase",
            params: {
              value: 1,
              currency: "USD",
              transaction_id: `test-${startTime}`,
            },
          },
        ],
      };
      try {
        const res = await postJson(url, body);
        eventSent = res.ok;
        if (!res.ok) {
          const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          sendError = `GA4 ${res.status}: ${text.slice(0, 200)}`;
        }
      } catch (e) {
        sendError = e instanceof Error ? e.message : "GA4 request failed";
      }
    } else if (platform === "meta") {
      const credentials = credentialsResult.value.credentials as {
        pixelId?: string;
        accessToken?: string;
        testEventCode?: string;
      };
      const pixelId = credentials.pixelId ?? "";
      const accessToken = credentials.accessToken ?? "";
      const url = PLATFORM_ENDPOINTS.META_GRAPH_API(pixelId);
      const eventPayload: Record<string, unknown> = {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        user_data: {},
        custom_data: { value: 1, currency: "USD" },
      };
      if (credentials.testEventCode) {
        eventPayload.test_event_code = credentials.testEventCode;
      }
      const body = { data: [eventPayload] };
      try {
        const res = await postJson(url, body, {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
          },
        });
        eventSent = res.ok;
        if (!res.ok) {
          const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          sendError = `Meta ${res.status}: ${text.slice(0, 200)}`;
        }
      } catch (e) {
        sendError = e instanceof Error ? e.message : "Meta request failed";
      }
    } else if (platform === "tiktok") {
      const credentials = credentialsResult.value.credentials as {
        pixelId?: string;
        accessToken?: string;
        testEventCode?: string;
      };
      const pixelCode = credentials.pixelId ?? "";
      const accessToken = credentials.accessToken ?? "";
      const url = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
      const body: Record<string, unknown> = {
        pixel_code: pixelCode,
        event: "CompletePayment",
        timestamp: new Date().toISOString(),
        context: {
          user: { external_id: `test-${startTime}` },
          page: { url: "https://test.tracking-guardian.local/" },
        },
        properties: { value: 1, currency: "USD" },
      };
      if (credentials.testEventCode) {
        body.test_event_code = credentials.testEventCode;
      }
      try {
        const res = await postJson(url, body, {
          headers: {
            "Access-Token": accessToken,
          },
        });
        eventSent = res.ok;
        if (!res.ok) {
          const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          sendError = `TikTok ${res.status}: ${text.slice(0, 200)}`;
        }
      } catch (e) {
        sendError = e instanceof Error ? e.message : "TikTok request failed";
      }
    }
    details.eventSent = eventSent;
    details.responseTime = Date.now() - startTime;
    if (sendError) {
      details.error = sendError;
    }
    return {
      valid: eventSent,
      message: eventSent ? "Test event sent successfully" : (sendError ?? "Test event send failed"),
      details,
    };
  } catch (error) {
    logger.error("Test environment validation error", {
      shopId,
      platform,
      error,
    });
    return {
      valid: false,
      message: `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: {
        eventSent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}
