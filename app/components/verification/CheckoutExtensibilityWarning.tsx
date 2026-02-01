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
            {t("verification.warning.desc")}
          </Text>
          <List type="bullet">
            <List.Item>
              <Text as="span" variant="bodyMd">
                <Trans i18nKey="verification.warning.item1" components={{ strong: <strong /> }} />
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodyMd">
                <Trans i18nKey="verification.warning.item2" components={{ strong: <strong />, br: <br /> }} />
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodyMd">
                <Trans i18nKey="verification.warning.item3" components={{ strong: <strong /> }} />
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

