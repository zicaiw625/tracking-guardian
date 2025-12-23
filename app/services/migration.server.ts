import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { Prisma } from "@prisma/client";
// P0-5: Deprecated pixel code generators removed - using server-side CAPI only
// P0-4: bing and clarity removed - no server-side CAPI implementation
export type Platform = "google" | "meta" | "tiktok";
export interface MigrationConfig {
    platform: Platform;
    platformId: string;
    additionalConfig?: Record<string, string>;
}
export interface MigrationResult {
    success: boolean;
    platform: Platform;
    pixelCode: string;
    instructions: string[];
    error?: string;
}
/**
 * P0-5: 统一产品叙事 - 服务端追踪
 * 
 * Tracking Guardian 使用服务端 CAPI 进行转化追踪，不生成任何客户端代码。
 * 此函数返回配置指南，不再返回 pixelCode。
 */
export function generatePixelCode(config: MigrationConfig): MigrationResult {
    try {
        // P0-5: 验证平台支持
        const supportedPlatforms = ["google", "meta", "tiktok"];
        if (!supportedPlatforms.includes(config.platform)) {
            throw new Error(`Unsupported platform: ${config.platform}. Tracking Guardian supports Google, Meta, and TikTok.`);
        }

        // P0-5: 服务端追踪指南，不包含任何客户端代码
        const serverSideInstructions = [
            "1. 前往 Tracking Guardian「迁移」页面，点击「一键启用 App Pixel」",
            "2. 前往「设置」页面，在「服务端追踪」部分配置平台凭证",
            "3. 创建测试订单，在「监控」页面验证转化事件已发送",
            "4. 手动删除旧的 ScriptTag 或 Additional Scripts（参考「扫描」页面的清理指南）",
            "",
            "💡 Tracking Guardian 使用服务端 Conversions API，无需粘贴任何客户端代码。",
        ];

        return {
            success: true,
            platform: config.platform,
            pixelCode: "", // P0-5: 不再生成客户端代码
            instructions: serverSideInstructions,
        };
    }
    catch (error) {
        return {
            success: false,
            platform: config.platform,
            pixelCode: "",
            instructions: [],
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
export interface SavePixelConfigOptions {
    clientConfig?: Record<string, string | number | boolean>;
    credentialsEncrypted?: string;
    serverSideEnabled?: boolean;
}
export async function savePixelConfig(shopId: string, platform: Platform, platformId: string, options?: SavePixelConfigOptions) {
    const { clientConfig, credentialsEncrypted, serverSideEnabled } = options || {};
    return prisma.pixelConfig.upsert({
        where: {
            shopId_platform: {
                shopId,
                platform,
            },
        },
        update: {
            platformId,
            clientConfig: clientConfig ?? undefined,
            credentialsEncrypted: credentialsEncrypted ?? undefined,
            serverSideEnabled: serverSideEnabled ?? undefined,
            migrationStatus: "in_progress",
            updatedAt: new Date(),
        },
        create: {
            shopId,
            platform,
            platformId,
            clientConfig: clientConfig ?? Prisma.JsonNull,
            credentialsEncrypted: credentialsEncrypted ?? null,
            serverSideEnabled: serverSideEnabled ?? false,
            migrationStatus: "in_progress",
        },
    });
}
export async function completeMigration(shopId: string, platform: Platform) {
    return prisma.pixelConfig.update({
        where: {
            shopId_platform: {
                shopId,
                platform,
            },
        },
        data: {
            migrationStatus: "completed",
            migratedAt: new Date(),
        },
    });
}
export async function getPixelConfigs(shopId: string) {
    return prisma.pixelConfig.findMany({
        where: { shopId },
        orderBy: { createdAt: "desc" },
    });
}
export interface CreateWebPixelResult {
    success: boolean;
    webPixelId?: string;
    error?: string;
    userErrors?: Array<{
        field: string;
        message: string;
    }>;
}
/**
 * P0-01/P0-02: WebPixelSettings must EXACTLY match shopify.extension.toml settings schema.
 * 
 * CRITICAL: Only include fields that are declared in the toml schema.
 * Adding extra fields will cause webPixelCreate mutation to fail with schema validation error.
 * 
 * All fields are strings per Shopify Web Pixel requirements (only single_line_text_field supported).
 * Reference: https://shopify.dev/docs/apps/build/marketing-analytics/build-web-pixels
 */
export interface WebPixelSettings {
    ingestion_key: string;
    shop_domain: string;
}

/**
 * Build settings object for webPixelCreate/webPixelUpdate mutations.
 * 
 * P0-02: Settings keys MUST exactly match shopify.extension.toml [settings.fields.*] keys.
 * - ingestion_key: matches [settings.fields.ingestion_key]
 * - shop_domain: matches [settings.fields.shop_domain]
 * 
 * Note: backend_url is NOT included because it's a build-time constant in the pixel code,
 * not a runtime setting. This avoids schema validation failures.
 */
export function buildWebPixelSettings(ingestionKey: string, shopDomain: string): WebPixelSettings {
    return {
        ingestion_key: ingestionKey,
        shop_domain: shopDomain,
    };
}
export function isOurWebPixel(settings: unknown, shopDomain?: string): boolean {
    if (!settings || typeof settings !== "object")
        return false;
    const s = settings as Record<string, unknown>;
    const hasKey = typeof s.ingestion_key === "string" || typeof s.ingestion_secret === "string";
    if (!hasKey)
        return false;
    if (shopDomain && typeof s.shop_domain === "string") {
        return s.shop_domain === shopDomain;
    }
    return true;
}
export function needsSettingsUpgrade(settings: unknown): boolean {
    if (!settings || typeof settings !== "object")
        return false;
    const s = settings as Record<string, unknown>;
    // Upgrade needed if using legacy ingestion_secret instead of ingestion_key
    if (typeof s.ingestion_secret === "string" && typeof s.ingestion_key !== "string") {
        return true;
    }
    // Upgrade needed if missing required shop_domain field
    if ((typeof s.ingestion_key === "string" || typeof s.ingestion_secret === "string") 
        && typeof s.shop_domain !== "string") {
        return true;
    }
    return false;
}
// P0-6: 参数名从 ingestionSecret 改为 ingestionKey（减少误解）
export async function createWebPixel(admin: AdminApiContext, ingestionKey?: string, shopDomain?: string): Promise<CreateWebPixelResult> {
    const pixelSettings = buildWebPixelSettings(ingestionKey || "", shopDomain || "");
    const settings = JSON.stringify(pixelSettings);
    try {
        const response = await admin.graphql(`
      mutation WebPixelCreate($webPixel: WebPixelInput!) {
        webPixelCreate(webPixel: $webPixel) {
          userErrors {
            field
            message
          }
          webPixel {
            id
            settings
          }
        }
      }
      `, {
            variables: {
                webPixel: {
                    settings,
                },
            },
        });
        const result = await response.json();
        const data = result.data?.webPixelCreate;
        if (data?.userErrors && data.userErrors.length > 0) {
            return {
                success: false,
                userErrors: data.userErrors,
                error: data.userErrors.map((e: {
                    message: string;
                }) => e.message).join(", "),
            };
        }
        if (data?.webPixel?.id) {
            logger.info(`Web Pixel created successfully: ${data.webPixel.id}`, {
                shopDomain,
            });
            return {
                success: true,
                webPixelId: data.webPixel.id,
            };
        }
        return {
            success: false,
            error: "Unexpected response from Shopify API",
        };
    }
    catch (error) {
        logger.error("Failed to create Web Pixel:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
// P0-6: 参数名从 ingestionSecret 改为 ingestionKey（减少误解）
export async function updateWebPixel(admin: AdminApiContext, webPixelId: string, ingestionKey?: string, shopDomain?: string): Promise<CreateWebPixelResult> {
    const pixelSettings = buildWebPixelSettings(ingestionKey || "", shopDomain || "");
    const settings = JSON.stringify(pixelSettings);
    try {
        const response = await admin.graphql(`
      mutation WebPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
        webPixelUpdate(id: $id, webPixel: $webPixel) {
          userErrors {
            field
            message
          }
          webPixel {
            id
            settings
          }
        }
      }
      `, {
            variables: {
                id: webPixelId,
                webPixel: {
                    settings,
                },
            },
        });
        const result = await response.json();
        const data = result.data?.webPixelUpdate;
        if (data?.userErrors && data.userErrors.length > 0) {
            return {
                success: false,
                userErrors: data.userErrors,
                error: data.userErrors.map((e: {
                    message: string;
                }) => e.message).join(", "),
            };
        }
        if (data?.webPixel?.id) {
            logger.info(`Web Pixel updated successfully: ${data.webPixel.id}`, {
                shopDomain,
            });
            return {
                success: true,
                webPixelId: data.webPixel.id,
            };
        }
        return {
            success: false,
            error: "Unexpected response from Shopify API",
        };
    }
    catch (error) {
        logger.error("Failed to update Web Pixel:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
/**
 * Upgrade WebPixel settings to latest schema.
 * Handles migration from ingestion_secret to ingestion_key.
 */
export async function upgradeWebPixelSettings(
    admin: AdminApiContext,
    webPixelId: string,
    currentSettings: unknown,
    shopDomain: string,
    ingestionKey: string
): Promise<CreateWebPixelResult> {
    if (!currentSettings || typeof currentSettings !== "object") {
        return {
            success: false,
            error: "Invalid current settings",
        };
    }

    const s = currentSettings as Record<string, unknown>;
    
    // Determine the key to use (prefer existing ingestion_key, fallback to ingestion_secret)
    const existingKey = (s.ingestion_key as string) || (s.ingestion_secret as string) || ingestionKey;
    
    logger.info(`Upgrading WebPixel settings for ${shopDomain}`, {
        webPixelId,
        hadIngestionSecret: typeof s.ingestion_secret === "string",
        hadShopDomain: typeof s.shop_domain === "string",
    });

    return updateWebPixel(admin, webPixelId, existingKey, shopDomain);
}

export async function getExistingWebPixels(admin: AdminApiContext): Promise<Array<{
    id: string;
    settings: string | null;
}>> {
    try {
        const response = await admin.graphql(`
      query GetWebPixels {
        webPixels(first: 50) {
          edges {
            node {
              id
              settings
            }
          }
        }
      }
      `);
        const result = await response.json();
        const edges = result.data?.webPixels?.edges || [];
        return edges.map((edge: {
            node: {
                id: string;
                settings: string | null;
            };
        }) => ({
            id: edge.node.id,
            settings: edge.node.settings,
        }));
    }
    catch (error) {
        logger.error("Failed to get Web Pixels:", error);
        return [];
    }
}
export interface ScriptTagDeletionGuidance {
    title: string;
    manualSteps: string[];
    adminUrl?: string;
    platform?: string;
    deadline?: string;
}
export function getScriptTagDeletionGuidance(scriptTagId: number, shopDomain?: string, platform?: string): ScriptTagDeletionGuidance {
    const storeHandle = shopDomain?.replace(".myshopify.com", "");
    const adminUrl = storeHandle
        ? `https://admin.shopify.com/store/${storeHandle}/settings/customer_events`
        : undefined;
    return {
        title: `删除 ScriptTag #${scriptTagId}`,
        manualSteps: [
            "1. 前往 Shopify 后台「设置 → 应用和销售渠道」",
            "2. 找到创建该 ScriptTag 的应用（通常是追踪/分析类应用）",
            "3. 点击该应用，选择「卸载」或在应用设置中禁用脚本",
            "4. 如果找不到对应应用，可能是已卸载的应用残留",
            "5. 联系 Shopify 支持获取帮助，提供 ScriptTag ID: " + scriptTagId,
            "",
            "💡 提示：安装 Tracking Guardian 的 Web Pixel 后，旧的 ScriptTag 可以安全删除，",
            "   因为服务端 CAPI 将接管所有转化追踪功能。",
        ],
        adminUrl,
        platform,
    };
}
export function getScriptTagMigrationGuidance(platform: string, scriptTagId: number): {
    title: string;
    steps: string[];
    deadline?: string;
    warning?: string;
} {
    const baseSteps = [
        "1. 在 Tracking Guardian「设置」页面配置该平台的 CAPI 凭证",
        "2. 在「迁移」页面安装 Web Pixel（如尚未安装）",
        "3. 验证新的追踪配置正常工作（查看「监控」页面）",
        "4. 删除旧的 ScriptTag（可使用上方删除按钮或手动操作）",
    ];
    const platformGuidance: Record<string, {
        title: string;
        extraSteps?: string[];
        warning?: string;
    }> = {
        google: {
            title: "Google Analytics / Google Ads 迁移",
            extraSteps: [
                "• GA4: 配置 Measurement ID (G-XXXXXX) 和 API Secret",
                "• Google Ads: 在 GA4 中设置「从 GA4 导入转化」",
            ],
        },
        meta: {
            title: "Meta (Facebook) Pixel 迁移",
            extraSteps: [
                "• 在 Meta Events Manager 生成 Conversions API Access Token",
                "• 配置 Pixel ID 和 Access Token",
                "• 可选: 使用 Test Event Code 进行测试",
            ],
        },
        tiktok: {
            title: "TikTok Pixel 迁移",
            extraSteps: [
                "• 在 TikTok Events Manager 生成 Access Token",
                "• 配置 Pixel ID 和 Access Token",
            ],
        },
        // P0-4: bing and clarity entries removed - not supported
    };
    const guidance = platformGuidance[platform] || {
        title: `${platform} 平台迁移`,
    };
    return {
        title: guidance.title,
        steps: [
            ...(guidance.extraSteps || []),
            ...baseSteps,
        ],
        deadline: platform === "unknown" ? undefined : "Plus 商家: 2025-08-28; 非 Plus: 2026-08-26",
        warning: guidance.warning,
    };
}
// P0-4: generateBingPixelCode removed - no CAPI support for Bing
import { encryptJson, decryptJson } from "../utils/crypto.server";
import type { PlatformCredentials } from "../types";
import { logger } from "../utils/logger.server";
export async function migrateCredentialsToEncrypted(): Promise<{
    migrated: number;
    failed: number;
    errors: string[];
}> {
    const errors: string[] = [];
    let migrated = 0;
    let failed = 0;
    const configs = await prisma.pixelConfig.findMany({
        where: {
            credentials: { not: Prisma.JsonNull },
        },
        select: {
            id: true,
            platform: true,
            credentials: true,
            credentialsEncrypted: true,
            shopId: true,
        },
    });
    logger.info(`P0-09: Found ${configs.length} configs with legacy credentials to migrate`);
    for (const config of configs) {
        try {
            if (config.credentialsEncrypted) {
                logger.info(`P0-09: Skipping ${config.id} - already has encrypted credentials`);
                await prisma.pixelConfig.update({
                    where: { id: config.id },
                    data: { credentials: Prisma.JsonNull },
                });
                continue;
            }
            const legacyCreds = config.credentials;
            if (!legacyCreds || typeof legacyCreds !== 'object') {
                logger.warn(`P0-09: Skipping ${config.id} - invalid credentials format`);
                continue;
            }
            const encrypted = encryptJson(legacyCreds as unknown as PlatformCredentials);
            await prisma.pixelConfig.update({
                where: { id: config.id },
                data: {
                    credentialsEncrypted: encrypted,
                    credentials: Prisma.JsonNull,
                },
            });
            logger.info(`P0-09: Migrated credentials for ${config.platform} on shop ${config.shopId}`);
            migrated++;
        }
        catch (error) {
            const errorMsg = `Failed to migrate config ${config.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            errors.push(errorMsg);
            logger.error(`P0-09: ${errorMsg}`);
            failed++;
        }
    }
    logger.info(`P0-09: Migration complete - ${migrated} migrated, ${failed} failed`);
    return { migrated, failed, errors };
}
export async function verifyCredentialsEncryption(): Promise<{
    total: number;
    encrypted: number;
    unencrypted: number;
    unencryptedConfigs: Array<{
        id: string;
        platform: string;
        shopDomain: string;
    }>;
}> {
    const configs = await prisma.pixelConfig.findMany({
        select: {
            id: true,
            platform: true,
            credentials: true,
            credentialsEncrypted: true,
            shop: { select: { shopDomain: true } },
        },
    });
    const unencryptedConfigs: Array<{
        id: string;
        platform: string;
        shopDomain: string;
    }> = [];
    let encrypted = 0;
    let unencrypted = 0;
    for (const config of configs) {
        if (config.credentials && !config.credentialsEncrypted) {
            unencrypted++;
            unencryptedConfigs.push({
                id: config.id,
                platform: config.platform,
                shopDomain: config.shop.shopDomain,
            });
        }
        else if (config.credentialsEncrypted) {
            encrypted++;
        }
    }
    return {
        total: configs.length,
        encrypted,
        unencrypted,
        unencryptedConfigs,
    };
}
export async function sanitizeExistingOrderPayloads(_batchSize = 500): Promise<{
    processed: number;
    cleaned: number;
    errors: number;
}> {
    logger.info("P0-01: sanitizeExistingOrderPayloads is deprecated - orderPayload field has been removed");
    return { processed: 0, cleaned: 0, errors: 0 };
}
export async function getOrderPayloadStats(): Promise<{
    totalJobs: number;
    withOrderPayload: number;
    withCapiInput: number;
    needsSanitization: number;
}> {
    const [totalJobs, withCapiInput] = await Promise.all([
        prisma.conversionJob.count(),
        prisma.conversionJob.count({
            where: { capiInput: { not: Prisma.JsonNull } },
        }),
    ]);
    return {
        totalJobs,
        withOrderPayload: 0,
        withCapiInput,
        needsSanitization: 0,
    };
}
// P0-4: generateClarityPixelCode removed - Clarity is client-side only
