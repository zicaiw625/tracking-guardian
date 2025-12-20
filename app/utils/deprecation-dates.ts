/**
 * Shopify Checkout Extensibility Deprecation Dates
 * 
 * References:
 * - https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/upgrade-thank-you-order-status/upgrade-guide
 * - https://shopify.dev/docs/apps/build/online-store/blocking-script-tags
 * 
 * Timeline:
 * - 2025-02-01: ScriptTag functionality blocked in Thank you / Order status pages
 * - 2025-08-28: Plus merchants - additional scripts become read-only
 * - 2026-08-26: Non-Plus merchants - additional scripts become read-only
 */

// Deprecation dates for different merchant types
export const DEPRECATION_DATES = {
  // ScriptTag blocking for Thank you / Order status pages
  scriptTagBlocked: new Date("2025-02-01"),
  
  // Plus merchants: additional scripts become read-only
  plusAdditionalScriptsReadOnly: new Date("2025-08-28"),
  
  // Non-Plus merchants: additional scripts become read-only
  nonPlusAdditionalScriptsReadOnly: new Date("2026-08-26"),
} as const;

export type ShopTier = "plus" | "non_plus" | "unknown";

export interface DeprecationStatus {
  isExpired: boolean;
  isWarning: boolean;  // Within 90 days of expiry
  daysRemaining: number | null;
  deadline: Date | null;
  message: string;
  messageBrief: string;
  tone: "critical" | "warning" | "info" | "success";
}

/**
 * Calculate days remaining until a deadline
 */
function getDaysRemaining(deadline: Date, now: Date = new Date()): number {
  const diff = deadline.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Get deprecation status for ScriptTag functionality
 */
export function getScriptTagDeprecationStatus(now: Date = new Date()): DeprecationStatus {
  const deadline = DEPRECATION_DATES.scriptTagBlocked;
  const daysRemaining = getDaysRemaining(deadline, now);
  
  if (daysRemaining <= 0) {
    return {
      isExpired: true,
      isWarning: false,
      daysRemaining: 0,
      deadline,
      message: "ScriptTag 在 Thank you / Order status 页面的功能已于 2025 年 2 月 1 日被禁用。请立即迁移到 Web Pixel。",
      messageBrief: "已禁用（2025-02-01）",
      tone: "critical",
    };
  }
  
  if (daysRemaining <= 90) {
    return {
      isExpired: false,
      isWarning: true,
      daysRemaining,
      deadline,
      message: `ScriptTag 功能将于 ${daysRemaining} 天后（2025-02-01）被禁用。请尽快迁移到 Web Pixel。`,
      messageBrief: `${daysRemaining} 天后禁用`,
      tone: "warning",
    };
  }
  
  return {
    isExpired: false,
    isWarning: false,
    daysRemaining,
    deadline,
    message: `ScriptTag 功能计划于 2025-02-01 被禁用。建议提前迁移到 Web Pixel。`,
    messageBrief: `2025-02-01 禁用`,
    tone: "info",
  };
}

/**
 * Get deprecation status for Additional Scripts based on merchant tier
 */
export function getAdditionalScriptsDeprecationStatus(
  tier: ShopTier,
  now: Date = new Date()
): DeprecationStatus {
  // For unknown tier, show more conservative (Plus) deadline
  const deadline = tier === "non_plus" 
    ? DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly
    : DEPRECATION_DATES.plusAdditionalScriptsReadOnly;
  
  const daysRemaining = getDaysRemaining(deadline, now);
  const tierLabel = tier === "plus" ? "Plus 商家" : tier === "non_plus" ? "非 Plus 商家" : "商家";
  const dateLabel = tier === "non_plus" ? "2026-08-26" : "2025-08-28";
  
  if (daysRemaining <= 0) {
    return {
      isExpired: true,
      isWarning: false,
      daysRemaining: 0,
      deadline,
      message: `${tierLabel}的 Additional Scripts 已于 ${dateLabel} 变为只读。请使用 Web Pixel 或 Checkout UI Extension 进行追踪。`,
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
      message: `${tierLabel}的 Additional Scripts 将于 ${daysRemaining} 天后（${dateLabel}）变为只读。请尽快迁移。`,
      messageBrief: `${daysRemaining} 天后只读`,
      tone: "warning",
    };
  }
  
  return {
    isExpired: false,
    isWarning: false,
    daysRemaining,
    deadline,
    message: `${tierLabel}的 Additional Scripts 将于 ${dateLabel} 变为只读。建议提前迁移到 Web Pixel。`,
    messageBrief: `${dateLabel} 只读`,
    tone: "info",
  };
}

/**
 * Get overall migration urgency status combining all deprecation timelines
 */
export function getMigrationUrgencyStatus(
  tier: ShopTier,
  hasScriptTags: boolean,
  hasOrderStatusScriptTags: boolean,
  now: Date = new Date()
): {
  urgency: "critical" | "high" | "medium" | "low";
  primaryMessage: string;
  actions: string[];
} {
  const scriptTagStatus = getScriptTagDeprecationStatus(now);
  const additionalScriptsStatus = getAdditionalScriptsDeprecationStatus(tier, now);
  
  const actions: string[] = [];
  let urgency: "critical" | "high" | "medium" | "low" = "low";
  let primaryMessage = "您的追踪配置状态良好。";
  
  // Critical: ScriptTag already blocked and shop has them
  if (scriptTagStatus.isExpired && hasOrderStatusScriptTags) {
    urgency = "critical";
    primaryMessage = scriptTagStatus.message;
    actions.push("立即删除订单状态页的 ScriptTag 并启用 Web Pixel");
  }
  
  // Critical: Additional scripts already read-only
  if (additionalScriptsStatus.isExpired) {
    urgency = "critical";
    primaryMessage = additionalScriptsStatus.message;
    actions.push("使用 Web Pixel Extension 或 Checkout UI Extension 替代 Additional Scripts");
  }
  
  // High: Within 90 days of any deadline
  if (!additionalScriptsStatus.isExpired && additionalScriptsStatus.isWarning) {
    if (urgency !== "critical") {
      urgency = "high";
      primaryMessage = additionalScriptsStatus.message;
    }
    actions.push(`在 ${additionalScriptsStatus.daysRemaining} 天内完成迁移`);
  }
  
  if (hasScriptTags && !scriptTagStatus.isExpired) {
    if (urgency === "low") urgency = "medium";
    actions.push("将 ScriptTag 追踪迁移到 Web Pixel");
  }
  
  // Always recommend CAPI
  if (urgency === "low") {
    primaryMessage = "建议启用服务端转化追踪 (CAPI) 以提高追踪准确率。";
  }
  
  return { urgency, primaryMessage, actions };
}

/**
 * Format a deadline status for display in UI
 */
export function formatDeadlineForUI(status: DeprecationStatus): {
  badge: { tone: "critical" | "warning" | "attention" | "success"; text: string };
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

