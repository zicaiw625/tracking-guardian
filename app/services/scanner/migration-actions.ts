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
        actions.push({
            type: "remove_duplicate",
            priority: "medium",
            platform: dup.platform,
            title: `清理重复的 ${dup.platform} 像素`,
            description: `检测到 ${dup.count} 个 ${dup.platform} 像素配置，可能导致重复追踪。建议只保留一个。`,
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
            description: "启用 Conversions API 可将追踪准确率提高 15-30%，不受广告拦截器影响。",
        });
    }

    // Sort by priority
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return actions;
}

/**
 * Get set of platforms that have been configured via web pixels
 */
function getConfiguredPlatforms(result: EnhancedScanResult): Set<string> {
    const configuredPlatforms = new Set<string>();

    for (const pixel of result.webPixels) {
        if (pixel.settings) {
            try {
                const settings = typeof pixel.settings === "string"
                    ? JSON.parse(pixel.settings)
                    : pixel.settings;

                for (const [, value] of Object.entries(settings as Record<string, unknown>)) {
                    if (typeof value === "string") {
                        if (/^G-[A-Z0-9]+$/.test(value) || /^AW-\d+$/.test(value)) {
                            configuredPlatforms.add("google");
                        } else if (/^\d{15,16}$/.test(value)) {
                            configuredPlatforms.add("meta");
                        } else if (/^[A-Z0-9]{20,}$/i.test(value)) {
                            configuredPlatforms.add("tiktok");
                        }
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }
    }

    return configuredPlatforms;
}

