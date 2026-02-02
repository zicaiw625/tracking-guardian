import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  ProgressBar,
  Icon,
  List,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ArrowRightIcon,
} from "~/components/icons";
import { useTranslation } from "react-i18next";

export interface UpgradeHealthCheckProps {
  typOspPagesEnabled: boolean;
  riskScore: number;
  estimatedMigrationTimeMinutes: number;
  scriptTagsCount: number;
  identifiedPlatforms: string[];
  onStartAudit: () => void;
  onViewDashboard: () => void;
}

export function UpgradeHealthCheck({
  typOspPagesEnabled,
  riskScore,
  estimatedMigrationTimeMinutes,
  scriptTagsCount,
  identifiedPlatforms,
  onStartAudit,
  onViewDashboard,
}: UpgradeHealthCheckProps) {
  const { t } = useTranslation();

  const getRiskLevel = (score: number): {
    level: "low" | "medium" | "high";
    label: string;
    tone: "success" | "critical" | undefined;
  } => {
    if (score >= 70) {
      return { level: "high", label: t("onboarding.upgradeHealthCheck.riskLevel.high"), tone: "critical" };
    } else if (score >= 40) {
      return { level: "medium", label: t("onboarding.upgradeHealthCheck.riskLevel.medium"), tone: undefined };
    } else {
      return { level: "low", label: t("onboarding.upgradeHealthCheck.riskLevel.low"), tone: "success" };
    }
  };
  const riskLevel = getRiskLevel(riskScore);
  const estimatedHours = Math.ceil(estimatedMigrationTimeMinutes / 60);
  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingLg">
              {t("onboarding.upgradeHealthCheck.title")}
            </Text>
            <Badge tone={riskLevel.tone} size="large">
              {riskLevel.label}
            </Badge>
          </InlineStack>
          <Text as="p" tone="subdued">
            {t("onboarding.upgradeHealthCheck.description")}
          </Text>
        </BlockStack>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            {t("onboarding.upgradeHealthCheck.upgradeStatus.title")}
          </Text>
          <Box
            background={typOspPagesEnabled ? "bg-surface-success" : "bg-surface-warning"}
            padding="400"
            borderRadius="200"
          >
            <InlineStack gap="300" blockAlign="center">
              <Icon
                source={typOspPagesEnabled ? CheckCircleIcon : AlertCircleIcon}
                tone={typOspPagesEnabled ? "success" : "warning"}
              />
              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">
                  {typOspPagesEnabled
                    ? t("onboarding.upgradeHealthCheck.upgradeStatus.upgraded")
                    : t("onboarding.upgradeHealthCheck.upgradeStatus.notUpgraded")}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {typOspPagesEnabled
                    ? t("onboarding.upgradeHealthCheck.upgradeStatus.upgradedDesc")
                    : t("onboarding.upgradeHealthCheck.upgradeStatus.notUpgradedDesc")}
                </Text>
              </BlockStack>
            </InlineStack>
          </Box>
        </BlockStack>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">
              {t("onboarding.riskScore.title")}
            </Text>
            <Text as="span" variant="headingLg" fontWeight="bold">
              {riskScore}/100
            </Text>
          </InlineStack>
          <ProgressBar
            progress={riskScore}
            tone={riskLevel.tone}
            size="large"
          />
          <Text as="p" variant="bodySm" tone="subdued">
            {riskScore >= 70
              ? t("onboarding.upgradeHealthCheck.riskScore.high")
              : riskScore >= 40
                ? t("onboarding.upgradeHealthCheck.riskScore.medium")
                : t("onboarding.upgradeHealthCheck.riskScore.low")}
          </Text>
        </BlockStack>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            {t("onboarding.upgradeHealthCheck.summary.title")}
          </Text>
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("onboarding.upgradeHealthCheck.summary.scriptTagsCount")}
                </Text>
                <Text as="span" fontWeight="semibold">
                  {t("common.countItems", { count: scriptTagsCount })}
                </Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("onboarding.upgradeHealthCheck.summary.identifiedPlatforms")}
                </Text>
                <InlineStack gap="100">
                  {identifiedPlatforms.length > 0 ? (
                    identifiedPlatforms.map((platform) => (
                      <Badge key={platform}>{platform}</Badge>
                    ))
                  ) : (
                    <Text as="span" variant="bodySm">{t("common.none")}</Text>
                  )}
                </InlineStack>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("onboarding.estimate.title")}
                </Text>
                <Text as="span" fontWeight="semibold">
                  {estimatedHours > 0
                    ? t("common.hours", { count: estimatedHours }) + " " + t("common.minutes", { count: estimatedMigrationTimeMinutes % 60 })
                    : t("common.minutes", { count: estimatedMigrationTimeMinutes })}
                </Text>
              </InlineStack>
              {estimatedMigrationTimeMinutes > 60 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("onboarding.upgradeHealthCheck.summary.tip")}
                </Text>
              )}
            </BlockStack>
          </Box>
        </BlockStack>
        <Banner tone="info" title={t("onboarding.upgradeHealthCheck.nextSteps.title")}>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              {t("onboarding.upgradeHealthCheck.nextSteps.description")}
            </Text>
            <List type="number">
              <List.Item>
                {typOspPagesEnabled
                  ? t("onboarding.upgradeHealthCheck.nextSteps.step1.upgraded")
                  : t("onboarding.upgradeHealthCheck.nextSteps.step1.notUpgraded")}
              </List.Item>
              <List.Item>{t("onboarding.upgradeHealthCheck.nextSteps.step2")}</List.Item>
              <List.Item>{t("onboarding.upgradeHealthCheck.nextSteps.step3")}</List.Item>
              <List.Item>{t("onboarding.upgradeHealthCheck.nextSteps.step4")}</List.Item>
            </List>
          </BlockStack>
        </Banner>
        <Divider />
        <InlineStack gap="200" align="end">
          <Button onClick={onViewDashboard}>{t("onboarding.upgradeHealthCheck.actions.viewDashboard")}</Button>
          <Button variant="primary" onClick={onStartAudit} icon={ArrowRightIcon}>
            {t("onboarding.upgradeHealthCheck.actions.startAudit")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
