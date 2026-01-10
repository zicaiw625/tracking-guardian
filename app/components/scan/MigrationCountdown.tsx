import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Box,
  ProgressBar,
  Icon,
  Divider,
  Banner,
  Tooltip,
} from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, ClockIcon } from "../icons";
import { DEPRECATION_DATES, SHOPIFY_HELP_LINKS } from "../../utils/migration-deadlines";

export type ShopTier = "plus" | "non_plus" | "unknown";

export interface CountdownMilestone {
  date: Date;
  label: string;
  description: string;
  isPassed: boolean;
  isNext: boolean;
  tier: "all" | "plus" | "non_plus";
}

export interface MigrationCountdownProps {
  shopTier: ShopTier;
  isUpgraded: boolean | null;
  hasScriptTags: boolean;
  scriptTagCount?: number;
  platformCount?: number;
  lastCheckedAt?: Date | null;
}

const MILESTONES: Omit<CountdownMilestone, "isPassed" | "isNext">[] = [
  {
    date: DEPRECATION_DATES.scriptTagCreationBlocked,
    label: "ScriptTag 创建禁止",
    description: `无法在 TYP/OSP 页面创建新的 ScriptTag（参考 ${SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}）`,
    tier: "all",
  },
  {
    date: DEPRECATION_DATES.plusScriptTagExecutionOff,
    label: "Plus 限制开始",
    description: `Plus 商家开始受到升级限制（参考 ${SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}）`,
    tier: "plus",
  },
  {
    date: DEPRECATION_DATES.plusAutoUpgradeStart,
    label: "Plus 自动升级开始",
    description: `Shopify 开始自动升级 Plus 商家页面，legacy 定制会丢失（参考 ${SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}）`,
    tier: "plus",
  },
  {
    date: DEPRECATION_DATES.nonPlusScriptTagExecutionOff,
    label: "非 Plus 截止日期",
    description: `所有非 Plus 商家的旧版追踪功能完全停止（参考 ${SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}）`,
    tier: "non_plus",
  },
];

function getMilestones(shopTier: ShopTier, now: Date = new Date()): CountdownMilestone[] {
  const applicableMilestones = MILESTONES.filter(
    (m) => m.tier === "all" || m.tier === shopTier || shopTier === "unknown"
  );
  let foundNext = false;
  return applicableMilestones.map((m) => {
    const isPassed = now >= m.date;
    const isNext = !isPassed && !foundNext;
    if (isNext) foundNext = true;
    return { ...m, isPassed, isNext };
  });
}

function getDeadline(shopTier: ShopTier): Date {
  switch (shopTier) {
    case "plus":
      return DEPRECATION_DATES.plusAutoUpgradeStart;
    case "non_plus":
      return DEPRECATION_DATES.nonPlusScriptTagExecutionOff;
    default:
      return DEPRECATION_DATES.nonPlusScriptTagExecutionOff;
  }
}

function getDaysRemaining(deadline: Date, now: Date = new Date()): number {
  const diff = deadline.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getProgressPercentage(shopTier: ShopTier, now: Date = new Date()): number {
  const startDate = new Date("2024-09-01");
  const deadline = getDeadline(shopTier);
  const total = deadline.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

function getUrgencyTone(daysRemaining: number): "critical" | "warning" | "attention" | "success" {
  if (daysRemaining <= 0) return "critical";
  if (daysRemaining <= 30) return "critical";
  if (daysRemaining <= 90) return "warning";
  if (daysRemaining <= 180) return "attention";
  return "success";
}

function getUrgencyBackground(daysRemaining: number): "bg-fill-critical" | "bg-fill-caution" {
  if (daysRemaining <= 0) return "bg-fill-critical";
  if (daysRemaining <= 30) return "bg-fill-critical";
  if (daysRemaining <= 90) return "bg-fill-caution";
  return "bg-fill-caution";
}

export function MigrationCountdown({
  shopTier,
  isUpgraded,
  hasScriptTags,
  scriptTagCount = 0,
  platformCount = 0,
  lastCheckedAt,
}: MigrationCountdownProps) {
  const now = new Date();
  const deadline = getDeadline(shopTier);
  const daysRemaining = getDaysRemaining(deadline, now);
  const progressPercentage = getProgressPercentage(shopTier, now);
  const milestones = getMilestones(shopTier, now);
  const urgencyTone = getUrgencyTone(daysRemaining);
  const urgencyBg = getUrgencyBackground(daysRemaining);
  const tierLabel = shopTier === "plus" ? "Shopify Plus" : shopTier === "non_plus" ? "标准版" : "未知";
  const deadlineLabel = deadline.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  if (isUpgraded === true) {
    return (
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Box
                background="bg-fill-success"
                padding="200"
                borderRadius="full"
              >
                <Icon source={CheckCircleIcon} tone="success" />
              </Box>
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">
                  ✅ 迁移已完成
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  您的店铺已升级到新版 Thank you / Order status 页面
                </Text>
              </BlockStack>
            </InlineStack>
            <Badge tone="success">已就绪</Badge>
          </InlineStack>
          {hasScriptTags && (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                检测到 {scriptTagCount} 个旧版 ScriptTag。这些脚本已不再执行，建议清理以保持配置整洁。
              </Text>
            </Banner>
          )}
        </BlockStack>
      </Card>
    );
  }
  return (
    <Card>
      <BlockStack gap="500">
        <Box
          background={urgencyBg}
          padding="600"
          borderRadius="300"
        >
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="start" wrap={false}>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    ⏰ 迁移倒计时
                  </Text>
                  <Badge tone={shopTier === "plus" ? "attention" : "info"}>
                    {tierLabel}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  截止日期：{deadlineLabel}
                </Text>
              </BlockStack>
              <Box
                background="bg-surface"
                padding="400"
                borderRadius="200"
                minWidth="120px"
              >
                <BlockStack gap="100" inlineAlign="center">
                  <Text
                    as="p"
                    variant="heading2xl"
                    fontWeight="bold"
                    alignment="center"
                  >
                    {daysRemaining <= 0 ? "已过期" : daysRemaining}
                  </Text>
                  {daysRemaining > 0 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      天
                    </Text>
                  )}
                </BlockStack>
              </Box>
            </InlineStack>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm">
                  时间进度
                </Text>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {progressPercentage.toFixed(0)}%
                </Text>
              </InlineStack>
              <ProgressBar
                progress={progressPercentage}
                tone={daysRemaining <= 30 ? "critical" : daysRemaining <= 90 ? "highlight" : "primary"}
                size="small"
              />
            </BlockStack>
            {hasScriptTags && (
              <InlineStack gap="400" align="start" wrap>
                <Box background="bg-surface" padding="300" borderRadius="100">
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">
                      待迁移 ScriptTag
                    </Text>
                    <Text as="p" variant="headingMd" fontWeight="bold" tone="critical">
                      {scriptTagCount}
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface" padding="300" borderRadius="100">
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">
                      涉及平台
                    </Text>
                    <Text as="p" variant="headingMd" fontWeight="bold" tone="caution">
                      {platformCount}
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface" padding="300" borderRadius="100">
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">
                      紧急程度
                    </Text>
                    <Badge tone={urgencyTone}>
                      {daysRemaining <= 0 ? "已过期" :
                       daysRemaining <= 30 ? "紧急" :
                       daysRemaining <= 90 ? "警告" : "正常"}
                    </Badge>
                  </BlockStack>
                </Box>
              </InlineStack>
            )}
          </BlockStack>
        </Box>
        {daysRemaining <= 30 && daysRemaining > 0 && (
          <Banner tone="critical" title="⚠️ 紧急迁移提醒">
            <BlockStack gap="200">
              <Text as="p">
                距离截止日期仅剩 {daysRemaining} 天！请立即开始迁移以避免追踪中断。
              </Text>
              {shopTier === "plus" && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Plus 商家提示：2026年1月起，Shopify 将开始自动升级未迁移的店铺，届时旧版脚本将被清除。
                </Text>
              )}
            </BlockStack>
          </Banner>
        )}
        {daysRemaining <= 0 && (
          <Banner tone="critical" title="🚨 截止日期已过">
            <BlockStack gap="200">
              <Text as="p">
                {shopTier === "plus"
                  ? "Plus 商家的 ScriptTag 和 Additional Scripts 已停止执行。请立即完成迁移！"
                  : "迁移截止日期已过。请尽快完成迁移以恢复追踪功能。"}
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            📅 关键里程碑
          </Text>
          <BlockStack gap="200">
            {milestones.map((milestone, index) => (
              <Box
                key={index}
                background={milestone.isNext ? "bg-surface-selected" : "bg-surface-secondary"}
                padding="300"
                borderRadius="200"
                borderWidth={milestone.isNext ? "025" : "0"}
                borderColor="border-info"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300" blockAlign="center">
                    <Box
                      background={milestone.isPassed ? "bg-fill-success" : milestone.isNext ? "bg-fill-info" : "bg-surface"}
                      padding="100"
                      borderRadius="full"
                    >
                      {milestone.isPassed ? (
                        <Icon source={CheckCircleIcon} tone="textSuccess" />
                      ) : milestone.isNext ? (
                        <Icon source={ClockIcon} tone="info" />
                      ) : (
                        <Icon source={ClockIcon} tone="subdued" />
                      )}
                    </Box>
                    <BlockStack gap="050">
                      <InlineStack gap="200">
                        <Text
                          as="span"
                          variant="bodySm"
                          fontWeight={milestone.isNext ? "bold" : "regular"}
                        >
                          {milestone.label}
                        </Text>
                        {milestone.isNext && (
                          <Badge tone="info" size="small">下一个</Badge>
                        )}
                        {milestone.tier !== "all" && (
                          <Badge tone={milestone.tier === "plus" ? "attention" : "info"} size="small">
                            {milestone.tier === "plus" ? "Plus" : "非 Plus"}
                          </Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {milestone.description}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Text
                    as="span"
                    variant="bodySm"
                    fontWeight={milestone.isNext ? "bold" : "regular"}
                    tone={milestone.isPassed ? "subdued" : undefined}
                  >
                    {milestone.date.toLocaleDateString("zh-CN", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </Text>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        </BlockStack>
        <Divider />
        <InlineStack align="end" gap="200">
          <Button url="/app/diagnostics" variant="tertiary">
            查看诊断
          </Button>
          <Button url="/app/migrate" variant="primary">
            {daysRemaining <= 30 ? "🚀 立即迁移" : "开始迁移"}
          </Button>
        </InlineStack>
        {lastCheckedAt && (
          <Text as="p" variant="bodySm" tone="subdued" alignment="end">
            状态更新时间：{new Date(lastCheckedAt).toLocaleString("zh-CN")}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
