import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Box, Divider, DataTable, Select, ProgressBar, Button, Icon, Link, Banner, List } from "@shopify/polaris";
import { SettingsIcon, SearchIcon, RefreshIcon, ArrowRightIcon, AlertCircleIcon, CheckCircleIcon, } from "~/components/icons";
import { TableSkeleton, EnhancedEmptyState, useToastContext } from "~/components/ui";
import { MissingParamsChart } from "~/components/monitor/MissingParamsChart";
import { EventVolumeChart } from "~/components/monitor/EventVolumeChart";
import { RealtimeEventMonitor } from "~/components/monitor/RealtimeEventMonitor";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getDeliveryHealthHistory, getDeliveryHealthSummary, type DeliveryHealthReport, } from "../services/delivery-health.server";
import { getAlertHistory, runAlertChecks, type AlertCheckResult } from "../services/alert-dispatcher.server";
import { isValidPlatform, PLATFORM_NAMES } from "../types";
import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats, checkMonitoringAlerts, getMissingParamsHistory, reconcileChannels, type EventMonitoringStats, type EventVolumeStats, type ChannelReconciliationResult } from "../services/monitoring.server";
import { getMissingParamsRate } from "../services/event-validation.server";
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
            lastUpdated: new Date().toISOString(),
            monitoringStats: null,
            missingParamsStats: [],
            volumeStats: null,
            monitoringAlert: null,
        });
    }
    const summary = await getDeliveryHealthSummary(shop.id);
    const history = await getDeliveryHealthHistory(shop.id, 30);

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

    const appUrl = process.env.SHOPIFY_APP_URL || "";
    const latestReceipt = await prisma.pixelEventReceipt.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        select: {
            originHost: true,
            createdAt: true
        }
    });

    const alertConfigs = await prisma.alertConfig.findMany({
        where: { shopId: shop.id, isEnabled: true },
        select: { id: true, channel: true, frequency: true },
    });

    const recentAlerts = await getAlertHistory(shop.id, 10);

    let currentAlertStatus: AlertCheckResult[] = [];
    try {
        const checkResult = await runAlertChecks(shop.id);
        currentAlertStatus = checkResult.results.filter(r => r.triggered);
    } catch (error) {

    }

    const [monitoringStats, missingParamsStats, volumeStats, monitoringAlert, missingParamsHistory, eventVolumeHistory, channelReconciliation] = await Promise.all([
        getEventMonitoringStats(shop.id, 24),
        getMissingParamsStats(shop.id, 24),
        getEventVolumeStats(shop.id),
        checkMonitoringAlerts(shop.id).catch(() => null),
        getMissingParamsHistory(shop.id, 7).catch(() => []),
        getEventVolumeHistory(shop.id, 7).catch(() => []),
        reconcileChannels(shop.id, 24).catch(() => []),
    ]);

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
        alertConfigs: alertConfigs.length > 0,
        alertCount: alertConfigs.length,
        recentAlerts,
        currentAlertStatus,
        monitoringStats,
        missingParamsStats,
        volumeStats,
        monitoringAlert,
        missingParamsHistory,
        eventVolumeHistory,
        channelReconciliation,
        lastUpdated: new Date().toISOString()
    });
};
export default function MonitorPage() {
  const { summary, history, conversionStats, configHealth, alertConfigs, alertCount, recentAlerts, currentAlertStatus, monitoringStats, missingParamsStats, volumeStats, monitoringAlert, missingParamsHistory, eventVolumeHistory, channelReconciliation, lastUpdated } = useLoaderData<typeof loader>();
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [selectedChartPlatform, setSelectedChartPlatform] = useState<string>("all");

    const isDevUrl = configHealth.appUrl && (configHealth.appUrl.includes("ngrok") || configHealth.appUrl.includes("trycloudflare"));

  const lastHeartbeat = configHealth.lastPixelTime ? new Date(configHealth.lastPixelTime) : null;
  const isHeartbeatStale = lastHeartbeat ? (new Date(lastUpdated).getTime() - lastHeartbeat.getTime() > 24 * 60 * 60 * 1000) : true;

  const heartbeatTone: "success" | "warning" | "critical" = (() => {
    if (!lastHeartbeat) return "critical";
    if (isHeartbeatStale) return "warning";
    return "success";
  })();

  const heartbeatLabel = (() => {
    if (!lastHeartbeat) return "未收到像素心跳";
    const diffMs = new Date(lastUpdated).getTime() - lastHeartbeat.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return "< 1 小时前";
    if (diffHours < 24) return `${diffHours} 小时前`;
    const diffDays = Math.ceil(diffHours / 24);
    return `${diffDays} 天前`;
  })();

  const heartbeatDescription = (() => {
    if (!lastHeartbeat) {
      return "尚未收到任何像素请求，请先在测试店铺下单并确认 Web Pixel 已安装。";
    }
    if (isHeartbeatStale) {
      return "超过 24 小时未收到新的像素请求，建议执行一次测试订单或检查域名配置。";
    }
    return "最近已收到像素心跳，可继续执行事件参数对账或多渠道验证。";
  })();

  const originHost = configHealth.lastPixelOrigin || "未记录";
  const isOriginDevHost = originHost.includes("ngrok") || originHost.includes("trycloudflare") || originHost.includes("localhost");
  const environmentWarning = isOriginDevHost && configHealth.appUrl && !configHealth.appUrl.includes("ngrok") && !configHealth.appUrl.includes("trycloudflare")
    ? "像素来自开发隧道域名，而应用 URL 指向生产。请确认 Pixel 使用的 backend_url 是否为生产域名。"
    : null;

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

        {!hasData && (
          <EnhancedEmptyState
            icon="📊"
            title="还没开始监控"
            description="连接平台后，我们会基于服务端转化发送日志计算发送成功率，帮助您发现追踪问题。"
            helpText="完成平台连接并产生订单数据后开始评分。"
            primaryAction={{
              content: "配置追踪平台",
              url: "/app/migrate",
            }}
            secondaryAction={{
              content: "配置告警通知",
              url: "/app/settings",
            }}
          />
        )}

        {}
        {monitoringAlert && monitoringAlert.shouldAlert && (
          <Banner
            title="监控告警"
            tone={monitoringAlert.severity === "critical" ? "critical" : "warning"}
          >
            <BlockStack gap="200">
              <Text as="p">{monitoringAlert.reason}</Text>
              {monitoringStats && (
                <Text as="p" variant="bodySm" tone="subdued">
                  成功率: {monitoringStats.successRate.toFixed(2)}% |
                  失败率: {monitoringStats.failureRate.toFixed(2)}%
                </Text>
              )}
            </BlockStack>
          </Banner>
        )}

        {}
        {volumeStats && volumeStats.isDrop && (
          <Banner
            title="事件量下降"
            tone="warning"
          >
            <BlockStack gap="200">
              <Text as="p">
                最近24小时事件量: {volumeStats.current24h} |
                前24小时: {volumeStats.previous24h} |
                变化: {volumeStats.changePercent.toFixed(2)}%
              </Text>
              {volumeStats.average7Days !== undefined && (
                <Text as="p" variant="bodySm" tone="subdued">
                  7天平均值: {volumeStats.average7Days.toFixed(0)} |
                  标准差: {volumeStats.stdDev?.toFixed(0) || "N/A"} |
                  异常阈值: {volumeStats.threshold?.toFixed(0) || "N/A"}
                </Text>
              )}
              <Text as="p" variant="bodySm" tone="subdued">
                如果下降超过50%，可能发生追踪断档，请检查像素配置和网络连接。
              </Text>
            </BlockStack>
          </Banner>
        )}

        {}
        {shop && (
          <RealtimeEventMonitor
            shopId={shop.id}
            autoStart={false}
          />
        )}

        {}
        {eventVolumeHistory && eventVolumeHistory.length > 0 && volumeStats && (
          <EventVolumeChart
            historyData={eventVolumeHistory}
            current24h={volumeStats.current24h}
            previous24h={volumeStats.previous24h}
            changePercent={volumeStats.changePercent}
            isDrop={volumeStats.isDrop}
          />
        )}

        {}
        {monitoringStats && missingParamsStats && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  📊 缺参率监控（最近24小时）
                </Text>
                {monitoringStats.totalEvents > 0 && (
                  <Badge
                    tone={
                      (() => {
                        const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                        const missingRate = (totalMissing / monitoringStats.totalEvents) * 100;
                        return missingRate < 5 ? "success" : missingRate < 10 ? "warning" : "critical";
                      })()
                    }
                  >
                    {(() => {
                      const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                      const missingRate = (totalMissing / monitoringStats.totalEvents) * 100;
                      return `缺参率: ${missingRate.toFixed(2)}%`;
                    })()}
                  </Badge>
                )}
              </InlineStack>

              {monitoringStats.totalEvents === 0 ? (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    暂无事件数据，完成订单后将显示缺参率统计。
                  </Text>
                </Banner>
              ) : missingParamsStats.length === 0 ? (
                <Banner tone="success">
                  <Text as="p" variant="bodySm">
                    ✅ 所有事件参数完整，未发现缺失情况。
                  </Text>
                </Banner>
              ) : (
                <BlockStack gap="300">
                  {}
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">总体缺参率</Text>
                        <Text
                          as="span"
                          variant="headingLg"
                          tone={(() => {
                            const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                            const missingRate = (totalMissing / monitoringStats.totalEvents) * 100;
                            return missingRate < 5 ? "success" : missingRate < 10 ? "warning" : "critical";
                          })()}
                        >
                          {(() => {
                            const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                            const missingRate = (totalMissing / monitoringStats.totalEvents) * 100;
                            return `${missingRate.toFixed(2)}%`;
                          })()}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">缺失事件数</Text>
                        <Text as="span" variant="headingMd">
                          {missingParamsStats.reduce((sum, s) => sum + s.count, 0)} / {monitoringStats.totalEvents}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </Box>

                  <Divider />

                  {}
                  {monitoringStats.totalEvents > 0 && (
                    <Box
                      background={(() => {
                        const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                        const overallRate = (totalMissing / monitoringStats.totalEvents) * 100;
                        if (overallRate < 5) return "bg-fill-success-secondary";
                        if (overallRate < 10) return "bg-fill-warning-secondary";
                        return "bg-fill-critical-secondary";
                      })()}
                      padding="400"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          总体缺参率
                        </Text>
                        <InlineStack gap="400" wrap>
                          <Box>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">缺参率</Text>
                              <Text
                                as="span"
                                variant="headingXl"
                                tone={(() => {
                                  const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                                  const overallRate = (totalMissing / monitoringStats.totalEvents) * 100;
                                  if (overallRate < 5) return "success";
                                  if (overallRate < 10) return "warning";
                                  return "critical";
                                })()}
                                fontWeight="bold"
                              >
                                {(() => {
                                  const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                                  return monitoringStats.totalEvents > 0
                                    ? ((totalMissing / monitoringStats.totalEvents) * 100).toFixed(2)
                                    : "0.00";
                                })()}%
                              </Text>
                            </BlockStack>
                          </Box>
                          <Box>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">缺失事件数</Text>
                              <Text as="span" variant="headingLg" fontWeight="semibold">
                                {missingParamsStats.reduce((sum, s) => sum + s.count, 0)} / {monitoringStats.totalEvents}
                              </Text>
                            </BlockStack>
                          </Box>
                          <Box>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">涉及平台/事件</Text>
                              <Text as="span" variant="headingLg" fontWeight="semibold">
                                {missingParamsStats.length} 种组合
                              </Text>
                            </BlockStack>
                          </Box>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}

                  {}
                  <Text as="h3" variant="headingSm">
                    详细统计
                  </Text>
                  <BlockStack gap="200">
                    {missingParamsStats.slice(0, 10).map((stat, idx) => {
                      const platformName = isValidPlatform(stat.platform)
                        ? PLATFORM_NAMES[stat.platform]
                        : stat.platform;
                      const missingRate = monitoringStats.totalEvents > 0
                        ? (stat.count / monitoringStats.totalEvents) * 100
                        : 0;

                      return (
                        <Box
                          key={idx}
                          background="bg-surface-secondary"
                          padding="300"
                          borderRadius="200"
                        >
                          <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <Badge tone={missingRate < 5 ? "success" : missingRate < 10 ? "warning" : "critical"}>
                                  {platformName} - {stat.eventType}
                                </Badge>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {stat.count} 次缺失
                                </Text>
                              </InlineStack>
                              <Text as="span" variant="bodySm" fontWeight="semibold">
                                {missingRate.toFixed(2)}%
                              </Text>
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="subdued">
                              缺失参数: {stat.missingParams.join(", ")}
                            </Text>
                          </BlockStack>
                        </Box>
                      );
                    })}
                  </BlockStack>

                  {missingParamsStats.length > 10 && (
                    <Banner tone="info">
                      <Text as="p" variant="bodySm">
                        还有 {missingParamsStats.length - 10} 种参数缺失情况未显示。建议检查事件配置。
                      </Text>
                    </Banner>
                  )}
                </BlockStack>
              )}

              {}
              {missingParamsHistory && missingParamsHistory.length > 0 && (
                <>
                  <Divider />
                  <MissingParamsChart
                    historyData={missingParamsHistory}
                    selectedPlatform={selectedChartPlatform}
                    onPlatformChange={setSelectedChartPlatform}
                  />
                </>
              )}
            </BlockStack>
          </Card>
        )}

        {}
        {monitoringStats && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                📈 实时监控统计（最近24小时）
              </Text>
              <BlockStack gap="300">
                <InlineStack gap="400" wrap>
                  <Box minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">总事件数</Text>
                      <Text as="span" variant="headingLg">{monitoringStats.totalEvents}</Text>
                    </BlockStack>
                  </Box>
                  <Box minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">成功率</Text>
                      <Text as="span" variant="headingLg" tone={monitoringStats.successRate >= 95 ? "success" : monitoringStats.successRate >= 90 ? "warning" : "critical"}>
                        {monitoringStats.successRate.toFixed(2)}%
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">失败率</Text>
                      <Text as="span" variant="headingLg" tone={monitoringStats.failureRate < 2 ? "success" : monitoringStats.failureRate < 5 ? "warning" : "critical"}>
                        {monitoringStats.failureRate.toFixed(2)}%
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineStack>
                {Object.keys(monitoringStats.byPlatform).length > 0 && (
                  <>
                    <Divider />
                    {Object.entries(monitoringStats.byPlatform).map(([platform, stats]) => (
                      <Box key={platform} background="bg-surface-secondary" padding="300" borderRadius="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {isValidPlatform(platform) ? PLATFORM_NAMES[platform] : platform}
                          </Text>
                          <InlineStack gap="300">
                            <Badge tone={stats.successRate >= 95 ? "success" : stats.successRate >= 90 ? "warning" : "critical"}>
                              成功率: {stats.successRate.toFixed(2)}%
                            </Badge>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {stats.success}/{stats.total}
                            </Text>
                          </InlineStack>
                        </InlineStack>
                      </Box>
                    ))}
                  </>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {}
        {channelReconciliation && channelReconciliation.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                🔄 渠道对账（最近24小时）
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                比较 Shopify 订单与平台事件的一致性，确保追踪数据准确
              </Text>
              <BlockStack gap="300">
                {channelReconciliation.map((recon) => {
                  const platformName = isValidPlatform(recon.platform)
                    ? PLATFORM_NAMES[recon.platform]
                    : recon.platform;

                  return (
                    <Box
                      key={recon.platform}
                      background={
                        recon.matchRate >= 95
                          ? "bg-surface-success"
                          : recon.matchRate >= 90
                            ? "bg-surface-warning"
                            : "bg-surface-critical"
                      }
                      padding="400"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {platformName}
                          </Text>
                          <Badge
                            tone={
                              recon.matchRate >= 95
                                ? "success"
                                : recon.matchRate >= 90
                                  ? "warning"
                                  : "critical"
                            }
                          >
                            匹配率: {recon.matchRate.toFixed(2)}%
                          </Badge>
                        </InlineStack>
                        <BlockStack gap="100">
                          <InlineStack align="space-between">
                            <Text as="span" variant="bodySm" tone="subdued">
                              Shopify 订单
                            </Text>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {recon.shopifyOrders}
                            </Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text as="span" variant="bodySm" tone="subdued">
                              平台事件
                            </Text>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {recon.platformEvents}
                            </Text>
                          </InlineStack>
                          {recon.discrepancy > 0 && (
                            <InlineStack align="space-between">
                              <Text as="span" variant="bodySm" tone="subdued">
                                差异
                              </Text>
                              <Text
                                as="span"
                                variant="bodySm"
                                fontWeight="semibold"
                                tone={recon.discrepancyRate > 10 ? "critical" : "warning"}
                              >
                                {recon.discrepancy} ({recon.discrepancyRate.toFixed(2)}%)
                              </Text>
                            </InlineStack>
                          )}
                        </BlockStack>
                      </BlockStack>
                    </Box>
                  );
                })}
              </BlockStack>
              {channelReconciliation.some((r) => r.discrepancyRate > 10) && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    ⚠️ 部分平台存在较大差异，建议检查事件发送配置或联系平台技术支持。
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        )}

        {}
        {(currentAlertStatus.length > 0 || !alertConfigs) && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  🔔 告警状态
                </Text>
                <Badge tone={currentAlertStatus.length > 0 ? "critical" : "success"}>
                  {currentAlertStatus.length > 0 ? `${currentAlertStatus.length} 个告警` : "正常"}
                </Badge>
              </InlineStack>

              {currentAlertStatus.length > 0 ? (
                <BlockStack gap="300">
                  {currentAlertStatus.map((alert, idx) => (
                    <Box
                      key={idx}
                      background={
                        alert.severity === "critical"
                          ? "bg-fill-critical-secondary"
                          : alert.severity === "high"
                            ? "bg-fill-warning-secondary"
                            : "bg-surface-secondary"
                      }
                      padding="400"
                      borderRadius="200"
                    >
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="200">
                          <InlineStack gap="200" blockAlign="center">
                            <Icon
                              source={AlertCircleIcon}
                              tone={alert.severity === "critical" ? "critical" : "warning"}
                            />
                            <Text as="span" fontWeight="semibold">
                              {alert.alertType === "failure_rate"
                                ? "事件失败率过高"
                                : alert.alertType === "missing_params"
                                  ? "参数缺失率过高"
                                  : alert.alertType === "volume_drop"
                                    ? "事件量骤降"
                                    : alert.alertType === "dedup_conflict"
                                      ? "去重冲突"
                                      : alert.alertType === "pixel_heartbeat"
                                        ? "像素心跳丢失"
                                        : "告警"}
                            </Text>
                            <Badge
                              tone={
                                alert.severity === "critical"
                                  ? "critical"
                                  : alert.severity === "high"
                                    ? "warning"
                                    : "info"
                              }
                            >
                              {alert.severity === "critical"
                                ? "严重"
                                : alert.severity === "high"
                                  ? "高"
                                  : "中"}
                            </Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm">
                            {alert.message}
                          </Text>
                        </BlockStack>
                        <Button url="/app/settings?tab=alerts" size="slim" variant="secondary">
                          配置告警
                        </Button>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              ) : (
                <Banner tone="success">
                  <Text as="p" variant="bodySm">
                    ✅ 所有监控指标正常，未发现异常情况。
                  </Text>
                </Banner>
              )}

              {!alertConfigs && (
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      ⚠️ 尚未配置告警通知。配置后，当追踪出现异常时会自动通知您。
                    </Text>
                    <Button url="/app/settings?tab=alerts" size="slim" variant="primary">
                      立即配置告警
                    </Button>
                  </BlockStack>
                </Banner>
              )}

              {alertConfigs && alertCount > 0 && (
                <InlineStack gap="200" align="end">
                  <Text as="p" variant="bodySm" tone="subdued">
                    已配置 {alertCount} 个告警渠道
                  </Text>
                  <Button url="/app/settings?tab=alerts" size="slim" variant="plain">
                    管理告警
                  </Button>
                </InlineStack>
              )}

              {recentAlerts.length > 0 && (
                <>
                  <Divider />
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      最近告警历史
                    </Text>
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={["时间", "类型", "严重程度", "消息"]}
                      rows={recentAlerts.slice(0, 5).map((alert) => [
                        new Date(alert.createdAt).toLocaleString("zh-CN"),
                        alert.alertType === "failure_rate"
                          ? "失败率"
                          : alert.alertType === "missing_params"
                            ? "缺参率"
                            : alert.alertType === "volume_drop"
                              ? "量降"
                              : alert.alertType === "dedup_conflict"
                                ? "去重冲突"
                                : alert.alertType === "pixel_heartbeat"
                                  ? "心跳丢失"
                                  : alert.alertType,
                        <Badge
                          key={alert.id}
                          tone={
                            alert.severity === "critical"
                              ? "critical"
                              : alert.severity === "high"
                                ? "warning"
                                : "info"
                          }
                        >
                          {alert.severity === "critical"
                            ? "严重"
                            : alert.severity === "high"
                              ? "高"
                              : "中"}
                        </Badge>,
                        alert.message,
                      ])}
                    />
                    {recentAlerts.length > 5 && (
                      <Button url="/app/settings?tab=alerts" variant="plain" size="slim">
                        查看全部告警历史
                      </Button>
                    )}
                  </BlockStack>
                </>
              )}
            </BlockStack>
          </Card>
        )}

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

        {}
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
                <InlineStack align="space-between" blockAlign="center">
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
                {environmentWarning && (
                  <Banner tone="critical">
                    <Text as="p" variant="bodySm">
                      {environmentWarning}
                    </Text>
                  </Banner>
                )}

                <Divider />

                <InlineStack align="space-between" blockAlign="center">
                   <InlineStack gap="200" blockAlign="center">
                     <Badge tone={heartbeatTone}>{heartbeatLabel}</Badge>
                     <Text as="span" tone="subdued">最近一次 Pixel 心跳</Text>
                   </InlineStack>
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

                <Text as="p" variant="bodySm" tone="subdued">
                  {heartbeatDescription}
                </Text>

                {(isHeartbeatStale || !lastHeartbeat) && (
                  <InlineStack gap="200" wrap>
                    <Button url="/app/migrate#pixel" icon={RefreshIcon} variant="primary">
                      重新推送 App Pixel
                    </Button>
                    <Button url="/app/reconciliation" icon={SearchIcon}>
                      打开送达对账
                    </Button>
                    <Button url="/app/scan" icon={SearchIcon} variant="secondary">
                      重新扫描追踪配置
                    </Button>
                  </InlineStack>
                )}

                {isHeartbeatStale && hasData && (
                  <Banner tone="critical">
                    <Text as="p" variant="bodySm">
                      超过 24 小时未收到 Web Pixel 心跳事件。请检查：<br />
                      1) Web Pixel 是否在 Shopify 后台被禁用<br />
                      2) 域名是否更换（ngrok 重启后需更新 Pixel 配置）<br />
                      3) 如为生产店铺，确认 storefront 是否启用新的 Thank you / Order status 页面
                    </Text>
                  </Banner>
                )}
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                测试模式与事件对账
              </Text>
              <Badge tone={heartbeatTone}>
                {heartbeatTone === "success" ? "已收到心跳" : "需要测试订单"}
              </Badge>
            </InlineStack>
            <Text as="p" tone="subdued">
              使用下方步骤跑一单“测试订单”，可以验证 CAPI / Web Pixel 是否同时送达并排除参数缺失问题。
            </Text>
            <List type="bullet">
              <List.Item>创建 1 笔低金额测试订单，确保结账完成后看到 Thank you / Order status 页面</List.Item>
              <List.Item>在本页面查看“最近一次 Pixel 心跳”是否更新，并确认来源域名与环境匹配</List.Item>
              <List.Item>前往“送达对账”页核对平台返回的发送结果与参数（如订单金额、货币、客户标识）</List.Item>
              <List.Item>若仍未收到事件，重新在“迁移”页点击“启用/升级 App Pixel”以刷新最新 backend URL</List.Item>
            </List>
            <InlineStack gap="200" wrap>
              <Button url="/app/scan" icon={RefreshIcon} variant="primary">
                重新扫描像素配置
              </Button>
              <Button url="/app/reconciliation" icon={SearchIcon}>
                查看送达对账
              </Button>
              <Button url="/app/migrate#pixel" icon={RefreshIcon} variant="secondary">
                重新推送 App Pixel
              </Button>
            </InlineStack>
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
