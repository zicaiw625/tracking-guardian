import { Banner, List, Text, BlockStack, Button } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { ConnectionIssue } from "~/types/connection-issues";

export function DataConnectionBanner({
  issues,
  onFixPixel,
}: {
  issues: ConnectionIssue[];
  onFixPixel?: () => void;
}) {
  const { t } = useTranslation();
  if (!issues || issues.length === 0) {
    return null;
  }
  
  // Helper to translate specific issue strings if they match known patterns
  const translateIssue = (issue: ConnectionIssue) => {
    if (issue === ConnectionIssue.INGESTION_SECRET_MISSING) return t("dashboard.dataConnection.issueIngestionSecret");
    if (issue === ConnectionIssue.WEB_PIXEL_NOT_INSTALLED) return t("dashboard.dataConnection.issueWebPixel");
    if (issue === ConnectionIssue.WEB_PIXEL_MISSING_INGESTION_KEY) return t("dashboard.dataConnection.issueIngestionKey");
    if (issue === ConnectionIssue.BACKEND_DIAGNOSTIC_ERRORS) return t("dashboard.dataConnection.issueBackendDiagnostics");
    if (issue === ConnectionIssue.INGESTION_KEY_ROTATION_IN_PROGRESS) return t("dashboard.dataConnection.issueRotationInProgress");
    return issue;
  };

  const hasIngestionSecretIssue = issues.includes(ConnectionIssue.INGESTION_SECRET_MISSING);
  const hasWebPixelIssue = issues.includes(ConnectionIssue.WEB_PIXEL_NOT_INSTALLED);
  const hasIngestionKeyIssue = issues.includes(ConnectionIssue.WEB_PIXEL_MISSING_INGESTION_KEY);
  const hasBackendDiagnosticIssue = issues.includes(ConnectionIssue.BACKEND_DIAGNOSTIC_ERRORS);
  const hasRotationIssue = issues.includes(ConnectionIssue.INGESTION_KEY_ROTATION_IN_PROGRESS);

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
          <Button url="/app/pixels/new" variant="primary">
            {t("dashboard.dataConnection.actionInstall")}
          </Button>
          <Text as="p" variant="bodySm" tone="subdued">
             {t("dashboard.dataConnection.scanHint")}
          </Text>
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
          {onFixPixel ? (
            <Button onClick={onFixPixel} variant="primary">
              {t("dashboard.dataConnection.actionFix")}
            </Button>
          ) : (
            <Button url="/app/scan" variant="primary">
              {t("dashboard.dataConnection.actionFix")}
            </Button>
          )}
        </BlockStack>
      </Banner>
    );
  }
  if (hasBackendDiagnosticIssue) {
    return (
      <Banner tone="warning" title={t("dashboard.dataConnection.title")}>
        <BlockStack gap="200">
          <Text as="p">
            {t("dashboard.dataConnection.msgBackendDiagnostics")}
          </Text>
          <Button url="/app/settings" variant="primary">
            {t("dashboard.dataConnection.actionSettings")}
          </Button>
        </BlockStack>
      </Banner>
    );
  }
  if (hasRotationIssue) {
    return (
      <Banner tone="info" title={t("dashboard.dataConnection.title")}>
        <BlockStack gap="200">
          <Text as="p">
            {t("dashboard.dataConnection.msgRotationInProgress")}
          </Text>
          <Button url="/app/settings" variant="primary">
            {t("dashboard.dataConnection.actionSettings")}
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
