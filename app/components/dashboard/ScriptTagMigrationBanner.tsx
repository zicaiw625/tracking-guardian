import { Banner, BlockStack, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export function ScriptTagMigrationBanner({
  scriptTagsCount,
  hasOrderStatusScripts,
}: {
  scriptTagsCount: number;
  hasOrderStatusScripts: boolean;
}) {
  const { t } = useTranslation();
  if (scriptTagsCount === 0) return null;
  return (
    <Banner
      title={t("dashboard.scriptTagMigrationBanner.title", { count: scriptTagsCount })}
      tone="critical"
      action={{ content: t("dashboard.scriptTagMigrationBanner.action"), url: "/app/migrate" }}
      secondaryAction={{ content: t("dashboard.scriptTagMigrationBanner.secondaryAction"), url: "/app/scan?tab=2" }}
    >
      <BlockStack gap="300">
        {hasOrderStatusScripts && (
          <Text as="p">
            <span dangerouslySetInnerHTML={{ __html: t("dashboard.scriptTagMigrationBanner.orderStatusWarning") }} />
          </Text>
        )}
        <BlockStack gap="100">
          <Text as="p" fontWeight="semibold">
            {t("dashboard.scriptTagMigrationBanner.stepsTitle")}
          </Text>
          <Text as="p" variant="bodySm">
            {t("dashboard.scriptTagMigrationBanner.step1")}
          </Text>
          <Text as="p" variant="bodySm">
            {t("dashboard.scriptTagMigrationBanner.step2")}
          </Text>
          <Text as="p" variant="bodySm">
            {t("dashboard.scriptTagMigrationBanner.step3")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("dashboard.scriptTagMigrationBanner.step3Sub")}
          </Text>
        </BlockStack>
      </BlockStack>
    </Banner>
  );
}
