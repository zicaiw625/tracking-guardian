import { randomUUID } from "crypto";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { Prisma } from "@prisma/client";
import { encryptJson } from "../utils/crypto.server";
import { logger } from "../utils/logger.server";
import prisma from "../db.server";
import { validateCredentials } from "../types/platform";
import { saveConfigSnapshot } from "./pixel-rollback.server";
import { DEPRECATION_DATES, getDateDisplayLabel } from "../utils/deprecation-dates";

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

export function generatePixelCode(config: MigrationConfig): MigrationResult {
    try {
        const supportedPlatforms = ["google", "meta", "tiktok"];
        if (!supportedPlatforms.includes(config.platform)) {
            throw new Error(`Unsupported platform: ${config.platform}. Tracking Guardian supports Google, Meta, and TikTok.`);
        }
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
            pixelCode: "",
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
    environment?: string;
}

export async function savePixelConfig(shopId: string, platform: Platform, platformId: string, options?: SavePixelConfigOptions) {
    const { clientConfig, credentialsEncrypted, serverSideEnabled } = options || {};
    const v1SupportedPlatforms = ["google", "meta", "tiktok"];
    if (!v1SupportedPlatforms.includes(platform)) {
        throw new Error(
            `平台 ${platform} 在 v1.0 版本中不支持。v1.0 仅支持: ${v1SupportedPlatforms.join(", ")}。` +
            `其他平台（如 Snapchat、Twitter、Pinterest）将在 v1.1+ 版本中提供支持。`
        );
    }
    if (serverSideEnabled === true && !credentialsEncrypted) {
        throw new Error(
            `启用服务端追踪时必须提供 credentialsEncrypted。平台: ${platform}, shopId: ${shopId}`
        );
    }
    const environment = options?.environment || "live";
    const existingConfig = await prisma.pixelConfig.findUnique({
        where: {
            shopId_platform_environment_platformId: {
                shopId,
                platform,
                environment: environment as string,
                platformId: platformId,
            },
        },
    });
    if (serverSideEnabled) {
        const { checkV1FeatureBoundary } = await import("../utils/version-gate");
        const gateResult = checkV1FeatureBoundary("server_side");
        if (!gateResult.allowed) {
            throw new Error(gateResult.reason || "此功能在当前版本中不可用");
        }
        if (!existingConfig) {
            const { requireEntitlementOrThrow } = await import("./billing/entitlement.server");
            await requireEntitlementOrThrow(shopId, "pixel_destinations");
        }
    }
    if (clientConfig && typeof clientConfig === 'object' && 'mode' in clientConfig) {
        const mode = (clientConfig as { mode?: string }).mode;
        if (mode === 'full_funnel') {
            const { requireEntitlementOrThrow } = await import("./billing/entitlement.server");
            await requireEntitlementOrThrow(shopId, "full_funnel");
        }
    }
    if (existingConfig) {
        await saveConfigSnapshot(shopId, platform, environment as "test" | "live");
    }
    return prisma.pixelConfig.upsert({
        where: {
            shopId_platform_environment_platformId: {
                shopId,
                platform,
                environment: environment as string,
                platformId: platformId,
            },
        },
        update: {
            platformId,
            clientConfig: clientConfig ?? undefined,
            credentialsEncrypted: credentialsEncrypted ?? undefined,
            serverSideEnabled: serverSideEnabled ?? false,
            migrationStatus: "in_progress",
            updatedAt: new Date(),
        },
        create: {
            id: randomUUID(),
            shopId,
            platform,
            platformId,
            clientConfig: clientConfig ?? Prisma.JsonNull,
            credentialsEncrypted: credentialsEncrypted ?? null,
            serverSideEnabled: serverSideEnabled ?? false,
            migrationStatus: "in_progress",
            configVersion: 1,
            rollbackAllowed: false,
            environment: environment as "test" | "live",
            updatedAt: new Date(),
        },
    });
}

export async function completeMigration(shopId: string, platform: Platform, environment: string = "live", platformId?: string | null) {
    if (platformId === undefined) {
        const config = await prisma.pixelConfig.findFirst({
            where: {
                shopId,
                platform,
                environment,
            },
        });
        if (!config) {
            throw new Error(`No PixelConfig found for shopId=${shopId}, platform=${platform}, environment=${environment}`);
        }
        platformId = config.platformId;
    }
    if (platformId === null || platformId === undefined) {
        const config = await prisma.pixelConfig.findFirst({
            where: {
                shopId,
                platform,
                environment,
                platformId: null,
            },
        });
        if (!config) {
            throw new Error(`No PixelConfig found for shopId=${shopId}, platform=${platform}, environment=${environment}, platformId=null`);
        }
        return prisma.pixelConfig.update({
            where: { id: config.id },
            data: {
                migrationStatus: "completed",
                migratedAt: new Date(),
            },
        });
    }
    return prisma.pixelConfig.update({
        where: {
            shopId_platform_environment_platformId: {
                shopId,
                platform,
                environment: environment as string,
                platformId: platformId,
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

import {
    DEFAULT_PIXEL_CONFIG,
    parseAndValidatePixelConfig,
    type PixelConfigV1,
    type WebPixelSettings as WebPixelSettingsSchema,
} from "../schemas/settings";

export type PixelConfig = PixelConfigV1;
export type WebPixelSettings = WebPixelSettingsSchema;
export { DEFAULT_PIXEL_CONFIG };

export function buildWebPixelSettings(
    ingestionKey: string,
    shopDomain: string,
    pixelConfig?: Partial<PixelConfig>,
    environment: "test" | "live" = "live",
    mode?: "purchase_only" | "full_funnel"
): WebPixelSettings {
    const configVersion = "1";
    const pixelMode = mode || pixelConfig?.mode || "purchase_only";
    return {
        ingestion_key: ingestionKey,
        shop_domain: shopDomain,
        config_version: configVersion,
        mode: pixelMode,
        environment,
    };
}

export function parsePixelConfigFromSettings(configStr?: string): PixelConfig {
    return parseAndValidatePixelConfig(configStr);
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
    if (typeof s.ingestion_secret === "string" && typeof s.ingestion_key !== "string") {
        return true;
    }
    if ((typeof s.ingestion_key === "string" || typeof s.ingestion_secret === "string")
        && typeof s.shop_domain !== "string") {
        return true;
    }
    return false;
}

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

export async function updateWebPixel(admin: AdminApiContext, webPixelId: string, ingestionKey?: string, shopDomain?: string, environment: "test" | "live" = "live", mode?: "purchase_only" | "full_funnel"): Promise<CreateWebPixelResult> {
    const pixelSettings = buildWebPixelSettings(ingestionKey || "", shopDomain || "", undefined, environment, mode);
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
    const existingKey = (s.ingestion_key as string) || (s.ingestion_secret as string) || ingestionKey;
    const existingEnvironment = (s.environment as "test" | "live") || "live";
    const existingMode = (s.mode as "purchase_only" | "full_funnel") || "purchase_only";
    logger.info(`Upgrading WebPixel settings for ${shopDomain}`, {
        webPixelId,
        hadIngestionSecret: typeof s.ingestion_secret === "string",
        hadShopDomain: typeof s.shop_domain === "string",
        existingMode,
    });
    return updateWebPixel(admin, webPixelId, existingKey, shopDomain, existingEnvironment, existingMode);
}

export async function syncWebPixelMode(
    admin: AdminApiContext,
    shopId: string,
    shopDomain: string,
    webPixelId: string,
    ingestionKey: string,
    environment: "test" | "live" = "live"
): Promise<CreateWebPixelResult> {
    try {
        const pixelConfigs = await prisma.pixelConfig.findMany({
            where: {
                shopId,
                isActive: true,
                environment,
            },
            select: {
                clientConfig: true,
            },
        });
        let mode: "purchase_only" | "full_funnel" = "purchase_only";
        for (const config of pixelConfigs) {
            if (config.clientConfig && typeof config.clientConfig === 'object') {
                if ('mode' in config.clientConfig && config.clientConfig.mode === 'full_funnel') {
                    mode = "full_funnel";
                    break;
                }
            }
        }
        logger.info(`Syncing WebPixel mode for ${shopDomain}`, {
            shopId,
            webPixelId,
            mode,
            environment,
            configCount: pixelConfigs.length,
        });
        return updateWebPixel(admin, webPixelId, ingestionKey, shopDomain, environment, mode);
    } catch (error) {
        logger.error("Failed to sync WebPixel mode", {
            shopId,
            shopDomain,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to sync mode",
        };
    }
}

export async function getExistingWebPixels(admin: AdminApiContext): Promise<Array<{
    id: string;
    settings: string | null;
}>> {
    const pixels: Array<{ id: string; settings: string | null }> = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let previousCursor: string | null = null;
    try {
        while (hasNextPage) {
            const response = await admin.graphql(`
        query GetWebPixels($cursor: String) {
          webPixels(first: 50, after: $cursor) {
            edges {
              node {
                id
                settings
              }
              cursor
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
        `, { variables: { cursor } });
            const result = await response.json();
            if (result && typeof result === 'object' && 'errors' in result && Array.isArray(result.errors) && result.errors.length > 0) {
                const errorMessage = (result.errors[0] as { message?: string })?.message || "Unknown GraphQL error";
                if (errorMessage.includes("doesn't exist") || errorMessage.includes("access")) {
                    logger.warn("WebPixels API not available (may need to reinstall app for read_pixels scope):", { error: errorMessage });
                } else {
                    logger.error("GraphQL error fetching WebPixels:", errorMessage);
                }
                return pixels;
            }
            const edges = (result.data?.webPixels?.edges || []) as Array<{
                node: {
                    id: string;
                    settings: string | null;
                };
                cursor?: string | null;
            }>;
            const pageInfo = (result.data?.webPixels?.pageInfo || { hasNextPage: false, endCursor: null }) as {
                hasNextPage: boolean;
                endCursor: string | null;
            };
            for (const edge of edges) {
                pixels.push({
                    id: edge.node.id,
                    settings: edge.node.settings,
                });
            }
            hasNextPage = pageInfo.hasNextPage;
            cursor = pageInfo.endCursor;
            if (cursor === previousCursor) {
                logger.warn("WebPixels pagination cursor did not advance, stopping to avoid loop");
                break;
            }
            previousCursor = cursor;
            if (pixels.length > 500) {
                logger.warn("WebPixels pagination limit reached (500)");
                break;
            }
        }
    }
    catch (error) {
        if (error instanceof Response) {
            const status = error.status;
            const statusText = error.statusText;
            if (status === 401 || status === 403) {
                logger.info("WebPixels API call failed (unauthorized/uninstalled)", { status, statusText });
                return pixels;
            }
            logger.warn("WebPixels API call failed (HTTP response)", { status, statusText });
            return pixels;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("doesn't exist") || errorMessage.includes("access")) {
            logger.warn("WebPixels API call failed (scope issue, app may need reinstall):", { error: errorMessage });
        } else {
            logger.error("Failed to get Web Pixels (paginated):", error);
        }
    }
    return pixels;
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
        ? `https://${storeHandle}.myshopify.com/admin`
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

export function getScriptTagMigrationGuidance(platform: string, _scriptTagId: number): {
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
        deadline: platform === "unknown" ? undefined : `Plus 商家: ${getDateDisplayLabel(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）; 非 Plus: ${getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）`,
        warning: guidance.warning,
    };
}

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
            credentials_legacy: { not: Prisma.JsonNull },
        },
        select: {
            id: true,
            platform: true,
            credentials_legacy: true,
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
                    data: { credentials_legacy: Prisma.JsonNull },
                });
                continue;
            }
            const legacyCreds = config.credentials_legacy;
            if (!legacyCreds || typeof legacyCreds !== 'object') {
                logger.warn(`P0-09: Skipping ${config.id} - invalid credentials format`);
                continue;
            }
            const credsValidation = validateCredentials(legacyCreds);
            if (!credsValidation.success) {
                logger.warn(`P0-09: Skipping ${config.id} - invalid credentials: ${credsValidation.errors.join(", ")}`);
                continue;
            }
            const encrypted = encryptJson(credsValidation.data);
            await prisma.pixelConfig.update({
                where: { id: config.id },
                data: {
                    credentialsEncrypted: encrypted,
                    credentials_legacy: Prisma.JsonNull,
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
            credentials_legacy: true,
            credentialsEncrypted: true,
            Shop: { select: { shopDomain: true } },
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
        if (config.credentials_legacy && !config.credentialsEncrypted) {
            unencrypted++;
            unencryptedConfigs.push({
                id: config.id,
                platform: config.platform,
                shopDomain: config.Shop.shopDomain,
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


export async function checkAppScopes(admin: AdminApiContext): Promise<boolean> {
    try {
        const response = await admin.graphql(`
            query GetAppScopes {
                app {
                    installation {
                        accessScopes {
                            handle
                        }
                    }
                }
            }
        `);
        const result = await response.json();
        const scopes = result.data?.app?.installation?.accessScopes?.map((s: { handle: string }) => s.handle) || [];
        return scopes.includes("read_pixels") && scopes.includes("write_pixels");
    } catch (error) {
        logger.error("Failed to check app scopes:", error);
        return true;
    }
}
