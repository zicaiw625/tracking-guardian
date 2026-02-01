import { Banner, BlockStack, Text, Link } from "@shopify/polaris";
import { formatDeadlineDate, DEPRECATION_DATES, SHOPIFY_HELP_LINKS } from "~/utils/migration-deadlines";
import { useTranslation, Trans } from "react-i18next";

export function MigrationDeadlineBanner({ scriptTagsCount }: { scriptTagsCount: number }) {
  const { t } = useTranslation();
  const plusDeadline = formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact");
  const plusAutoUpgrade = formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month");
  const nonPlusDeadline = formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact");
  return (
    <Banner
      title={t("dashboard.migrationDeadlineBanner.title")}
      tone={scriptTagsCount > 0 ? "warning" : "info"}
      action={{
        content: t("dashboard.migrationDeadlineBanner.action"),
        url: SHOPIFY_HELP_LINKS.UPGRADE_GUIDE,
        external: true,
      }}
    >
      <BlockStack gap="300">
        <Text as="p" variant="bodySm" tone="subdued">
          <span dangerouslySetInnerHTML={{ __html: t("dashboard.migrationDeadlineBanner.disclaimer") }} />
        </Text>
        <BlockStack gap="100">
          <Text as="p">
            <Trans
              i18nKey="dashboard.migrationDeadlineBanner.plusMerchant"
              values={{ date1: plusDeadline, date2: plusAutoUpgrade }}
              components={{
                1: <Link url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE} external>Shopify Help Center</Link>,
                strong: <strong />,
              }}
            />
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Link
              url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}
              external
            >
              {t("dashboard.migrationDeadlineBanner.plusGuide")}
            </Link>
          </Text>
        </BlockStack>
        <BlockStack gap="100">
          <Text as="p">
            <Trans
              i18nKey="dashboard.migrationDeadlineBanner.nonPlusMerchant"
              values={{ date: nonPlusDeadline }}
              components={{
                1: <Link url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE} external>Shopify Help Center</Link>,
                strong: <strong />,
              }}
            />
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Link
              url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}
              external
            >
              {t("dashboard.migrationDeadlineBanner.deprecationSchedule")}
            </Link>
          </Text>
        </BlockStack>
        <Text as="p" tone="subdued">
          {t("dashboard.migrationDeadlineBanner.footer")}
        </Text>
      </BlockStack>
    </Banner>
  );
}
