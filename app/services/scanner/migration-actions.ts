import type { MigrationAction, EnhancedScanResult } from "./types";
import {
    identifyPlatformFromSrc,
    getPlatformInfo,
} from "./patterns";
import {
    getScriptTagCreationStatus,
    getScriptTagExecutionStatus,
    DEPRECATION_DATES,
    getDateDisplayLabel,
} from "../../utils/deprecation-dates";
import { isOurWebPixel, needsSettingsUpgrade } from "../migration.server";
import { logger } from "../../utils/logger.server";

export function estimateMigrationTime(action: MigrationAction): number {
    let baseTime = 0;
    switch (action.type) {
        case "migrate_script_tag":
            baseTime = 15;
            break;
        case "configure_pixel":
            baseTime = 10;
            break;
        case "enable_capi":
            baseTime = 5;
            break;
        case "remove_duplicate":
            baseTime = 3;
            break;
        default:
            baseTime = 10;
    }
    if (action.priority === "high") {
        baseTime += 10;
    } else if (action.priority === "low") {
        baseTime -= 2;
    }
    if (action.platform) {
        const platformInfo = getPlatformInfo(action.platform);
        if (platformInfo.supportLevel === "partial") {
            baseTime += 15;
        } else if (platformInfo.supportLevel === "unsupported") {
            baseTime += 30;
        }
    }
    return Math.max(5, baseTime);
}

export function calculateMigrationProgress(
    totalActions: MigrationAction[],
    completedActionIds: string[]
): number {
    if (totalActions.length === 0) return 100;
    const completed = totalActions.filter((action) => {
        const actionId = getActionId(action);
        return completedActionIds.includes(actionId);
    }).length;
    return Math.round((completed / totalActions.length) * 100);
}

export function getActionId(action: MigrationAction): string {
    if (action.scriptTagId) {
        return `script_tag_${action.scriptTagId}`;
    }
    if (action.webPixelGid) {
        return `pixel_${action.webPixelGid}`;
    }
    return `${action.type}_${action.platform || "unknown"}_${action.title}`;
}

export function generateMigrationActions(result: EnhancedScanResult, shopTier: string): MigrationAction[] {
    const actions: MigrationAction[] = [];
    const creationStatus = getScriptTagCreationStatus();
    const plusExecutionStatus = getScriptTagExecutionStatus("plus");
    const nonPlusExecutionStatus = getScriptTagExecutionStatus("non_plus");
    for (const tag of result.scriptTags) {
        const platform = identifyPlatformFromSrc(tag.src || "");
        const isOrderStatusScript = tag.display_scope === "order_status";
        let deadlineNote: string;
        let priority: "high" | "medium" | "low" = "high";
        let deadline: string | undefined;
        const PLUS_SCRIPT_TAG_OFF_LABEL = getDateDisplayLabel(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact");
        const NON_PLUS_SCRIPT_TAG_OFF_LABEL = getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact");
        const isPlus = shopTier === "plus";
        const primaryStatus = isPlus ? plusExecutionStatus : nonPlusExecutionStatus;
        const primaryDeadlineLabel = isPlus ? PLUS_SCRIPT_TAG_OFF_LABEL : NON_PLUS_SCRIPT_TAG_OFF_LABEL;
        const deadlineNoteSuffix = "（日期来自 Shopify 官方公告，请以 Admin 提示为准）";
        if (primaryStatus.isExpired) {
            deadlineNote = `⚠️ ${isPlus ? "Plus" : "非 Plus"} 商家的 ScriptTag 已于 ${primaryDeadlineLabel}${deadlineNoteSuffix} 停止执行！`;
            if (isPlus) {
                deadlineNote += ` (非 Plus 商家: ${nonPlusExecutionStatus.isExpired ? "也已停止执行" : `剩余 ${nonPlusExecutionStatus.daysRemaining} 天`})`;
            } else {
                deadlineNote += ` (Plus 商家已于 ${PLUS_SCRIPT_TAG_OFF_LABEL}${deadlineNoteSuffix} 停止执行)`;
            }
            priority = "high";
            deadline = `${primaryDeadlineLabel}${deadlineNoteSuffix}`;
        } else if (creationStatus.isExpired && isOrderStatusScript) {
            deadlineNote = `⚠️ 2025-02-01${deadlineNoteSuffix} 起已无法创建新的 ScriptTag。现有脚本仍在运行，但将于 ${primaryDeadlineLabel}${deadlineNoteSuffix} 停止执行。`;
            priority = "high";
            deadline = `${primaryDeadlineLabel}${deadlineNoteSuffix}`;
        } else if (primaryStatus.isWarning) {
            deadlineNote = `⏰ ${isPlus ? "Plus" : "非 Plus"} 商家: ScriptTag 将于 ${primaryDeadlineLabel}${deadlineNoteSuffix} 停止执行（剩余 ${primaryStatus.daysRemaining} 天）。`;
            priority = "high";
            deadline = `${primaryDeadlineLabel}${deadlineNoteSuffix}`;
        } else {
            deadlineNote = `📅 执行窗口期 - ${isPlus ? "Plus" : "非 Plus"} 商家截止日期: ${primaryDeadlineLabel}${deadlineNoteSuffix}（剩余 ${primaryStatus.daysRemaining} 天）。`;
            priority = "medium";
            deadline = `${primaryDeadlineLabel}${deadlineNoteSuffix}`;
        }
        const estimatedTime = estimateMigrationTime({
            type: "migrate_script_tag",
            priority,
            platform,
            title: `迁移 ScriptTag: ${platform}`,
            description: `${deadlineNote}\n\n推荐步骤：1) 启用 App Pixel  2) 配置 CAPI 凭证  3) 测试追踪  4) 手动清理此 ScriptTag（查看指南）`,
            scriptTagId: tag.id,
            deadline,
        });
        actions.push({
            type: "migrate_script_tag",
            priority,
            platform,
            title: `迁移 ScriptTag: ${platform}`,
            description: `${deadlineNote}\n\n推荐步骤：1) 启用 App Pixel  2) 配置 CAPI 凭证  3) 测试追踪  4) 手动清理此 ScriptTag（查看指南）`,
            scriptTagId: tag.id,
            deadline,
            estimatedTimeMinutes: estimatedTime,
        });
    }
    const configuredPlatforms = getConfiguredPlatforms(result);
    for (const platform of result.identifiedPlatforms) {
        const platformInfo = getPlatformInfo(platform);
        if (platformInfo.supportLevel === "unsupported") {
            const action: MigrationAction = {
                type: "configure_pixel",
                priority: "low",
                platform,
                title: `${platformInfo.name}: 建议使用官方方案`,
                description: platformInfo.recommendation +
                    (platformInfo.officialApp ? `\n\n👉 官方应用: ${platformInfo.officialApp}` : ""),
            };
            action.estimatedTimeMinutes = estimateMigrationTime(action);
            actions.push(action);
        } else if (platformInfo.supportLevel === "partial") {
            const action: MigrationAction = {
                type: "configure_pixel",
                priority: "medium",
                platform,
                title: `${platformInfo.name}: 需要评估迁移方案`,
                description: platformInfo.recommendation,
            };
            action.estimatedTimeMinutes = estimateMigrationTime(action);
            actions.push(action);
        } else if (!configuredPlatforms.has(platform)) {
            const action: MigrationAction = {
                type: "configure_pixel",
                priority: "medium",
                platform,
                title: `配置 ${platformInfo.name}`,
                description: `检测到 ${platformInfo.name} 追踪代码，但尚未配置。${platformInfo.recommendation}`,
            };
            action.estimatedTimeMinutes = estimateMigrationTime(action);
            actions.push(action);
        }
    }
    for (const dup of result.duplicatePixels) {
        const webPixelGids = dup.ids
            .filter(id => id.startsWith("webpixel_"))
            .map(id => {
                const parts = id.split("_");
                if (parts.length >= 2) {
                    return parts[1];
                }
                return null;
            })
            .filter((gid): gid is string => gid !== null);
        const gidsToDelete = webPixelGids.slice(1);
        const duplicateAction: MigrationAction = {
            type: "remove_duplicate",
            priority: "medium",
            platform: dup.platform,
            title: `清理重复的 ${dup.platform} 像素`,
            description: `检测到 ${dup.count} 个 ${dup.platform} 像素配置，可能导致重复追踪。建议只保留一个。` +
                (gidsToDelete.length > 0 ? ` (可删除 ${gidsToDelete.length} 个)` : ""),
            webPixelGid: gidsToDelete[0],
        };
        duplicateAction.estimatedTimeMinutes = estimateMigrationTime(duplicateAction);
        actions.push(duplicateAction);
    }
    const hasAppPixelConfigured = result.webPixels.some(p => {
        if (!p.settings || typeof p.settings !== "string") return false;
        try {
            const settings = JSON.parse(p.settings);
            return isOurWebPixel(settings);
        } catch (error) {
            logger.warn(`Failed to parse pixel settings for pixel ${p.id} in hasAppPixelConfigured:`, { error: error instanceof Error ? error.message : String(error), pixelId: p.id });
            return false;
        }
    });
    const pixelNeedsUpgrade = result.webPixels.some(p => {
        if (!p.settings || typeof p.settings !== "string") return false;
        try {
            const settings = JSON.parse(p.settings);
            return isOurWebPixel(settings) && needsSettingsUpgrade(settings);
        } catch (error) {
            logger.warn(`Failed to parse pixel settings for pixel ${p.id} in pixelNeedsUpgrade:`, { error: error instanceof Error ? error.message : String(error), pixelId: p.id });
            return false;
        }
    });
    if (pixelNeedsUpgrade) {
        const upgradeAction: MigrationAction = {
            type: "configure_pixel",
            priority: "medium",
            title: "升级 App Pixel 配置",
            description: "检测到旧版 Pixel 配置（缺少 shop_domain 或仍使用 ingestion_secret 旧字段）。请重新启用 App Pixel 以升级到新版配置格式。",
        };
        upgradeAction.estimatedTimeMinutes = estimateMigrationTime(upgradeAction);
        actions.push(upgradeAction);
    }
    if (!hasAppPixelConfigured && result.identifiedPlatforms.length > 0) {
        const capiAction: MigrationAction = {
            type: "enable_capi",
            priority: "low",
            title: "启用服务端转化追踪 (CAPI)",
            description: "启用 Conversions API 可降低广告拦截器影响，提高追踪数据的一致性和完整性。",
        };
        capiAction.estimatedTimeMinutes = estimateMigrationTime(capiAction);
        actions.push(capiAction);
    }
    const now = new Date();
    const autoUpgradeStart = DEPRECATION_DATES.plusAutoUpgradeStart;
    const daysToAutoUpgrade = Math.ceil((autoUpgradeStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const isInAutoUpgradeWindow = now >= autoUpgradeStart;
    const hasLegacyTracking = result.scriptTags.length > 0 ||
        result.additionalScriptsPatterns.some(p => p.platform !== "unknown");
    if (hasLegacyTracking && shopTier === "plus") {
        if (isInAutoUpgradeWindow) {
            const autoUpgradeAction: MigrationAction = {
                type: "configure_pixel",
                priority: "high",
                title: "⚡ Plus 商家自动升级窗口已开始",
                description: `Shopify 已于 2026年1月 开始自动将 Plus 商家迁移到新版 Thank you / Order status 页面。` +
                    `旧的 ScriptTags、checkout.liquid 自定义将在自动升级后失效。Additional Scripts 需要通过手动粘贴识别。` +
                    `请立即确认 Web Pixel 配置正确，避免追踪中断。`,
            };
            autoUpgradeAction.estimatedTimeMinutes = estimateMigrationTime(autoUpgradeAction);
            actions.unshift(autoUpgradeAction);
        } else if (daysToAutoUpgrade <= 90) {
            const countdownAction: MigrationAction = {
                type: "configure_pixel",
                priority: daysToAutoUpgrade <= 30 ? "high" : "medium",
                title: `📅 Plus 自动升级倒计时：剩余 ${daysToAutoUpgrade} 天`,
                description: `Shopify 将于 2026年1月 开始自动将 Plus 商家迁移到新版页面。` +
                    `自动升级后，旧的 Additional Scripts、ScriptTags、checkout.liquid 自定义将失效。` +
                    `建议提前完成迁移，确保控制迁移时机。`,
            };
            countdownAction.estimatedTimeMinutes = estimateMigrationTime(countdownAction);
            actions.push(countdownAction);
        }
    }
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    return actions;
}
function getConfiguredPlatforms(result: EnhancedScanResult): Set<string> {
    const configuredPlatforms = new Set<string>();
    for (const pixel of result.webPixels) {
        if (pixel.settings && typeof pixel.settings === "string") {
            try {
                const settings = JSON.parse(pixel.settings);
                if (Array.isArray(settings.platforms_enabled)) {
                    for (const platform of settings.platforms_enabled) {
                        configuredPlatforms.add(platform);
                    }
                    continue;
                }
                if (settings.ingestion_key || settings.ingestion_secret) {
                    if (settings.shop_domain) {
                        continue;
                    }
                }
                for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
                    if (typeof value !== "string") continue;
                    if (value.includes(":")) {
                        continue;
                    }
                    if (/^G-[A-Z0-9]{7,12}$/.test(value)) {
                        configuredPlatforms.add("google");
                    }
                    else if (/^AW-\d{9,12}$/.test(value)) {
                        configuredPlatforms.add("google");
                    }
                    else if (/^\d{15,16}$/.test(value) && key.toLowerCase().includes("pixel")) {
                        configuredPlatforms.add("meta");
                    }
                    else if (/^[A-Z0-9]{20,30}$/.test(value) && key.toLowerCase().includes("pixel")) {
                        configuredPlatforms.add("tiktok");
                    }
                }
            } catch (error) {
                logger.warn(`Failed to parse pixel settings for pixel ${pixel.id} in getConfiguredPlatforms:`, { error: error instanceof Error ? error.message : String(error), pixelId: pixel.id });
                continue;
            }
        }
    }
    return configuredPlatforms;
}
