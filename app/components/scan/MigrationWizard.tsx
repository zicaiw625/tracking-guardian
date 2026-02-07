import {
  Card,
  BlockStack,
  Box,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  List,
} from "@shopify/polaris";
import { ShareIcon, ArrowRightIcon, ClipboardIcon, ExportIcon } from "~/components/icons";
import type { MigrationAction } from "../../services/scanner/types";
import { getPlatformName } from "./utils";
import { getShopifyAdminUrl } from "../../utils/helpers";
import { useTranslation, Trans } from "react-i18next";

interface MigrationWizardProps {
  migrationActions: MigrationAction[];
  shopDomain?: string;
}

export function MigrationWizard({ migrationActions, shopDomain }: MigrationWizardProps) {
  const { t } = useTranslation();

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case "high": return t("migrationWizard.checklist.content.priority.high");
      case "medium": return t("migrationWizard.checklist.content.priority.medium");
      default: return t("migrationWizard.checklist.content.priority.low");
    }
  };

  const handleCopyChecklist = () => {
    const checklist = [
      `# ${t("migrationWizard.checklist.content.header")}`,
      `${t("migrationWizard.checklist.content.shop")}: ${shopDomain || t("migrationWizard.checklist.content.unknown")}`,
      `${t("migrationWizard.checklist.content.generatedAt")}: ${new Date().toLocaleString()}`,
      "",
      `## ${t("migrationWizard.checklist.content.pendingHeader")}`,
      ...(migrationActions?.map(
        (a, i) =>
          `${i + 1}. [${getPriorityLabel(a.priority)}] ${
            a.title
          }${a.platform ? ` (${a.platform})` : ""}`
      ) || [t("migrationWizard.checklist.noPending")]),
      "",
      `## ${t("migrationWizard.checklist.content.quickLinks")}`,
      shopDomain ? `- ${t("migrationWizard.checklist.content.pixelManagement")}: ${getShopifyAdminUrl(shopDomain, "/settings/notifications")}` : `- ${t("migrationWizard.checklist.content.pixelManagement")}: ${t("migrationWizard.checklist.content.needDomain")}`,
      `- ${t("migrationWizard.checklist.content.migrationTool")}: /app/migrate`,
    ].join("\n");
    navigator.clipboard.writeText(checklist);
  };
  const handleExportChecklist = () => {
    const checklist = [
      t("migrationWizard.checklist.content.header"),
      `${t("migrationWizard.checklist.content.shop")}: ${shopDomain || t("migrationWizard.checklist.content.unknown")}`,
      `${t("migrationWizard.checklist.content.generatedAt")}: ${new Date().toLocaleString()}`,
      "",
      `${t("migrationWizard.checklist.content.pendingHeader")}:`,
      ...(migrationActions?.map(
        (a, i) =>
          `${i + 1}. [${getPriorityLabel(a.priority)}] ${a.title}${a.platform ? ` (${a.platform})` : ""}`
      ) || [t("migrationWizard.checklist.noPending")]),
    ].join("\n");
    const blob = new Blob([checklist], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `migration-checklist-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            🧭 {t("migrationWizard.title")}
          </Text>
          <Badge tone="info">{t("migrationWizard.badge")}</Badge>
        </InlineStack>
        <Text as="p" tone="subdued">
          {t("migrationWizard.description")}
        </Text>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            📦 {t("migrationWizard.webPixel.title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("migrationWizard.webPixel.description")}
          </Text>
          <InlineStack gap="300" wrap>
            <Button
              url={shopDomain ? getShopifyAdminUrl(shopDomain, "/settings/notifications") : "#"}
              external
              icon={ShareIcon}
              disabled={!shopDomain}
            >
              {t("migrationWizard.webPixel.manage")}
            </Button>
            <Button url="/app/migrate" icon={ArrowRightIcon}>
              {t("migrationWizard.webPixel.configure")}
            </Button>
          </InlineStack>
        </BlockStack>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            📋 {t("migrationWizard.checklist.title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("migrationWizard.checklist.description")}
          </Text>
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="200">
              <Text as="p" fontWeight="semibold">
                {t("migrationWizard.checklist.pendingItems")}
              </Text>
              <List type="number">
                {migrationActions && migrationActions.length > 0 ? (
                  migrationActions.slice(0, 5).map((action, i) => (
                    <List.Item key={i}>
                      {action.title}
                      {action.platform && ` (${getPlatformName(action.platform)})`}
                      {action.priority === "high" && " ⚠️"}
                    </List.Item>
                  ))
                ) : (
                  <List.Item>{t("migrationWizard.checklist.noPending")}</List.Item>
                )}
                {migrationActions && migrationActions.length > 5 && (
                  <List.Item>{t("migrationWizard.checklist.moreItems", { count: migrationActions.length - 5 })}</List.Item>
                )}
              </List>
              <InlineStack gap="200" align="end">
                <Button icon={ClipboardIcon} onClick={handleCopyChecklist}>
                  {t("migrationWizard.checklist.copy")}
                </Button>
                <Button icon={ExportIcon} onClick={handleExportChecklist}>
                  {t("migrationWizard.checklist.export")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Box>
        </BlockStack>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            🔄 {t("migrationWizard.alternatives.title")}
          </Text>
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="300">
              <InlineStack gap="400" wrap>
                <Box minWidth="200px">
                  <BlockStack gap="100">
                    <Badge tone="success">{t("migrationWizard.alternatives.official.badge")}</Badge>
                    <Text as="p" variant="bodySm">
                      <Trans i18nKey="migrationWizard.alternatives.official.text" components={{ br: <br /> }} />
                    </Text>
                  </BlockStack>
                </Box>
                <Box minWidth="200px">
                  <BlockStack gap="100">
                    <Badge tone="info">{t("migrationWizard.alternatives.webPixel.badge")}</Badge>
                    <Text as="p" variant="bodySm">
                      <Trans i18nKey="migrationWizard.alternatives.webPixel.text" components={{ br: <br /> }} />
                    </Text>
                  </BlockStack>
                </Box>
                <Box minWidth="200px">
                  <BlockStack gap="100">
                    <Badge tone="warning">{t("migrationWizard.alternatives.uiExtension.badge")}</Badge>
                    <Text as="p" variant="bodySm">
                      <Trans i18nKey="migrationWizard.alternatives.uiExtension.text" components={{ br: <br /> }} />
                    </Text>
                  </BlockStack>
                </Box>
              </InlineStack>
            </BlockStack>
          </Box>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
