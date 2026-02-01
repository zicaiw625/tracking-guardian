import { Banner, List, Text, BlockStack, Button } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export function DataConnectionBanner({
  issues,
}: {
  issues: string[];
}) {
  const { t } = useTranslation();
  if (!issues || issues.length === 0) {
    return null;
  }
  
  // Helper to translate specific issue strings if they match known patterns
  const translateIssue = (issue: string) => {
    if (issue === "MISSING_SECRET") return t("dashboard.dataConnection.issueIngestionSecret");
    if (issue === "MISSING_PIXEL") return t("dashboard.dataConnection.issueWebPixel");
    if (issue === "MISSING_KEY") return t("dashboard.dataConnection.issueIngestionKey");
    return issue;
  };

  const hasIngestionSecretIssue = issues.includes("MISSING_SECRET");
  const hasWebPixelIssue = issues.includes("MISSING_PIXEL");
  const hasIngestionKeyIssue = issues.includes("MISSING_KEY");

  if (hasIngestionSecretIssue && hasWebPixelIssue) {
    return (
      <Banner tone="warning" title={t("dashboard.dataConnection.title")}>
        <BlockStack gap="200">
          <Text as="p">
            {t("dashboard.dataConnection.msgBoth")}
          </Text>
          <Button url="/app/settings" variant="primary">
            {t("dashboard.dataConnection.actionSettings")}
          </Button>
        </BlockStack>
      </Banner>
    );
  }
  if (hasIngestionSecretIssue) {
    return (
      <Banner tone="warning" title={t("dashboard.dataConnection.title")}>
        <BlockStack gap="200">
          <Text as="p">
            {t("dashboard.dataConnection.msgSecret")}
          </Text>
          <Button url="/app/settings" variant="primary">
            {t("dashboard.dataConnection.actionSettings")}
          </Button>
        </BlockStack>
      </Banner>
    );
  }
  if (hasWebPixelIssue) {
    return (
      <Banner tone="warning" title={t("dashboard.dataConnection.title")}>
        <BlockStack gap="200">
          <Text as="p">
            {t("dashboard.dataConnection.msgPixel")}
          </Text>
          <Button url="/app/settings" variant="primary">
            {t("dashboard.dataConnection.actionInstall")}
          </Button>
        </BlockStack>
      </Banner>
    );
  }
  if (hasIngestionKeyIssue) {
    return (
      <Banner tone="warning" title={t("dashboard.dataConnection.title")}>
        <BlockStack gap="200">
          <Text as="p">
            {t("dashboard.dataConnection.msgIncomplete")}
          </Text>
          <Button url="/app/settings" variant="primary">
            {t("dashboard.dataConnection.actionFix")}
          </Button>
        </BlockStack>
      </Banner>
    );
  }

  return (
    <Banner tone="warning" title={t("dashboard.dataConnection.title")}>
      <BlockStack gap="200">
        <Text as="p">{t("dashboard.dataConnection.issues")}</Text>
        <List>
          {issues.map((issue, index) => (
            <List.Item key={index}>{translateIssue(issue)}</List.Item>
          ))}
        </List>
        <Button url="/app/settings">{t("dashboard.dataConnection.actionSettings")}</Button>
      </BlockStack>
    </Banner>
  );
}
