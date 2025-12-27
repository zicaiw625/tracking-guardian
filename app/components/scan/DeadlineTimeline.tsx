import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Tooltip,
} from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon, AlertCircleIcon } from "../icons";

export type TimelineTier = "plus" | "non_plus" | "unknown";

export interface TimelineEvent {
  id: string;
  date: Date;
  title: string;
  description: string;
  affectedTiers: TimelineTier[];
  type: "warning" | "deadline" | "auto_action" | "info";
  isCritical?: boolean;
}

export interface DeadlineTimelineProps {
  shopTier: TimelineTier;
  showCurrentTime?: boolean;
  compact?: boolean;
}

const TIMELINE_EVENTS: TimelineEvent[] = [
  {
    id: "scripttag-creation-blocked",
    date: new Date("2025-02-01"),
    title: "ScriptTag 创建受限",
    description: "无法在 Thank you / Order status 页面创建新的 ScriptTag",
    affectedTiers: ["plus", "non_plus", "unknown"],
    type: "warning",
  },
  {
    id: "plus-scripts-readonly",
    date: new Date("2025-08-28"),
    title: "Plus 商家截止日期",
    description: "ScriptTag 和 Additional Scripts 停止执行，进入只读模式",
    affectedTiers: ["plus"],
    type: "deadline",
    isCritical: true,
  },
  {
    id: "plus-auto-upgrade-start",
    date: new Date("2026-01-01"),
    title: "Plus 自动升级开始",
    description: "Shopify 开始自动升级 Plus 商家到新版 TYP/OSP 页面",
    affectedTiers: ["plus"],
    type: "auto_action",
  },
  {
    id: "non-plus-deadline",
    date: new Date("2026-08-26"),
    title: "非 Plus 商家截止日期",
    description: "所有商家的 ScriptTag 和 Additional Scripts 完全停止执行",
    affectedTiers: ["non_plus", "unknown"],
    type: "deadline",
    isCritical: true,
  },
];

function getEventIcon(event: TimelineEvent, isPassed: boolean) {
  if (isPassed) {
    return CheckCircleIcon;
  }
  if (event.type === "deadline") {
    return AlertCircleIcon;
  }
  return ClockIcon;
}

function getEventTone(event: TimelineEvent, isPassed: boolean): "success" | "critical" | "warning" | "subdued" | "info" {
  if (isPassed) return "subdued";
  if (event.type === "deadline") return "critical";
  if (event.type === "warning") return "warning";
  if (event.type === "auto_action") return "info";
  return "subdued";
}

function getDaysUntil(date: Date, now: Date = new Date()): number {
  const diff = date.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function DeadlineTimeline({
  shopTier,
  showCurrentTime = true,
  compact = false,
}: DeadlineTimelineProps) {
  const now = new Date();
  const relevantEvents = TIMELINE_EVENTS.filter(
    (event) =>
      event.affectedTiers.includes(shopTier) ||
      event.affectedTiers.includes("unknown")
  ).sort((a, b) => a.date.getTime() - b.date.getTime());
  const nextEvent = relevantEvents.find((event) => event.date > now);
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            📆 迁移时间线
          </Text>
          <Badge tone={shopTier === "plus" ? "attention" : "info"}>
            {shopTier === "plus" ? "Shopify Plus" : shopTier === "non_plus" ? "标准版" : "检测中"}
          </Badge>
        </InlineStack>
        {           }
        <Box
          background="bg-surface-secondary"
          padding="400"
          borderRadius="200"
        >
          <BlockStack gap="000">
            {relevantEvents.map((event, index) => {
              const isPassed = event.date <= now;
              const isNext = event === nextEvent;
              const daysUntil = getDaysUntil(event.date, now);
              const IconComponent = getEventIcon(event, isPassed);
              const tone = getEventTone(event, isPassed);
              const isLast = index === relevantEvents.length - 1;
              return (
                <Box key={event.id} paddingBlockEnd={isLast ? "0" : "400"}>
                  <InlineStack gap="300" blockAlignment="start" wrap={false}>
                    {               }
                    <Box minWidth="24px">
                      <BlockStack gap="000" inlineAlign="center">
                        {          }
                        <Tooltip content={isPassed ? "已过" : `距今 ${Math.abs(daysUntil)} 天`}>
                          <Box
                            background={
                              isPassed
                                ? "bg-fill-success"
                                : isNext
                                  ? event.type === "deadline"
                                    ? "bg-fill-critical"
                                    : "bg-fill-warning"
                                  : "bg-surface"
                            }
                            padding="100"
                            borderRadius="full"
                            borderWidth="025"
                            borderColor={isNext ? "border-critical" : "border"}
                          >
                            <Box minWidth="16px" minHeight="16px">
                              {}
                              <svg
                                viewBox="0 0 20 20"
                                width="16"
                                height="16"
                                fill={
                                  isPassed
                                    ? "var(--p-color-icon-success)"
                                    : isNext && event.type === "deadline"
                                      ? "var(--p-color-icon-critical)"
                                      : "var(--p-color-icon-subdued)"
                                }
                              >
                                {isPassed ? (

                                  <path d="M8.53 14.53a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l2.47 2.47 5.47-5.47a.75.75 0 0 1 1.06 1.06l-6 6Z" />
                                ) : (

                                  <path d="M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-.75 3.25a.75.75 0 0 1 1.5 0v3.69l2.28 2.28a.75.75 0 1 1-1.06 1.06l-2.5-2.5a.75.75 0 0 1-.22-.53v-4z" />
                                )}
                              </svg>
                            </Box>
                          </Box>
                        </Tooltip>
                        {}
                        {!isLast && (
                          <Box
                            background={isPassed ? "bg-fill-success" : "bg-fill-disabled"}
                            minHeight="40px"
                            minWidth="2px"
                          />
                        )}
                      </BlockStack>
                    </Box>
                    {}
                    <Box paddingBlockStart="0" minWidth="0">
                      <BlockStack gap={compact ? "050" : "100"}>
                        <InlineStack gap="200" blockAlignment="center" wrap>
                          <Text
                            as="span"
                            variant={compact ? "bodySm" : "bodyMd"}
                            fontWeight={isNext ? "bold" : "regular"}
                            tone={isPassed ? "subdued" : undefined}
                          >
                            {event.title}
                          </Text>
                          {isNext && (
                            <Badge tone={event.type === "deadline" ? "critical" : "warning"} size="small">
                              {daysUntil <= 0 ? "今天" : `${daysUntil} 天后`}
                            </Badge>
                          )}
                          {isPassed && (
                            <Badge tone="success" size="small">已过</Badge>
                          )}
                          {event.isCritical && !isPassed && (
                            <Badge tone="critical" size="small">关键</Badge>
                          )}
                        </InlineStack>
                        {!compact && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {event.description}
                          </Text>
                        )}
                        <Text
                          as="span"
                          variant="bodySm"
                          tone="subdued"
                        >
                          {event.date.toLocaleDateString("zh-CN", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })}
                        </Text>
                      </BlockStack>
                    </Box>
                  </InlineStack>
                </Box>
              );
            })}
          </BlockStack>
        </Box>
        {}
        {showCurrentTime && (
          <Text as="p" variant="bodySm" tone="subdued" alignment="end">
            当前时间：{now.toLocaleDateString("zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

export function CompactDeadlineTimeline({ shopTier }: { shopTier: TimelineTier }) {
  return <DeadlineTimeline shopTier={shopTier} compact showCurrentTime={false} />;
}
