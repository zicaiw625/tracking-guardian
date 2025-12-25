import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Box, Divider, DataTable, Select, ProgressBar, Button, Icon, Link, Banner } from "@shopify/polaris";
import { SettingsIcon, SearchIcon, RefreshIcon, ArrowRightIcon, } from "@shopify/polaris-icons";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getDeliveryHealthHistory, getDeliveryHealthSummary, type DeliveryHealthReport, } from "../services/delivery-health.server";
import { isValidPlatform, PLATFORM_NAMES } from "../types";
interface DeliverySummary {
    platform: string;
    last7DaysAttempted: number;
    last7DaysSent: number;
    avgSuccessRate: number;
    topFailureReasons: Array<{
        reason: string;
        count: number;
    }>;
}
interface ConversionStat {
    platform: string;
    status: string;
    _count: number;
    _sum: {
        orderValue: number | null;
    };
}
interface ProcessedStat {
    total: number;
    sent: number;
    failed: number;
    revenue: number;
}
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
    });
    if (!shop) {
        return json({ 
            shop: null, 
            summary: {}, 
            history: [], 
            conversionStats: null,
            configHealth: {
                appUrl: process.env.SHOPIFY_APP_URL || "",
                lastPixelOrigin: null,
                lastPixelTime: null
            },
            lastUpdated: new Date().toISOString()
        });
    }
    const summary = await getDeliveryHealthSummary(shop.id);
    const history = await getDeliveryHealthHistory(shop.id, 30);
    // P0-3: 使用 UTC 确保跨时区一致性
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);
    const conversionStats = await prisma.conversionLog.groupBy({
        by: ["platform", "status"],
        where: {
            shopId: shop.id,
            createdAt: { gte: sevenDaysAgo },
        },
        _count: true,
        _sum: { orderValue: true },
    });

    // P1-9: Runtime configuration check
    const appUrl = process.env.SHOPIFY_APP_URL || "";
    const latestReceipt = await prisma.pixelEventReceipt.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        select: { 
            originHost: true,
            createdAt: true 
        }
    });

    return json({
        shop: { id: shop.id, domain: shopDomain },
        summary,
        history,
        conversionStats,
        configHealth: {
            appUrl,
            lastPixelOrigin: latestReceipt?.originHost || null,
            lastPixelTime: latestReceipt?.createdAt || null
        },
        lastUpdated: new Date().toISOString()
    });
};
export default function MonitorPage() {
    const { summary, history, conversionStats, configHealth, lastUpdated } = useLoaderData<typeof loader>();
    const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
    
    // Check for environment mismatch
    // const isProd = configHealth.appUrl && !configHealth.appUrl.includes("ngrok") && !configHealth.appUrl.includes("localhost");
    const isDevUrl = configHealth.appUrl && (configHealth.appUrl.includes("ngrok") || configHealth.appUrl.includes("trycloudflare"));
    
    // Warning if pixel is sending from a different host than expected (mostly for dev/prod mixups)
    // Note: originHost is where the pixel RUNS (storefront), not where it sends TO.
    // However, if we receive it, it means it sent to US.
    // The check requested is "fallback URL" - if pixel sends to OLD url.
    // If we received it, it sent to current URL. So this confirms connectivity.
    // If we haven't received anything recently, that's the issue.
    const lastHeartbeat = configHealth.lastPixelTime ? new Date(configHealth.lastPixelTime) : null;
    const isHeartbeatStale = lastHeartbeat ? (new Date(lastUpdated).getTime() - lastHeartbeat.getTime() > 24 * 60 * 60 * 1000) : true;

    const summaryData: Record<string, DeliverySummary> = (summary ?? {}) as Record<string, DeliverySummary>;
    const historyData = ((history ?? []) as unknown as Array<Omit<DeliveryHealthReport, 'reportDate'> & {
        reportDate: string;
    }>).map((h) => ({
        ...h,
        reportDate: new Date(h.reportDate),
    }));
    const statsData: ConversionStat[] | null = conversionStats as ConversionStat[] | null;
    const calculateHealthScore = (): number | null => {
        const platforms = Object.keys(summaryData);
        if (platforms.length === 0)
            return null;
        const avgSuccessRate = platforms.reduce((sum, p) => sum + (summaryData[p]?.avgSuccessRate || 0), 0) / platforms.length;
        if (avgSuccessRate < 0.8)
            return 40;
        if (avgSuccessRate < 0.9)
            return 70;
        if (avgSuccessRate < 0.95)
            return 85;
        return 95;
    };
    const healthScore = calculateHealthScore();
    const hasData = Object.keys(summaryData).length > 0;
    const filteredHistory = selectedPlatform === "all"
        ? historyData
        : historyData.filter((h) => h.platform === selectedPlatform);
    const processedStats = statsData?.reduce<Record<string, ProcessedStat>>((acc, stat) => {
        if (!acc[stat.platform]) {
            acc[stat.platform] = { total: 0, sent: 0, failed: 0, revenue: 0 };
        }
        acc[stat.platform].total += stat._count;
        if (stat.status === "sent") {
            acc[stat.platform].sent += stat._count;
            acc[stat.platform].revenue += Number(stat._sum?.orderValue || 0);
        }
        else if (stat.status === "failed") {
            acc[stat.platform].failed += stat._count;
        }
        return acc;
    }, {});
    const platformOptions = [
        { label: "所有平台", value: "all" },
        ...Object.keys(summaryData).map((p) => ({
            label: isValidPlatform(p) ? PLATFORM_NAMES[p] : p,
            value: p,
        })),
    ];
    return (<Page title="监控面板" subtitle="追踪健康状况和转化发送成功率报告" primaryAction={{
            content: "配置追踪平台",
            url: "/app/migrate",
        }} secondaryActions={[
            {
                content: "运行诊断",
                url: "/app/diagnostics",
            }
        ]}>
      <BlockStack gap="500">
        
        {!hasData && (<Card>
            <BlockStack gap="500">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    还没开始监控
                  </Text>
                  <Text as="p" tone="subdued">
                    连接平台后，我们会基于服务端转化发送日志计算发送成功率，帮助您发现追踪问题。
                  </Text>
                </BlockStack>
                <Badge tone="info">未初始化</Badge>
              </InlineStack>

              <Box background="bg-surface-secondary" padding="600" borderRadius="200">
                <BlockStack gap="200" align="center">
                  <Text as="p" variant="headingLg" fontWeight="semibold" tone="subdued">
                    健康度评分
                  </Text>
                  <Text as="p" variant="heading2xl" fontWeight="bold" tone="subdued">
                    --
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    完成平台连接并产生订单数据后开始评分
                  </Text>
                </BlockStack>
              </Box>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  开始监控
                </Text>
                <InlineStack gap="300">
                  <Button url="/app/migrate" variant="primary">
                    配置追踪平台
                  </Button>
                  <Button url="/app/settings">
                    配置告警通知
                  </Button>
                </InlineStack>
              </BlockStack>

              <Text as="p" variant="bodySm" tone="subdued">
                <Link url="https://help.shopify.com/en/manual/promoting-marketing/pixels" external>
                  了解 Pixels 和 Customer Events
                </Link>
              </Text>
            </BlockStack>
          </Card>)}

        
        {hasData && (<Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      整体健康度
                    </Text>
                    <Badge tone={healthScore !== null && healthScore > 80
                ? "success"
                : healthScore !== null && healthScore > 60
                    ? "attention"
                    : "critical"}>
                      {healthScore !== null && healthScore > 80
                ? "健康"
                : healthScore !== null && healthScore > 60
                    ? "有风险"
                    : "需要关注"}
                    </Badge>
                  </InlineStack>
                  <Box background={healthScore !== null && healthScore > 80
                ? "bg-fill-success"
                : healthScore !== null && healthScore > 60
                    ? "bg-fill-warning"
                    : "bg-fill-critical"} padding="600" borderRadius="200">
                    <BlockStack gap="200" align="center">
                      <Text as="p" variant="heading3xl" fontWeight="bold">
                        {healthScore ?? "--"}
                      </Text>
                      <Text as="p" variant="bodySm">
                        / 100
                      </Text>
                    </BlockStack>
                  </Box>
                  <ProgressBar progress={healthScore ?? 0} tone={healthScore !== null && healthScore > 80
                ? "success"
                : healthScore !== null && healthScore > 60
                    ? "highlight"
                    : "critical"}/>
                  <Text as="p" variant="bodySm" tone="subdued">
                    评分依据：过去 7 天发送成功率
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            
            {Object.entries(summaryData).map(([platform, data]) => (<Layout.Section key={platform} variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">
                        {isValidPlatform(platform) ? PLATFORM_NAMES[platform] : platform}
                      </Text>
                      <Badge tone={data.avgSuccessRate >= 0.95
                    ? "success"
                    : data.avgSuccessRate >= 0.8
                        ? "attention"
                        : "critical"}>
                        {`${(data.avgSuccessRate * 100).toFixed(1)}% 成功率`}
                      </Badge>
                    </InlineStack>
                    <Divider />
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">
                        尝试发送
                      </Text>
                      <Text as="span" fontWeight="semibold">
                        {data.last7DaysAttempted}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">
                        成功发送
                      </Text>
                      <Text as="span" fontWeight="semibold">
                        {data.last7DaysSent}
                      </Text>
                    </InlineStack>
                    {data.topFailureReasons.length > 0 && (<>
                        <Divider />
                        <Text as="p" variant="bodySm" tone="subdued">
                          主要失败原因：{data.topFailureReasons[0]?.reason || "未知"}
                        </Text>
                      </>)}
                  </BlockStack>
                </Card>
              </Layout.Section>))}
          </Layout>)}

        
        {processedStats && Object.keys(processedStats).length > 0 && (<Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                过去 7 天转化发送统计
              </Text>
              <DataTable columnContentTypes={["text", "numeric", "numeric", "numeric", "text"]} headings={["平台", "总转化", "成功发送", "发送失败", "发送成功率"]} rows={Object.entries(processedStats).map(([platform, stats]) => [
                isValidPlatform(platform) ? PLATFORM_NAMES[platform] : platform,
                stats.total,
                stats.sent,
                stats.failed,
                stats.total > 0
                    ? `${((stats.sent / stats.total) * 100).toFixed(1)}%`
                    : "-",
            ])}/>
            </BlockStack>
          </Card>)}

        
        {historyData.length > 0 && (<Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  发送日志核对记录
                </Text>
                <Select label="" labelHidden options={platformOptions} value={selectedPlatform} onChange={setSelectedPlatform}/>
              </InlineStack>
              <DataTable columnContentTypes={[
                "text",
                "text",
                "numeric",
                "numeric",
                "text",
                "text",
            ]} headings={[
                "日期",
                "平台",
                "待发送",
                "成功发送",
                "失败率",
                "状态",
            ]} rows={filteredHistory.slice(0, 20).map((report) => [
                new Date(report.reportDate).toLocaleDateString("zh-CN"),
                isValidPlatform(report.platform) ? PLATFORM_NAMES[report.platform] : report.platform,
                report.shopifyOrders,
                report.platformConversions,
                `${(report.orderDiscrepancy * 100).toFixed(1)}%`,
                report.alertSent ? "⚠️ 已报警" : "✓ 正常",
            ])}/>
            </BlockStack>
          </Card>)}

        {/* Runtime Configuration Health Check */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                运行环境自检
              </Text>
              <Badge tone={!isHeartbeatStale ? "success" : "warning"}>
                {!isHeartbeatStale ? "连接正常" : "无近期心跳"}
              </Badge>
            </InlineStack>
            
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack align="space-between">
                   <Text as="span" tone="subdued">当前应用后端 (App URL)</Text>
                   <Text as="span" fontWeight="semibold">{configHealth.appUrl || "未检测到"}</Text>
                </InlineStack>
                {isDevUrl && (
                  <Banner tone="warning">
                    <Text as="p" variant="bodySm">
                      ⚠️ 检测到开发环境 URL (ngrok/cloudflare)。请确保 Web Pixel 扩展已使用最新 URL 重新构建/推送，否则可能导致事件发送失败。
                    </Text>
                  </Banner>
                )}
                
                <Divider />
                
                <InlineStack align="space-between">
                   <Text as="span" tone="subdued">最近一次 Pixel 连接</Text>
                   <Text as="span" fontWeight={configHealth.lastPixelTime ? "semibold" : "regular"}>
                     {configHealth.lastPixelTime 
                       ? new Date(configHealth.lastPixelTime).toLocaleString("zh-CN") 
                       : "尚未收到事件"}
                   </Text>
                </InlineStack>
                
                {configHealth.lastPixelOrigin && (
                  <InlineStack align="space-between">
                     <Text as="span" tone="subdued">来源店铺域名 (Origin)</Text>
                     <Text as="span">{configHealth.lastPixelOrigin}</Text>
                  </InlineStack>
                )}

                {isHeartbeatStale && hasData && (
                  <Banner tone="critical">
                    <Text as="p" variant="bodySm">
                      超过 24 小时未收到 Web Pixel 心跳事件。请检查：
                      <br />1. Web Pixel 是否已在 Shopify 后台断开连接
                      <br />2. 如果是开发环境，确保 App URL 未变更（ngrok 重启后需更新）
                    </Text>
                  </Banner>
                )}
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              提高追踪准确性的建议
            </Text>
            <BlockStack gap="300">
              
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={SettingsIcon} tone="base"/>
                      <Text as="span" fontWeight="semibold">
                        启用服务端追踪
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      配置 Conversions API（CAPI）可降低广告拦截器影响，提高追踪数据的一致性
                    </Text>
                  </BlockStack>
                  <Button url="/app/settings" size="slim" icon={ArrowRightIcon}>
                    配置
                  </Button>
                </InlineStack>
              </Box>

              
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={SearchIcon} tone="base"/>
                      <Text as="span" fontWeight="semibold">
                        检查 Web Pixel 配置
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      确保 Web Pixel 代码在所有页面正常加载，验证事件是否正确触发
                    </Text>
                  </BlockStack>
                  <Button url="/app/migrate" size="slim" icon={ArrowRightIcon}>
                    验证
                  </Button>
                </InlineStack>
              </Box>

              
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={RefreshIcon} tone="base"/>
                      <Text as="span" fontWeight="semibold">
                        定期扫描追踪脚本
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      建议每月进行一次扫描，确保追踪配置最新，及时发现问题
                    </Text>
                  </BlockStack>
                  <Button url="/app/scan" size="slim" icon={ArrowRightIcon}>
                    扫描
                  </Button>
                </InlineStack>
              </Box>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>);
}
