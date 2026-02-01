import { Card, BlockStack, InlineStack, Text, Box, Badge, Divider, Button, Icon } from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon, ArrowRightIcon } from "~/components/icons";
import { EnhancedEmptyState } from "~/components/ui";
import type { DashboardData } from "~/types/dashboard";
import { useTranslation } from "react-i18next";

export function MigrationChecklistPreviewCard({
  checklist,
  estimatedTimeMinutes: _estimatedTimeMinutes,
}: {
  checklist: DashboardData["migrationChecklist"];
  estimatedTimeMinutes?: number;
}) {
  const { t } = useTranslation();
  if (!checklist || checklist.totalItems === 0) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {t("dashboard.checklist.title")}
          </Text>
          <EnhancedEmptyState
            icon="📋"
            title={t("dashboard.checklist.emptyTitle")}
            description={t("dashboard.checklist.emptyDesc")}
            primaryAction={{
              content: t("dashboard.checklist.startScan"),
              url: "/app/scan",
            }}
          />
        </BlockStack>
      </Card>
    );
  }
  const estimatedHours = Math.floor(checklist.estimatedTotalTime / 60);
  const estimatedMinutes = checklist.estimatedTotalTime % 60;
  const timeText =
    estimatedHours > 0
      ? `${estimatedHours} h ${estimatedMinutes > 0 ? estimatedMinutes + " m" : ""}`
      : `${estimatedMinutes} m`;
  const completedItems = checklist.topItems.filter((item) => item.status === "completed").length;
  const remainingItems = checklist.totalItems - completedItems;
  const avgTimePerItem = checklist.totalItems > 0
    ? checklist.estimatedTotalTime / checklist.totalItems
    : 0;
  const remainingTime = Math.ceil(remainingItems * avgTimePerItem);
  const remainingHours = Math.floor(remainingTime / 60);
  const remainingMinutes = remainingTime % 60;
  const remainingTimeText =
    remainingHours > 0
      ? `${remainingHours} h ${remainingMinutes > 0 ? remainingMinutes + " m" : ""}`
      : `${remainingMinutes} m`;
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("dashboard.checklist.preview")}
          </Text>
          <Badge tone="info">{`${checklist.totalItems} ${t("dashboard.checklist.items")}`}</Badge>
        </InlineStack>
        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                {t("dashboard.checklist.highRisk")}
              </Text>
              <Text as="span" fontWeight="semibold" tone="critical">
                {checklist.highPriorityItems}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                {t("dashboard.checklist.mediumRisk")}
              </Text>
              <Text as="span" fontWeight="semibold">
                {checklist.mediumPriorityItems}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                {t("dashboard.checklist.lowRisk")}
              </Text>
              <Text as="span" fontWeight="semibold" tone="success">
                {checklist.lowPriorityItems}
              </Text>
            </InlineStack>
            <Divider />
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                {t("dashboard.checklist.estimatedTotalTime")}
              </Text>
              <Text as="span" fontWeight="semibold">
                {timeText}
              </Text>
            </InlineStack>
            {remainingItems > 0 && (
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("dashboard.checklist.remainingTime")}
                </Text>
                <Text as="span" fontWeight="semibold">
                  {remainingTimeText}
                </Text>
              </InlineStack>
            )}
            {completedItems > 0 && (
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("dashboard.checklist.progress")}
                </Text>
                <Text as="span" fontWeight="semibold">
                  {completedItems} / {checklist.totalItems} ({Math.round((completedItems / checklist.totalItems) * 100)}%)
                </Text>
              </InlineStack>
            )}
          </BlockStack>
        </Box>
        {checklist.topItems.length > 0 && (
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              {t("dashboard.checklist.topPriority")}
            </Text>
            <BlockStack gap="200">
              {checklist.topItems.map((item) => {
                const priorityBadgeTone =
                  item.priority >= 8 ? "critical" :
                  item.priority >= 5 ? "warning" :
                  "info";
                const estimatedTimeText = item.estimatedTime
                  ? item.estimatedTime < 60
                    ? `${item.estimatedTime} m`
                    : `${Math.floor(item.estimatedTime / 60)} h ${item.estimatedTime % 60} m`
                  : t("dashboard.checklist.unknown");
                return (
                  <Box
                    key={item.id}
                    background={item.status === "completed" ? "bg-surface-success" : "bg-surface-secondary"}
                    padding="300"
                    borderRadius="200"
                  >
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Badge
                            tone={
                              item.riskLevel === "high"
                                ? "critical"
                                : item.riskLevel === "medium"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {item.riskLevel === "high" ? t("dashboard.checklist.high") : item.riskLevel === "medium" ? t("dashboard.checklist.medium") : t("dashboard.checklist.low")}
                          </Badge>
                          {item.priority > 0 && (
                            <Badge tone={priorityBadgeTone}>
                              {t("dashboard.checklist.priority", { level: item.priority })}
                            </Badge>
                          )}
                          {item.status === "completed" && (
                            <Icon source={CheckCircleIcon} tone="success" />
                          )}
                          {item.status === "in_progress" && (
                            <Badge tone="info">{t("dashboard.checklist.inProgress")}</Badge>
                          )}
                        </InlineStack>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {item.title}
                        </Text>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            <Icon source={ClockIcon} />
                            {estimatedTimeText}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                      {item.status === "pending" && (
                        <Button
                          size="slim"
                          url={`/app/migrate?asset=${item.id.replace("checklist-", "")}`}
                        >
                          {t("dashboard.checklist.startMigration")}
                        </Button>
                      )}
                    </InlineStack>
                  </Box>
                );
              })}
            </BlockStack>
            {checklist.totalItems > checklist.topItems.length && (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("dashboard.checklist.moreItems", { count: checklist.totalItems - checklist.topItems.length })}
              </Text>
            )}
          </BlockStack>
        )}
        <Button url="/app/scan?tab=2" fullWidth icon={ArrowRightIcon}>
          {t("dashboard.checklist.viewFull")}
        </Button>
      </BlockStack>
    </Card>
  );
}
