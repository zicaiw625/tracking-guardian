import { Banner, BlockStack, Text, List } from "@shopify/polaris";
import { AlertTriangleIcon } from "~/components/icons";
import { useTranslation, Trans } from "react-i18next";

export function CheckoutExtensibilityWarning() {
  const { t } = useTranslation();
  return (
    <Banner tone="warning" icon={AlertTriangleIcon}>
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm" fontWeight="semibold">
          {t("verification.warning.title")}
        </Text>
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd">
            {t("verification.warning.subtitle")}
          </Text>
          <List type="bullet">
            <List.Item>
              <Text as="span" variant="bodyMd">
                <Trans i18nKey="verification.warning.items.timeline" components={{ strong: <strong /> }} />
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodyMd">
                <Trans i18nKey="verification.warning.items.location" components={{ strong: <strong />, br: <br /> }} />
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodyMd">
                <Trans i18nKey="verification.warning.items.consent" components={{ strong: <strong /> }} />
              </Text>
            </List.Item>
          </List>
          <Text as="p" variant="bodySm" tone="subdued">
            <Trans i18nKey="verification.warning.note" components={{ strong: <strong /> }} />
          </Text>
        </BlockStack>
      </BlockStack>
    </Banner>
  );
}

export function getCheckoutExtensibilityWarningText(t: (key: string) => string): string {
  return `
${t("verification.warning.title")}
1. ${t("verification.warning.items.timeline").replace(/<\/?strong>/g, "")}
2. ${t("verification.warning.items.location").replace(/<\/?strong>/g, "").replace(/<br \/>/g, "\n")}
3. ${t("verification.warning.items.consent").replace(/<\/?strong>/g, "")}
${t("verification.warning.note").replace(/<\/?strong>/g, "")}
  `.trim();
}
