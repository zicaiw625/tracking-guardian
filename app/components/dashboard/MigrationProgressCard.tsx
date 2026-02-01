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
            {t("dashboard.migrationProgress.title")}
          </Text>
          <EnhancedEmptyState
            icon="📊"
            title={t("dashboard.migrationProgress.emptyTitle")}
            description={t("dashboard.migrationProgress.emptyDescription")}
            primaryAction={{
              content: t("dashboard.migrationProgress.startAudit"),
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
            {t("dashboard.migrationProgress.title")}
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
              {t("dashboard.migrationProgress.detailedProgress")}
            </Text>
            <BlockStack gap="200">
              {migrationProgress.auditCompletion && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">{t("dashboard.migrationProgress.auditCompletion")}</Text>
                  <Badge tone={migrationProgress.auditCompletion.completed ? "success" : migrationProgress.auditCompletion.status === "in_progress" ? "info" : undefined}>
                    {migrationProgress.auditCompletion.completed ? t("dashboard.migrationProgress.status.completed") : migrationProgress.auditCompletion.status === "in_progress" ? t("dashboard.migrationProgress.status.inProgress") : t("dashboard.migrationProgress.status.pending")}
                  </Badge>
                </InlineStack>
              )}
              {migrationProgress.pixelsStatus && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">{t("dashboard.migrationProgress.pixelsStatus")}</Text>
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
                  <Text as="span" variant="bodySm">{t("dashboard.migrationProgress.modulesEnabled")}</Text>
                  <Badge tone={migrationProgress.modulesEnabled > 0 ? "success" : undefined}>
                    {`${migrationProgress.modulesEnabled} ${t("dashboard.quickStats.unit")}`}
                  </Badge>
                </InlineStack>
              )}
              {migrationProgress.verificationLatest && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">{t("dashboard.migrationProgress.verificationLatest")}</Text>
                  <Badge tone={migrationProgress.verificationLatest.status === "completed" ? "success" : migrationProgress.verificationLatest.status === "running" ? "info" : undefined}>
                    {migrationProgress.verificationLatest.status === "completed" ? t("dashboard.migrationProgress.status.completed") : migrationProgress.verificationLatest.status === "running" ? t("dashboard.migrationProgress.status.running") : migrationProgress.verificationLatest.status === "pending" ? t("dashboard.migrationProgress.status.pending") : t("dashboard.migrationProgress.status.noRecord")}
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
                  {/* Assuming stage labels are already translated or handled elsewhere, but if not we might need to translate them too. 
                      However, stage.label comes from the prop. I'll leave it for now as it might be dynamic. 
                      Actually, looking at types, stage label is string. 
                      If it comes from backend or constants, it might need translation.
                      I'll check where migrationProgress comes from later. */}
                  {stage.label}
                </Text>
                {isCurrent && (
                  <Badge tone="info">{t("dashboard.migrationProgress.status.inProgress")}</Badge>
                )}
              </InlineStack>
            );
          })}
        </BlockStack>
        {migrationProgress.progressPercentage < 100 && (
          <Button url="/app/scan" variant="primary">
            {migrationProgress.currentStage === "audit" ? t("dashboard.migrationProgress.startAudit") : t("dashboard.migrationProgress.continueMigration")}
          </Button>
        )}
      </BlockStack>
    </Card>
  );
});
