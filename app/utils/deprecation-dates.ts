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
  nonPlusAdditionalScriptsReadOnly: "2026-08-26",
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
  scriptTagBlocked: parseEnvDate(process.env.DEPRECATION_SCRIPT_TAG_BLOCKED, DEFAULT_DATES.scriptTagBlocked),
  plusAutoUpgradeStart: parseEnvDate(process.env.DEPRECATION_PLUS_AUTO_UPGRADE, DEFAULT_DATES.plusAutoUpgradeStart),
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
    displayLabel: "2026-08-26",
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
      message:
        "自 2025 年 2 月 1 日起，无法在 Thank you / Order status 页面创建新的 ScriptTag。现有的 ScriptTag 仍在运行，但将于稍后的截止日期停止。",
      messageBrief: "禁止创建（2025-02-01）",
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
      message: `${daysRemaining} 天后（2025-02-01）将无法在 TYP/OSP 页面创建新的 ScriptTag。建议提前规划迁移。`,
      messageBrief: `${daysRemaining} 天后禁止创建`,
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
    message: `2025-02-01 起将无法创建新的 ScriptTag。建议提前迁移到 Web Pixel。`,
    messageBrief: `2025-02-01 禁止创建`,
    tone: "info",
    messageKey: "deprecation.scriptTagCreation.info.message",
    messageParams: { date: dateLabel },
    messageBriefKey: "deprecation.scriptTagCreation.info.brief",
    messageBriefParams: { date: dateLabel },
  };
}

export function getScriptTagExecutionStatus(tier: ShopTier, now: Date = new Date()): DeprecationStatus {
  const deadline =
    tier === "plus" ? DEPRECATION_DATES.plusScriptTagExecutionOff : DEPRECATION_DATES.nonPlusScriptTagExecutionOff;
  const daysRemaining = getDaysRemaining(deadline, now);
  const tierLabel = tier === "plus" ? "Plus 商家" : tier === "non_plus" ? "非 Plus 商家" : "商家";
  // const tierKey = tier === "plus" ? "deprecation.tier.plus" : tier === "non_plus" ? "deprecation.tier.nonPlus" : "deprecation.tier.generic";
  const dateLabel = getDateDisplayLabel(deadline, "exact");

  const tierKeySuffix = tier === "plus" ? "plus" : tier === "non_plus" ? "nonPlus" : "generic";

  if (daysRemaining <= 0) {
    return {
      isExpired: true,
      isWarning: false,
      daysRemaining: 0,
      deadline,
      message: `${tierLabel}的 ScriptTag 已于 ${dateLabel} 停止执行。请立即迁移到 Web Pixel 以恢复追踪功能。`,
      messageBrief: `已停止执行（${dateLabel}）`,
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
      message: `${tierLabel}的 ScriptTag 将于 ${dateLabel} 停止执行（剩余 ${daysRemaining} 天）。请尽快完成迁移！`,
      messageBrief: `剩余 ${daysRemaining} 天`,
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
    message: `${tierLabel}的 ScriptTag 将于 ${dateLabel} 停止执行。建议提前迁移到 Web Pixel。`,
    messageBrief: `截止 ${dateLabel}`,
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
  const deadline =
    tier === "plus"
      ? DEPRECATION_DATES.plusAdditionalScriptsReadOnly
      : DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly;
  const daysRemaining = getDaysRemaining(deadline, now);
  const tierLabel = tier === "plus" ? "Plus 商家" : tier === "non_plus" ? "非 Plus 商家" : "商家";
  const dateLabel = getDateDisplayLabel(deadline, "exact");
  const tierKeySuffix = tier === "plus" ? "plus" : tier === "non_plus" ? "nonPlus" : "generic";

  if (daysRemaining <= 0) {
    return {
      isExpired: true,
      isWarning: false,
      daysRemaining: 0,
      deadline,
      message: `${tierLabel}的 Additional Scripts 已于 ${dateLabel} 变为只读。请使用 Web Pixel 进行追踪。`,
      messageBrief: `已只读（${dateLabel}）`,
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
      message: `${tierLabel}的 Additional Scripts 将于 ${dateLabel} 变为只读（剩余 ${daysRemaining} 天）。请尽快迁移。`,
      messageBrief: `剩余 ${daysRemaining} 天`,
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
    message: `${tierLabel}的 Additional Scripts 将于 ${dateLabel} 变为只读。建议提前迁移到 Web Pixel。`,
    messageBrief: `截止 ${dateLabel}`,
    tone: "info",
    messageKey: `deprecation.additionalScripts.info.message.${tierKeySuffix}`,
    messageParams: { date: dateLabel },
    messageBriefKey: "deprecation.additionalScripts.info.brief",
    messageBriefParams: { date: dateLabel },
  };
}

export function getMigrationUrgencyStatus(
  tier: ShopTier,
  hasScriptTags: boolean,
  hasOrderStatusScriptTags: boolean,
  now: Date = new Date()
): {
  urgency: "critical" | "high" | "medium" | "low";
  primaryMessage: string;
  primaryMessageKey: string;
  primaryMessageParams?: Record<string, any>;
  actions: string[];
  actionsKeys: { key: string; params?: Record<string, any> }[];
} {
  const scriptTagStatus = getScriptTagDeprecationStatus(now);
  const additionalScriptsStatus = getAdditionalScriptsDeprecationStatus(tier, now);
  const actions: string[] = [];
  const actionsKeys: { key: string; params?: Record<string, any> }[] = [];
  let urgency: "critical" | "high" | "medium" | "low" = "low";
  let primaryMessage = "您的追踪配置状态良好。";
  let primaryMessageKey = "deprecation.urgency.status.good";
  let primaryMessageParams = {};

  if (scriptTagStatus.isExpired && hasOrderStatusScriptTags) {
    urgency = "critical";
    primaryMessage = scriptTagStatus.message;
    primaryMessageKey = scriptTagStatus.messageKey;
    primaryMessageParams = scriptTagStatus.messageParams || {};
    actions.push("立即删除订单状态页的 ScriptTag 并启用 Web Pixel");
    actionsKeys.push({ key: "deprecation.urgency.action.removeScriptTag" });
  }

  if (additionalScriptsStatus.isExpired) {
    urgency = "critical";
    primaryMessage = additionalScriptsStatus.message;
    primaryMessageKey = additionalScriptsStatus.messageKey;
    primaryMessageParams = additionalScriptsStatus.messageParams || {};
    actions.push("使用 Web Pixel 替代 Additional Scripts");
    actionsKeys.push({ key: "deprecation.urgency.action.replaceAdditionalScripts" });
  }

  if (!additionalScriptsStatus.isExpired && additionalScriptsStatus.isWarning) {
    if (urgency !== "critical") {
      urgency = "high";
      primaryMessage = additionalScriptsStatus.message;
      primaryMessageKey = additionalScriptsStatus.messageKey;
      primaryMessageParams = additionalScriptsStatus.messageParams || {};
    }
    actions.push(`在 ${additionalScriptsStatus.daysRemaining} 天内完成迁移`);
    actionsKeys.push({
      key: "deprecation.urgency.action.migrateInDays",
      params: { days: additionalScriptsStatus.daysRemaining },
    });
  }

  if (hasScriptTags && !scriptTagStatus.isExpired) {
    if (urgency === "low") urgency = "medium";
    actions.push("将 ScriptTag 追踪迁移到 Web Pixel");
    actionsKeys.push({ key: "deprecation.urgency.action.migrateScriptTag" });
  }

  if (urgency === "low") {
    primaryMessage = "建议完成 Web Pixel 迁移并运行验收，确保升级后不丢数据。";
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
      badge: {
        tone: "critical",
        text: "已过期",
        textKey: "deprecation.scriptTagExecution.expired.brief",
        textParams: { date: "..." },
      }, // Note: reusing brief keys might be tricky if params missing
      description: status.message,
      descriptionKey: status.messageKey,
      descriptionParams: status.messageParams,
    };
  }
  if (status.isWarning) {
    return {
      badge: {
        tone: "warning",
        text: `剩余 ${status.daysRemaining} 天`,
        textKey: "deprecation.scriptTagExecution.warning.brief",
        textParams: { days: status.daysRemaining },
      },
      description: status.message,
      descriptionKey: status.messageKey,
      descriptionParams: status.messageParams,
    };
  }
  return {
    badge: {
      tone: "attention",
      text: status.messageBrief,
      textKey: status.messageBriefKey,
      textParams: status.messageBriefParams,
    },
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
  actionsKeys: { key: string; params?: Record<string, any> }[];
  autoUpgradeInfo?: {
    isInAutoUpgradeWindow: boolean;
    autoUpgradeMessage: string;
    autoUpgradeMessageKey: string;
    autoUpgradeMessageParams?: Record<string, any>;
  };
}

export function getUpgradeStatusMessage(
  upgradeStatus: ShopUpgradeStatus,
  hasScriptTags: boolean,
  now: Date = new Date()
): UpgradeStatusUI {
  const { tier, typOspPagesEnabled } = upgradeStatus;
  const plusDeadlineLabel = getDateDisplayLabel(DEPRECATION_DATES.plusAdditionalScriptsReadOnly, "exact");
  const nonPlusDeadlineLabel = getDateDisplayLabel(DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly, "exact");
  const deadlineLabel = tier === "plus" ? plusDeadlineLabel : nonPlusDeadlineLabel;
  const isInPlusAutoUpgradeWindow = tier === "plus" && now >= DEPRECATION_DATES.plusAutoUpgradeStart;
  const autoUpgradeStartLabel = getDateDisplayLabel(DEPRECATION_DATES.plusAutoUpgradeStart, "month");
  const daysToAutoUpgrade = Math.ceil(
    (DEPRECATION_DATES.plusAutoUpgradeStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  const isInAutoUpgradeRiskWindow = tier === "plus" && daysToAutoUpgrade <= 90;

  const plusAutoUpgradeMessage = isInPlusAutoUpgradeWindow
    ? `⚡ Plus 商家自动升级窗口已开始（${autoUpgradeStartLabel}起，Shopify 会提前30天通知，日期来自 Shopify 官方公告，请以 Admin 提示为准）：Shopify 正在逐步将 Plus 商家的 Thank you / Order status 页面自动迁移到新版本。自动升级后，旧的 Additional Scripts、ScriptTags、checkout.liquid 自定义将失效。`
    : isInAutoUpgradeRiskWindow
      ? `⚠️ Plus 商家自动升级风险窗口（剩余 ${daysToAutoUpgrade} 天）：Shopify 将于 ${autoUpgradeStartLabel}（Shopify 会提前30天通知，日期来自 Shopify 官方公告，请以 Admin 提示为准）开始自动将 Plus 商家迁移到新版页面。自动升级后，旧的 Additional Scripts、ScriptTags、checkout.liquid 自定义将丢失。建议提前完成迁移。`
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
    const actions = hasScriptTags ? ["建议删除不再生效的旧版 ScriptTags 以保持配置整洁"] : [];
    const actionsKeys = hasScriptTags ? [{ key: "deprecation.upgradeStatus.upgraded.action.clean" }] : [];

    return {
      isUpgraded: true,
      urgency: "resolved",
      title: "已升级到新版 Thank you / Order status 页面",
      titleKey: "deprecation.upgradeStatus.upgraded.title",
      message: "您的店铺已使用新版 Checkout Extensibility 页面。旧版 ScriptTags 和 Additional Scripts 已不再执行。",
      messageKey: "deprecation.upgradeStatus.upgraded.message",
      actions,
      actionsKeys,
      autoUpgradeInfo:
        isInPlusAutoUpgradeWindow || isInAutoUpgradeRiskWindow
          ? {
              isInAutoUpgradeWindow: isInPlusAutoUpgradeWindow,
              autoUpgradeMessage: plusAutoUpgradeMessage,
              autoUpgradeMessageKey,
              autoUpgradeMessageParams,
            }
          : undefined,
    };
  }

  const deadline =
    tier === "plus"
      ? DEPRECATION_DATES.plusAdditionalScriptsReadOnly
      : DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly;
  const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isPlusDeadlinePassed = now >= DEPRECATION_DATES.plusAdditionalScriptsReadOnly;

  if (typOspPagesEnabled === null || typOspPagesEnabled === undefined) {
    const reasonHint = (() => {
      const reason = upgradeStatus.typOspUnknownReason;
      if (!reason) return null;
      // Map reason to key
      // This needs mapping logic or pass generic reason
      return `原因：${reason}`;
    })();

    // Need to construct localized reason or key
    // const reasonKey = `deprecation.upgradeStatus.unknown.reason.${upgradeStatus.typOspUnknownReason || "generic"}`;
    // const reasonParams = { reason: upgradeStatus.typOspUnknownReason };

    if (tier === "plus" && isPlusDeadlinePassed) {
      return {
        isUpgraded: null,
        urgency: "critical",
        title: "⚠️ Plus 商家：请确认页面升级状态",
        titleKey: "deprecation.upgradeStatus.unknown.title.plus",
        message:
          `Plus 商家的 Additional Scripts 已于 ${plusDeadlineLabel}（日期来自 Shopify 官方公告，请以 Admin 提示为准）进入只读模式。` +
          "如果您尚未升级到新版 Thank you / Order status 页面，旧脚本可能已停止运行。请检查您的追踪是否正常。" +
          (reasonHint ? `\n${reasonHint}` : ""),
        messageKey: "deprecation.upgradeStatus.unknown.message.plus",
        messageParams: { date: plusDeadlineLabel }, // Note: appending reason might be needed in UI if using keys
        actions: [
          "前往 Shopify 后台 → 设置 → 结账 查看当前页面版本",
          "如已升级：确认 Web Pixel 正常运行",
          "如未升级：旧脚本可能仍在运行，但建议尽快迁移",
        ],
        actionsKeys: [
          { key: "deprecation.upgradeStatus.unknown.action.check" },
          { key: "deprecation.upgradeStatus.unknown.action.checkWebPixel" },
          { key: "deprecation.upgradeStatus.unknown.action.migrate" },
        ],
      };
    }

    return {
      isUpgraded: null,
      urgency: "medium",
      title: "升级状态待确认",
      titleKey: "deprecation.upgradeStatus.unknown.title.generic",
      message:
        "我们暂时无法通过 Shopify Admin API 确认您店铺的 Thank you / Order status 页面是否已启用 extensibility。" +
        (reasonHint ? `\n${reasonHint}` : ""),
      messageKey: "deprecation.upgradeStatus.unknown.message.generic",
      actions: [
        "前往 Shopify 后台 → 设置 → 结账 查看当前页面版本",
        `${
          tier === "plus"
            ? `Plus 商家截止日期：${plusDeadlineLabel}（日期来自 Shopify 官方公告，请以 Admin 提示为准）`
            : `非 Plus 商家：距截止日期（${nonPlusDeadlineLabel}，日期来自 Shopify 官方公告，请以 Admin 提示为准）还有约 ${Math.max(0, daysRemaining)} 天`
        }`,
      ],
      actionsKeys: [
        { key: "deprecation.upgradeStatus.unknown.action.check" },
        tier === "plus"
          ? { key: "deprecation.upgradeStatus.unknown.action.plusDeadline", params: { date: plusDeadlineLabel } }
          : {
              key: "deprecation.upgradeStatus.unknown.action.nonPlusDeadline",
              params: { date: nonPlusDeadlineLabel, days: Math.max(0, daysRemaining) },
            },
      ],
    };
  }

  if (tier === "plus" && isPlusDeadlinePassed) {
    const autoUpgradeNote = isInPlusAutoUpgradeWindow
      ? `\n\n⚡ 自动升级窗口已开始：Shopify 正在将 Plus 商家自动迁移到新版页面（${autoUpgradeStartLabel}起，Shopify 会提前30天通知，日期来自 Shopify 官方公告，请以 Admin 提示为准）。`
      : `\n\n📅 ${autoUpgradeStartLabel}起（Shopify 会提前30天通知，日期来自 Shopify 官方公告，请以 Admin 提示为准），Shopify 将开始自动迁移 Plus 商家到新版页面。`;

    return {
      isUpgraded: false,
      urgency: "critical",
      title: "🚨 Plus 商家：Additional Scripts 已进入只读模式",
      titleKey: "deprecation.upgradeStatus.critical.title",
      message:
        `您的店铺尚未升级到新版页面。Plus 商家的 Additional Scripts 已于 ${plusDeadlineLabel}（日期来自 Shopify 官方公告，请以 Admin 提示为准）进入只读模式。` +
        "Shopify 可能随时将您的页面迁移到新版本。" +
        autoUpgradeNote,
      messageKey: "deprecation.upgradeStatus.critical.message",
      messageParams: { date: plusDeadlineLabel },
      actions: [
        "立即配置 Web Pixel 以确保追踪不中断",
        "检查 Web Pixel 配置是否正确",
        "考虑主动升级到新版页面以获得更好的控制",
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
      title: "截止日期已过 - 请立即迁移",
      titleKey: "deprecation.upgradeStatus.expired.title",
      message: `Additional Scripts 已于 ${deadlineLabel}（日期来自 Shopify 官方公告，请以 Admin 提示为准）进入只读模式。请尽快完成迁移以避免追踪中断。`,
      messageKey: "deprecation.upgradeStatus.expired.message",
      messageParams: { date: deadlineLabel },
      actions: ["立即配置 Web Pixel", "验证追踪是否正常工作"],
      actionsKeys: [
        { key: "deprecation.upgradeStatus.expired.action.configure" },
        { key: "deprecation.upgradeStatus.expired.action.verify" },
      ],
    };
  }

  if (daysRemaining <= 30) {
    return {
      isUpgraded: false,
      urgency: "high",
      title: `紧急：剩余 ${daysRemaining} 天`,
      titleKey: "deprecation.upgradeStatus.high.title",
      titleParams: { days: daysRemaining },
      message: `您的店铺尚未升级到新版页面。Additional Scripts 将于 ${deadlineLabel}（日期来自 Shopify 官方公告，请以 Admin 提示为准）进入只读模式（剩余 ${daysRemaining} 天）。`,
      messageKey: "deprecation.upgradeStatus.high.message",
      messageParams: { date: deadlineLabel, days: daysRemaining },
      actions: ["尽快完成 Web Pixel 配置", "测试迁移后的追踪功能"],
      actionsKeys: [
        { key: "deprecation.upgradeStatus.high.action.configure" },
        { key: "deprecation.upgradeStatus.high.action.test" },
      ],
    };
  }

  if (daysRemaining <= 90) {
    return {
      isUpgraded: false,
      urgency: "medium",
      title: `请规划迁移：剩余 ${daysRemaining} 天`,
      titleKey: "deprecation.upgradeStatus.medium.title",
      titleParams: { days: daysRemaining },
      message: `您的店铺尚未升级到新版页面。建议在截止日期前完成迁移。`,
      messageKey: "deprecation.upgradeStatus.medium.message",
      actions: ["规划迁移时间表", "在设置页面配置 Web Pixel"],
      actionsKeys: [
        { key: "deprecation.upgradeStatus.medium.action.plan" },
        { key: "deprecation.upgradeStatus.medium.action.configure" },
      ],
      autoUpgradeInfo:
        tier === "plus" && isInAutoUpgradeRiskWindow
          ? {
              isInAutoUpgradeWindow: false,
              autoUpgradeMessage: plusAutoUpgradeMessage,
              autoUpgradeMessageKey,
              autoUpgradeMessageParams,
            }
          : undefined,
    };
  }

  return {
    isUpgraded: false,
    urgency: "low",
    title: "建议迁移",
    titleKey: "deprecation.upgradeStatus.low.title",
    message: "您的店铺尚未升级到新版页面。虽然时间充裕，但建议提前规划迁移。",
    messageKey: "deprecation.upgradeStatus.low.message",
    autoUpgradeInfo:
      tier === "plus" && isInAutoUpgradeRiskWindow
        ? {
            isInAutoUpgradeWindow: false,
            autoUpgradeMessage: plusAutoUpgradeMessage,
            autoUpgradeMessageKey,
            autoUpgradeMessageParams,
          }
        : undefined,
    actions: ["了解 Web Pixel 和 Checkout Extensibility", "在测试店铺中预演迁移流程"],
    actionsKeys: [
      { key: "deprecation.upgradeStatus.low.action.learn" },
      { key: "deprecation.upgradeStatus.low.action.preview" },
    ],
  };
}
