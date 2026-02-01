import { Card, BlockStack, Box, InlineStack, Text, Badge, Button, Banner } from "@shopify/polaris";
import { InfoIcon, RefreshIcon, ArrowRightIcon } from "~/components/icons";
import type { MigrationAction } from "../../services/scanner/types";
import { getPlatformName } from "./utils";
import { useTranslation } from "react-i18next";

interface MigrationActionsCardProps {
  migrationActions: MigrationAction[];
  onShowScriptTagGuidance: (scriptTagId: number, platform?: string) => void;
  onDeleteWebPixel: (webPixelGid: string, platform?: string) => void;
  onUpgradePixelSettings: () => void;
  isDeleting: boolean;
  isUpgrading: boolean;
  pendingDeleteGid?: string;
  deleteFetcherData?: { success?: boolean; message?: string; error?: string };
  upgradeFetcherData?: { success?: boolean; message?: string; error?: string };
}

export function MigrationActionsCard({
  migrationActions,
  onShowScriptTagGuidance,
  onDeleteWebPixel,
  onUpgradePixelSettings,
  isDeleting,
  isUpgrading,
  pendingDeleteGid,
  deleteFetcherData,
  upgradeFetcherData,
}: MigrationActionsCardProps) {
  const { t } = useTranslation();
  if (migrationActions.length === 0) return null;
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("scan.migrationActionsCard.title")}
          </Text>
          <Badge tone="attention">{t("scan.migrationActionsCard.pending", { count: migrationActions.length })}</Badge>
        </InlineStack>
        {deleteFetcherData && (
          <Banner
            tone={deleteFetcherData.success ? "success" : "critical"}
            onDismiss={() => {}}
          >
            <Text as="p">
              {String(deleteFetcherData.message || deleteFetcherData.error || t("scan.migrationActionsCard.operationComplete"))}
            </Text>
          </Banner>
        )}
        {upgradeFetcherData && (
          <Banner
            tone={upgradeFetcherData.success ? "success" : "critical"}
            onDismiss={() => {}}
          >
            <Text as="p">
              {String(upgradeFetcherData.message || upgradeFetcherData.error || t("scan.migrationActionsCard.upgradeComplete"))}
            </Text>
          </Banner>
        )}
        <BlockStack gap="300">
          {migrationActions.map((action, index) => (
            <Box
              key={index}
              background="bg-surface-secondary"
              padding="400"
              borderRadius="200"
            >
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {action.titleKey ? t(action.titleKey, action.titleParams) : action.title}
                      </Text>
                      <Badge
                        tone={
                          action.priority === "high"
                            ? "critical"
                            : action.priority === "medium"
                            ? "warning"
                            : "info"
                        }
                      >
                        {action.priority === "high"
                          ? t("scan.migrationActionsCard.priority.high")
                          : action.priority === "medium"
                          ? t("scan.migrationActionsCard.priority.medium")
                          : t("scan.migrationActionsCard.priority.low")}
                      </Badge>
                    </InlineStack>
                    {action.platform && (
                      <Badge>{getPlatformName(action.platform, t)}</Badge>
                    )}
                  </BlockStack>
                  {action.deadline && (
                    <Badge tone="warning">{t("scan.migrationActionsCard.deadline", { date: action.deadline })}</Badge>
                  )}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {action.description}
                </Text>
                {action.estimatedTimeMinutes && (
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">
                      {t("scan.migrationActionsCard.estimatedTime", { time: action.estimatedTimeMinutes })}
                    </Badge>
                  </InlineStack>
                )}
                <InlineStack gap="200" align="end">
                  {action.type === "migrate_script_tag" && action.scriptTagId && (
                    <Button
                      size="slim"
                      icon={InfoIcon}
                      onClick={() =>
                        onShowScriptTagGuidance(action.scriptTagId!, action.platform)
                      }
                    >
                      {t("scan.migrationActionsCard.cleanGuide")}
                    </Button>
                  )}
                  {action.type === "remove_duplicate" && action.webPixelGid && (
                    <Button
                      tone="critical"
                      size="slim"
                      loading={isDeleting && pendingDeleteGid === action.webPixelGid}
                      onClick={() => onDeleteWebPixel(action.webPixelGid!, action.platform)}
                    >
                      {t("scan.migrationActionsCard.removeDuplicate")}
                    </Button>
                  )}
                  {action.type === "configure_pixel" && action.titleKey === "scan.migrationLogic.upgrade.title" && (
                    <Button
                      size="slim"
                      icon={RefreshIcon}
                      loading={isUpgrading}
                      onClick={onUpgradePixelSettings}
                    >
                      {t("scan.migrationActionsCard.upgradeConfig")}
                    </Button>
                  )}
                  {action.type === "configure_pixel" && action.titleKey !== "scan.migrationLogic.upgrade.title" && (
                    <Button size="slim" url="/app/migrate" icon={ArrowRightIcon}>
                      {t("scan.migrationActionsCard.configurePixel")}
                    </Button>
                  )}
                  {action.type === "enable_capi" && (
                    <Button size="slim" url="/app/migrate" icon={ArrowRightIcon}>
                      {t("scan.migrationActionsCard.enableAppPixel")}
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
