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
} from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon } from "../icons";
import { DEPRECATION_DATES, SHOPIFY_HELP_LINKS } from "../../utils/migration-deadlines";
import { useTranslation, Trans } from "react-i18next";
import type { TFunction } from "i18next";

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

const getMilestonesData = (t: TFunction): Omit<CountdownMilestone, "isPassed" | "isNext">[] => [
  {
    date: DEPRECATION_DATES.scriptTagCreationBlocked,
    label: t("scanPage.countdown.milestones.creationBlocked.label"),
    description: t("scanPage.countdown.milestones.creationBlocked.desc", { link: SHOPIFY_HELP_LINKS.UPGRADE_GUIDE }),
    tier: "all",
  },
  {
    date: DEPRECATION_DATES.plusScriptTagExecutionOff,
    label: t("scanPage.countdown.milestones.plusRestriction.label"),
    description: t("scanPage.countdown.milestones.plusRestriction.desc", { link: SHOPIFY_HELP_LINKS.UPGRADE_GUIDE }),
    tier: "plus",
  },
  {
    date: DEPRECATION_DATES.plusAutoUpgradeStart,
    label: t("scanPage.countdown.milestones.plusAutoUpgrade.label"),
    description: t("scanPage.countdown.milestones.plusAutoUpgrade.desc", { link: SHOPIFY_HELP_LINKS.UPGRADE_GUIDE }),
    tier: "plus",
  },
  {
    date: DEPRECATION_DATES.nonPlusScriptTagExecutionOff,
    label: t("scanPage.countdown.milestones.nonPlusDeadline.label"),
    description: t("scanPage.countdown.milestones.nonPlusDeadline.desc", { link: SHOPIFY_HELP_LINKS.UPGRADE_GUIDE }),
    tier: "non_plus",
  },
];

function getMilestones(shopTier: ShopTier, t: TFunction, now: Date = new Date()): CountdownMilestone[] {
  const milestonesData = getMilestonesData(t);
  const applicableMilestones = milestonesData.filter(
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
  const deadline = getDeadline(shopTier);
  const daysRemaining = getDaysRemaining(deadline, now);
  const progressPercentage = getProgressPercentage(shopTier, now);
  const milestones = getMilestones(shopTier, t, now);
  const urgencyTone = getUrgencyTone(daysRemaining);
  const urgencyBg = getUrgencyBackground(daysRemaining);
  const locale = (i18n.resolvedLanguage ?? i18n.language)?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  const tierLabel =
    shopTier === "plus"
      ? t("scanPage.countdown.plus")
      : shopTier === "non_plus"
        ? t("scanPage.countdown.nonPlus")
        : t("common.unknown", "Unknown");
  const deadlineLabel = deadline.toLocaleDateString(locale, {
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
                  {t("scanPage.countdown.upgraded.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("scanPage.countdown.upgraded.desc")}
                </Text>
              </BlockStack>
            </InlineStack>
            <Badge tone="success">{t("scanPage.countdown.upgraded.ready")}</Badge>
          </InlineStack>
          {hasScriptTags && (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                {t("scanPage.countdown.upgraded.legacyScriptTag", { count: scriptTagCount })}
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
                    {t("scanPage.countdown.timer.title")}
                  </Text>
                  <Badge tone={shopTier === "plus" ? "attention" : "info"}>
                    {tierLabel}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("scanPage.countdown.timer.deadline", { date: deadlineLabel })}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  <Trans i18nKey="scanPage.countdown.timer.source" components={{ strong: <strong /> }} />
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
                    {daysRemaining <= 0 ? t("scanPage.countdown.timer.expired") : daysRemaining}
                  </Text>
                  {daysRemaining > 0 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("scanPage.countdown.timer.days")}
                    </Text>
                  )}
                </BlockStack>
              </Box>
            </InlineStack>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm">
                  {t("scanPage.countdown.timer.progress")}
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
                      {t("scanPage.countdown.timer.pendingScripts")}
                    </Text>
                    <Text as="p" variant="headingMd" fontWeight="bold" tone="critical">
                      {scriptTagCount}
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface" padding="300" borderRadius="100">
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("scanPage.countdown.timer.platforms")}
                    </Text>
                    <Text as="p" variant="headingMd" fontWeight="bold" tone="caution">
                      {platformCount}
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface" padding="300" borderRadius="100">
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("scanPage.countdown.timer.urgency")}
                    </Text>
                    <Badge tone={urgencyTone}>
                      {daysRemaining <= 0 ? t("scanPage.countdown.timer.status.expired") :
                       daysRemaining <= 30 ? t("scanPage.countdown.timer.status.critical") :
                       daysRemaining <= 90 ? t("scanPage.countdown.timer.status.warning") : t("scanPage.countdown.timer.status.normal")}
                    </Badge>
                  </BlockStack>
                </Box>
              </InlineStack>
            )}
          </BlockStack>
        </Box>
        {daysRemaining <= 30 && daysRemaining > 0 && (
          <Banner tone="critical" title={t("scanPage.countdown.banners.urgent")}>
            <BlockStack gap="200">
              <Text as="p">
                {t("scanPage.countdown.banners.urgentDesc", { days: daysRemaining })}
              </Text>
              {shopTier === "plus" && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("scanPage.countdown.banners.plusTip")}
                </Text>
              )}
            </BlockStack>
          </Banner>
        )}
        {daysRemaining <= 0 && (
          <Banner tone="critical" title={t("scanPage.countdown.banners.expired")}>
            <BlockStack gap="200">
              <Text as="p">
                {shopTier === "plus"
                  ? t("scanPage.countdown.banners.expiredDescPlus")
                  : t("scanPage.countdown.banners.expiredDescNonPlus")}
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            {t("scanPage.countdown.milestonesTitle")}
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
                          <Badge tone="info" size="small">{t("scanPage.countdown.next")}</Badge>
                        )}
                        {milestone.tier !== "all" && (
                          <Badge tone={milestone.tier === "plus" ? "attention" : "info"} size="small">
                            {milestone.tier === "plus" ? t("scanPage.countdown.plus") : t("scanPage.countdown.nonPlus")}
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
                    {milestone.date.toLocaleDateString(locale, {
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
          <Button url="/app/migrate" variant="primary">
            {daysRemaining <= 30 ? t("scanPage.countdown.immediateMigration") : t("scanPage.countdown.startMigration")}
          </Button>
        </InlineStack>
        {lastCheckedAt && (
          <Text as="p" variant="bodySm" tone="subdued" alignment="end">
            {t("scanPage.countdown.lastUpdated", { date: new Date(lastCheckedAt).toLocaleString(locale) })}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
