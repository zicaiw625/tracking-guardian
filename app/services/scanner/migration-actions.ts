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
        let descriptionKey: string;
        let descriptionParams: Record<string, any> = {};

        const PLUS_SCRIPT_TAG_OFF_LABEL = getDateDisplayLabel(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact");
        const NON_PLUS_SCRIPT_TAG_OFF_LABEL = getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact");
        
        const isPlus = shopTier === "plus";
        const primaryStatus = isPlus ? plusExecutionStatus : nonPlusExecutionStatus;
        const primaryDeadlineLabel = isPlus ? PLUS_SCRIPT_TAG_OFF_LABEL : NON_PLUS_SCRIPT_TAG_OFF_LABEL;
        const deadlineNoteSuffix = " (Date from Shopify announcement, check Admin)";

        const tierLabel = isPlus ? "Plus" : "Non-Plus";
        
        if (primaryStatus.isExpired) {
            deadlineNote = `⚠️ ${tierLabel} ScriptTags stopped execution on ${primaryDeadlineLabel}${deadlineNoteSuffix}!`;
            
            descriptionKey = "scan.migrationLogic.scriptTag.expired";
            descriptionParams = { tier: tierLabel, date: primaryDeadlineLabel };

            if (isPlus) {
                deadlineNote += ` (Non-Plus: ${nonPlusExecutionStatus.isExpired ? "Also expired" : `${nonPlusExecutionStatus.daysRemaining} days remaining`})`;
            } else {
                deadlineNote += ` (Plus stopped on ${PLUS_SCRIPT_TAG_OFF_LABEL}${deadlineNoteSuffix})`;
            }
            
            priority = "high";
            deadline = `${primaryDeadlineLabel}${deadlineNoteSuffix}`;
        } else if (creationStatus.isExpired && isOrderStatusScript) {
            deadlineNote = `⚠️ From 2025-02-01${deadlineNoteSuffix}, new ScriptTags cannot be created. Existing scripts are running but will stop on ${primaryDeadlineLabel}${deadlineNoteSuffix}.`;
            descriptionKey = "scan.migrationLogic.scriptTag.creationBlocked";
            descriptionParams = { date: primaryDeadlineLabel };
            priority = "high";
            deadline = `${primaryDeadlineLabel}${deadlineNoteSuffix}`;
        } else if (primaryStatus.isWarning) {
            deadlineNote = `⏰ ${tierLabel}: ScriptTags will stop execution on ${primaryDeadlineLabel}${deadlineNoteSuffix} (${primaryStatus.daysRemaining} days remaining).`;
            descriptionKey = "scan.migrationLogic.scriptTag.warning";
            descriptionParams = { tier: tierLabel, date: primaryDeadlineLabel, days: primaryStatus.daysRemaining };
            priority = "high";
            deadline = `${primaryDeadlineLabel}${deadlineNoteSuffix}`;
        } else {
            deadlineNote = `📅 Execution Window - ${tierLabel} deadline: ${primaryDeadlineLabel}${deadlineNoteSuffix} (${primaryStatus.daysRemaining} days remaining).`;
            descriptionKey = "scan.migrationLogic.scriptTag.window";
            descriptionParams = { tier: tierLabel, date: primaryDeadlineLabel, days: primaryStatus.daysRemaining };
            priority = "medium";
            deadline = `${primaryDeadlineLabel}${deadlineNoteSuffix}`;
        }

        const estimatedTime = estimateMigrationTime({
            type: "migrate_script_tag",
            priority,
            platform,
            title: `Migrate ScriptTag: ${platform}`,
            description: `${deadlineNote}\n\nRecommended Steps: 1) Enable App Pixel 2) Complete test order and verification 3) Manually clean up this ScriptTag (See guide)`,
            scriptTagId: tag.id,
            deadline,
        });

        actions.push({
            type: "migrate_script_tag",
            priority,
            platform,
            title: `Migrate ScriptTag: ${platform}`,
            titleKey: "scan.migrationLogic.scriptTag.title",
            titleParams: { platform },
            description: `${deadlineNote}\n\nRecommended Steps: 1) Enable App Pixel 2) Complete test order and verification 3) Manually clean up this ScriptTag (See guide)`,
            descriptionKey,
            descriptionParams,
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
                title: `${platformInfo.name}: Official solution recommended`,
                titleKey: "scan.migrationLogic.pixel.official",
                titleParams: { name: platformInfo.name },
                description: platformInfo.recommendation +
                    (platformInfo.officialApp ? `\n\n👉 Official App: ${platformInfo.officialApp}` : ""),
            };
            action.estimatedTimeMinutes = estimateMigrationTime(action);
            actions.push(action);
        } else if (platformInfo.supportLevel === "partial") {
            const action: MigrationAction = {
                type: "configure_pixel",
                priority: "medium",
                platform,
                title: `${platformInfo.name}: Migration plan evaluation needed`,
                titleKey: "scan.migrationLogic.pixel.evaluate",
                titleParams: { name: platformInfo.name },
                description: platformInfo.recommendation,
            };
            action.estimatedTimeMinutes = estimateMigrationTime(action);
            actions.push(action);
        } else if (!configuredPlatforms.has(platform)) {
            const action: MigrationAction = {
                type: "configure_pixel",
                priority: "medium",
                platform,
                title: `Configure ${platformInfo.name}`,
                titleKey: "scan.migrationLogic.pixel.configure",
                titleParams: { name: platformInfo.name },
                description: `${platformInfo.name} tracking code detected but not configured. ${platformInfo.recommendation}`,
                descriptionKey: "scan.migrationLogic.pixel.desc.notConfigured",
                descriptionParams: { name: platformInfo.name, recommendation: platformInfo.recommendation },
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
            title: `Clean up duplicate ${dup.platform} pixels`,
            titleKey: "scan.migrationLogic.duplicate.title",
            titleParams: { platform: dup.platform },
            description: `Detected ${dup.count} ${dup.platform} pixel configurations, which may cause duplicate tracking. Keeping only one is recommended.` +
                (gidsToDelete.length > 0 ? ` (${gidsToDelete.length} can be deleted)` : ""),
            descriptionKey: gidsToDelete.length > 0 ? "scan.migrationLogic.duplicate.descWithDelete" : "scan.migrationLogic.duplicate.desc",
            descriptionParams: { count: dup.count, platform: dup.platform, deleteCount: gidsToDelete.length },
            // Suffix logic for delete count is simple enough to handle or ignore for now, or add as param if supported.
            // Added `delete` key in JSON, but using it requires composition.
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
            title: "Upgrade App Pixel Configuration",
            titleKey: "scan.migrationLogic.upgrade.title",
            description: "Legacy Pixel configuration detected (missing shop_domain or using legacy ingestion_secret). Please re-enable App Pixel to upgrade to the new format.",
            descriptionKey: "scan.migrationLogic.upgrade.desc",
        };
        upgradeAction.estimatedTimeMinutes = estimateMigrationTime(upgradeAction);
        actions.push(upgradeAction);
    }

    if (!hasAppPixelConfigured && result.identifiedPlatforms.length > 0) {
        const enableAction: MigrationAction = {
            type: "configure_pixel",
            priority: "low",
            title: "Enable App Pixel",
            titleKey: "scan.migrationLogic.enable.title",
            description: "Enable Web Pixel to start receiving events, store data, and run verification.",
            descriptionKey: "scan.migrationLogic.enable.desc",
        };
        enableAction.estimatedTimeMinutes = estimateMigrationTime(enableAction);
        actions.push(enableAction);
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
                title: "⚡ Plus Auto-Upgrade Window Started",
                titleKey: "scan.migrationLogic.autoUpgrade.start.title",
                description: `Shopify has started automatically migrating Plus merchants to the new Thank you / Order status pages as of Jan 2026 (30-day notice provided). ` +
                    `Old ScriptTags and checkout.liquid customizations will stop working after auto-upgrade. Additional Scripts need manual identification. ` +
                    `Please verify Web Pixel configuration immediately to avoid tracking interruption.`,
                descriptionKey: "scan.migrationLogic.autoUpgrade.start.desc",
            };
            autoUpgradeAction.estimatedTimeMinutes = estimateMigrationTime(autoUpgradeAction);
            actions.unshift(autoUpgradeAction);
        } else if (daysToAutoUpgrade <= 90) {
            const countdownAction: MigrationAction = {
                type: "configure_pixel",
                priority: daysToAutoUpgrade <= 30 ? "high" : "medium",
                title: `📅 Plus Auto-Upgrade Countdown: ${daysToAutoUpgrade} days remaining`,
                titleKey: "scan.migrationLogic.autoUpgrade.countdown.title",
                titleParams: { days: daysToAutoUpgrade },
                description: `Shopify will start automatically migrating Plus merchants to the new pages starting Jan 2026 (30-day notice provided). ` +
                    `After auto-upgrade, old Additional Scripts, ScriptTags, and checkout.liquid customizations will stop working. ` +
                    `Early migration is recommended to control the timing.`,
                descriptionKey: "scan.migrationLogic.autoUpgrade.countdown.desc",
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
