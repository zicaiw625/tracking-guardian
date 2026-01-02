

import {
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Select,
  Checkbox,
  Divider,
  Banner,
  Badge,
  Box,
  ButtonGroup,
  Icon,
  Collapsible,
  Tabs,
} from "@shopify/polaris";
import { RefreshIcon, HistoryIcon } from "~/components/icons";
import type { TokenIssues } from "../types";
import { ConfigComparison } from "~/components/settings/ConfigComparison";
import { VersionHistory } from "~/components/settings/VersionHistory";
import { useState, useEffect, useCallback } from "react";
import { useFetcher } from "@remix-run/react";

type PixelEnvironment = "test" | "live";

interface ServerTrackingTabProps {
  shop: {
    pixelConfigs: Array<{
      id: string;
      platform: string;
      platformId: string | null;
      serverSideEnabled: boolean;
      clientSideEnabled: boolean;
      isActive: boolean;
      environment?: string;
      configVersion?: number;
      rollbackAllowed?: boolean;
      lastTestedAt?: string | Date | null;
    }>;
  } | null;
  tokenIssues: TokenIssues;
  serverPlatform: string;
  setServerPlatform: (value: string) => void;
  serverEnabled: boolean;
  setServerEnabled: (value: boolean) => void;

  environment: PixelEnvironment;
  setEnvironment: (value: PixelEnvironment) => void;
  onSwitchEnvironment?: (platform: string, env: PixelEnvironment) => void;
  onRollbackEnvironment?: (platform: string) => void;

  metaPixelId: string;
  setMetaPixelId: (value: string) => void;
  metaAccessToken: string;
  setMetaAccessToken: (value: string) => void;
  metaTestCode: string;
  setMetaTestCode: (value: string) => void;

  googleMeasurementId: string;
  setGoogleMeasurementId: (value: string) => void;
  googleApiSecret: string;
  setGoogleApiSecret: (value: string) => void;

  tiktokPixelId: string;
  setTiktokPixelId: (value: string) => void;
  tiktokAccessToken: string;
  setTiktokAccessToken: (value: string) => void;

  pinterestAdAccountId: string;
  setPinterestAdAccountId: (value: string) => void;
  pinterestAccessToken: string;
  setPinterestAccessToken: (value: string) => void;

  serverFormDirty: boolean;
  isSubmitting: boolean;
  onSaveServerSide: () => void;
  onTestConnection: () => void;
}

export function ServerTrackingTab({
  shop,
  tokenIssues,
  serverPlatform,
  setServerPlatform,
  serverEnabled,
  setServerEnabled,
  environment = "live",
  setEnvironment,
  onSwitchEnvironment,
  onRollbackEnvironment,
  metaPixelId,
  setMetaPixelId,
  metaAccessToken,
  setMetaAccessToken,
  metaTestCode,
  setMetaTestCode,
  googleMeasurementId,
  setGoogleMeasurementId,
  googleApiSecret,
  setGoogleApiSecret,
  tiktokPixelId,
  setTiktokPixelId,
  tiktokAccessToken,
  setTiktokAccessToken,
  pinterestAdAccountId = "",
  setPinterestAdAccountId,
  pinterestAccessToken = "",
  setPinterestAccessToken,
  serverFormDirty,
  isSubmitting,
  onSaveServerSide,
  onTestConnection,
}: ServerTrackingTabProps) {

  const currentConfig = shop?.pixelConfigs?.find(c => c.platform === serverPlatform);
  const canRollback = currentConfig?.rollbackAllowed ?? false;

  const [showHistory, setShowHistory] = useState(false);
  const [historyTab, setHistoryTab] = useState(0);
  const comparisonFetcher = useFetcher<{
    comparison?: {
      current?: Record<string, unknown>;
      previous?: Record<string, unknown>;
      differences?: string[];
    }
  }>();
  const historyFetcher = useFetcher<{
    history?: Array<{
      version: number;
      config: {
        platformId: string | null;
        credentialsEncrypted: string | null;
        eventMappings: Record<string, string> | null;
        environment: string;
        clientSideEnabled: boolean;
        serverSideEnabled: boolean;
      };
      savedAt: string;
    }>
  }>();

  const loadComparison = useCallback(() => {
    comparisonFetcher.load(`/api/pixel-config-history?platform=${serverPlatform}&type=comparison`);
  }, [serverPlatform, comparisonFetcher]);

  const loadHistory = useCallback(() => {
    historyFetcher.load(`/api/pixel-config-history?platform=${serverPlatform}&type=history&limit=10`);
  }, [serverPlatform, historyFetcher]);

  useEffect(() => {
    if (showHistory && historyTab === 0) {
      loadComparison();
    } else if (showHistory && historyTab === 1) {
      loadHistory();
    }
  }, [showHistory, historyTab, loadComparison, loadHistory]);
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              服务端转化追踪（Conversions API）
            </Text>

            {tokenIssues.hasIssues && (
              <Banner
                title="需要重新授权"
                tone="critical"
                action={{
                  content: "查看详情",
                  onAction: () => {
                    const platform = tokenIssues.affectedPlatforms[0];
                    if (platform) setServerPlatform(platform);
                  },
                }}
              >
                <p>
                  以下平台的访问令牌已过期或无效，请重新配置：
                  <strong> {tokenIssues.affectedPlatforms.join(", ")}</strong>
                </p>
              </Banner>
            )}

            {}
            <Banner
              title="受保护客户数据 (PCD) 访问权限说明"
              tone="warning"
              action={{
                content: "了解更多",
                url: "https:
                external: true,
              }}
            >
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  自 <strong>2025-12-10</strong> 起，Shopify Web Pixels 中的客户个人信息（PII，如邮箱/电话/地址）将仅在应用获得批准的 <strong>Protected Customer Data (PCD)</strong> 权限后才会填充。
                </Text>
                <Text as="p" variant="bodySm">
                  如果未获批相关权限，Web Pixel 发送的事件中 PII 字段将为 null。这可能导致：
                </Text>
                <ul style={{ paddingLeft: "1.5rem", marginTop: "0.5rem", marginBottom: "0.5rem" }}>
                  <li><Text as="span" variant="bodySm">Web Pixel 端的受众匹配率下降</Text></li>
                  <li><Text as="span" variant="bodySm">依赖 hashed PII 的 CAPI 匹配质量降低</Text></li>
                </ul>
                <Text as="p" variant="bodySm">
                  <strong>建议：</strong>为了获得最佳追踪效果，请确保在 Shopify Partner Dashboard 中申请必要的客户数据访问权限。
                  即使未获批，我们的服务端 CAPI 仍会利用订单 ID 和其他非 PII 信号尽力匹配。
                </Text>
              </BlockStack>
            </Banner>

            <Banner tone="info">
              <p>
                服务端追踪通过 Shopify Webhooks 直接将转化数据发送到广告平台，
                不受浏览器隐私设置和广告拦截器的影响，可显著提高追踪准确性。
              </p>
            </Banner>

            <Divider />

            <Select
              label="选择平台"
              options={[
                { label: "Meta Conversions API（CAPI）", value: "meta" },
                { label: "Google GA4 Measurement Protocol", value: "google" },
                { label: "TikTok Events API", value: "tiktok" },
                { label: "Pinterest Conversions API", value: "pinterest" },
              ]}
              value={serverPlatform}
              onChange={setServerPlatform}
            />

            {}
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      运行环境
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      测试环境用于验证配置，生产环境用于正式追踪
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200">
                    <ButtonGroup variant="segmented">
                      <Button
                        pressed={environment === "test"}
                        onClick={() => {
                          setEnvironment("test");
                          onSwitchEnvironment?.(serverPlatform, "test");
                        }}
                        size="slim"
                      >
                        🧪 测试
                      </Button>
                      <Button
                        pressed={environment === "live"}
                        onClick={() => {
                          setEnvironment("live");
                          onSwitchEnvironment?.(serverPlatform, "live");
                        }}
                        size="slim"
                      >
                        🚀 生产
                      </Button>
                    </ButtonGroup>
                    {canRollback && (
                      <Button
                        icon={RefreshIcon}
                        onClick={() => onRollbackEnvironment?.(serverPlatform)}
                        size="slim"
                        variant="plain"
                      >
                        回滚
                      </Button>
                    )}
                  </InlineStack>
                </InlineStack>
                {environment === "test" && (
                  <Banner tone="warning">
                    <Text as="p" variant="bodySm">
                      ⚠️ 测试模式：事件将发送到平台的测试端点，不会影响正式数据。
                      验证完成后请切换到生产环境。
                    </Text>
                  </Banner>
                )}
                {currentConfig?.configVersion && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    配置版本: v{currentConfig.configVersion}
                  </Text>
                )}
              </BlockStack>
            </Box>

            {serverPlatform === "meta" && (
              <>
                <TextField
                  label="Pixel ID"
                  value={metaPixelId}
                  onChange={setMetaPixelId}
                  autoComplete="off"
                  placeholder="1234567890123456"
                />
                <TextField
                  label="Access Token"
                  type="password"
                  value={metaAccessToken}
                  onChange={setMetaAccessToken}
                  autoComplete="off"
                  helpText="在 Meta Events Manager 中生成系统用户访问令牌"
                />
                <TextField
                  label="Test Event Code (可选)"
                  value={metaTestCode}
                  onChange={setMetaTestCode}
                  autoComplete="off"
                  helpText="用于测试模式，生产环境请留空"
                />
              </>
            )}

            {serverPlatform === "google" && (
              <>
                <Banner tone="info">
                  <p>
                    <strong>GA4 Measurement Protocol</strong>{" "}
                    是推荐的服务端追踪方式。 Google Ads 可以从 GA4
                    导入转化数据进行归因优化。
                  </p>
                </Banner>
                <TextField
                  label="Measurement ID"
                  value={googleMeasurementId}
                  onChange={setGoogleMeasurementId}
                  autoComplete="off"
                  placeholder="G-XXXXXXXXXX"
                  helpText="GA4 媒体资源的 Measurement ID（格式：G-XXXXXXXXXX）。在 GA4 管理后台 > 数据流中找到"
                  error={
                    googleMeasurementId &&
                    !googleMeasurementId.match(/^G-[A-Z0-9]+$/i)
                      ? "格式应为 G-XXXXXXXXXX"
                      : undefined
                  }
                />
                <TextField
                  label="API Secret"
                  type="password"
                  value={googleApiSecret}
                  onChange={setGoogleApiSecret}
                  autoComplete="off"
                  helpText="在 GA4 > 数据流 > 选择您的数据流 > Measurement Protocol API 密钥中创建新密钥"
                />
                <Text as="p" variant="bodySm" tone="subdued">
                  💡 提示：如需在 Google Ads 中使用转化数据，请在 Google Ads
                  中设置「从 GA4 导入转化」。
                </Text>
              </>
            )}

            {serverPlatform === "tiktok" && (
              <>
                <TextField
                  label="Pixel ID"
                  value={tiktokPixelId}
                  onChange={setTiktokPixelId}
                  autoComplete="off"
                  placeholder="例: C1234567890123456789"
                />
                <TextField
                  label="Access Token"
                  type="password"
                  value={tiktokAccessToken}
                  onChange={setTiktokAccessToken}
                  autoComplete="off"
                  helpText="在 TikTok Events Manager 中生成"
                />
              </>
            )}

            {serverPlatform === "pinterest" && (
              <>
                <Banner tone="info">
                  <p>
                    <strong>Pinterest Conversions API</strong>{" "}
                    允许您直接将转化数据发送到 Pinterest，提高广告归因准确性。
                  </p>
                </Banner>
                <TextField
                  label="Ad Account ID"
                  value={pinterestAdAccountId}
                  onChange={setPinterestAdAccountId}
                  autoComplete="off"
                  placeholder="例: 123456789012345678"
                  helpText="在 Pinterest Ads Manager 中找到您的广告账户 ID"
                  error={
                    pinterestAdAccountId && !/^\d+$/.test(pinterestAdAccountId)
                      ? "广告账户 ID 应为纯数字"
                      : undefined
                  }
                />
                <TextField
                  label="Access Token"
                  type="password"
                  value={pinterestAccessToken}
                  onChange={setPinterestAccessToken}
                  autoComplete="off"
                  helpText="在 Pinterest Developer Portal 中生成 API Access Token"
                />
                <Text as="p" variant="bodySm" tone="subdued">
                  💡 提示：确保您的 Pinterest 应用已获得 Conversion API 访问权限。
                  访问 <a href="https:
                </Text>
              </>
            )}

            <Checkbox
              label="启用服务端追踪"
              checked={serverEnabled}
              onChange={setServerEnabled}
            />

            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={onSaveServerSide}
                loading={isSubmitting}
                disabled={!serverFormDirty}
              >
                保存配置
              </Button>
              <Button
                variant="secondary"
                onClick={onTestConnection}
                loading={isSubmitting}
                disabled={
                  serverFormDirty ||
                  (serverPlatform === "meta" &&
                    (!metaPixelId || !metaAccessToken))
                }
              >
                测试连接
              </Button>
              {currentConfig && (
                <Button
                  icon={HistoryIcon}
                  onClick={() => {
                    setShowHistory(!showHistory);
                    if (!showHistory) {
                      loadComparison();
                      loadHistory();
                    }
                  }}
                  variant="plain"
                >
                  {showHistory ? "隐藏历史" : "查看历史"}
                </Button>
              )}
            </InlineStack>

            {}
            {showHistory && currentConfig && (
              <Box paddingBlockStart="400">
                <Tabs
                  tabs={[
                    { id: "comparison", content: "配置对比" },
                    { id: "history", content: "版本历史" },
                  ]}
                  selected={historyTab}
                  onSelect={setHistoryTab}
                >
                  <Box paddingBlockStart="400">
                    {historyTab === 0 && comparisonFetcher.data?.comparison && (
                      <ConfigComparison
                        current={comparisonFetcher.data.comparison.current}
                        previous={comparisonFetcher.data.comparison.previous}
                        differences={comparisonFetcher.data.comparison.differences}
                        platform={serverPlatform}
                      />
                    )}
                    {historyTab === 1 && historyFetcher.data?.history && (
                      <VersionHistory
                        history={historyFetcher.data.history}
                        platform={serverPlatform}
                      />
                    )}
                  </Box>
                </Tabs>
              </Box>
            )}
            {serverFormDirty && (
              <Text as="p" variant="bodySm" tone="caution">
                请先保存配置后再测试连接
              </Text>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              服务端追踪状态
            </Text>
            {shop?.pixelConfigs &&
            shop.pixelConfigs.filter((c) => c.serverSideEnabled).length > 0 ? (
              shop.pixelConfigs
                .filter((c) => c.serverSideEnabled)
                .map((config) => (
                  <Box
                    key={config.id}
                    background="bg-surface-secondary"
                    padding="300"
                    borderRadius="200"
                  >
                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text as="span" fontWeight="semibold">
                          {config.platform === "meta"
                            ? "Meta CAPI"
                            : config.platform === "google"
                              ? "Google Analytics 4 (GA4)"
                              : config.platform === "pinterest"
                                ? "Pinterest CAPI"
                                : "TikTok"}
                        </Text>
                        <InlineStack gap="100">
                          {config.environment === "test" && (
                            <Badge tone="warning">测试</Badge>
                          )}
                          <Badge tone="success">已启用</Badge>
                        </InlineStack>
                      </InlineStack>
                      {config.lastTestedAt && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          上次测试:{" "}
                          {new Date(config.lastTestedAt).toLocaleDateString(
                            "zh-CN"
                          )}
                        </Text>
                      )}
                    </BlockStack>
                  </Box>
                ))
            ) : (
              <Text as="p" tone="subdued">
                尚未启用服务端追踪
              </Text>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

