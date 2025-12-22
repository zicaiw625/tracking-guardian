// Migration action generation for scanner

import type { MigrationAction, EnhancedScanResult } from "./types";
import { PLATFORM_PATTERNS, identifyPlatformFromSrc } from "./patterns";
import { 
    getScriptTagCreationStatus, 
    getScriptTagExecutionStatus, 
    getAdditionalScriptsDeprecationStatus 
} from "../../utils/deprecation-dates";
import { isOurWebPixel, needsSettingsUpgrade } from "../migration.server";

/**
 * Generate migration actions based on scan results
 */
export function generateMigrationActions(result: EnhancedScanResult): MigrationAction[] {
    const actions: MigrationAction[] = [];

    const creationStatus = getScriptTagCreationStatus();
    const plusExecutionStatus = getScriptTagExecutionStatus("plus");
    const nonPlusExecutionStatus = getScriptTagExecutionStatus("non_plus");

    // Generate actions for each script tag
    for (const tag of result.scriptTags) {
        const platform = identifyPlatformFromSrc(tag.src || "");
        const isOrderStatusScript = tag.display_scope === "order_status";

        let deadlineNote: string;
        let priority: "high" | "medium" | "low" = "high";
        let deadline: string | undefined;

        const PLUS_SCRIPT_TAG_OFF_LABEL = "2025年8月起";
        const NON_PLUS_SCRIPT_TAG_OFF_LABEL = "2026年8月起";

        if (plusExecutionStatus.isExpired) {
            deadlineNote = `⚠️ Plus 商家的 ScriptTag 预计已于 ${PLUS_SCRIPT_TAG_OFF_LABEL} 停止执行！非 Plus 商家: ${nonPlusExecutionStatus.isExpired ? "预计也已停止执行" : `约剩余 ${nonPlusExecutionStatus.daysRemaining} 天`}`;
            priority = "high";
            deadline = "2025年8月";
        } else if (creationStatus.isExpired && isOrderStatusScript) {
            deadlineNote = `⚠️ 2025-02-01 起已无法创建新的 ScriptTag。现有脚本仍在运行，但将于 Plus: ${PLUS_SCRIPT_TAG_OFF_LABEL} / 非 Plus: ${NON_PLUS_SCRIPT_TAG_OFF_LABEL} 停止执行。`;
            priority = "high";
            deadline = "2025年8月";
        } else if (plusExecutionStatus.isWarning) {
            deadlineNote = `⏰ Plus 商家: 约剩余 ${plusExecutionStatus.daysRemaining} 天后停止执行（${PLUS_SCRIPT_TAG_OFF_LABEL}）；非 Plus 商家: 约剩余 ${nonPlusExecutionStatus.daysRemaining} 天（${NON_PLUS_SCRIPT_TAG_OFF_LABEL}）`;
            priority = "high";
            deadline = "2025年8月";
        } else {
            deadlineNote = `📅 执行窗口期 - Plus: ${PLUS_SCRIPT_TAG_OFF_LABEL}（约剩余 ${plusExecutionStatus.daysRemaining} 天）；非 Plus: ${NON_PLUS_SCRIPT_TAG_OFF_LABEL}（约剩余 ${nonPlusExecutionStatus.daysRemaining} 天）`;
            priority = "medium";
            deadline = "2026年8月";
        }

        actions.push({
            type: "delete_script_tag",
            priority,
            platform,
            title: `迁移 ScriptTag: ${platform}`,
            description: `${deadlineNote}\n\n推荐步骤：1) 启用 App Pixel  2) 配置 CAPI 凭证  3) 测试追踪  4) 删除此 ScriptTag`,
            scriptTagId: tag.id,
            scriptTagGid: tag.gid, // Include GID for deletion mutation
            deadline,
        });
    }

    // Check for platforms that need configuration
    const configuredPlatforms = getConfiguredPlatforms(result);

    for (const platform of result.identifiedPlatforms) {
        if (!configuredPlatforms.has(platform)) {
            actions.push({
                type: "configure_pixel",
                priority: "medium",
                platform,
                title: `配置 ${platform.charAt(0).toUpperCase() + platform.slice(1)} Web Pixel`,
                description: `检测到 ${platform} 追踪代码，但尚未配置 Web Pixel。建议使用我们的迁移工具进行配置。`,
            });
        }
    }

    // Check for duplicate pixels
    for (const dup of result.duplicatePixels) {
        // Extract WebPixel GIDs for deletion (keep first, delete rest)
        const webPixelGids = dup.ids
            .filter(id => id.startsWith("webpixel_"))
            .map(id => {
                // Format: webpixel_{gid}_{key}
                const parts = id.split("_");
                if (parts.length >= 2) {
                    return parts[1]; // Return the GID part
                }
                return null;
            })
            .filter((gid): gid is string => gid !== null);
        
        // If we have multiple WebPixel GIDs, we can offer to delete duplicates
        const gidsToDelete = webPixelGids.slice(1); // Keep first, delete rest
        
        actions.push({
            type: "remove_duplicate",
            priority: "medium",
            platform: dup.platform,
            title: `清理重复的 ${dup.platform} 像素`,
            description: `检测到 ${dup.count} 个 ${dup.platform} 像素配置，可能导致重复追踪。建议只保留一个。` +
                (gidsToDelete.length > 0 ? ` (可删除 ${gidsToDelete.length} 个)` : ""),
            webPixelGid: gidsToDelete[0], // First duplicate to delete
        });
    }

    // Check for pixel upgrade needs
    const hasAppPixelConfigured = result.webPixels.some(p => {
        if (!p.settings) return false;
        try {
            const settings = typeof p.settings === "string" ? JSON.parse(p.settings) : p.settings;
            return isOurWebPixel(settings);
        } catch {
            return false;
        }
    });

    const pixelNeedsUpgrade = result.webPixels.some(p => {
        if (!p.settings) return false;
        try {
            const settings = typeof p.settings === "string" ? JSON.parse(p.settings) : p.settings;
            return isOurWebPixel(settings) && needsSettingsUpgrade(settings);
        } catch {
            return false;
        }
    });

    if (pixelNeedsUpgrade) {
        actions.push({
            type: "configure_pixel",
            priority: "medium",
            title: "升级 App Pixel 配置",
            description: "检测到旧版 Pixel 配置（缺少 backend_url 或 shop_domain）。请重新启用 App Pixel 以升级到新版配置格式。",
        });
    }

    // Suggest CAPI if not configured
    if (!hasAppPixelConfigured && result.identifiedPlatforms.length > 0) {
        actions.push({
            type: "enable_capi",
            priority: "low",
            title: "启用服务端转化追踪 (CAPI)",
            description: "启用 Conversions API 可降低广告拦截器影响，提高追踪数据的一致性和完整性。",
        });
    }

    // Sort by priority
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return actions;
}

/**
 * P1-05: Get set of platforms that have been configured via web pixels
 * 
 * Improved detection that:
 * 1. Checks for explicit platform identifiers in settings
 * 2. Uses our own WebPixel's platforms_enabled field if available
 * 3. More precise pattern matching to avoid false positives
 */
function getConfiguredPlatforms(result: EnhancedScanResult): Set<string> {
    const configuredPlatforms = new Set<string>();

    for (const pixel of result.webPixels) {
        if (pixel.settings) {
            try {
                const settings = typeof pixel.settings === "string"
                    ? JSON.parse(pixel.settings)
                    : pixel.settings;

                // Check if this is our pixel with explicit platforms_enabled
                if (Array.isArray(settings.platforms_enabled)) {
                    for (const platform of settings.platforms_enabled) {
                        configuredPlatforms.add(platform);
                    }
                    continue; // Skip pattern matching for our own pixel
                }

                // Check for our pixel's ingestion_key (Tracking Guardian)
                if (settings.ingestion_key || settings.ingestion_secret) {
                    // This is our pixel, check if it has platform config
                    if (settings.backend_url && settings.shop_domain) {
                        // Properly configured Tracking Guardian pixel
                        // The platforms are configured server-side, not in pixel settings
                        continue;
                    }
                }

                // Pattern matching for third-party pixels
                for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
                    if (typeof value !== "string") continue;
                    
                    // Skip URLs and tokens
                    if (value.includes("://") || value.length > 100) continue;
                    
                    // GA4 Measurement ID (exact format: G-XXXXXXXXXX)
                    if (/^G-[A-Z0-9]{7,12}$/.test(value)) {
                        configuredPlatforms.add("google");
                    }
                    // Google Ads Conversion ID (exact format: AW-XXXXXXXXXX)
                    else if (/^AW-\d{9,12}$/.test(value)) {
                        configuredPlatforms.add("google");
                    }
                    // Meta Pixel ID (exactly 15-16 digits)
                    else if (/^\d{15,16}$/.test(value) && key.toLowerCase().includes("pixel")) {
                        configuredPlatforms.add("meta");
                    }
                    // TikTok Pixel ID (20+ alphanumeric, typically uppercase)
                    else if (/^[A-Z0-9]{20,30}$/.test(value) && key.toLowerCase().includes("pixel")) {
                        configuredPlatforms.add("tiktok");
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }
    }

    return configuredPlatforms;
}

