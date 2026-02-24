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
  Link,
} from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon } from "../icons";
import { DEPRECATION_DATES, SHOPIFY_HELP_LINKS } from "../../utils/migration-deadlines";
import { useTranslation, Trans } from "react-i18next";

export type ShopTier = "plus" | "non_plus" | "unknown";

export interface CountdownMilestone {
  date: Date;
  labelKey: string;
  descriptionKey: string;
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

const MILESTONES_DATA = [
  {
    date: DEPRECATION_DATES.scriptTagCreationBlocked,
    labelKey: "migrationCountdown.milestones.scriptTagBlocked.label",
    descriptionKey: "migrationCountdown.milestones.scriptTagBlocked.desc",
    tier: "all" as const,
  },
  {
    date: DEPRECATION_DATES.plusScriptTagExecutionOff,
    labelKey: "migrationCountdown.milestones.plusRestriction.label",
    descriptionKey: "migrationCountdown.milestones.plusRestriction.desc",
    tier: "plus" as const,
  },
  {
    date: DEPRECATION_DATES.plusAutoUpgradeStart,
    labelKey: "migrationCountdown.milestones.plusAutoUpgrade.label",
    descriptionKey: "migrationCountdown.milestones.plusAutoUpgrade.desc",
    tier: "plus" as const,
  },
  {
    date: DEPRECATION_DATES.nonPlusScriptTagExecutionOff,
    labelKey: "migrationCountdown.milestones.nonPlusDeadline.label",
    descriptionKey: "migrationCountdown.milestones.nonPlusDeadline.desc",
    tier: "non_plus" as const,
  },
];

function getMilestones(shopTier: ShopTier, now: Date = new Date()): CountdownMilestone[] {
  const applicableMilestones = MILESTONES_DATA.filter(
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
  const { t, i18n } = useTranslation();
  const now = new Date();
  const isEstimatedDeadline = shopTier === "plus";
  const deadline = getDeadline(shopTier);
  const daysRemaining = isEstimatedDeadline ? null : getDaysRemaining(deadline, now);
  const progressPercentage = getProgressPercentage(shopTier, now);
  const milestones = getMilestones(shopTier, now);
  const urgencyTone = daysRemaining === null ? "attention" : getUrgencyTone(daysRemaining);
  const urgencyBg = daysRemaining === null ? "bg-fill-caution" : getUrgencyBackground(daysRemaining);
  
  const tierLabel = shopTier === "plus" 
    ? t("migrationCountdown.tier.plus") 
    : shopTier === "non_plus" 
      ? t("migrationCountdown.tier.standard") 
      : t("migrationCountdown.tier.unknown");
      
  const deadlineLabel = deadline.toLocaleDateString(
    i18n.language,
    isEstimatedDeadline
      ? {
          year: "numeric",
          month: "long",
        }
      : {
          year: "numeric",
          month: "long",
          day: "numeric",
        }
  );

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
                  {t("migrationCountdown.status.completed")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("migrationCountdown.status.upgradedDesc")}
                </Text>
              </BlockStack>
            </InlineStack>
            <Badge tone="success">{t("migrationCountdown.status.ready")}</Badge>
          </InlineStack>
          {hasScriptTags && (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                {t("migrationCountdown.status.legacyScriptTagsDetected", { count: scriptTagCount })}
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
                    {t("migrationCountdown.title")}
                  </Text>
                  <Badge tone={shopTier === "plus" ? "attention" : "info"}>
                    {tierLabel}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("migrationCountdown.deadline", { date: deadlineLabel })}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  <Trans
                    i18nKey="migrationCountdown.source"
                    components={{
                      strong: <strong />,
                      1: <Link url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE} target="_blank" />,
                      3: <Link url={SHOPIFY_HELP_LINKS.CHECKOUT_EXTENSIBILITY} target="_blank" />
                    }}
                  />
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
                    {daysRemaining === null
                      ? "—"
                      : daysRemaining <= 0
                      ? t("migrationCountdown.expired")
                      : daysRemaining}
                  </Text>
                  {daysRemaining !== null && daysRemaining > 0 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("migrationCountdown.days")}
                    </Text>
                  )}
                </BlockStack>
              </Box>
            </InlineStack>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm">
                  {t("migrationCountdown.progress")}
                </Text>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {progressPercentage.toFixed(0)}%
                </Text>
              </InlineStack>
              <ProgressBar
                progress={progressPercentage}
                tone={
                  daysRemaining === null
                    ? "highlight"
                    : daysRemaining <= 30
                    ? "critical"
                    : daysRemaining <= 90
                    ? "highlight"
                    : "primary"
                }
                size="small"
              />
            </BlockStack>
            {hasScriptTags && (
              <InlineStack gap="400" align="start" wrap>
                <Box background="bg-surface" padding="300" borderRadius="100">
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("migrationCountdown.pendingScriptTags")}
                    </Text>
                    <Text as="p" variant="headingMd" fontWeight="bold" tone="critical">
                      {scriptTagCount}
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface" padding="300" borderRadius="100">
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("migrationCountdown.platformsInvolved")}
                    </Text>
                    <Text as="p" variant="headingMd" fontWeight="bold" tone="caution">
                      {platformCount}
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface" padding="300" borderRadius="100">
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("migrationCountdown.urgency")}
                    </Text>
                    <Badge tone={urgencyTone}>
                      {daysRemaining === null
                        ? t("migrationCountdown.urgencyLevels.warning")
                        : daysRemaining <= 0
                        ? t("migrationCountdown.expired")
                        : daysRemaining <= 30
                        ? t("migrationCountdown.urgencyLevels.critical")
                        : daysRemaining <= 90
                        ? t("migrationCountdown.urgencyLevels.warning")
                        : t("migrationCountdown.urgencyLevels.normal")}
                    </Badge>
                  </BlockStack>
                </Box>
              </InlineStack>
            )}
          </BlockStack>
        </Box>
        {daysRemaining !== null && daysRemaining <= 30 && daysRemaining > 0 && (
          <Banner tone="critical" title={t("migrationCountdown.banner.urgent.title")}>
            <BlockStack gap="200">
              <Text as="p">
                {t("migrationCountdown.banner.urgent.desc", { days: daysRemaining })}
              </Text>
              {shopTier === "plus" && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("migrationCountdown.banner.plusHint")}
                </Text>
              )}
            </BlockStack>
          </Banner>
        )}
        {daysRemaining !== null && daysRemaining <= 0 && (
          <Banner tone="critical" title={t("migrationCountdown.banner.expired.title")}>
            <BlockStack gap="200">
              <Text as="p">
                {shopTier === "plus"
                  ? t("migrationCountdown.banner.expired.plusDesc")
                  : t("migrationCountdown.banner.expired.nonPlusDesc")}
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            {t("migrationCountdown.milestonesTitle")}
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
                          {t(milestone.labelKey)}
                        </Text>
                        {milestone.isNext && (
                          <Badge tone="info" size="small">{t("migrationCountdown.next")}</Badge>
                        )}
                        {milestone.tier !== "all" && (
                          <Badge tone={milestone.tier === "plus" ? "attention" : "info"} size="small">
                            {milestone.tier === "plus" ? "Plus" : t("migrationCountdown.tier.standardShort")}
                          </Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        <Trans
                          i18nKey={milestone.descriptionKey}
                          components={{
                            1: <Link url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE} target="_blank" />
                          }}
                        />
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Text
                    as="span"
                    variant="bodySm"
                    fontWeight={milestone.isNext ? "bold" : "regular"}
                    tone={milestone.isPassed ? "subdued" : undefined}
                  >
                    {milestone.date.toLocaleDateString(
                      i18n.language,
                      milestone.labelKey === "migrationCountdown.milestones.plusAutoUpgrade.label"
                        ? {
                            year: "numeric",
                            month: "short",
                          }
                        : {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          }
                    )}
                  </Text>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        </BlockStack>
        <Divider />
        <InlineStack align="end" gap="200">
          <Button url="/app/migrate" variant="primary">
            {daysRemaining !== null && daysRemaining <= 30
              ? t("migrationCountdown.actions.migrateNow")
              : t("migrationCountdown.actions.startMigrate")}
          </Button>
        </InlineStack>
        {lastCheckedAt && (
          <Text as="p" variant="bodySm" tone="subdued" alignment="end">
            {t("migrationCountdown.lastUpdated", { date: new Date(lastCheckedAt).toLocaleString(i18n.language) })}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
