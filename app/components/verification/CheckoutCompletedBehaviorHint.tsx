import { Banner, BlockStack, Text, List, Collapsible } from "@shopify/polaris";
import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { AlertCircleIcon, InfoIcon } from "~/components/icons";

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
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(!collapsible);
  const tone = mode === "missing" ? "warning" : mode === "drop" ? "critical" : "info";
  const icon = mode === "missing" || mode === "drop" ? AlertCircleIcon : InfoIcon;
  const defaultTitle = mode === "missing"
    ? t("verification.hint.titles.missing")
    : mode === "drop"
    ? t("verification.hint.titles.drop")
    : t("verification.hint.titles.info");
  const displayTitle = title || defaultTitle;
  const content = (
    <BlockStack gap="200">
      <Text as="p" variant="bodySm">
        <Trans i18nKey="verification.hint.intro" components={{ strong: <strong /> }} />
      </Text>
      <List type="bullet">
        <List.Item>
          <Text as="span" variant="bodySm">
            <Trans i18nKey="verification.hint.items.upsell" components={{ strong: <strong /> }} />
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm">
            <Trans i18nKey="verification.hint.items.pageLoad" components={{ strong: <strong /> }} />
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm">
            <Trans i18nKey="verification.hint.items.consent" components={{ strong: <strong /> }} />
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm">
            <Trans i18nKey="verification.hint.items.shopPay" components={{ strong: <strong /> }} />
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm">
            <Trans i18nKey="verification.hint.items.pcd" components={{ strong: <strong /> }} />
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm">
            <Trans i18nKey="verification.hint.items.fullFunnel" components={{ strong: <strong /> }} />
          </Text>
        </List.Item>
      </List>
      <Text as="p" variant="bodySm" tone="subdued">
        <Trans i18nKey="verification.hint.troubleshooting.title" components={{ strong: <strong /> }} />
      </Text>
      <List type="bullet">
        <List.Item>
          <Text as="span" variant="bodySm" tone="subdued">
            {t("verification.hint.troubleshooting.steps.upsell")}
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm" tone="subdued">
            {t("verification.hint.troubleshooting.steps.v1")}
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm" tone="subdued">
            {t("verification.hint.troubleshooting.steps.monitoring")}
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm" tone="subdued">
            {t("verification.hint.troubleshooting.steps.pcd")}
          </Text>
        </List.Item>
      </List>
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
