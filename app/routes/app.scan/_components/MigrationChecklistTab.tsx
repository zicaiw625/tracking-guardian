import { BlockStack, Box, Card, Text, InlineStack, Badge, Button, List } from "@shopify/polaris";
import type { SubmitFunction } from "@remix-run/react";
import { MigrationChecklistEnhanced } from "~/components/scan/MigrationChecklistEnhanced";
import { EnhancedEmptyState } from "~/components/ui";
import type { DependencyGraph } from "~/services/dependency-analysis.server";
import type { MigrationChecklistItem } from "~/services/migration-checklist.server";
import { useTranslation } from "react-i18next";

export interface MigrationChecklistTabProps {
  showTabs: boolean;
  planIdSafe: string;
  latestScan: { id: string } | null;
  migrationChecklist: { items: MigrationChecklistItem[] } | null;
  dependencyGraph: DependencyGraph | null;
  officialUpgradeChecklist?: {
    audit: { completed: boolean };
    pixel: { completed: boolean };
    modules: { completed: boolean };
    verification: { completed: boolean };
  } | null;
  handleScan: () => void;
  submit: SubmitFunction;
  onNavigate?: (url: string) => void;
}

export function MigrationChecklistTab({
  showTabs: _showTabs,
  planIdSafe: _planIdSafe,
  latestScan,
  migrationChecklist,
  dependencyGraph,
  officialUpgradeChecklist,
  handleScan,
  submit,
  onNavigate,
}: MigrationChecklistTabProps) {
  const { t } = useTranslation();
  return (
    <BlockStack gap="500">
      <Box paddingBlockStart="400">
        {officialUpgradeChecklist && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  {t("scan.officialChecklist.title")}
                </Text>
                <Button url="/app/reports" variant="plain">
                  {t("scan.officialChecklist.reports")}
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scan.officialChecklist.desc")}
              </Text>
              <List type="number">
                <List.Item>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">{t("scan.officialChecklist.items.audit")}</Text>
                    <Badge tone={officialUpgradeChecklist.audit.completed ? "success" : "warning"}>
                      {officialUpgradeChecklist.audit.completed ? t("scan.officialChecklist.done") : t("scan.officialChecklist.pending")}
                    </Badge>
                  </InlineStack>
                </List.Item>
                <List.Item>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">{t("scan.officialChecklist.items.pixel")}</Text>
                    <Badge tone={officialUpgradeChecklist.pixel.completed ? "success" : "warning"}>
                      {officialUpgradeChecklist.pixel.completed ? t("scan.officialChecklist.done") : t("scan.officialChecklist.pending")}
                    </Badge>
                  </InlineStack>
                </List.Item>
                <List.Item>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">{t("scan.officialChecklist.items.modules")}</Text>
                    <Badge tone={officialUpgradeChecklist.modules.completed ? "success" : "warning"}>
                      {officialUpgradeChecklist.modules.completed ? t("scan.officialChecklist.done") : t("scan.officialChecklist.pending")}
                    </Badge>
                  </InlineStack>
                </List.Item>
                <List.Item>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">{t("scan.officialChecklist.items.verification")}</Text>
                    <Badge tone={officialUpgradeChecklist.verification.completed ? "success" : "warning"}>
                      {officialUpgradeChecklist.verification.completed ? t("scan.officialChecklist.done") : t("scan.officialChecklist.pending")}
                    </Badge>
                  </InlineStack>
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        )}
        {!latestScan ? (
          <Card>
            <BlockStack gap="400">
              <EnhancedEmptyState
                icon="📋"
                title={t("checklist.emptyScanTitle")}
                description={t("checklist.emptyScanDesc")}
                primaryAction={{ content: t("checklist.startScan"), onAction: handleScan }}
              />
            </BlockStack>
          </Card>
        ) : migrationChecklist && migrationChecklist.items.length > 0 ? (
          <MigrationChecklistEnhanced
            items={migrationChecklist.items}
            dependencyGraph={dependencyGraph}
            onItemClick={(assetId) => {
              const url = `/app/migrate?asset=${assetId}`;
              if (onNavigate) { onNavigate(url); } else { window.location.href = url; }
            }}
            onItemComplete={(assetId) => {
              const formData = new FormData();
              formData.append("_action", "mark_asset_complete");
              formData.append("assetId", assetId);
              submit(formData, { method: "post" });
            }}
          />
        ) : (
          <Card>
            <BlockStack gap="400">
              <EnhancedEmptyState
                icon="📋"
                title={t("checklist.emptyScanTitle")}
                description={t("checklist.emptyResultsDesc")}
              />
            </BlockStack>
          </Card>
        )}
      </Box>
    </BlockStack>
  );
}
