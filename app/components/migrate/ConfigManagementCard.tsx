
import { useState, useCallback } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Tabs,
  Modal,
} from "@shopify/polaris";
import { SettingsIcon } from "~/components/icons";
import { ConfigComparison } from "~/components/settings/ConfigComparison";
import { VersionHistory } from "~/components/settings/VersionHistory";
import { useFetcher } from "@remix-run/react";

interface PixelConfig {
  id: string;
  platform: string;
  environment: string;
  configVersion: number | null;
  previousConfig: unknown;
  rollbackAllowed: boolean;
}

interface ConfigManagementCardProps {
  pixelConfigs: PixelConfig[];
  shopId: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  google: "Google Analytics 4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
  pinterest: "Pinterest",
};

export function ConfigManagementCard({
  pixelConfigs,
  shopId,
}: ConfigManagementCardProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [showModal, setShowModal] = useState(false);

  const comparisonFetcher = useFetcher();
  const historyFetcher = useFetcher();

  const handleViewConfig = useCallback(
    (platform: string) => {
      setSelectedPlatform(platform);
      setShowModal(true);
      setActiveTab(0);

      // 加载配置对比
      comparisonFetcher.load(
        `/api/pixel-config-history?platform=${platform}&type=comparison`
      );

      // 加载版本历史
      historyFetcher.load(
        `/api/pixel-config-history?platform=${platform}&type=history&limit=10`
      );
    },
    [comparisonFetcher, historyFetcher]
  );

  if (pixelConfigs.length === 0) {
    return null;
  }

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">
              已配置的平台
            </Text>
            <Badge tone="success">{pixelConfigs.length} 个</Badge>
          </InlineStack>

          <Divider />

          <BlockStack gap="300">
            {pixelConfigs.map((config) => (
              <Box
                key={config.id}
                background="bg-surface-secondary"
                padding="400"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {PLATFORM_LABELS[config.platform] || config.platform}
                      </Text>
                      <Badge
                        tone={
                          config.environment === "live" ? "success" : "warning"
                        }
                      >
                        {config.environment === "live" ? "生产" : "测试"}
                      </Badge>
                      {config.configVersion && (
                        <Badge>v{config.configVersion}</Badge>
                      )}
                    </InlineStack>
                    {config.rollbackAllowed && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        可回滚到上一个版本
                      </Text>
                    )}
                  </BlockStack>
                  <Button
                    size="slim"
                    icon={SettingsIcon}
                    onClick={() => handleViewConfig(config.platform)}
                  >
                    查看配置
                  </Button>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>

          <Button url="/app/settings" fullWidth>
            前往设置页面管理
          </Button>
        </BlockStack>
      </Card>

      {showModal && selectedPlatform && (
        <Modal
          open={showModal}
          onClose={() => {
            setShowModal(false);
            setSelectedPlatform(null);
          }}
          title={`${PLATFORM_LABELS[selectedPlatform] || selectedPlatform} 配置管理`}
          primaryAction={{
            content: "关闭",
            onAction: () => {
              setShowModal(false);
              setSelectedPlatform(null);
            },
          }}
        >
          <Modal.Section>
            <Tabs
              tabs={[
                { id: "comparison", content: "配置对比" },
                { id: "history", content: "版本历史" },
              ]}
              selected={activeTab}
              onSelect={(index) => setActiveTab(index)}
            >
              <Box paddingBlockStart="400">
                {activeTab === 0 &&
                  comparisonFetcher.data?.comparison && (
                    <ConfigComparison
                      current={comparisonFetcher.data.comparison.current}
                      previous={comparisonFetcher.data.comparison.previous}
                      differences={
                        comparisonFetcher.data.comparison.differences
                      }
                      platform={selectedPlatform}
                    />
                  )}
                {activeTab === 1 && historyFetcher.data?.history && (
                  <VersionHistory
                    history={historyFetcher.data.history}
                    platform={selectedPlatform}
                  />
                )}
              </Box>
            </Tabs>
          </Modal.Section>
        </Modal>
      )}
    </>
  );
}

