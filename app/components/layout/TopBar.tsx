import {
  InlineStack,
  Text,
  Badge,
  Button,
  Popover,
  ActionList,
  Box,
  BlockStack,
  Divider,
  Spinner,
} from "@shopify/polaris";
import { BellIcon, QuestionCircleIcon } from "~/components/icons";
import { SHOPIFY_HELP_LINKS } from "~/utils/migration-deadlines";
import { getPlanConfig, type PlanId } from "~/services/billing/plans";
import { useState, useCallback } from "react";

interface TopBarProps {
  shopDomain: string;
  planId: PlanId;
  planDisplayName: string;
  isAgency: boolean;
  alertCount: number;
  activeShops?: Array<{ id: string; domain: string }>;
  currentShopId?: string;
}

interface AlertMetrics {
  failureRate?: number;
  missingParamsRate?: number;
  volumeDrop?: number;
  volumeChangePercent?: number;
}

export function TopBar({
  shopDomain,
  planId,
  planDisplayName,
  isAgency,
  alertCount,
  activeShops,
  currentShopId,
}: TopBarProps) {
  const planConfig = getPlanConfig(planId);
  const planBadgeTone =
    planId === "free"
      ? "info"
      : planId === "starter"
        ? "attention"
        : planId === "growth"
          ? "success"
          : "new";

  const [alertMetrics, setAlertMetrics] = useState<AlertMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [alertPopoverActive, setAlertPopoverActive] = useState(false);

  const handleUpgradeClick = useCallback(() => {
    void fetch("/api/analytics.track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "app_upgrade_clicked",
        metadata: {
          plan: planId,
          triggerPage: "top_bar",
        },
      }),
    });
  }, [planId]);

  const fetchAlertMetrics = useCallback(async () => {
    if (loadingMetrics || alertMetrics) return;

    setLoadingMetrics(true);
    try {
      const response = await fetch("/api/alert-metrics?hours=24");
      if (response.ok) {
        const data = await response.json();
        setAlertMetrics({
          failureRate: data.monitoringStats?.failureRate,
          missingParamsRate: data.missingParamsRate,
          volumeDrop: data.volumeStats?.isDrop ? Math.abs(data.volumeStats.changePercent) : undefined,
          volumeChangePercent: data.volumeStats?.changePercent,
        });
      }
    } catch (error) {
            console.warn("Failed to fetch alert metrics", error);
    } finally {
      setLoadingMetrics(false);
    }
  }, [loadingMetrics, alertMetrics]);

  const handleAlertPopoverToggle = useCallback((active: boolean) => {
    setAlertPopoverActive(active);
    if (active && !alertMetrics && !loadingMetrics) {
      fetchAlertMetrics();
    }
  }, [alertMetrics, loadingMetrics, fetchAlertMetrics]);

  return (
    <Box
      background="bg-surface"
      paddingBlock="300"
      paddingInline="400"
      borderBlockEndWidth="025"
      borderColor="border"
    >
      <InlineStack align="space-between" blockAlign="center" gap="400">
        {}
        <InlineStack gap="300" blockAlign="center">
          {isAgency && activeShops && activeShops.length > 0 ? (
            <Popover
              activator={
                <Button variant="plain" size="slim">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {shopDomain}
                  </Text>
                </Button>
              }
            >
              <ActionList
                items={activeShops.map((shop) => ({
                  content: shop.domain,
                  url: `/app/workspace?shop=${shop.id}`,
                  active: shop.id === currentShopId,
                }))}
              />
            </Popover>
          ) : (
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {shopDomain}
            </Text>
          )}
        </InlineStack>

        {}
        <InlineStack gap="300" blockAlign="center">
          {}
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={planBadgeTone}>{planConfig.name}</Badge>
            {planId !== "agency" && (
              <Button
                size="slim"
                variant="plain"
                url="/app/billing"
                onClick={handleUpgradeClick}
              >
                升级
              </Button>
            )}
          </InlineStack>

          {}
          <Popover
            active={alertPopoverActive}
            activator={
              <Button
                size="slim"
                variant="plain"
                url={alertCount > 0 ? "/app/alerts" : undefined}
                onClick={alertCount === 0 ? () => handleAlertPopoverToggle(true) : undefined}
                icon={BellIcon}
                tone={alertCount > 0 ? "critical" : undefined}
              >
                {alertCount > 0 ? `${alertCount} 条告警` : "告警"}
              </Button>
            }
            onClose={() => handleAlertPopoverToggle(false)}
          >
            <Box padding="400" minWidth="280px">
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  告警详情（最近24小时）
                </Text>
                <Divider />
                {loadingMetrics ? (
                  <InlineStack align="center" blockAlign="center" gap="200">
                    <Spinner size="small" />
                    <Text as="span" variant="bodySm" tone="subdued">
                      加载中...
                    </Text>
                  </InlineStack>
                ) : alertMetrics ? (
                  <BlockStack gap="200">
                    {alertMetrics.failureRate !== undefined && (
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodySm">失败率</Text>
                        <Badge tone={alertMetrics.failureRate > 5 ? "critical" : alertMetrics.failureRate > 2 ? "warning" : "success"}>
                          {alertMetrics.failureRate.toFixed(2)}%
                        </Badge>
                      </InlineStack>
                    )}
                    {alertMetrics.missingParamsRate !== undefined && (
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodySm">缺参率</Text>
                        <Badge tone={alertMetrics.missingParamsRate > 10 ? "critical" : alertMetrics.missingParamsRate > 5 ? "warning" : "success"}>
                          {alertMetrics.missingParamsRate.toFixed(2)}%
                        </Badge>
                      </InlineStack>
                    )}
                    {alertMetrics.volumeDrop !== undefined && alertMetrics.volumeChangePercent !== undefined && (
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodySm">事件量变化</Text>
                        <Badge tone={alertMetrics.volumeDrop > 50 ? "critical" : alertMetrics.volumeDrop > 30 ? "warning" : "success"}>
                          {alertMetrics.volumeChangePercent > 0 ? "+" : ""}{alertMetrics.volumeChangePercent.toFixed(1)}%
                        </Badge>
                      </InlineStack>
                    )}
                    {(!alertMetrics.failureRate && !alertMetrics.missingParamsRate && !alertMetrics.volumeDrop) && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        暂无监控数据
                      </Text>
                    )}
                  </BlockStack>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    点击"查看告警中心"获取详细信息
                  </Text>
                )}
                <Divider />
                <Button url="/app/alerts" size="slim" variant="primary" fullWidth>
                  查看告警中心
                </Button>
              </BlockStack>
            </Box>
          </Popover>

          {}
          <Popover
            activator={
              <Button size="slim" variant="plain" icon={QuestionCircleIcon}>
                帮助
              </Button>
            }
          >
            <ActionList
              items={[
                {
                  content: "文档",
                  external: true,
                  url: SHOPIFY_HELP_LINKS.UPGRADE_GUIDE,
                },
                {
                  content: "工单支持",
                  url: "/app/support",
                },
                {
                  content: "导出报告",
                  url: "/app/reports",
                },
              ]}
            />
          </Popover>
        </InlineStack>
      </InlineStack>
    </Box>
  );
}
