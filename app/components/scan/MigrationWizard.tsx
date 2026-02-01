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
import { useTranslation, Trans } from "react-i18next";
import { ShareIcon, ArrowRightIcon, ClipboardIcon, ExportIcon } from "~/components/icons";
import type { MigrationAction } from "../../services/scanner/types";
import { getPlatformName } from "./utils";
import { getShopifyAdminUrl } from "../../utils/helpers";

interface MigrationWizardProps {
  migrationActions: MigrationAction[];
  shopDomain?: string;
}

export function MigrationWizard({ migrationActions, shopDomain }: MigrationWizardProps) {
  const { t } = useTranslation();

  const handleCopyChecklist = () => {
    const checklist = [
      `# ${t("scan.migrationWizard.checklist.content.title")}`,
      t("scan.migrationWizard.checklist.content.shop", { shop: shopDomain || t("scan.migrationWizard.checklist.content.unknown") }),
      t("scan.migrationWizard.checklist.content.generatedAt", { date: new Date().toLocaleString() }),
      "",
      `## ${t("scan.migrationWizard.checklist.content.pendingHeader")}`,
      ...(migrationActions?.map(
        (a, i) =>
          `${i + 1}. [${
            a.priority === "high" 
              ? t("scan.migrationWizard.checklist.content.priority.high") 
              : a.priority === "medium" 
              ? t("scan.migrationWizard.checklist.content.priority.medium") 
              : t("scan.migrationWizard.checklist.content.priority.low")
          }] ${a.title}${a.platform ? ` (${a.platform})` : ""}`
      ) || [t("scan.migrationWizard.checklist.content.none")]),
      "",
      `## ${t("scan.migrationWizard.checklist.content.quickLinks")}`,
      shopDomain 
        ? `- ${t("scan.migrationWizard.checklist.content.pixelManage")}: ${getShopifyAdminUrl(shopDomain, "/settings/notifications")}` 
        : `- ${t("scan.migrationWizard.checklist.content.pixelManage")}: ${t("scan.migrationWizard.checklist.content.needShopDomain")}`,
      `- ${t("scan.migrationWizard.checklist.content.appTool")}`,
    ].join("\n");
    navigator.clipboard.writeText(checklist);
  };

  const handleExportChecklist = () => {
    const checklist = [
      t("scan.migrationWizard.checklist.content.title"),
      t("scan.migrationWizard.checklist.content.shop", { shop: shopDomain || t("scan.migrationWizard.checklist.content.unknown") }),
      t("scan.migrationWizard.checklist.content.generatedAt", { date: new Date().toLocaleString() }),
      "",
      t("scan.migrationWizard.checklist.content.pendingHeader"),
      ...(migrationActions?.map(
        (a, i) =>
          `${i + 1}. [${
            a.priority === "high" 
              ? t("scan.migrationWizard.checklist.content.highPriority") 
              : a.priority === "medium" 
              ? t("scan.migrationWizard.checklist.content.mediumPriority") 
              : t("scan.migrationWizard.checklist.content.lowPriority")
          }] ${a.title}${a.platform ? ` (${a.platform})` : ""}`
      ) || [t("scan.migrationWizard.checklist.content.none")]),
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
            {t("scan.migrationWizard.title")}
          </Text>
          <Badge tone="info">{t("scan.migrationWizard.badge")}</Badge>
        </InlineStack>
        <Text as="p" tone="subdued">
          {t("scan.migrationWizard.description")}
        </Text>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            {t("scan.migrationWizard.webPixel.title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("scan.migrationWizard.webPixel.description")}
          </Text>
          <InlineStack gap="300" wrap>
            <Button
              url={shopDomain ? getShopifyAdminUrl(shopDomain, "/settings/notifications") : "#"}
              external
              icon={ShareIcon}
              disabled={!shopDomain}
            >
              {t("scan.migrationWizard.webPixel.manageButton")}
            </Button>
            <Button url="/app/migrate" icon={ArrowRightIcon}>
              {t("scan.migrationWizard.webPixel.configureButton")}
            </Button>
          </InlineStack>
        </BlockStack>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            {t("scan.migrationWizard.checklist.title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("scan.migrationWizard.checklist.description")}
          </Text>
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="200">
              <Text as="p" fontWeight="semibold">
                {t("scan.migrationWizard.checklist.pendingItems")}
              </Text>
              <List type="number">
                {migrationActions && migrationActions.length > 0 ? (
                  migrationActions.slice(0, 5).map((action, i) => (
                    <List.Item key={i}>
                      {action.title}
                      {action.platform && ` (${getPlatformName(action.platform, t)})`}
                      {action.priority === "high" && " ⚠️"}
                    </List.Item>
                  ))
                ) : (
                  <List.Item>{t("scan.migrationWizard.checklist.noItems")}</List.Item>
                )}
                {migrationActions && migrationActions.length > 5 && (
                  <List.Item>{t("scan.migrationWizard.checklist.moreItems", { count: migrationActions.length - 5 })}</List.Item>
                )}
              </List>
              <InlineStack gap="200" align="end">
                <Button icon={ClipboardIcon} onClick={handleCopyChecklist}>
                  {t("scan.migrationWizard.checklist.copyButton")}
                </Button>
                <Button icon={ExportIcon} onClick={handleExportChecklist}>
                  {t("scan.migrationWizard.checklist.exportButton")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Box>
        </BlockStack>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            {t("scan.migrationWizard.alternatives.title")}
          </Text>
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="300">
              <InlineStack gap="400" wrap>
                <Box minWidth="200px">
                  <BlockStack gap="100">
                    <Badge tone="success">{t("scan.migrationWizard.alternatives.official")}</Badge>
                    <Text as="p" variant="bodySm">
                      <Trans i18nKey="scan.migrationWizard.alternatives.officialDesc" components={{ br: <br /> }} />
                    </Text>
                  </BlockStack>
                </Box>
                <Box minWidth="200px">
                  <BlockStack gap="100">
                    <Badge tone="info">{t("scan.migrationWizard.alternatives.webPixel")}</Badge>
                    <Text as="p" variant="bodySm">
                      <Trans i18nKey="scan.migrationWizard.alternatives.webPixelDesc" components={{ br: <br /> }} />
                    </Text>
                  </BlockStack>
                </Box>
                <Box minWidth="200px">
                  <BlockStack gap="100">
                    <Badge tone="warning">{t("scan.migrationWizard.alternatives.uiExtension")}</Badge>
                    <Text as="p" variant="bodySm">
                      <Trans i18nKey="scan.migrationWizard.alternatives.uiExtensionDesc" components={{ br: <br /> }} />
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
