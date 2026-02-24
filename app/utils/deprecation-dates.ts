function parseEnvDate(envVar: string | undefined, defaultDate: string): Date {
    if (envVar && /^\d{4}-\d{2}-\d{2}$/.test(envVar)) {
        const parsed = new Date(envVar);
        if (!isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return new Date(defaultDate);
}

const DEFAULT_DATES = {
    scriptTagCreationBlocked: "2025-02-01",
    plusScriptTagExecutionOff: "2025-08-28",
    nonPlusScriptTagExecutionOff: "2026-08-26",
    plusAdditionalScriptsReadOnly: "2025-08-28",
    nonPlusAdditionalScriptsReadOnly: "2025-08-28",
    scriptTagBlocked: "2025-02-01",
    plusAutoUpgradeStart: "2026-01-01",
} as const;

export const DEPRECATION_DATES = {
    scriptTagCreationBlocked: parseEnvDate(
        process.env.DEPRECATION_SCRIPT_TAG_BLOCKED,
        DEFAULT_DATES.scriptTagCreationBlocked
    ),
    plusScriptTagExecutionOff: parseEnvDate(
        process.env.DEPRECATION_PLUS_EXECUTION_OFF,
        DEFAULT_DATES.plusScriptTagExecutionOff
    ),
    nonPlusScriptTagExecutionOff: parseEnvDate(
        process.env.DEPRECATION_NON_PLUS_EXECUTION_OFF,
        DEFAULT_DATES.nonPlusScriptTagExecutionOff
    ),
    plusAdditionalScriptsReadOnly: parseEnvDate(
        process.env.DEPRECATION_PLUS_SCRIPTS_READONLY,
        DEFAULT_DATES.plusAdditionalScriptsReadOnly
    ),
    nonPlusAdditionalScriptsReadOnly: parseEnvDate(
        process.env.DEPRECATION_NON_PLUS_SCRIPTS_READONLY,
        DEFAULT_DATES.nonPlusAdditionalScriptsReadOnly
    ),
    scriptTagBlocked: parseEnvDate(
        process.env.DEPRECATION_SCRIPT_TAG_BLOCKED,
        DEFAULT_DATES.scriptTagBlocked
    ),
    plusAutoUpgradeStart: parseEnvDate(
        process.env.DEPRECATION_PLUS_AUTO_UPGRADE,
        DEFAULT_DATES.plusAutoUpgradeStart
    ),
} as const;

export type DatePrecision = "exact" | "month" | "quarter";

export interface DateDisplayInfo {
    date: Date;
    precision: DatePrecision;
    displayLabel: string;
    isEstimate: boolean;
}

export function getDateDisplayLabel(date: Date, precision: DatePrecision = "month"): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    switch (precision) {
        case "exact":
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        case "month":
            return `${year}-${String(month).padStart(2, "0")}`;
        case "quarter": {
            const quarter = Math.ceil(month / 3);
            return `${year}-Q${quarter}`;
        }
        default:
            return `${year}-${String(month).padStart(2, "0")}`;
    }
}

export const DEADLINE_METADATA: Record<string, DateDisplayInfo> = {
    scriptTagCreationBlocked: {
        date: DEPRECATION_DATES.scriptTagCreationBlocked,
        precision: "exact",
        displayLabel: "2025-02-01",
        isEstimate: false,
    },
    plusAdditionalScriptsReadOnly: {
        date: DEPRECATION_DATES.plusAdditionalScriptsReadOnly,
        precision: "exact",
        displayLabel: "2025-08-28",
        isEstimate: false,
    },
    nonPlusAdditionalScriptsReadOnly: {
        date: DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly,
        precision: "exact",
        displayLabel: "2025-08-28",
        isEstimate: false,
    },
    plusScriptTagExecutionOff: {
        date: DEPRECATION_DATES.plusScriptTagExecutionOff,
        precision: "exact",
        displayLabel: "2025-08-28",
        isEstimate: false,
    },
    nonPlusScriptTagExecutionOff: {
        date: DEPRECATION_DATES.nonPlusScriptTagExecutionOff,
        precision: "exact",
        displayLabel: "2026-08-26",
        isEstimate: false,
    },
    plusAutoUpgradeStart: {
        date: DEPRECATION_DATES.plusAutoUpgradeStart,
        precision: "month",
        displayLabel: "2026-01",
        isEstimate: true,
    },
};

export type ShopTier = "plus" | "non_plus" | "unknown";

export interface ShopUpgradeStatus {
    tier: ShopTier;
    typOspPagesEnabled: boolean | null;
    typOspUpdatedAt: Date | null;
    typOspUnknownReason?: string;
    typOspUnknownError?: string;
}

export interface DeprecationStatus {
    isExpired: boolean;
    isWarning: boolean;
    daysRemaining: number | null;
    deadline: Date | null;
    message: string;
    messageBrief: string;
    tone: "critical" | "warning" | "info" | "success";
    messageKey: string;
    messageParams?: Record<string, any>;
    messageBriefKey: string;
    messageBriefParams?: Record<string, any>;
}

function getDaysRemaining(deadline: Date, now: Date = new Date()): number {
    const diff = deadline.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function getScriptTagCreationStatus(now: Date = new Date()): DeprecationStatus {
    const deadline = DEPRECATION_DATES.scriptTagCreationBlocked;
    const daysRemaining = getDaysRemaining(deadline, now);
    const dateLabel = "2025-02-01";

    if (daysRemaining <= 0) {
        return {
            isExpired: true,
            isWarning: false,
            daysRemaining: 0,
            deadline,
            message: "Since 2025-02-01, new ScriptTags can no longer be created on the Thank you / Order status pages. Existing ScriptTags still run, but they will stop at a later deadline.",
            messageBrief: "Creation blocked (2025-02-01)",
            tone: "warning",
            messageKey: "deprecation.scriptTagCreation.expired.message",
            messageBriefKey: "deprecation.scriptTagCreation.expired.brief",
        };
    }

    if (daysRemaining <= 90) {
        return {
            isExpired: false,
            isWarning: true,
            daysRemaining,
            deadline,
            message: `In ${daysRemaining} days (2025-02-01), new ScriptTags can no longer be created on TYP/OSP pages. Plan your migration early.`,
            messageBrief: `Creation blocked in ${daysRemaining} days`,
            tone: "warning",
            messageKey: "deprecation.scriptTagCreation.warning.message",
            messageParams: { days: daysRemaining, date: dateLabel },
            messageBriefKey: "deprecation.scriptTagCreation.warning.brief",
            messageBriefParams: { days: daysRemaining },
        };
    }

    return {
        isExpired: false,
        isWarning: false,
        daysRemaining,
        deadline,
        message: `Starting 2025-02-01, new ScriptTags cannot be created. Migrate to Web Pixel early.`,
        messageBrief: `Creation blocked on 2025-02-01`,
        tone: "info",
        messageKey: "deprecation.scriptTagCreation.info.message",
        messageParams: { date: dateLabel },
        messageBriefKey: "deprecation.scriptTagCreation.info.brief",
        messageBriefParams: { date: dateLabel },
    };
}

export function getScriptTagExecutionStatus(tier: ShopTier, now: Date = new Date()): DeprecationStatus {
    const deadline = tier === "plus"
        ? DEPRECATION_DATES.plusScriptTagExecutionOff
        : DEPRECATION_DATES.nonPlusScriptTagExecutionOff;
    const daysRemaining = getDaysRemaining(deadline, now);
    const tierLabel = tier === "plus" ? "Plus merchants" : tier === "non_plus" ? "Non-Plus merchants" : "Merchants";
    // const tierKey = tier === "plus" ? "deprecation.tier.plus" : tier === "non_plus" ? "deprecation.tier.nonPlus" : "deprecation.tier.generic";
    const dateLabel = getDateDisplayLabel(deadline, "exact");

    const tierKeySuffix = tier === "plus" ? "plus" : tier === "non_plus" ? "nonPlus" : "generic";

    if (daysRemaining <= 0) {
        return {
            isExpired: true,
            isWarning: false,
            daysRemaining: 0,
            deadline,
            message: `${tierLabel}' ScriptTags stopped executing on ${dateLabel}. Migrate to Web Pixel immediately to restore tracking.`,
            messageBrief: `Execution stopped (${dateLabel})`,
            tone: "critical",
            messageKey: `deprecation.scriptTagExecution.expired.message.${tierKeySuffix}`,
            messageParams: { date: dateLabel },
            messageBriefKey: "deprecation.scriptTagExecution.expired.brief",
            messageBriefParams: { date: dateLabel },
        };
    }

    if (daysRemaining <= 90) {
        return {
            isExpired: false,
            isWarning: true,
            daysRemaining,
            deadline,
            message: `${tierLabel}' ScriptTags will stop executing on ${dateLabel} (${daysRemaining} days left). Complete migration as soon as possible.`,
            messageBrief: `${daysRemaining} days left`,
            tone: "warning",
            messageKey: `deprecation.scriptTagExecution.warning.message.${tierKeySuffix}`,
            messageParams: { date: dateLabel, days: daysRemaining },
            messageBriefKey: "deprecation.scriptTagExecution.warning.brief",
            messageBriefParams: { days: daysRemaining },
        };
    }

    return {
        isExpired: false,
        isWarning: false,
        daysRemaining,
        deadline,
        message: `${tierLabel}' ScriptTags will stop executing on ${dateLabel}. Migrate to Web Pixel early.`,
        messageBrief: `Deadline ${dateLabel}`,
        tone: "info",
        messageKey: `deprecation.scriptTagExecution.info.message.${tierKeySuffix}`,
        messageParams: { date: dateLabel },
        messageBriefKey: "deprecation.scriptTagExecution.info.brief",
        messageBriefParams: { date: dateLabel },
    };
}

export function getScriptTagDeprecationStatus(now: Date = new Date()): DeprecationStatus {
    return getScriptTagCreationStatus(now);
}

export function getAdditionalScriptsDeprecationStatus(tier: ShopTier, now: Date = new Date()): DeprecationStatus {
    const deadline = tier === "plus"
        ? DEPRECATION_DATES.plusAdditionalScriptsReadOnly
        : DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly;
    const daysRemaining = getDaysRemaining(deadline, now);
    const tierLabel = tier === "plus" ? "Plus merchants" : tier === "non_plus" ? "Non-Plus merchants" : "Merchants";
    const dateLabel = getDateDisplayLabel(deadline, "exact");
    const tierKeySuffix = tier === "plus" ? "plus" : tier === "non_plus" ? "nonPlus" : "generic";

    if (daysRemaining <= 0) {
        return {
            isExpired: true,
            isWarning: false,
            daysRemaining: 0,
            deadline,
            message: `${tierLabel}' Additional Scripts became read-only on ${dateLabel}. Use Web Pixel for tracking.`,
            messageBrief: `Read-only (${dateLabel})`,
            tone: "critical",
            messageKey: `deprecation.additionalScripts.expired.message.${tierKeySuffix}`,
            messageParams: { date: dateLabel },
            messageBriefKey: "deprecation.additionalScripts.expired.brief",
            messageBriefParams: { date: dateLabel },
        };
    }

    if (daysRemaining <= 90) {
        return {
            isExpired: false,
            isWarning: true,
            daysRemaining,
            deadline,
            message: `${tierLabel}' Additional Scripts will become read-only on ${dateLabel} (${daysRemaining} days left). Migrate as soon as possible.`,
            messageBrief: `${daysRemaining} days left`,
            tone: "warning",
            messageKey: `deprecation.additionalScripts.warning.message.${tierKeySuffix}`,
            messageParams: { date: dateLabel, days: daysRemaining },
            messageBriefKey: "deprecation.additionalScripts.warning.brief",
            messageBriefParams: { days: daysRemaining },
        };
    }

    return {
        isExpired: false,
        isWarning: false,
        daysRemaining,
        deadline,
        message: `${tierLabel}' Additional Scripts will become read-only on ${dateLabel}. Migrate to Web Pixel early.`,
        messageBrief: `Deadline ${dateLabel}`,
        tone: "info",
        messageKey: `deprecation.additionalScripts.info.message.${tierKeySuffix}`,
        messageParams: { date: dateLabel },
        messageBriefKey: "deprecation.additionalScripts.info.brief",
        messageBriefParams: { date: dateLabel },
    };
}

export function getMigrationUrgencyStatus(tier: ShopTier, hasScriptTags: boolean, hasOrderStatusScriptTags: boolean, now: Date = new Date()): {
    urgency: "critical" | "high" | "medium" | "low";
    primaryMessage: string;
    primaryMessageKey: string;
    primaryMessageParams?: Record<string, any>;
    actions: string[];
    actionsKeys: { key: string, params?: Record<string, any> }[];
} {
    const scriptTagStatus = getScriptTagDeprecationStatus(now);
    const additionalScriptsStatus = getAdditionalScriptsDeprecationStatus(tier, now);
    const actions: string[] = [];
    const actionsKeys: { key: string, params?: Record<string, any> }[] = [];
    let urgency: "critical" | "high" | "medium" | "low" = "low";
    let primaryMessage = "Your tracking setup is in good shape.";
    let primaryMessageKey = "deprecation.urgency.status.good";
    let primaryMessageParams = {};

    if (scriptTagStatus.isExpired && hasOrderStatusScriptTags) {
        urgency = "critical";
        primaryMessage = scriptTagStatus.message;
        primaryMessageKey = scriptTagStatus.messageKey;
        primaryMessageParams = scriptTagStatus.messageParams || {};
        actions.push("Remove ScriptTags from the Order status page now and enable Web Pixel");
        actionsKeys.push({ key: "deprecation.urgency.action.removeScriptTag" });
    }

    if (additionalScriptsStatus.isExpired) {
        urgency = "critical";
        primaryMessage = additionalScriptsStatus.message;
        primaryMessageKey = additionalScriptsStatus.messageKey;
        primaryMessageParams = additionalScriptsStatus.messageParams || {};
        actions.push("Replace Additional Scripts with Web Pixel");
        actionsKeys.push({ key: "deprecation.urgency.action.replaceAdditionalScripts" });
    }

    if (!additionalScriptsStatus.isExpired && additionalScriptsStatus.isWarning) {
        if (urgency !== "critical") {
            urgency = "high";
            primaryMessage = additionalScriptsStatus.message;
            primaryMessageKey = additionalScriptsStatus.messageKey;
            primaryMessageParams = additionalScriptsStatus.messageParams || {};
        }
        actions.push(`Complete migration within ${additionalScriptsStatus.daysRemaining} days`);
        actionsKeys.push({ key: "deprecation.urgency.action.migrateInDays", params: { days: additionalScriptsStatus.daysRemaining } });
    }

    if (hasScriptTags && !scriptTagStatus.isExpired) {
        if (urgency === "low")
            urgency = "medium";
        actions.push("Migrate ScriptTag tracking to Web Pixel");
        actionsKeys.push({ key: "deprecation.urgency.action.migrateScriptTag" });
    }

    if (urgency === "low") {
        primaryMessage = "Complete Web Pixel migration and run verification to prevent data loss after the upgrade.";
        primaryMessageKey = "deprecation.urgency.message.low";
    }

    return { urgency, primaryMessage, primaryMessageKey, primaryMessageParams, actions, actionsKeys };
}

export function formatDeadlineForUI(status: DeprecationStatus): {
    badge: {
        tone: "critical" | "warning" | "attention" | "success";
        text: string;
        textKey?: string;
        textParams?: Record<string, any>;
    };
    description: string;
    descriptionKey?: string;
    descriptionParams?: Record<string, any>;
} {
    if (status.isExpired) {
        return {
            badge: { tone: "critical", text: "Expired", textKey: "deprecation.scriptTagExecution.expired.brief", textParams: { date: "..." } }, // Note: reusing brief keys might be tricky if params missing
            description: status.message,
            descriptionKey: status.messageKey,
            descriptionParams: status.messageParams,
        };
    }
    if (status.isWarning) {
        return {
            badge: { tone: "warning", text: `${status.daysRemaining} days left`, textKey: "deprecation.scriptTagExecution.warning.brief", textParams: { days: status.daysRemaining } },
            description: status.message,
            descriptionKey: status.messageKey,
            descriptionParams: status.messageParams,
        };
    }
    return {
        badge: { tone: "attention", text: status.messageBrief, textKey: status.messageBriefKey, textParams: status.messageBriefParams },
        description: status.message,
        descriptionKey: status.messageKey,
        descriptionParams: status.messageParams,
    };
}

export interface UpgradeStatusUI {
    isUpgraded: boolean | null;
    urgency: "critical" | "high" | "medium" | "low" | "resolved";
    title: string;
    titleKey: string;
    titleParams?: Record<string, any>;
    message: string;
    messageKey: string;
    messageParams?: Record<string, any>;
    actions: string[];
    actionsKeys: { key: string, params?: Record<string, any> }[];
    autoUpgradeInfo?: {
        isInAutoUpgradeWindow: boolean;
        autoUpgradeMessage: string;
        autoUpgradeMessageKey: string;
        autoUpgradeMessageParams?: Record<string, any>;
    };
}

export function getUpgradeStatusMessage(upgradeStatus: ShopUpgradeStatus, hasScriptTags: boolean, now: Date = new Date()): UpgradeStatusUI {
    const { tier, typOspPagesEnabled } = upgradeStatus;
    const plusDeadlineLabel = getDateDisplayLabel(DEPRECATION_DATES.plusAdditionalScriptsReadOnly, "exact");
    const nonPlusDeadlineLabel = getDateDisplayLabel(DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly, "exact");
    const deadlineLabel = tier === "plus" ? plusDeadlineLabel : nonPlusDeadlineLabel;
    const isInPlusAutoUpgradeWindow = tier === "plus" && now >= DEPRECATION_DATES.plusAutoUpgradeStart;
    const autoUpgradeStartLabel = getDateDisplayLabel(DEPRECATION_DATES.plusAutoUpgradeStart, "month");
    const daysToAutoUpgrade = Math.ceil((DEPRECATION_DATES.plusAutoUpgradeStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const isInAutoUpgradeRiskWindow = tier === "plus" && daysToAutoUpgrade <= 90;

    const plusAutoUpgradeMessage = isInPlusAutoUpgradeWindow
        ? `⚡ The Plus merchant auto-upgrade window has started (from ${autoUpgradeStartLabel}; Shopify will notify 30 days in advance. Date is based on Shopify official announcements; refer to Admin prompts): Shopify is gradually auto-migrating Plus merchants' Thank you / Order status pages to the new version. After auto-upgrade, legacy Additional Scripts, ScriptTags, and checkout.liquid customizations will stop working.`
        : isInAutoUpgradeRiskWindow
        ? `⚠️ Plus merchant auto-upgrade risk window (${daysToAutoUpgrade} days left): Shopify will start auto-migrating Plus merchants to the new pages on ${autoUpgradeStartLabel} (Shopify will notify 30 days in advance. Date is based on Shopify official announcements; refer to Admin prompts). After auto-upgrade, legacy Additional Scripts, ScriptTags, and checkout.liquid customizations will be lost. Complete migration early.`
        : "";
    
    const autoUpgradeMessageKey = isInPlusAutoUpgradeWindow
        ? "deprecation.autoUpgrade.start"
        : isInAutoUpgradeRiskWindow
        ? "deprecation.autoUpgrade.risk"
        : "";
    
    const autoUpgradeMessageParams = isInPlusAutoUpgradeWindow
        ? { date: autoUpgradeStartLabel }
        : isInAutoUpgradeRiskWindow
        ? { date: autoUpgradeStartLabel, days: daysToAutoUpgrade }
        : {};

    if (typOspPagesEnabled === true) {
        const actions = hasScriptTags
            ? ["Delete legacy ScriptTags that no longer work to keep configuration clean"]
            : [];
        const actionsKeys = hasScriptTags
            ? [{ key: "deprecation.upgradeStatus.upgraded.action.clean" }]
            : [];
            
        return {
            isUpgraded: true,
            urgency: "resolved",
            title: "Upgraded to new Thank you / Order status pages",
            titleKey: "deprecation.upgradeStatus.upgraded.title",
            message: "Your store is now using the new Checkout Extensibility pages. Legacy ScriptTags and Additional Scripts no longer execute.",
            messageKey: "deprecation.upgradeStatus.upgraded.message",
            actions,
            actionsKeys,
            autoUpgradeInfo: isInPlusAutoUpgradeWindow || isInAutoUpgradeRiskWindow ? {
                isInAutoUpgradeWindow: isInPlusAutoUpgradeWindow,
                autoUpgradeMessage: plusAutoUpgradeMessage,
                autoUpgradeMessageKey,
                autoUpgradeMessageParams,
            } : undefined,
        };
    }

    const deadline = tier === "plus"
        ? DEPRECATION_DATES.plusAdditionalScriptsReadOnly
        : DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly;
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const isPlusDeadlinePassed = now >= DEPRECATION_DATES.plusAdditionalScriptsReadOnly;

    if (typOspPagesEnabled === null || typOspPagesEnabled === undefined) {
        const reasonHint = (() => {
            const reason = upgradeStatus.typOspUnknownReason;
            if (!reason)
                return null;
            // Map reason to key
            // This needs mapping logic or pass generic reason
            return `Reason: ${reason}`;
        })();
        
        // Need to construct localized reason or key
        // const reasonKey = `deprecation.upgradeStatus.unknown.reason.${upgradeStatus.typOspUnknownReason || "generic"}`;
        // const reasonParams = { reason: upgradeStatus.typOspUnknownReason };

        if (tier === "plus" && isPlusDeadlinePassed) {
            return {
                isUpgraded: null,
                urgency: "critical",
                title: "⚠️ Plus merchants: please confirm page upgrade status",
                titleKey: "deprecation.upgradeStatus.unknown.title.plus",
                message: `Plus merchants' Additional Scripts became read-only on ${plusDeadlineLabel} (date is based on Shopify official announcements; refer to Admin prompts).` +
                    "If you have not upgraded to the new Thank you / Order status pages, legacy scripts may have stopped running. Check whether your tracking is working." +
                    (reasonHint ? `\n${reasonHint}` : ""),
                messageKey: "deprecation.upgradeStatus.unknown.message.plus",
                messageParams: { date: plusDeadlineLabel }, // Note: appending reason might be needed in UI if using keys
                actions: [
                    "Go to Shopify Admin -> Settings -> Checkout to check the current page version",
                    "If upgraded: confirm Web Pixel is running correctly",
                    "If not upgraded: legacy scripts may still run, but migration is recommended soon",
                ],
                actionsKeys: [
                    { key: "deprecation.upgradeStatus.unknown.action.check" },
                    { key: "deprecation.upgradeStatus.unknown.action.checkWebPixel" },
                    { key: "deprecation.upgradeStatus.unknown.action.migrate" },
                ]
            };
        }

        return {
            isUpgraded: null,
            urgency: "medium",
            title: "Upgrade status needs confirmation",
            titleKey: "deprecation.upgradeStatus.unknown.title.generic",
            message: "We currently cannot confirm via Shopify Admin API whether your store's Thank you / Order status pages have extensibility enabled." +
                (reasonHint ? `\n${reasonHint}` : ""),
            messageKey: "deprecation.upgradeStatus.unknown.message.generic",
            actions: [
                "Go to Shopify Admin -> Settings -> Checkout to check the current page version",
                `${tier === "plus"
                    ? `Plus merchant deadline: ${plusDeadlineLabel} (date is based on Shopify official announcements; refer to Admin prompts)`
                    : `Non-Plus merchants: about ${Math.max(0, daysRemaining)} days remain until the deadline (${nonPlusDeadlineLabel}; date is based on Shopify official announcements; refer to Admin prompts)`}`,
            ],
            actionsKeys: [
                { key: "deprecation.upgradeStatus.unknown.action.check" },
                tier === "plus" 
                    ? { key: "deprecation.upgradeStatus.unknown.action.plusDeadline", params: { date: plusDeadlineLabel } }
                    : { key: "deprecation.upgradeStatus.unknown.action.nonPlusDeadline", params: { date: nonPlusDeadlineLabel, days: Math.max(0, daysRemaining) } }
            ]
        };
    }

    if (tier === "plus" && isPlusDeadlinePassed) {
        const autoUpgradeNote = isInPlusAutoUpgradeWindow
            ? `\n\n⚡ Auto-upgrade window started: Shopify is auto-migrating Plus merchants to the new pages (from ${autoUpgradeStartLabel}; Shopify will notify 30 days in advance. Date is based on Shopify official announcements; refer to Admin prompts).`
            : `\n\n📅 Starting ${autoUpgradeStartLabel} (Shopify will notify 30 days in advance; date is based on Shopify official announcements; refer to Admin prompts), Shopify will begin auto-migrating Plus merchants to the new pages.`;
        
        return {
            isUpgraded: false,
            urgency: "critical",
            title: "🚨 Plus merchants: Additional Scripts are now read-only",
            titleKey: "deprecation.upgradeStatus.critical.title",
            message: `Your store has not upgraded to the new pages yet. Plus merchants' Additional Scripts became read-only on ${plusDeadlineLabel} (date is based on Shopify official announcements; refer to Admin prompts).` +
                "Shopify may migrate your pages to the new version at any time." + autoUpgradeNote,
            messageKey: "deprecation.upgradeStatus.critical.message",
            messageParams: { date: plusDeadlineLabel },
            actions: [
                "Configure Web Pixel immediately to avoid tracking interruption",
                "Check whether Web Pixel configuration is correct",
                "Consider proactively upgrading to the new pages for better control",
            ],
            actionsKeys: [
                { key: "deprecation.upgradeStatus.critical.action.configure" },
                { key: "deprecation.upgradeStatus.critical.action.check" },
                { key: "deprecation.upgradeStatus.critical.action.upgrade" },
            ],
            autoUpgradeInfo: {
                isInAutoUpgradeWindow: isInPlusAutoUpgradeWindow,
                autoUpgradeMessage: plusAutoUpgradeMessage,
                autoUpgradeMessageKey,
                autoUpgradeMessageParams,
            },
        };
    }

    if (daysRemaining <= 0) {
        return {
            isUpgraded: false,
            urgency: "critical",
            title: "Deadline passed - migrate now",
            titleKey: "deprecation.upgradeStatus.expired.title",
            message: `Additional Scripts became read-only on ${deadlineLabel} (date is based on Shopify official announcements; refer to Admin prompts). Complete migration as soon as possible to avoid tracking interruption.`,
            messageKey: "deprecation.upgradeStatus.expired.message",
            messageParams: { date: deadlineLabel },
            actions: [
                "Configure Web Pixel now",
                "Verify tracking works correctly",
            ],
            actionsKeys: [
                { key: "deprecation.upgradeStatus.expired.action.configure" },
                { key: "deprecation.upgradeStatus.expired.action.verify" },
            ]
        };
    }

    if (daysRemaining <= 30) {
        return {
            isUpgraded: false,
            urgency: "high",
            title: `Urgent: ${daysRemaining} days left`,
            titleKey: "deprecation.upgradeStatus.high.title",
            titleParams: { days: daysRemaining },
            message: `Your store has not upgraded to the new pages yet. Additional Scripts will become read-only on ${deadlineLabel} (date is based on Shopify official announcements; refer to Admin prompts; ${daysRemaining} days left).`,
            messageKey: "deprecation.upgradeStatus.high.message",
            messageParams: { date: deadlineLabel, days: daysRemaining },
            actions: [
                "Complete Web Pixel configuration as soon as possible",
                "Test tracking after migration",
            ],
            actionsKeys: [
                { key: "deprecation.upgradeStatus.high.action.configure" },
                { key: "deprecation.upgradeStatus.high.action.test" },
            ]
        };
    }

    if (daysRemaining <= 90) {
        return {
            isUpgraded: false,
            urgency: "medium",
            title: `Plan migration: ${daysRemaining} days left`,
            titleKey: "deprecation.upgradeStatus.medium.title",
            titleParams: { days: daysRemaining },
            message: `Your store has not upgraded to the new pages yet. Complete migration before the deadline.`,
            messageKey: "deprecation.upgradeStatus.medium.message",
            actions: [
                "Plan a migration timeline",
                "Configure Web Pixel in Settings",
            ],
            actionsKeys: [
                { key: "deprecation.upgradeStatus.medium.action.plan" },
                { key: "deprecation.upgradeStatus.medium.action.configure" },
            ],
            autoUpgradeInfo: tier === "plus" && isInAutoUpgradeRiskWindow ? {
                isInAutoUpgradeWindow: false,
                autoUpgradeMessage: plusAutoUpgradeMessage,
                autoUpgradeMessageKey,
                autoUpgradeMessageParams,
            } : undefined,
        };
    }

    return {
        isUpgraded: false,
        urgency: "low",
        title: "Migration recommended",
        titleKey: "deprecation.upgradeStatus.low.title",
        message: "Your store has not upgraded to the new pages yet. There is still time, but early migration planning is recommended.",
        messageKey: "deprecation.upgradeStatus.low.message",
        autoUpgradeInfo: tier === "plus" && isInAutoUpgradeRiskWindow ? {
            isInAutoUpgradeWindow: false,
            autoUpgradeMessage: plusAutoUpgradeMessage,
            autoUpgradeMessageKey,
            autoUpgradeMessageParams,
        } : undefined,
        actions: [
            "Learn Web Pixel and Checkout Extensibility",
            "Rehearse the migration flow in a test store",
        ],
        actionsKeys: [
            { key: "deprecation.upgradeStatus.low.action.learn" },
            { key: "deprecation.upgradeStatus.low.action.preview" },
        ]
    };
}
