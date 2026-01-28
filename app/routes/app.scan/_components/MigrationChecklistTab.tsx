import { BlockStack, Box, Card } from "@shopify/polaris";
import type { SubmitFunction } from "@remix-run/react";
import { MigrationChecklistEnhanced } from "~/components/scan/MigrationChecklistEnhanced";
import { AuditPaywallCard } from "~/components/paywall/AuditPaywallCard";
import { EnhancedEmptyState } from "~/components/ui";
import type { DependencyGraph } from "~/services/dependency-analysis.server";
import type { MigrationChecklistItem } from "~/services/migration-checklist.server";

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
  return (
    <BlockStack gap="500">
      {showTabs && <AuditPaywallCard planId={planIdSafe} />}
      <Box paddingBlockStart="400">
        {!latestScan ? (
          <Card>
            <BlockStack gap="400">
              <EnhancedEmptyState
                icon="📋"
                title="暂无迁移清单"
                description="完成自动扫描后，我们将为您生成迁移清单和优先级建议。"
                primaryAction={{ content: "开始扫描", onAction: handleScan }}
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
                title="暂无迁移清单"
                description="扫描结果中没有需要迁移的项目。"
              />
            </BlockStack>
          </Card>
        )}
      </Box>
    </BlockStack>
  );
}
