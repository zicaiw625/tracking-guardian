import { BlockStack, Card, Text, InlineStack, Button, Icon, Layout, Banner, List, Badge } from "@shopify/polaris";
import { ArrowRightIcon, LockIcon } from "~/components/icons";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { DataConnectionBanner } from "./DataConnectionBanner";
import { UpgradeHealthCheck } from "~/components/onboarding/UpgradeHealthCheck";
import { PostInstallScanProgress } from "~/components/onboarding/PostInstallScanProgress";
import { isPlanAtLeast } from "~/utils/plans";
import type { DashboardData } from "~/types/dashboard";

interface DashboardOverviewProps {
  data: DashboardData;
  shopDomain: string;
  showWelcomeBanner: boolean;
  showScanProgress: boolean;
  scanStartedAt: Date;
  onDismissWelcomeBanner: () => void;
  onScanComplete: () => void;
  backendUrlInfo?: { placeholderDetected?: boolean };
}

export function DashboardOverview({
  data,
  shopDomain,
  showWelcomeBanner,
  showScanProgress,
  scanStartedAt,
  onDismissWelcomeBanner,
  onScanComplete,
  backendUrlInfo,
}: DashboardOverviewProps) {
  const introConfig = {
    title: "升级迁移交付平台",
    description: "完成平台连接、扫描风险、迁移配置、验证测试，生成可交付的验收报告",
    items: [
      "自动扫描 ScriptTag 与 Web Pixels，生成迁移风险评估",
      "Web Pixel 标准事件映射（GA4/Meta/TikTok）",
      "测试清单 + 事件参数完整率 + 订单金额/币种一致性验证",
      "上线后有断档告警",
    ],
    primaryAction: data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
      ? { content: "开始免费体检", url: "/app/audit/start" }
      : { content: "查看完整报告", url: "/app/audit/report" },
    secondaryAction: { content: "查看报告中心", url: "/app/reports" },
  };

  return (
    <BlockStack gap="500">
      {data.dataConnection && (
        <DataConnectionBanner
          hasIngestionSecret={data.dataConnection.hasIngestionSecret}
          hasWebPixel={data.dataConnection.hasWebPixel}
          webPixelHasIngestionKey={data.dataConnection.webPixelHasIngestionKey}
          shopDomain={shopDomain}
        />
      )}
      {backendUrlInfo?.placeholderDetected && (
        <Banner tone="critical" title="⚠️ 严重错误：BACKEND_URL 未在构建时替换">
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              <strong>检测到占位符 __BACKEND_URL_PLACEHOLDER__，URL 未在构建时替换</strong>
            </Text>
            <Text as="p" variant="bodySm">
              像素扩展配置中仍包含占位符，这表明构建流程未正确替换占位符。如果占位符未被替换，像素扩展将无法发送事件到后端，导致事件丢失。这是一个严重的配置错误，必须在上线前修复。
            </Text>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              修复步骤（必须在生产环境部署前完成）：
            </Text>
            <List type="number">
              <List.Item>
                <Text as="span" variant="bodySm">
                  在 CI/CD 流程中，部署前必须运行 <code>pnpm ext:inject</code> 或 <code>pnpm deploy:ext</code>
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  确保环境变量 <code>SHOPIFY_APP_URL</code> 已正确设置
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  验证扩展构建产物中不再包含占位符
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  确保该 URL 已在 Web Pixel Extension 的 allowlist 中配置
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  禁止直接使用 <code>shopify app deploy</code>，必须使用 <code>pnpm deploy:ext</code>
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Banner>
      )}
      {showWelcomeBanner && (
        <Banner
          title="欢迎使用 Tracking Guardian"
          onDismiss={onDismissWelcomeBanner}
        >
          <Text as="p" variant="bodySm">
            开始您的迁移之旅：扫描风险 → 配置迁移 → 验证测试 → 生成报告
          </Text>
        </Banner>
      )}
      {showScanProgress && (
        <PostInstallScanProgress
          shopId={data.shopDomain}
          scanStartedAt={scanStartedAt}
          onComplete={onScanComplete}
        />
      )}
      {data.showOnboarding && data.latestScan && (
        <UpgradeHealthCheck
          typOspPagesEnabled={data.typOspPagesEnabled || false}
          riskScore={data.riskScore || 0}
          estimatedMigrationTimeMinutes={data.estimatedMigrationTimeMinutes || 0}
          scriptTagsCount={data.scriptTagsCount || 0}
          identifiedPlatforms={data.latestScan.identifiedPlatforms || []}
          onStartAudit={() => window.location.href = "/app/audit/start"}
          onViewDashboard={() => window.location.href = "/app"}
        />
      )}
      <PageIntroCard
        title={introConfig.title}
        description={introConfig.description}
        items={introConfig.items}
        primaryAction={introConfig.primaryAction}
        secondaryAction={introConfig.secondaryAction}
      />
      {data.latestScan && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  快速开始
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  完成以下步骤以开始迁移
                </Text>
              </BlockStack>
              <Button
                url={
                  data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
                    ? "/app/audit/start"
                    : "/app/audit/report"
                }
                variant="primary"
                size="large"
                icon={ArrowRightIcon}
              >
                {data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
                  ? "开始免费体检"
                  : "查看完整报告"}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}
      {data.latestScan && (
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      🎯 启用像素迁移（Test 环境）
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      标准事件映射 + 参数完整率 + 可下载 payload 证据（GA4/Meta/TikTok 三选一）
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>技术说明：</strong>Web Pixel 是 strict sandbox（Web Worker），很多能力受限
                    </Text>
                    <Badge tone="info">Migration $49/月</Badge>
                  </BlockStack>
                  <Icon source={LockIcon} />
                </InlineStack>
                <Button
                  url={isPlanAtLeast(data.planId || "free", "starter") ? "/app/migrate" : "/app/billing"}
                  variant={isPlanAtLeast(data.planId || "free", "starter") ? "primary" : "secondary"}
                  fullWidth
                >
                  {isPlanAtLeast(data.planId || "free", "starter") ? "开始迁移" : "升级到 Migration"}
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      📦 Thank you/Order status 页面自检
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      迁移 tracking 到 Web Pixel，使用验收报告做交付验证。本应用不提供 Thank you/Order status 页面模块库。
                    </Text>
                    <Badge tone="info">Migration $49/月</Badge>
                  </BlockStack>
                  <Icon source={LockIcon} />
                </InlineStack>
                <Button
                  url={isPlanAtLeast(data.planId || "free", "starter") ? "/app/migrate" : "/app/billing"}
                  variant={isPlanAtLeast(data.planId || "free", "starter") ? "primary" : "secondary"}
                  fullWidth
                >
                  {isPlanAtLeast(data.planId || "free", "starter") ? "配置模块" : "升级到 Migration"}
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      📄 生成验收报告（CSV）
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      测试清单 + 事件参数完整率 + 订单金额/币种一致性 + 隐私合规检查（consent/customerPrivacy）• 给老板/客户看的证据
                    </Text>
                    <Badge tone="warning">Growth $79/月 或 Agency $199/月</Badge>
                  </BlockStack>
                  <Icon source={LockIcon} />
                </InlineStack>
                <Button
                  url={isPlanAtLeast(data.planId || "free", "growth") ? "/app/verification" : "/app/billing"}
                  variant={isPlanAtLeast(data.planId || "free", "growth") ? "primary" : "secondary"}
                  fullWidth
                >
                  {isPlanAtLeast(data.planId || "free", "growth") ? "生成报告" : "升级到 Go-Live"}
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      )}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                报告中心
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                管理 Audit / Verification / Monitoring 报告导出与历史记录。
              </Text>
            </BlockStack>
            <Button url="/app/reports" size="slim" variant="primary">
              进入报告中心
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
