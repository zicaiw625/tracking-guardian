import { Banner, BlockStack, Text, List } from "@shopify/polaris";
import { AlertTriangleIcon } from "~/components/icons";
import { useTranslation } from "react-i18next";
import i18next from "i18next";

export function CheckoutExtensibilityWarning() {
  const { t } = useTranslation();
  return (
    <Banner tone="warning" icon={AlertTriangleIcon}>
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm" fontWeight="semibold">
          {t("checkoutExtWarning.title")}
        </Text>
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd">
            {t("checkoutExtWarning.intro")}
          </Text>
          <List type="bullet">
            <List.Item>
              <Text as="span" variant="bodyMd">
                <strong>{t("checkoutExtWarning.legacyScriptLabel")}</strong>{" "}
                {t("checkoutExtWarning.legacyScriptDesc")}
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodyMd">
                <strong>{t("checkoutExtWarning.triggerLocationLabel")}</strong>{" "}
                {t("checkoutExtWarning.triggerLocationDesc")}
                <br />
                <strong>{t("checkoutExtWarning.v1NoteLabel")}</strong>
                {t("checkoutExtWarning.v1NoteDesc")}
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodyMd">
                <strong>{t("checkoutExtWarning.consentLabel")}</strong>{" "}
                {t("checkoutExtWarning.consentDesc")}
              </Text>
            </List.Item>
          </List>
          <Text as="p" variant="bodySm" tone="subdued">
            💡 <strong>{t("checkoutExtWarning.v1NoteLabel")}</strong>{" "}
            {t("checkoutExtWarning.v1TipDesc")}
          </Text>
        </BlockStack>
      </BlockStack>
    </Banner>
  );
}

export function getCheckoutExtensibilityWarningText(): string {
  return i18next.t("checkoutExtWarning.fullSummaryText");
}
