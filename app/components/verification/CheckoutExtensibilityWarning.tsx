import { Banner, BlockStack, Text, List } from "@shopify/polaris";
import { AlertTriangleIcon } from "~/components/icons";
import { useTranslation } from "react-i18next";
import { t as i18nT } from "i18next";

export function CheckoutExtensibilityWarning() {
  const { t } = useTranslation();
  const items = t("checkoutExtWarning.items", { returnObjects: true }) as string[];

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
            {items.map((item, index) => (
              <List.Item key={index}>
                <Text as="span" variant="bodyMd">
                  {item}
                </Text>
              </List.Item>
            ))}
          </List>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("checkoutExtWarning.recommendation")}
          </Text>
        </BlockStack>
      </BlockStack>
    </Banner>
  );
}

export function getCheckoutExtensibilityWarningText(): string {
  const intro = i18nT("checkoutExtWarning.intro");
  const items = i18nT("checkoutExtWarning.items", {
    returnObjects: true,
  }) as string[];
  const recommendation = i18nT("checkoutExtWarning.recommendation");
  return [intro, ...items, recommendation].join(" ");
}
