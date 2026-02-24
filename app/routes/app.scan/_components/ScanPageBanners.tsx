import { BlockStack, Banner, Text, Button, List } from "@shopify/polaris";
import { getDateDisplayLabel, DEPRECATION_DATES } from "~/utils/deprecation-dates";
import { getUpgradeBannerTone } from "~/components/scan";
import { parseDateSafely } from "~/utils/scan-validation";
import { useTranslation, Trans } from "react-i18next";

export interface ScanPageBannersProps {
  deprecationStatus: {
    additionalScripts?: {
      badge?: {
        text: string;
        textKey?: string;
        textParams?: Record<string, any>;
      };
      description?: string;
      descriptionKey?: string;
      descriptionParams?: Record<string, any>;
    };
  } | null;
  onShowUpgradeGuide: () => void;
  scannerMaxScriptTags: number;
  scannerMaxWebPixels: number;
  currentScriptTagCount?: number;
  currentWebPixelCount?: number;
  partialRefresh: boolean;
  upgradeStatus: {
    autoUpgradeInfo?: {
      isInAutoUpgradeWindow?: boolean;
      autoUpgradeMessage?: string;
      autoUpgradeMessageKey?: string;
      autoUpgradeMessageParams?: Record<string, any>;
    };
    title?: string;
    titleKey?: string;
    titleParams?: Record<string, any>;
    message?: string;
    messageKey?: string;
    messageParams?: Record<string, any>;
    urgency?: string;
    actions?: string[];
    actionsKeys?: { key: string; params?: Record<string, any> }[];
    lastUpdated?: string | null;
    hasOfficialSignal?: boolean;
  } | null;
  planId: string | null;
  planLabel: string | null;
  planTagline: string | null;
  isGrowthOrAbove: boolean;
  isProOrAbove: boolean;
  isAgency: boolean;
}

export function ScanPageBanners({
  deprecationStatus,
  onShowUpgradeGuide,
  scannerMaxScriptTags,
  scannerMaxWebPixels,
  currentScriptTagCount = 0,
  currentWebPixelCount = 0,
  partialRefresh,
  upgradeStatus,
  planId,
  planLabel,
  planTagline,
  isGrowthOrAbove,
  isProOrAbove,
  isAgency,
}: ScanPageBannersProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || undefined;

  const resolvePlanText = (text: string | null, type: "name" | "tagline") => {
    // If planId is available, try to look up the translation directly first
    if (planId) {
      const standardKey = `subscriptionPlans.${planId}.${type}`;
      const standardTranslated = t(standardKey);
      if (standardTranslated !== standardKey) return standardTranslated;

      const legacyKey = `plans.${planId}.${type}`;
      const legacyTranslated = t(legacyKey);
      if (legacyTranslated !== legacyKey) return legacyTranslated;
    }

    if (!text) return "";
    const translated = t(text);
    // If translation found (and not just the key returned), return it
    if (translated !== text) return translated;

    return translated;
  };

  const dep = deprecationStatus;

  // Only show pagination warning if we are close to the limits (e.g. > 80%) or if partial refresh occurred
  const showPaginationWarning = partialRefresh ||
    (currentScriptTagCount > 0 && currentScriptTagCount >= scannerMaxScriptTags * 0.8) ||
    (currentWebPixelCount > 0 && currentWebPixelCount >= scannerMaxWebPixels * 0.8);

  const getTranslatedText = (
    text: string | undefined,
    key: string | undefined,
    params: Record<string, any> | undefined
  ) => {
    if (key) return t(key, params);
    return text || "";
  };

  return (
    <>
      <Banner tone="warning" title={t("scan.banners.additionalScripts.title")}>
        <BlockStack gap="200">
          <Text as="p">
            {t("scan.banners.additionalScripts.content")}
          </Text>
          {dep?.additionalScripts && (
            <Text as="p" tone="subdued">
              {t("scan.banners.additionalScripts.deadline", {
                badge: getTranslatedText(
                  dep.additionalScripts.badge?.text,
                  dep.additionalScripts.badge?.textKey,
                  dep.additionalScripts.badge?.textParams
                ),
                desc: getTranslatedText(
                  dep.additionalScripts.description,
                  dep.additionalScripts.descriptionKey,
                  dep.additionalScripts.descriptionParams
                )
              })}
            </Text>
          )}
          <Button size="slim" variant="plain" onClick={onShowUpgradeGuide}>
            {t("scan.banners.additionalScripts.guide")}
          </Button>
        </BlockStack>
      </Banner>
      {showPaginationWarning && (
        <Banner tone="info" title={t("scan.banners.pagination.title")}>
          <BlockStack gap="200">
            <Text as="p">
              {t("scan.banners.pagination.content")}
            </Text>
            <List type="bullet">
              <List.Item>{t("scan.banners.pagination.limitScriptTags", { limit: scannerMaxScriptTags.toLocaleString(locale) })}</List.Item>
              <List.Item>{t("scan.banners.pagination.limitWebPixels", { limit: scannerMaxWebPixels.toLocaleString(locale) })}</List.Item>
            </List>
            <Text as="p" tone="subdued">
              {t("scan.banners.pagination.footer")}
            </Text>
          </BlockStack>
        </Banner>
      )}
      {partialRefresh && (
        <Banner tone="warning" title={t("scan.banners.partialRefresh.title")}>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              {t("scan.banners.partialRefresh.content")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("scan.banners.partialRefresh.suggestion")}
            </Text>
          </BlockStack>
        </Banner>
      )}
      {(upgradeStatus?.autoUpgradeInfo?.autoUpgradeMessage || upgradeStatus?.autoUpgradeInfo?.autoUpgradeMessageKey) && (
        <Banner
          title={upgradeStatus.autoUpgradeInfo!.isInAutoUpgradeWindow ? t("scan.banners.autoUpgrade.windowOpen") : t("scan.banners.autoUpgrade.windowRisk")}
          tone={upgradeStatus.autoUpgradeInfo!.isInAutoUpgradeWindow ? "critical" : "warning"}
        >
          <BlockStack gap="200">
            <Text as="p">
              {getTranslatedText(
                upgradeStatus.autoUpgradeInfo!.autoUpgradeMessage,
                upgradeStatus.autoUpgradeInfo!.autoUpgradeMessageKey,
                upgradeStatus.autoUpgradeInfo!.autoUpgradeMessageParams
              )}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              <Trans
                i18nKey="scan.banners.autoUpgrade.officialPath"
                values={{
                  date1: getDateDisplayLabel(DEPRECATION_DATES.plusAdditionalScriptsReadOnly, "exact"),
                  date2: getDateDisplayLabel(DEPRECATION_DATES.plusAutoUpgradeStart, "month"),
                  date3: getDateDisplayLabel(DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly, "exact")
                }}
              />
            </Text>
          </BlockStack>
        </Banner>
      )}
      {(upgradeStatus?.title || upgradeStatus?.titleKey) && (upgradeStatus?.message || upgradeStatus?.messageKey) && (
        <Banner
          title={getTranslatedText(upgradeStatus.title, upgradeStatus.titleKey, upgradeStatus.titleParams)}
          tone={getUpgradeBannerTone(upgradeStatus.urgency ?? "info")}
        >
          <BlockStack gap="200">
            <Text as="p">
              {getTranslatedText(upgradeStatus.message, upgradeStatus.messageKey, upgradeStatus.messageParams)}
            </Text>
            {((upgradeStatus.actionsKeys && upgradeStatus.actionsKeys.length > 0) || (upgradeStatus.actions && upgradeStatus.actions.length > 0)) && (
              <BlockStack gap="100">
                {(upgradeStatus.actionsKeys && upgradeStatus.actionsKeys.length > 0
                  ? upgradeStatus.actionsKeys.map((actionKey, idx) => ({ text: t(actionKey.key, actionKey.params), idx }))
                  : upgradeStatus.actions!.map((action, idx) => ({ text: action, idx }))
                ).map(({ text, idx }) => (
                  <Text key={idx} as="p" variant="bodySm">
                    • {text}
                  </Text>
                ))}
              </BlockStack>
            )}
            {!upgradeStatus.hasOfficialSignal && (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scan.banners.upgradeStatus.pending")}
              </Text>
            )}
            {upgradeStatus.lastUpdated && parseDateSafely(upgradeStatus.lastUpdated) && (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scan.banners.upgradeStatus.lastUpdated", { date: parseDateSafely(upgradeStatus.lastUpdated)!.toLocaleString(locale) })}
              </Text>
            )}
          </BlockStack>
        </Banner>
      )}
      {planId && planLabel && (
        <Banner
          title={t("scan.banners.plan.title", { plan: resolvePlanText(planLabel, "name") })}
          tone={isGrowthOrAbove ? "info" : "warning"}
          action={{
            content: t("scan.banners.plan.action"),
            url: "/app/settings?tab=subscription",
          }}
        >
          <BlockStack gap="200">
            {planTagline && (
              <Text as="p" variant="bodySm">{resolvePlanText(planTagline, "tagline")}</Text>
            )}
            {!isGrowthOrAbove && (
              <List type="bullet">
                <List.Item><Trans i18nKey="scan.banners.plan.starter.item1" /></List.Item>
                <List.Item>{t("scan.banners.plan.starter.item2")}</List.Item>
                <List.Item><Trans i18nKey="scan.banners.plan.starter.item3" /></List.Item>
                <List.Item>{t("scan.banners.plan.starter.item4")}</List.Item>
              </List>
            )}
            {isGrowthOrAbove && !isProOrAbove && (
              <List type="bullet">
                <List.Item>{t("scan.banners.plan.growth.item1")}</List.Item>
                <List.Item>{t("scan.banners.plan.growth.item2")}</List.Item>
              </List>
            )}
            {isProOrAbove && !isAgency && (
              <List type="bullet">
                <List.Item>{t("scan.banners.plan.pro.item1")}</List.Item>
                <List.Item>{t("scan.banners.plan.pro.item2")}</List.Item>
              </List>
            )}
            {isAgency && (
              <List type="bullet">
                <List.Item>{t("scan.banners.plan.agency.item1")}</List.Item>
                <List.Item>{t("scan.banners.plan.agency.item2")}</List.Item>
              </List>
            )}
          </BlockStack>
        </Banner>
      )}
    </>
  );
}
