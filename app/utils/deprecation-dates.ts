export const DEPRECATION_DATES = {
    scriptTagCreationBlocked: new Date("2025-02-01"),
    plusScriptTagExecutionOff: new Date("2025-08-28"),
    nonPlusScriptTagExecutionOff: new Date("2026-08-26"),
    plusAdditionalScriptsReadOnly: new Date("2025-08-28"),
    nonPlusAdditionalScriptsReadOnly: new Date("2026-08-26"),
    scriptTagBlocked: new Date("2025-02-01"),
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
            return `${year}年${month}月`;
        case "quarter": {
            const quarter = Math.ceil(month / 3);
            return `${year}年第${quarter}季度`;
        }
        default:
            return `${year}年${month}月`;
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
        precision: "month",
        displayLabel: "2025年8月",
        isEstimate: true,
    },
    nonPlusAdditionalScriptsReadOnly: {
        date: DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly,
        precision: "month",
        displayLabel: "2026年8月",
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
}
function getDaysRemaining(deadline: Date, now: Date = new Date()): number {
    const diff = deadline.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
export function getScriptTagCreationStatus(now: Date = new Date()): DeprecationStatus {
    const deadline = DEPRECATION_DATES.scriptTagCreationBlocked;
    const daysRemaining = getDaysRemaining(deadline, now);
    if (daysRemaining <= 0) {
        return {
            isExpired: true,
            isWarning: false,
            daysRemaining: 0,
            deadline,
            message: "自 2025 年 2 月 1 日起，无法在 Thank you / Order status 页面创建新的 ScriptTag。现有的 ScriptTag 仍在运行，但将于稍后的截止日期停止。",
            messageBrief: "禁止创建（2025-02-01）",
            tone: "warning",
        };
    }
    if (daysRemaining <= 90) {
        return {
            isExpired: false,
            isWarning: true,
            daysRemaining,
            deadline,
            message: `${daysRemaining} 天后（2025-02-01）将无法在 TYP/OSP 页面创建新的 ScriptTag。建议提前规划迁移。`,
            messageBrief: `${daysRemaining} 天后禁止创建`,
            tone: "warning",
        };
    }
    return {
        isExpired: false,
        isWarning: false,
        daysRemaining,
        deadline,
        message: `2025-02-01 起将无法创建新的 ScriptTag。建议提前迁移到 Web Pixel。`,
        messageBrief: `2025-02-01 禁止创建`,
        tone: "info",
    };
}
export function getScriptTagExecutionStatus(tier: ShopTier, now: Date = new Date()): DeprecationStatus {
    const deadline = tier === "plus"
        ? DEPRECATION_DATES.plusScriptTagExecutionOff
        : DEPRECATION_DATES.nonPlusScriptTagExecutionOff;
    const daysRemaining = getDaysRemaining(deadline, now);
    const tierLabel = tier === "plus" ? "Plus 商家" : tier === "non_plus" ? "非 Plus 商家" : "商家";
    const dateLabel = tier === "plus" ? "2025年8月起" : "2026年8月起";
    if (daysRemaining <= 0) {
        return {
            isExpired: true,
            isWarning: false,
            daysRemaining: 0,
            deadline,
            message: `${tierLabel}的 ScriptTag 已于 ${dateLabel}停止执行。请立即迁移到 Web Pixel 以恢复追踪功能。`,
            messageBrief: `已停止执行（${dateLabel}）`,
            tone: "critical",
        };
    }
    if (daysRemaining <= 90) {
        return {
            isExpired: false,
            isWarning: true,
            daysRemaining,
            deadline,
            message: `${tierLabel}的 ScriptTag 将于 ${dateLabel}停止执行（约 ${daysRemaining} 天后）。请尽快完成迁移！`,
            messageBrief: `约 ${daysRemaining} 天后停止执行`,
            tone: "warning",
        };
    }
    return {
        isExpired: false,
        isWarning: false,
        daysRemaining,
        deadline,
        message: `${tierLabel}的 ScriptTag 将于 ${dateLabel}停止执行。建议提前迁移到 Web Pixel。`,
        messageBrief: `${dateLabel}停止执行`,
        tone: "info",
    };
}
export function getScriptTagDeprecationStatus(now: Date = new Date()): DeprecationStatus {
    return getScriptTagCreationStatus(now);
}
export function getAdditionalScriptsDeprecationStatus(tier: ShopTier, now: Date = new Date()): DeprecationStatus {
    const deadline = tier === "non_plus"
        ? DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly
        : DEPRECATION_DATES.plusAdditionalScriptsReadOnly;
    const daysRemaining = getDaysRemaining(deadline, now);
    const tierLabel = tier === "plus" ? "Plus 商家" : tier === "non_plus" ? "非 Plus 商家" : "商家";
    const dateLabel = tier === "non_plus" ? "2026年8月起" : "2025年8月起";
    if (daysRemaining <= 0) {
        return {
            isExpired: true,
            isWarning: false,
            daysRemaining: 0,
            deadline,
            message: `${tierLabel}的 Additional Scripts 已于 ${dateLabel}变为只读。请使用 Web Pixel 或 Checkout UI Extension 进行追踪。`,
            messageBrief: `已只读（${dateLabel}）`,
            tone: "critical",
        };
    }
    if (daysRemaining <= 90) {
        return {
            isExpired: false,
            isWarning: true,
            daysRemaining,
            deadline,
            message: `${tierLabel}的 Additional Scripts 将于 ${dateLabel}变为只读（约 ${daysRemaining} 天后）。请尽快迁移。`,
            messageBrief: `约 ${daysRemaining} 天后只读`,
            tone: "warning",
        };
    }
    return {
        isExpired: false,
        isWarning: false,
        daysRemaining,
        deadline,
        message: `${tierLabel}的 Additional Scripts 将于 ${dateLabel}变为只读。建议提前迁移到 Web Pixel。`,
        messageBrief: `${dateLabel}只读`,
        tone: "info",
    };
}
export function getMigrationUrgencyStatus(tier: ShopTier, hasScriptTags: boolean, hasOrderStatusScriptTags: boolean, now: Date = new Date()): {
    urgency: "critical" | "high" | "medium" | "low";
    primaryMessage: string;
    actions: string[];
} {
    const scriptTagStatus = getScriptTagDeprecationStatus(now);
    const additionalScriptsStatus = getAdditionalScriptsDeprecationStatus(tier, now);
    const actions: string[] = [];
    let urgency: "critical" | "high" | "medium" | "low" = "low";
    let primaryMessage = "您的追踪配置状态良好。";
    if (scriptTagStatus.isExpired && hasOrderStatusScriptTags) {
        urgency = "critical";
        primaryMessage = scriptTagStatus.message;
        actions.push("立即删除订单状态页的 ScriptTag 并启用 Web Pixel");
    }
    if (additionalScriptsStatus.isExpired) {
        urgency = "critical";
        primaryMessage = additionalScriptsStatus.message;
        actions.push("使用 Web Pixel Extension 或 Checkout UI Extension 替代 Additional Scripts");
    }
    if (!additionalScriptsStatus.isExpired && additionalScriptsStatus.isWarning) {
        if (urgency !== "critical") {
            urgency = "high";
            primaryMessage = additionalScriptsStatus.message;
        }
        actions.push(`在 ${additionalScriptsStatus.daysRemaining} 天内完成迁移`);
    }
    if (hasScriptTags && !scriptTagStatus.isExpired) {
        if (urgency === "low")
            urgency = "medium";
        actions.push("将 ScriptTag 追踪迁移到 Web Pixel");
    }
    if (urgency === "low") {
        primaryMessage = "建议启用服务端转化追踪 (CAPI) 以提高追踪准确率。";
    }
    return { urgency, primaryMessage, actions };
}
export function formatDeadlineForUI(status: DeprecationStatus): {
    badge: {
        tone: "critical" | "warning" | "attention" | "success";
        text: string;
    };
    description: string;
} {
    if (status.isExpired) {
        return {
            badge: { tone: "critical", text: "已过期" },
            description: status.message,
        };
    }
    if (status.isWarning) {
        return {
            badge: { tone: "warning", text: `剩余 ${status.daysRemaining} 天` },
            description: status.message,
        };
    }
    return {
        badge: { tone: "attention", text: status.messageBrief },
        description: status.message,
    };
}
export function getUpgradeStatusMessage(upgradeStatus: ShopUpgradeStatus, hasScriptTags: boolean, now: Date = new Date()): {
    isUpgraded: boolean | null;
    urgency: "critical" | "high" | "medium" | "low" | "resolved";
    title: string;
    message: string;
    actions: string[];
} {
    const { tier, typOspPagesEnabled } = upgradeStatus;
    const plusAdditionalScriptsWindowLabel = "2025年8月起";
    const nonPlusAdditionalScriptsWindowLabel = "2026年8月起";
    const windowLabel = tier === "non_plus" ? nonPlusAdditionalScriptsWindowLabel : plusAdditionalScriptsWindowLabel;
    const windowDisclaimer = "（月份级窗口，具体日期以 Shopify 官方公告为准）";
    if (typOspPagesEnabled === true) {
        return {
            isUpgraded: true,
            urgency: "resolved",
            title: "已升级到新版 Thank you / Order status 页面",
            message: "您的店铺已使用新版 Checkout Extensibility 页面。旧版 ScriptTags 和 Additional Scripts 已不再执行。",
            actions: hasScriptTags
                ? ["建议删除不再生效的旧版 ScriptTags 以保持配置整洁"]
                : [],
        };
    }
    const deadline = tier === "plus"
        ? DEPRECATION_DATES.plusAdditionalScriptsReadOnly
        : tier === "non_plus"
            ? DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly
            : DEPRECATION_DATES.plusAdditionalScriptsReadOnly;
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const isPlusDeadlinePassed = now >= DEPRECATION_DATES.plusAdditionalScriptsReadOnly;
    if (typOspPagesEnabled === null || typOspPagesEnabled === undefined) {
        const reasonHint = (() => {
            const reason = upgradeStatus.typOspUnknownReason;
            if (!reason)
                return null;
            switch (reason) {
                case "NOT_PLUS":
                    return "原因：店铺可能不是 Plus，或没有 checkoutProfiles 权限。";
                case "NO_EDITOR_ACCESS":
                    return "原因：缺少「checkout and accounts editor」访问权限。";
                case "RATE_LIMIT":
                    return "原因：Shopify API 限流，请稍后重试。";
                case "FIELD_NOT_AVAILABLE":
                    return "原因：API 响应中缺少 typOspPagesActive 字段（已降级处理）。";
                case "NO_PROFILES":
                    return "原因：未返回 checkout profiles。";
                case "API_ERROR":
                    return "原因：Shopify Admin API 查询失败。";
                case "NO_ADMIN_CONTEXT":
                    return "原因：缺少 Admin API 上下文（无离线 session 或未授权）。";
                default:
                    return `原因：${reason}`;
            }
        })();
        if (tier === "plus" && isPlusDeadlinePassed) {
            return {
                isUpgraded: null,
                urgency: "critical",
                title: "⚠️ Plus 商家：请确认页面升级状态",
                message: `Plus 商家的 Additional Scripts 预计自 ${plusAdditionalScriptsWindowLabel} 起进入只读窗口期${windowDisclaimer}。` +
                    "如果您尚未升级到新版 Thank you / Order status 页面，旧脚本可能已停止运行。请检查您的追踪是否正常。" +
                    (reasonHint ? `\n${reasonHint}` : ""),
                actions: [
                    "前往 Shopify 后台 → 设置 → 结账 查看当前页面版本",
                    "如已升级：确认 Web Pixel 正常运行",
                    "如未升级：旧脚本可能仍在运行，但建议尽快迁移",
                ],
            };
        }
        return {
            isUpgraded: null,
            urgency: "medium",
            title: "升级状态待确认",
            message: "我们暂时无法通过 Shopify Admin API 确认您店铺的 Thank you / Order status 页面是否已启用 extensibility。" +
                (reasonHint ? `\n${reasonHint}` : ""),
            actions: [
                "前往 Shopify 后台 → 设置 → 结账 查看当前页面版本",
                `${tier === "plus"
                    ? `Plus 商家：预计自 ${plusAdditionalScriptsWindowLabel} 起进入只读窗口期${windowDisclaimer}`
                    : `预计距离只读窗口期还有约 ${Math.max(0, daysRemaining)} 天（${nonPlusAdditionalScriptsWindowLabel}）`}`,
            ],
        };
    }
    if (tier === "plus" && isPlusDeadlinePassed) {
        return {
            isUpgraded: false,
            urgency: "critical",
            title: "🚨 Plus 商家：Additional Scripts 已进入只读模式",
            message: `您的店铺尚未升级到新版页面，但 Plus 商家的 Additional Scripts 预计已进入只读窗口期（${plusAdditionalScriptsWindowLabel}）${windowDisclaimer}。` +
                "Shopify 可能随时将您的页面迁移到新版本。",
            actions: [
                "立即配置 Web Pixel 以确保追踪不中断",
                "检查 Web Pixel 和 CAPI 配置是否正确",
                "考虑主动升级到新版页面以获得更好的控制",
            ],
        };
    }
    if (daysRemaining <= 0) {
        return {
            isUpgraded: false,
            urgency: "critical",
            title: "截止日期已过 - 请立即迁移",
            message: `Additional Scripts 预计已进入只读窗口期（${windowLabel}）${windowDisclaimer}。请尽快完成迁移以避免追踪中断。`,
            actions: [
                "立即配置 Web Pixel",
                "验证追踪是否正常工作",
            ],
        };
    }
    if (daysRemaining <= 30) {
        return {
            isUpgraded: false,
            urgency: "high",
            title: `紧急：剩余 ${daysRemaining} 天`,
            message: `您的店铺尚未升级到新版页面。Additional Scripts 预计约 ${daysRemaining} 天后进入只读窗口期（${windowLabel}）${windowDisclaimer}。`,
            actions: [
                "尽快完成 Web Pixel 配置",
                "测试迁移后的追踪功能",
            ],
        };
    }
    if (daysRemaining <= 90) {
        return {
            isUpgraded: false,
            urgency: "medium",
            title: `请规划迁移：剩余 ${daysRemaining} 天`,
            message: `您的店铺尚未升级到新版页面。建议在截止日期前完成迁移。`,
            actions: [
                "规划迁移时间表",
                "在设置页面配置 Web Pixel",
            ],
        };
    }
    return {
        isUpgraded: false,
        urgency: "low",
        title: "建议迁移",
        message: "您的店铺尚未升级到新版页面。虽然时间充裕，但建议提前规划迁移。",
        actions: [
            "了解 Web Pixel 和 Checkout Extensibility",
            "在测试店铺中预演迁移流程",
        ],
    };
}
