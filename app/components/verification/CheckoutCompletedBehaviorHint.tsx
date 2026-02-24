import { Banner, BlockStack, Text, List, Collapsible } from "@shopify/polaris";
import { useState } from "react";
import { AlertCircleIcon, InfoIcon } from "~/components/icons";
import { useTranslation } from "react-i18next";

export interface CheckoutCompletedBehaviorHintProps {
  mode?: "missing" | "drop" | "info";
  collapsible?: boolean;
  title?: string;
}

export function CheckoutCompletedBehaviorHint({
  mode = "info",
  collapsible = true,
  title,
}: CheckoutCompletedBehaviorHintProps) {
  const [expanded, setExpanded] = useState(!collapsible);
  const { t } = useTranslation();
  const tone = mode === "missing" ? "warning" : mode === "drop" ? "critical" : "info";
  const icon = mode === "missing" || mode === "drop" ? AlertCircleIcon : InfoIcon;
  const defaultTitle = t("checkoutBehaviorHint.title");
  const displayTitle = title || defaultTitle;
  const content = (
    <BlockStack gap="200">
      <Text as="p" variant="bodySm">
        {t("checkoutBehaviorHint.subtitle")}
      </Text>
      <List type="bullet">
        <List.Item>
          <Text as="span" variant="bodySm">
            <strong>{t("checkoutBehaviorHint.upsellTitle")}</strong>{" "}
            {t("checkoutBehaviorHint.upsellDesc")}
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm">
            <strong>{t("checkoutBehaviorHint.consentTitle")}</strong>{" "}
            {t("checkoutBehaviorHint.consentDesc")}
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm">
            <strong>{t("checkoutBehaviorHint.shopPayTitle")}</strong>{" "}
            {t("checkoutBehaviorHint.shopPayDesc")}
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm">
            <strong>{t("checkoutBehaviorHint.ajaxCheckoutTitle")}</strong>{" "}
            {t("checkoutBehaviorHint.ajaxCheckoutDesc")}
          </Text>
        </List.Item>
      </List>
      <Text as="p" variant="bodySm" tone="subdued">
        {t("checkoutBehaviorHint.note")}
      </Text>
    </BlockStack>
  );
  if (!collapsible) {
    return (
      <Banner tone={tone} icon={icon} title={displayTitle}>
        {content}
      </Banner>
    );
  }
  return (
    <Banner tone={tone} icon={icon}>
      <BlockStack gap="200">
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            cursor: "pointer",
            textAlign: "left",
            background: "none",
            border: "none",
            padding: 0,
            font: "inherit",
            color: "inherit",
          }}
        >
          <Text
            as="span"
            variant="bodySm"
            fontWeight="semibold"
          >
            {displayTitle} {expanded ? "▼" : "▶"}
          </Text>
        </button>
        <Collapsible open={expanded} id="checkout-completed-hint">
          {content}
        </Collapsible>
      </BlockStack>
    </Banner>
  );
}
