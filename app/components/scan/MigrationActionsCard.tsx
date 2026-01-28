import { Card, BlockStack, Box, InlineStack, Text, Badge, Button, Banner } from "@shopify/polaris";
import { InfoIcon, RefreshIcon, ArrowRightIcon } from "~/components/icons";
import type { MigrationAction } from "../../services/scanner/types";
import { getPlatformName } from "./utils";

interface MigrationActionsCardProps {
  migrationActions: MigrationAction[];
  onShowScriptTagGuidance: (scriptTagId: number, platform?: string) => void;
  onDeleteWebPixel: (webPixelGid: string, platform?: string) => void;
  onUpgradePixelSettings: () => void;
  isDeleting: boolean;
  isUpgrading: boolean;
  pendingDeleteGid?: string;
  deleteFetcherData?: { success?: boolean; message?: string; error?: string };
  upgradeFetcherData?: { success?: boolean; message?: string; error?: string };
}

export function MigrationActionsCard({
  migrationActions,
  onShowScriptTagGuidance,
  onDeleteWebPixel,
  onUpgradePixelSettings,
  isDeleting,
  isUpgrading,
  pendingDeleteGid,
  deleteFetcherData,
  upgradeFetcherData,
}: MigrationActionsCardProps) {
  if (migrationActions.length === 0) return null;
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            迁移操作
          </Text>
          <Badge tone="attention">{`${migrationActions.length} 项待处理`}</Badge>
        </InlineStack>
        {deleteFetcherData && (
          <Banner
            tone={deleteFetcherData.success ? "success" : "critical"}
            onDismiss={() => {}}
          >
            <Text as="p">
              {String(deleteFetcherData.message || deleteFetcherData.error || "操作完成")}
            </Text>
          </Banner>
        )}
        {upgradeFetcherData && (
          <Banner
            tone={upgradeFetcherData.success ? "success" : "critical"}
            onDismiss={() => {}}
          >
            <Text as="p">
              {String(upgradeFetcherData.message || upgradeFetcherData.error || "升级完成")}
            </Text>
          </Banner>
        )}
        <BlockStack gap="300">
          {migrationActions.map((action, index) => (
            <Box
              key={index}
              background="bg-surface-secondary"
              padding="400"
              borderRadius="200"
            >
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {action.title}
                      </Text>
                      <Badge
                        tone={
                          action.priority === "high"
                            ? "critical"
                            : action.priority === "medium"
                            ? "warning"
                            : "info"
                        }
                      >
                        {action.priority === "high"
                          ? "高优先级"
                          : action.priority === "medium"
                          ? "中优先级"
                          : "低优先级"}
                      </Badge>
                    </InlineStack>
                    {action.platform && (
                      <Badge>{getPlatformName(action.platform)}</Badge>
                    )}
                  </BlockStack>
                  {action.deadline && (
                    <Badge tone="warning">{`截止: ${action.deadline}`}</Badge>
                  )}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {action.description}
                </Text>
                {action.estimatedTimeMinutes && (
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">
                      {`预计时间: ${action.estimatedTimeMinutes} 分钟`}
                    </Badge>
                  </InlineStack>
                )}
                <InlineStack gap="200" align="end">
                  {action.type === "migrate_script_tag" && action.scriptTagId && (
                    <Button
                      size="slim"
                      icon={InfoIcon}
                      onClick={() =>
                        onShowScriptTagGuidance(action.scriptTagId!, action.platform)
                      }
                    >
                      查看清理指南
                    </Button>
                  )}
                  {action.type === "remove_duplicate" && action.webPixelGid && (
                    <Button
                      tone="critical"
                      size="slim"
                      loading={isDeleting && pendingDeleteGid === action.webPixelGid}
                      onClick={() => onDeleteWebPixel(action.webPixelGid!, action.platform)}
                    >
                      删除重复像素
                    </Button>
                  )}
                  {action.type === "configure_pixel" && action.description?.includes("升级") && (
                    <Button
                      size="slim"
                      icon={RefreshIcon}
                      loading={isUpgrading}
                      onClick={onUpgradePixelSettings}
                    >
                      升级配置
                    </Button>
                  )}
                  {action.type === "configure_pixel" && !action.description?.includes("升级") && (
                    <Button size="slim" url="/app/migrate" icon={ArrowRightIcon}>
                      配置 Pixel
                    </Button>
                  )}
                  {action.type === "enable_capi" && (
                    <Button size="slim" url="/app/migrate" icon={ArrowRightIcon}>
                      启用 App Pixel
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
