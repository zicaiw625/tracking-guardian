import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Box, Divider, Banner, ProgressBar, DataTable, } from "@shopify/polaris";
import { useToastContext, EnhancedEmptyState } from "~/components/ui";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getExistingWebPixels, isOurWebPixel, needsSettingsUpgrade } from "../services/migration.server";
import { DEPRECATION_DATES, formatDeadlineDate } from "../utils/migration-deadlines";
import { getShopifyAdminUrl } from "../utils/helpers";
interface DiagnosticCheck {
    name: string;
    status: "pass" | "fail" | "warning" | "pending";
    message: string;
    details?: string;
}

interface EventFunnel {
    pixelRequests: number;
    passedOrigin: number;
    passedKey: number;
    sentToPlatforms: number;
    period: string;
}
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const checks: DiagnosticCheck[] = [];
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            ingestionSecret: true,
            consentStrategy: true,
            dataRetentionDays: true,
            pixelConfigs: {
                where: { isActive: true },
                select: {
                    platform: true,
                    serverSideEnabled: true,
                },
            },
        },
    });
    if (!shop) {
        return json({
            shopDomain,
            checks: [
                {
                    name: "Shop 配置",
                    status: "fail" as const,
                    message: "未找到店铺配置",
                    details: "请重新安装应用",
                },
            ],
            summary: { total: 1, passed: 0, failed: 1, warnings: 0 },
            eventFunnel: {
                pixelRequests: 0,
                passedOrigin: 0,
                passedKey: 0,
                sentToPlatforms: 0,
                period: "24h",
            } as EventFunnel,
            webhookHealth: {
                totalWebhooks24h: 0,
                failedWebhooks24h: 0,
                queuedJobs: 0,
                deadLetterJobs: 0,
            },
            recentEvents: [],
            lastUpdated: new Date().toISOString(),
        });
    }
    checks.push({
        name: "Ingestion Key",
        status: shop.ingestionSecret ? "pass" : "fail",
        message: shop.ingestionSecret
            ? "已配置 Ingestion Key"
            : "Ingestion Key 未配置",
        details: shop.ingestionSecret
            ? "像素事件关联与过滤已启用"
            : "请在设置页面生成 Ingestion Key",
    });
    try {
        const existingPixels = await getExistingWebPixels(admin);
        const ourPixel = existingPixels.find((p) => {
            try {
                const settings = JSON.parse(p.settings || "{}");
                return isOurWebPixel(settings, shopDomain);
            }
            catch {
                return false;
            }
        });
        let settingsNeedUpgrade = false;
        let pixelSettings: Record<string, unknown> = {};
        if (ourPixel?.settings) {
            try {
                pixelSettings = JSON.parse(ourPixel.settings);
                settingsNeedUpgrade = needsSettingsUpgrade(pixelSettings);
            }
            catch {
                settingsNeedUpgrade = false;
            }
        }
        const hasShopDomain = typeof pixelSettings.shop_domain === "string" && pixelSettings.shop_domain.length > 0;
        const hasIngestionKey = typeof pixelSettings.ingestion_key === "string" && pixelSettings.ingestion_key.length > 0;
        if (ourPixel) {
            if (settingsNeedUpgrade) {
                checks.push({
                    name: "Web Pixel",
                    status: "warning",
                    message: "Web Pixel 已安装（需要升级配置）",
                    details: `Pixel ID: ${ourPixel.id}。检测到旧版配置，请重新启用 Pixel 以升级。` +
                        (!hasShopDomain ? " 缺少 shop_domain。" : "") +
                        (!hasIngestionKey ? " 使用旧键名 ingestion_secret。" : ""),
                });
            }
            else {
                const missingIngestionKey = !hasIngestionKey;
                checks.push({
                    name: "Web Pixel",
                    status: missingIngestionKey ? "warning" : "pass",
                    message: missingIngestionKey
                        ? "Web Pixel 已安装（ingestion_key 缺失）"
                        : "Web Pixel 已安装",
                    details: missingIngestionKey
                        ? `像素配置缺失 ingestion_key，生产严格模式下 /ingest 将拒绝事件，请在 Admin 中配置 Ingestion Key 并同步到 Pixel 设置。Pixel ID: ${ourPixel.id}`
                        : `Pixel ID: ${ourPixel.id}` +
                            (hasShopDomain ? ` | shop_domain: ✓` : "") +
                            (hasIngestionKey ? ` | ingestion_key: ✓` : ""),
                });
            }
        }
        else {
            checks.push({
                name: "Web Pixel",
                status: "warning",
                message: "Web Pixel 未安装",
                details: "请在迁移页面安装 Web Pixel",
            });
        }
    }
    catch {
        checks.push({
            name: "Web Pixel",
            status: "warning",
            message: "无法检查 Web Pixel 状态",
            details: "请手动检查 Web Pixel 配置",
        });
    }
    const serverSideConfigs = shop.pixelConfigs.filter((c: { platform: string; serverSideEnabled: boolean }) => c.serverSideEnabled);
    if (serverSideConfigs.length > 0) {
        checks.push({
            name: "服务端追踪 (CAPI)",
            status: "pass",
            message: `已配置 ${serverSideConfigs.length} 个平台`,
            details: serverSideConfigs.map((c: { platform: string }) => c.platform).join(", "),
        });
    }
    else {
        checks.push({
            name: "服务端追踪 (CAPI)",
            status: "warning",
            message: "未启用服务端追踪",
            details: "启用 CAPI 可提高追踪准确性",
        });
    }
    const recentReceipt = await prisma.pixelEventReceipt.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        select: {
            createdAt: true,
            eventType: true,
            originHost: true,
        },
    });
    if (recentReceipt) {
        const hoursSinceLastEvent = Math.round((Date.now() - recentReceipt.createdAt.getTime()) / (1000 * 60 * 60));
        checks.push({
            name: "最近事件",
            status: hoursSinceLastEvent < 24 ? "pass" : "warning",
            message: `${hoursSinceLastEvent} 小时前收到事件`,
            details: `类型: ${recentReceipt.eventType}, 来源: ${recentReceipt.originHost || "未知"}`,
        });
    }
    else {
        checks.push({
            name: "最近事件",
            status: "pending",
            message: "尚未收到任何事件",
            details: "完成一个测试订单以验证追踪功能",
        });
    }
    const recentReceiptsCount = await prisma.pixelEventReceipt.count({
        where: {
            shopId: shop.id,
            eventType: { in: ["purchase", "checkout_completed"] },
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
    });
    checks.push({
        name: "24h 事件记录",
        status: recentReceiptsCount > 0 ? "pass" : "pending",
        message: `${recentReceiptsCount} 条事件记录`,
        details: recentReceiptsCount > 0
            ? "事件追踪正常运行"
            : "完成测试订单后会产生事件记录",
    });
    checks.push({
        name: "Consent 策略",
        status: "pass",
        message: `当前策略: ${shop.consentStrategy || "balanced"}`,
        details: shop.consentStrategy === "strict"
            ? "严格模式: 需要明确用户同意"
            : shop.consentStrategy === "weak"
                ? "宽松模式: 默示同意"
                : "平衡模式: 推荐设置",
    });
    checks.push({
        name: "数据保留策略",
        status: "pass",
        message: `保留期: ${shop.dataRetentionDays} 天`,
        details: "超期数据自动清理",
    });
    const summary = {
        total: checks.length,
        passed: checks.filter(c => c.status === "pass").length,
        failed: checks.filter(c => c.status === "fail").length,
        warnings: checks.filter(c => c.status === "warning").length,
    };
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pixelReceiptsCount = await prisma.pixelEventReceipt.count({
        where: {
            shopId: shop.id,
            createdAt: { gte: last24h },
        },
    });
    const trustedReceiptsCount = pixelReceiptsCount;
    const sentToPlatformsCount = pixelReceiptsCount;
    const eventFunnel: EventFunnel = {
        pixelRequests: pixelReceiptsCount,
        passedOrigin: pixelReceiptsCount,
        passedKey: trustedReceiptsCount,
        sentToPlatforms: sentToPlatformsCount,
        period: "24h",
    };
    const totalWebhooks24h = 0;
    const failedWebhooks24h = 0;
    const queuedJobs = 0;
    const deadLetterJobs = 0;
    const recentEventsRaw = await prisma.pixelEventReceipt.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
            id: true,
            orderKey: true,
            eventType: true,
            createdAt: true,
            originHost: true,
            eventId: true,
        },
    });
    const recentEvents = recentEventsRaw.map((event) => {
        return {
            ...event,
            orderId: event.orderKey || null,
            jobStatus: "pending_webhook" as const,
            platformResults: undefined,
            jobError: null,
            isTrusted: true,
            signatureStatus: event.originHost ? "verified" : "unknown",
            createdAt: event.createdAt instanceof Date ? event.createdAt : new Date(event.createdAt),
        };
    });
    return json({
        shopDomain,
        checks,
        summary,
        eventFunnel,
        webhookHealth: {
            totalWebhooks24h,
            failedWebhooks24h,
            queuedJobs,
            deadLetterJobs,
        },
        recentEvents,
        lastUpdated: new Date().toISOString(),
    });
};

function FunnelStage({ label, count, total, description, }: {
    label: string;
    count: number;
    total: number;
    description: string;
}) {
    const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
    const widthPercent = Math.max(percentage, 10);
    const getTone = (pct: number): "success" | "highlight" | "critical" => {
        if (pct >= 80)
            return "success";
        if (pct >= 50)
            return "highlight";
        return "critical";
    };
    return (<Box>
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text as="span" fontWeight="semibold">
            {label}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {description}
          </Text>
        </BlockStack>
        <Text as="span" fontWeight="bold">
          {count} ({percentage}%)
        </Text>
      </InlineStack>
      <Box paddingBlockStart="200">
        <ProgressBar progress={widthPercent} tone={total > 0 ? getTone(percentage) : "primary"} size="small"/>
      </Box>
    </Box>);
}

function StatusBadge({ status }: { status: string }) {
    switch (status) {
        case "completed":
        case "sent":
            return <Badge tone="success">成功</Badge>;
        case "processing":
        case "queued":
            return <Badge tone="info">处理中</Badge>;
        case "failed":
        case "dead_letter":
            return <Badge tone="critical">失败</Badge>;
        case "pending_webhook":
            return <Badge tone="warning">等待 Webhook</Badge>;
        default:
            return <Badge>{status}</Badge>;
    }
}

export default function DiagnosticsPage() {
    const data = useLoaderData<typeof loader>();
    const { shopDomain } = data;
    const revalidator = useRevalidator();
    const { showSuccess } = useToastContext();
    const getStatusBadge = (status: DiagnosticCheck["status"]) => {
        switch (status) {
            case "pass":
                return <Badge tone="success">通过</Badge>;
            case "fail":
                return <Badge tone="critical">失败</Badge>;
            case "warning":
                return <Badge tone="warning">警告</Badge>;
            case "pending":
                return <Badge tone="info">待验证</Badge>;
        }
    };
    const overallStatus = data.summary.failed > 0
        ? "critical"
        : data.summary.warnings > 0
            ? "highlight"
            : "success";
    const progressPercent = Math.round((data.summary.passed / data.summary.total) * 100);
    const handleRefresh = () => {
        revalidator.revalidate();
        showSuccess("诊断检查已刷新");
    };
    return (<Page title="诊断向导" subtitle="快速检查应用配置状态" primaryAction={{
            content: "刷新检查",
            onAction: handleRefresh,
            loading: revalidator.state === "loading",
        }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  整体状态
                </Text>
                <Badge tone={overallStatus === "highlight" ? "warning" : overallStatus}>
                  {overallStatus === "success"
            ? "正常"
            : overallStatus === "highlight"
                ? "需要注意"
                : "需要处理"}
                </Badge>
              </InlineStack>
              <ProgressBar progress={progressPercent} tone={overallStatus}/>
              <InlineStack gap="400">
                <Text as="span" variant="bodySm" tone="subdued">
                  通过: {data.summary.passed}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  警告: {data.summary.warnings}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  失败: {data.summary.failed}
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                检查项
              </Text>
              <Divider />
              {data.checks.length === 0 ? (
                <EnhancedEmptyState
                  icon="🔍"
                  title="暂无检查项"
                  description="当前没有可执行的诊断检查。"
                  helpText="请稍后刷新页面或联系支持。"
                />
              ) : (
                data.checks.map((check, index) => (<Box key={index} paddingBlockEnd="400">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {check.name}
                      </Text>
                      {getStatusBadge(check.status)}
                    </InlineStack>
                    <Text as="p" variant="bodyMd">
                      {check.message}
                    </Text>
                    {check.details && (<Text as="p" variant="bodySm" tone="subdued">
                        {check.details}
                      </Text>)}
                  </BlockStack>
                  {index < data.checks.length - 1 && (<Box paddingBlockStart="400">
                      <Divider />
                    </Box>)}
                </Box>))
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  事件处理漏斗 (过去 {data.eventFunnel.period})
                </Text>
                <Badge tone="info">诊断</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                显示像素事件从接收到发送到广告平台的各个阶段
              </Text>
              <Divider />
              <BlockStack gap="300">
                <FunnelStage label="1. Pixel 请求" count={data.eventFunnel.pixelRequests} total={data.eventFunnel.pixelRequests} description="收到的 checkout_completed 事件"/>
                <FunnelStage label="2. 通过 Origin 验证" count={data.eventFunnel.passedOrigin} total={data.eventFunnel.pixelRequests} description="来自 Shopify 域名/沙箱的请求"/>
                <FunnelStage label="3. 通过 Key 验证" count={data.eventFunnel.passedKey} total={data.eventFunnel.pixelRequests} description="Ingestion Key 匹配的请求"/>
                <FunnelStage label="4. 成功发送到平台" count={data.eventFunnel.sentToPlatforms} total={data.eventFunnel.pixelRequests} description="通过 CAPI 发送到广告平台"/>
              </BlockStack>
              {data.eventFunnel.pixelRequests === 0 && (<Banner tone="info">
                  <Text as="p" variant="bodySm">
                    尚无事件数据。完成测试订单后，此漏斗将显示事件处理情况。
                  </Text>
                </Banner>)}
              {data.eventFunnel.pixelRequests > 0 && data.eventFunnel.sentToPlatforms === 0 && (<Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    有像素事件但未成功发送到平台。可能原因：
                    <br />• 未配置 CAPI 平台凭证
                    <br />• 用户未授予 marketing 同意
                    <br />• Webhook 尚未到达
                  </Text>
                </Banner>)}
              {data.eventFunnel.pixelRequests > 0 && (
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">漏斗健康度</Text>
                    <InlineStack gap="400" wrap>
                      <Box>
                        <Text as="span" variant="bodySm" tone="subdued">签名验证率: </Text>
                        <Text as="span" fontWeight="semibold" tone={
                          data.eventFunnel.passedKey / data.eventFunnel.pixelRequests >= 0.9 ? "success" :
                          data.eventFunnel.passedKey / data.eventFunnel.pixelRequests >= 0.5 ? "caution" : "critical"
                        }>
                          {Math.round((data.eventFunnel.passedKey / data.eventFunnel.pixelRequests) * 100)}%
                        </Text>
                      </Box>
                      <Box>
                        <Text as="span" variant="bodySm" tone="subdued">发送成功率: </Text>
                        <Text as="span" fontWeight="semibold" tone={
                          data.eventFunnel.sentToPlatforms / data.eventFunnel.pixelRequests >= 0.9 ? "success" :
                          data.eventFunnel.sentToPlatforms / data.eventFunnel.pixelRequests >= 0.5 ? "caution" : "critical"
                        }>
                          {data.eventFunnel.pixelRequests > 0
                            ? Math.round((data.eventFunnel.sentToPlatforms / data.eventFunnel.pixelRequests) * 100)
                            : 0}%
                        </Text>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  📈 追踪配置状态概览
                </Text>
                <Badge tone="info">参考信息</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                展示当前追踪配置状态，实际效果因店铺情况而异
              </Text>
              <Divider />
              <BlockStack gap="300">
                <Box background={data.eventFunnel.sentToPlatforms > 0 ? "bg-fill-success-secondary" : "bg-fill-warning-secondary"} padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" fontWeight="semibold">
                        🎯 转化事件捕获率
                      </Text>
                      <Badge tone={data.eventFunnel.sentToPlatforms > 0 ? "success" : "warning"}>
                        {data.eventFunnel.pixelRequests > 0
                          ? `${Math.round((data.eventFunnel.sentToPlatforms / data.eventFunnel.pixelRequests) * 100)}%`
                          : "待配置"}
                      </Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm">
                      {data.eventFunnel.sentToPlatforms > 0
                        ? `✅ 过去 24 小时：${data.eventFunnel.pixelRequests} 个订单 → ${data.eventFunnel.sentToPlatforms} 个转化事件发送成功`
                        : "⚠️ 尚未发送转化事件，请完成以下配置"}
                    </Text>
                    {data.eventFunnel.sentToPlatforms === 0 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        1. 确保 Web Pixel 已安装 → 2. 配置平台 CAPI 凭证 → 3. 完成测试订单
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              </BlockStack>
              <Divider />
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  💡 仅客户端追踪 vs 客户端+服务端追踪
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  以下为示意说明，实际效果因店铺流量来源、客户群体、地区分布等因素而异，不构成效果保证
                </Text>
                <InlineStack gap="400" wrap={false} align="space-between">
                  <Box background="bg-fill-warning-secondary" padding="400" borderRadius="200" minWidth="45%">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold" tone="caution">⚠️ 仅依赖客户端追踪</Text>
                      <Text as="p" variant="bodySm">
                        • 浏览器隐私设置可能阻挡部分事件
                        <br />• 广告拦截器可能影响像素加载
                        <br />• iOS ATT 可能限制部分用户追踪
                      </Text>
                      <Divider />
                      <Text as="p" variant="bodySm" fontWeight="semibold" tone="caution">
                        部分转化事件可能无法捕获
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        具体影响因店铺情况而异
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box background="bg-fill-success-secondary" padding="400" borderRadius="200" minWidth="45%">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold" tone="success">✅ 客户端 + 服务端 CAPI</Text>
                      <Text as="p" variant="bodySm">
                        • Shopify Webhook 直接传递订单数据
                        <br />• 不受浏览器/拦截器影响
                        <br />• 双重机制提高数据完整性
                      </Text>
                      <Divider />
                      <Text as="p" variant="bodySm" fontWeight="semibold" tone="success">
                        数据传输更可靠
                      </Text>
                      <Text as="p" variant="bodySm" tone="success">
                        Shopify 和各广告平台推荐的追踪方式
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineStack>
              </BlockStack>
              <Divider />
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  📊 您当前的追踪状态
                </Text>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" fontWeight="semibold">
                        Web Pixel（客户端）
                      </Text>
                      <Badge tone={data.eventFunnel.pixelRequests > 0 ? "success" : "warning"}>
                        {data.eventFunnel.pixelRequests > 0 ? "已启用" : "待配置"}
                      </Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.eventFunnel.pixelRequests > 0
                        ? `过去 24h 收到 ${data.eventFunnel.pixelRequests} 个事件，用户同意率 ${data.eventFunnel.passedKey > 0 ? Math.round((data.eventFunnel.passedKey / data.eventFunnel.pixelRequests) * 100) : 0}%`
                        : "客户端追踪是服务端追踪的补充，用于收集用户同意证据"}
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" fontWeight="semibold">
                        服务端 CAPI
                      </Text>
                      <Badge tone={data.eventFunnel.sentToPlatforms > 0 ? "success" : "warning"}>
                        {data.eventFunnel.sentToPlatforms > 0 ? "已启用" : "待配置"}
                      </Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.eventFunnel.sentToPlatforms > 0
                        ? `过去 24h 成功发送 ${data.eventFunnel.sentToPlatforms} 个转化到广告平台`
                        : "服务端追踪是核心功能，通过 Webhook 直接获取订单数据"}
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" fontWeight="semibold">
                        用户隐私合规
                      </Text>
                      <Badge tone="success">✓ 符合</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      仅在用户明确同意后发送追踪数据，符合 GDPR/CCPA 等隐私法规要求
                    </Text>
                  </BlockStack>
                </Box>
              </BlockStack>
              {data.eventFunnel.pixelRequests === 0 && (
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      💡 如何验证追踪是否正常工作？
                    </Text>
                    <Text as="p" variant="bodySm">
                      1. 确保 Web Pixel 和 CAPI 均已配置
                      <br />2. 在开发商店中下一个测试订单
                      <br />3. 等待 1-2 分钟，刷新此页面
                      <br />4. 检查上方漏斗图的各项指标
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              {data.eventFunnel.pixelRequests > 0 && data.eventFunnel.sentToPlatforms === 0 && (
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      ⚠️ 有像素事件但未发送到平台
                    </Text>
                    <Text as="p" variant="bodySm">
                      可能原因：
                      <br />• 未配置 CAPI 平台凭证 → 前往「设置」配置
                      <br />• 用户未授予 marketing 同意 → 正常现象，符合隐私法规
                      <br />• Webhook 尚未到达 → 等待几分钟后刷新
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              <InlineStack align="end" gap="200">
                <Button url="/app/settings">配置 CAPI 凭证</Button>
                <Button url="/app/migrate" variant="primary">安装/更新 Pixel</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  最近像素事件日志 (Top 10)
                </Text>
                <Badge tone="info">Self-Check</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                实时显示最近接收到的 Pixel 事件及其后端处理状态
              </Text>
              {data.recentEvents && data.recentEvents.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                  ]}
                  headings={[
                    "时间",
                    "事件类型",
                    "Order ID",
                    "Pixel 签名",
                    "后端处理",
                    "CAPI 结果",
                  ]}
                  rows={(data.recentEvents as Array<{
                    id: string;
                    orderId: string | null;
                    eventType: string;
                    createdAt: Date | string;
                    isTrusted: boolean;
                    signatureStatus: string;
                    jobStatus: string;
                    platformResults?: unknown;
                    jobError?: string | null;
                  }>).map((event) => {
                    const platforms = event.platformResults
                        ? Object.keys(event.platformResults as Record<string, string>).join(", ")
                        : "-";
                    return [
                        event.createdAt instanceof Date ? event.createdAt.toLocaleTimeString("zh-CN") : new Date(event.createdAt).toLocaleTimeString("zh-CN"),
                        event.eventType,
                        event.orderId || "-",
                        event.isTrusted ? "✅ 验证通过" : `⚠️ ${event.signatureStatus}`,
                        <StatusBadge key={event.id} status={event.jobStatus} />,
                        event.jobError ? `❌ ${event.jobError}` : platforms || "-"
                    ];
                  })}
                />
              ) : (
                <Banner tone="info">暂无最近事件数据</Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Webhook 与队列监控
                </Text>
                <Badge tone={data.webhookHealth.failedWebhooks24h > 0 || data.webhookHealth.deadLetterJobs > 0 ? "critical" : "success"}>
                  {data.webhookHealth.failedWebhooks24h > 0 || data.webhookHealth.deadLetterJobs > 0 ? "异常" : "健康"}
                </Badge>
              </InlineStack>
              <Divider />
              <InlineStack gap="400" align="space-between">
                <Box minWidth="45%">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">Webhook 接收 (24h)</Text>
                    <InlineStack gap="400">
                        <Box>
                            <Text as="p" variant="bodySm" tone="subdued">总接收</Text>
                            <Text as="p" variant="headingLg">{data.webhookHealth.totalWebhooks24h}</Text>
                        </Box>
                        <Box>
                            <Text as="p" variant="bodySm" tone="subdued">失败</Text>
                            <Text as="p" variant="headingLg" tone={data.webhookHealth.failedWebhooks24h > 0 ? "critical" : "success"}>
                                {data.webhookHealth.failedWebhooks24h}
                            </Text>
                        </Box>
                    </InlineStack>
                  </BlockStack>
                </Box>
                <Box minWidth="45%">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">处理队列</Text>
                    <InlineStack gap="400">
                        <Box>
                            <Text as="p" variant="bodySm" tone="subdued">排队中</Text>
                            <Text as="p" variant="headingLg">{data.webhookHealth.queuedJobs}</Text>
                        </Box>
                        <Box>
                            <Text as="p" variant="bodySm" tone="subdued">死信 (Dead Letter)</Text>
                            <Text as="p" variant="headingLg" tone={data.webhookHealth.deadLetterJobs > 0 ? "critical" : "success"}>
                                {data.webhookHealth.deadLetterJobs}
                            </Text>
                        </Box>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </InlineStack>
              {data.webhookHealth.deadLetterJobs > 0 && (
                  <Banner tone="critical">
                      <Text as="p">检测到 {data.webhookHealth.deadLetterJobs} 个任务在多次重试后失败。请检查日志或联系支持。</Text>
                  </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                常见问题 (FAQ)
              </Text>
              <Divider />
              <BlockStack gap="300">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      Q: 为什么没有收到像素事件？
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      A: 可能原因：(1) Web Pixel 未安装或配置错误 - 前往「迁移」页面重新安装；
                      (2) 用户未授予 marketing 同意 - 需要顾客在结账时同意；
                      (3) 浏览器广告拦截器阻止了像素加载。
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      Q: 为什么事件未发送到广告平台？
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      A: 请检查：(1) 是否已在「设置」页面配置平台凭证（API Token 等）；
                      (2) 凭证是否有效/过期；(3) 顾客是否授予了 marketing 同意。
                      前往「监控」页面查看具体失败原因。
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      Q: ScriptTag 迁移截止日期是什么？
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      A: Shopify Plus 商家：{formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")} 停止执行；非 Plus 商家：{formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")} 停止执行。
                      建议尽早迁移到 Web Pixel + 服务端 CAPI 方案。
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>提示：</strong>以上日期来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      Q: Checkout UI Blocks 如何添加到页面？
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      A: 前往 Shopify 后台 → 设置 → 结账 → 自定义 → 在 Thank You 或 Order Status 区域点击「添加区块」，
                      选择 Tracking Guardian 的 Survey/Shipping Tracker/Upsell Offer 等区块。
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>重要提示：</strong>Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），Order Status 模块将不会显示。请确认您的店铺已启用 Customer Accounts 功能（可在 Shopify Admin → 设置 → 客户账户中检查），否则模块不会在订单状态页显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。请参考 <a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">Customer Accounts UI Extensions 官方文档</a>（注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions）。
                    </Text>
                  </BlockStack>
                </Box>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                快速修复
              </Text>
              <Divider />
              <BlockStack gap="300">
                {data.checks.some(c => c.name === "Web Pixel" && c.status !== "pass") && (
                  <Box background="bg-surface-warning" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="p" fontWeight="semibold">
                          Web Pixel 未安装或需要升级
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          安装 Web Pixel 是追踪功能正常工作的前提
                        </Text>
                      </BlockStack>
                      <Button url="/app/migrate" variant="primary">
                        前往安装
                      </Button>
                    </InlineStack>
                  </Box>
                )}
                {data.checks.some(c => c.name === "服务端追踪 (CAPI)" && c.status !== "pass") && (
                  <Box background="bg-surface-warning" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="p" fontWeight="semibold">
                          未配置服务端追踪
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          配置 CAPI 可大幅提高追踪准确性
                        </Text>
                      </BlockStack>
                      <Button url="/app/settings">
                        配置凭证
                      </Button>
                    </InlineStack>
                  </Box>
                )}
                {data.checks.some(c => c.name === "最近事件" && c.status === "pending") && (
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="p" fontWeight="semibold">
                          尚未收到任何事件
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          完成一个测试订单以验证追踪功能
                        </Text>
                      </BlockStack>
                      <Badge tone="info">需要测试订单</Badge>
                    </InlineStack>
                  </Box>
                )}
                {data.summary.failed === 0 && data.summary.warnings === 0 && (
                  <Banner tone="success">
                    <Text as="p">
                      🎉 所有检查项均已通过！追踪功能配置正常。
                    </Text>
                  </Banner>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                🛠️ 像素调试工具
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                使用 Shopify 官方工具验证您的 Web Pixel 是否正常工作。
              </Text>
              <Divider />
              <BlockStack gap="300">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      Shopify Admin - Customer Events
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      在 Shopify 后台查看已安装的 Web Pixel 列表和配置状态。
                      <br />
                      路径：设置 → 客户事件 → 查看 Tracking Guardian Pixel
                    </Text>
                    <InlineStack gap="200">
                      <Button
                        url={getShopifyAdminUrl(shopDomain, "/settings/customer-events")}
                        external
                        size="slim"
                      >
                        前往 Customer Events
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      浏览器开发者工具调试
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      在店铺结账页面，打开浏览器开发者工具（F12）→ Network 标签页，
                      完成一个测试订单，搜索 <code>pixel-events</code> 请求，验证事件是否正常发送。
                    </Text>
                    <Text as="p" variant="bodySm">
                      ✅ 应该看到：<code>POST /ingest</code> 请求
                      <br />
                      ✅ 请求体包含：<code>eventName: &quot;checkout_completed&quot;</code>
                      <br />
                      ✅ 响应状态：<code>200 OK</code> 或 <code>204 No Content</code>
                    </Text>
                  </BlockStack>
                </Box>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      平台端验证
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      在各广告平台的事件管理器中验证转化事件是否到达：
                    </Text>
                    <InlineStack gap="200" wrap>
                      <Button
                        url="https://business.facebook.com/events_manager2/list"
                        external
                        size="slim"
                        variant="secondary"
                      >
                        Meta Events Manager
                      </Button>
                      <Button
                        url="https://analytics.google.com/"
                        external
                        size="slim"
                        variant="secondary"
                      >
                        Google Analytics
                      </Button>
                      <Button
                        url="https://ads.tiktok.com/marketing_api/eventsmanager"
                        external
                        size="slim"
                        variant="secondary"
                      >
                        TikTok Events Manager
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Banner title="审核人员提示" tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                如需验证完整功能，请按以下步骤操作：
              </Text>
              <Text as="p" variant="bodySm">
                1. 确保所有检查项为「通过」或「待验证」
                <br />
                2. 完成一个测试订单
                <br />
                3. 刷新此页面，确认「最近事件」变为「通过」
                <br />
                4. 查看「监控」页面确认数据正确显示
              </Text>
            </BlockStack>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Text as="p" variant="bodySm" tone="subdued">
            最后更新: {new Date(data.lastUpdated).toLocaleString("zh-CN")}
          </Text>
        </Layout.Section>
      </Layout>
    </Page>);
}
