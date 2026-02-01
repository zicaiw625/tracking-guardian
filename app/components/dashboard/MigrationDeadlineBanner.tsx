import { Banner, BlockStack, Text, Button, InlineStack } from "@shopify/polaris";
import { Link } from "@remix-run/react";
import { useTranslation, Trans } from "react-i18next";
import { DEPRECATION_DATES, formatDeadlineDate } from "../../utils/migration-deadlines";
import { ArrowRightIcon } from "../icons";

export function MigrationDeadlineBanner() {
  const { t } = useTranslation();

  return (
    <Banner tone="warning" title={t("dashboard.migrationDeadlineBanner.title")}>
      <BlockStack gap="200">
        <BlockStack gap="100">
          <Text as="p" variant="bodySm">
            <Trans
              i18nKey="dashboard.migrationDeadlineBanner.plusDeadline"
              values={{
                date: formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact"),
              }}
              components={{
                strong: <strong />,
              }}
            />
          </Text>
          <Text as="p" variant="bodySm">
            <Trans
              i18nKey="dashboard.migrationDeadlineBanner.nonPlusDeadline"
              values={{
                date: formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact"),
              }}
              components={{
                strong: <strong />,
              }}
            />
          </Text>
        </BlockStack>
        <Text as="p" variant="bodySm" tone="subdued">
          <Trans
            i18nKey="dashboard.migrationDeadlineBanner.disclaimer"
            components={{
              strong: <strong />,
              a: (
                <Link
                  to="https://help.shopify.com/en/manual/checkout-settings/order-status-page/additional-scripts"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              ),
            }}
          >
            <strong>Important:</strong> The following dates are from Shopify official announcements for reference only. Please refer to Shopify Admin for actual deadlines. Shopify may update policies, we recommend checking <Link to="https://help.shopify.com/en/manual/checkout-settings/order-status-page/additional-scripts" target="_blank" rel="noopener noreferrer">{t("dashboard.migrationDeadlineBanner.helpCenter")}</Link> regularly.
          </Trans>
        </Text>
        <InlineStack align="start">
          <Button url="/app/migrate" variant="plain" icon={ArrowRightIcon}>
            {t("dashboard.migrationDeadlineBanner.action")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
