import { Banner, Button, BlockStack, InlineStack, Text } from "@shopify/polaris";
import { useLocale } from "~/context/LocaleContext";

interface DataConnectionBannerProps {
  hasIngestionSecret: boolean;
  hasWebPixel: boolean;
  webPixelHasIngestionKey: boolean;
  shopDomain: string;
}

const ISSUE_SEP = { en: ", ", zh: "、" };

export function DataConnectionBanner({
  hasIngestionSecret,
  hasWebPixel,
  webPixelHasIngestionKey,
  shopDomain: _shopDomain,
}: DataConnectionBannerProps) {
  const { t, locale } = useLocale();
  const issueSep = ISSUE_SEP[locale];

  const issues: string[] = [];
  if (!hasIngestionSecret) {
    issues.push(t("dashboard.dataConnection.issueIngestion"));
  }
  if (!hasWebPixel) {
    issues.push(t("dashboard.dataConnection.issueNoPixel"));
  } else if (!webPixelHasIngestionKey) {
    issues.push(t("dashboard.dataConnection.issuePixelNoKey"));
  }

  if (issues.length === 0) {
    return null;
  }

  const getMessage = () => {
    if (!hasIngestionSecret && !hasWebPixel) {
      return t("dashboard.dataConnection.messageBoth");
    }
    if (!hasIngestionSecret) {
      return t("dashboard.dataConnection.messageNoIngestion");
    }
    if (!hasWebPixel) {
      return t("dashboard.dataConnection.messageNoPixel");
    }
    return t("dashboard.dataConnection.messagePixelNoKey");
  };

  const getActionUrl = () => {
    if (!hasIngestionSecret) {
      return "/app/settings";
    }
    if (!hasWebPixel || !webPixelHasIngestionKey) {
      return "/app/pixels";
    }
    return "/app/settings";
  };

  const getActionLabel = () => {
    if (!hasIngestionSecret) {
      return t("dashboard.dataConnection.actionSettings");
    }
    if (!hasWebPixel) {
      return t("dashboard.dataConnection.actionInstallPixel");
    }
    return t("dashboard.dataConnection.actionFixConfig");
  };

  return (
    <Banner tone="critical" title={t("dashboard.dataConnection.title")}>
      <BlockStack gap="200">
        <Text as="p">{getMessage()}</Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {t("dashboard.dataConnection.issuesLabel")}{issues.join(issueSep)}
        </Text>
        <InlineStack gap="200">
          <Button variant="primary" url={getActionUrl()}>
            {getActionLabel()}
          </Button>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
