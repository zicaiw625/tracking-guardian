import { BlockStack, Box, Card } from "@shopify/polaris";
import type { SubmitFunction } from "@remix-run/react";
import { MigrationChecklistEnhanced } from "~/components/scan/MigrationChecklistEnhanced";
import { AuditPaywallCard } from "~/components/paywall/AuditPaywallCard";
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
  handleScan: () => void;
  submit: SubmitFunction;
}

export function MigrationChecklistTab({
  showTabs,
  planIdSafe,
  latestScan,
  migrationChecklist,
  dependencyGraph,
  handleScan,
  submit,
}: MigrationChecklistTabProps) {
  const { t } = useTranslation();
  return (
    <BlockStack gap="500">
      {showTabs && <AuditPaywallCard planId={planIdSafe} />}
      <Box paddingBlockStart="400">
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
              window.location.href = `/app/migrate?asset=${assetId}`;
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
