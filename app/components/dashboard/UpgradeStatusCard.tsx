import { Card, BlockStack, InlineStack, Text, Box, Badge, Banner, Button, SkeletonBodyText, List, Icon } from "@shopify/polaris";
import { AlertCircleIcon, ClockIcon, CheckCircleIcon } from "~/components/icons";
import { useTranslation } from "react-i18next";

export function UpgradeStatusCard({
  status,
  loading,
}: {
  status: any;
  loading: boolean;
}) {
  const { t } = useTranslation();
  
  if (loading) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {t("dashboard.upgradeStatus.title")}
          </Text>
          <Box padding="400">
            <BlockStack gap="400">
              <SkeletonBodyText lines={3} />
            </BlockStack>
          </Box>
        </BlockStack>
      </Card>
    );
  }
  if (!status) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {t("dashboard.upgradeStatus.title")}
          </Text>
          <Banner tone="info">
            <p>{t("dashboard.upgradeStatus.pendingDesc")}</p>
          </Banner>
        </BlockStack>
      </Card>
    );
  }
  const isUpgraded = status.isUpgraded;
  const deadlineDate = new Date("2025-08-13");
  const today = new Date();
  const daysRemaining = Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const isCritical = daysRemaining < 30;
  
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("dashboard.upgradeStatus.title")}
          </Text>
          <Badge tone={isUpgraded ? "success" : "critical"}>
            {isUpgraded ? t("dashboard.upgradeStatus.upgradedLabel") : t("dashboard.upgradeStatus.notUpgradedLabel")}
          </Badge>
        </InlineStack>
        <Box
          background={isUpgraded ? "bg-surface-success" : "bg-surface-critical"}
          padding="400"
          borderRadius="200"
        >
          <BlockStack gap="200">
            <InlineStack gap="200" align="start">
              <Icon source={isUpgraded ? CheckCircleIcon : AlertCircleIcon} tone={isUpgraded ? "success" : "critical"} />
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm" fontWeight="semibold">
                  {t("dashboard.upgradeStatus.extensibilityStatus")}
                </Text>
                <Text as="p" variant="bodySm">
                  {isUpgraded
                    ? t("dashboard.upgradeStatus.upgradedDesc")
                    : t("dashboard.upgradeStatus.notUpgradedDesc")}
                </Text>
              </BlockStack>
            </InlineStack>
            {!isUpgraded && (
              <Box paddingBlockStart="200">
                <BlockStack gap="200">
                  <Text as="h4" variant="bodySm" fontWeight="semibold">
                    {t("dashboard.upgradeStatus.impactTitle")}
                  </Text>
                  <List type="bullet">
                    <List.Item>{t("dashboard.upgradeStatus.impact1")}</List.Item>
                    <List.Item>{t("dashboard.upgradeStatus.impact2")}</List.Item>
                    <List.Item>{t("dashboard.upgradeStatus.impact3")}</List.Item>
                  </List>
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </Box>
        {!isUpgraded && (
          <BlockStack gap="400">
            <Box
              background={isCritical ? "bg-surface-critical" : "bg-surface-warning"}
              padding="300"
              borderRadius="200"
              borderWidth="025"
              borderColor={isCritical ? "border-critical" : "border-warning"}
            >
              <BlockStack gap="200">
                <InlineStack gap="200" align="center">
                  <Icon source={ClockIcon} tone={isCritical ? "critical" : "warning"} />
                  <Text as="h3" variant="headingSm" fontWeight="semibold">
                    {t("dashboard.upgradeStatus.deadline")}: 2025-08-13
                  </Text>
                </InlineStack>
                {daysRemaining > 0 ? (
                  <Text as="p" variant="bodySm" alignment="center">
                    {t("dashboard.upgradeStatus.remainingDays", { days: daysRemaining })} - {t("dashboard.upgradeStatus.remainingDesc")}
                  </Text>
                ) : (
                  <Text as="p" variant="bodySm" alignment="center" tone="critical" fontWeight="bold">
                    {t("dashboard.upgradeStatus.deadlinePassed")}
                  </Text>
                )}
                <Text as="p" variant="bodyXs" tone="subdued" alignment="center">
                  {t("dashboard.upgradeStatus.source")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" fontWeight="semibold">
                  {t("dashboard.upgradeStatus.autoUpgradeStart")}: 2025-08-28
                </Text>
                <Text as="p" variant="bodySm">
                  {t("dashboard.upgradeStatus.autoUpgradeDesc", { date: "2025-08-28" })}
                </Text>
              </BlockStack>
            </Box>
            <Button
              variant="primary"
              url="https://help.shopify.com/en/manual/checkout-settings/checkout-extensibility/checkout-upgrade"
              target="_blank"
              fullWidth
            >
              {t("dashboard.upgradeStatus.viewGuide")}
            </Button>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
