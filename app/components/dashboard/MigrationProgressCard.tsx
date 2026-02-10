import { memo } from "react";
import { Badge, BlockStack, Box, Button, Card, Divider, Icon, InlineStack, ProgressBar, Text } from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon } from "~/components/icons";
import { EnhancedEmptyState } from "~/components/ui";
import type { MigrationProgress } from "~/types/dashboard";
import { useTranslation } from "react-i18next";

export const MigrationProgressCard = memo(function MigrationProgressCard({
  migrationProgress,
}: {
  migrationProgress?: MigrationProgress;
}) {
  const { t } = useTranslation();

  if (!migrationProgress) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {t("dashboard.migration.title")}
          </Text>
          <EnhancedEmptyState
            icon="📊"
            title={t("dashboard.migration.empty.title")}
            description={t("dashboard.migration.empty.description")}
            primaryAction={{
              content: t("dashboard.migration.empty.action"),
              url: "/app/scan",
            }}
          />
        </BlockStack>
      </Card>
    );
  }
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("dashboard.migration.title")}
          </Text>
          <Text as="span" variant="bodyMd" tone="subdued">
            {migrationProgress.progressPercentage}%
          </Text>
        </InlineStack>
        <ProgressBar progress={migrationProgress.progressPercentage} />
        {(migrationProgress.auditCompletion || migrationProgress.pixelsStatus || migrationProgress.modulesEnabled !== undefined || migrationProgress.verificationLatest) && (
          <BlockStack gap="300">
            <Divider />
            <Text as="h3" variant="headingSm">
              {t("dashboard.migration.details")}
            </Text>
            <BlockStack gap="200">
              {migrationProgress.auditCompletion && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">{t("dashboard.migration.audit")}</Text>
                  <Badge tone={migrationProgress.auditCompletion.completed ? "success" : migrationProgress.auditCompletion.status === "in_progress" ? "info" : undefined}>
                    {migrationProgress.auditCompletion.completed 
                      ? t("dashboard.migration.status.completed") 
                      : migrationProgress.auditCompletion.status === "in_progress" 
                        ? t("dashboard.migration.status.in_progress") 
                        : t("dashboard.migration.status.pending")}
                  </Badge>
                </InlineStack>
              )}
              {migrationProgress.pixelsStatus && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">{t("dashboard.migration.pixels")}</Text>
                  <InlineStack gap="200">
                    <Badge tone={migrationProgress.pixelsStatus.test > 0 ? "warning" : undefined}>
                      {`Test: ${migrationProgress.pixelsStatus.test}`}
                    </Badge>
                    <Badge tone={migrationProgress.pixelsStatus.live > 0 ? "success" : undefined}>
                      {`Live: ${migrationProgress.pixelsStatus.live}`}
                    </Badge>
                  </InlineStack>
                </InlineStack>
              )}
              {migrationProgress.modulesEnabled !== undefined && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">{t("dashboard.migration.modules")}</Text>
                  <Badge tone={migrationProgress.modulesEnabled > 0 ? "success" : undefined}>
                    {t("dashboard.migration.count", { count: migrationProgress.modulesEnabled })}
                  </Badge>
                </InlineStack>
              )}
              {migrationProgress.verificationLatest && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">{t("dashboard.migration.verification")}</Text>
                  <Badge tone={migrationProgress.verificationLatest.status === "completed" ? "success" : migrationProgress.verificationLatest.status === "running" ? "info" : undefined}>
                    {migrationProgress.verificationLatest.status === "completed" 
                      ? t("dashboard.migration.status.completed") 
                      : migrationProgress.verificationLatest.status === "running" 
                        ? t("dashboard.migration.status.running") 
                        : migrationProgress.verificationLatest.status === "pending" 
                          ? t("dashboard.migration.status.pending") 
                          : t("dashboard.migration.status.no_record")}
                  </Badge>
                </InlineStack>
              )}
            </BlockStack>
          </BlockStack>
        )}
        <BlockStack gap="200">
          {migrationProgress.stages.map((stage) => {
            const isCompleted = stage.completed;
            const isCurrent = stage.stage === migrationProgress.currentStage;
            return (
              <InlineStack key={stage.stage} gap="300" blockAlign="center">
                {isCompleted ? (
                  <Icon source={CheckCircleIcon} tone="success" />
                ) : isCurrent || stage.inProgress ? (
                  <Icon source={ClockIcon} tone="info" />
                ) : (
                  <Box minWidth="20px" />
                )}
                <Text
                  as="span"
                  variant="bodyMd"
                  tone={isCompleted ? "success" : undefined}
                  fontWeight={isCurrent ? "semibold" : "regular"}
                >
                  {stage.label}
                </Text>
                {isCurrent && (
                  <Badge tone="info">{t("dashboard.migration.status.in_progress")}</Badge>
                )}
              </InlineStack>
            );
          })}
        </BlockStack>
        {migrationProgress.progressPercentage < 100 && (
          <Button url="/app/scan" variant="primary">
            {migrationProgress.currentStage === "audit" ? t("dashboard.migration.start") : t("dashboard.migration.continue")}
          </Button>
        )}
      </BlockStack>
    </Card>
  );
});
