

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  ProgressBar,
  Select,
  DataTable,
  Icon,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  PlayIcon,
  RefreshIcon,
} from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { useFetcher } from "@remix-run/react";

export interface ShopGroup {
  id: string;
  name: string;
  shopCount: number;
}

export interface BatchAuditPanelProps {
  shopGroups: ShopGroup[];
  onRefresh?: () => void;
}

export function BatchAuditPanel({
  shopGroups,
  onRefresh,
}: BatchAuditPanelProps) {
  const { showSuccess, showError } = useToastContext();
  const fetcher = useFetcher();
  const statusFetcher = useFetcher();
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [results, setResults] = useState<Array<{
    shopId: string;
    shopDomain: string;
    status: "success" | "failed" | "skipped";
    riskScore?: number;
    error?: string;
  }>>([]);
  const [summary, setSummary] = useState<{
    totalShops: number;
    completedShops: number;
    failedShops: number;
    skippedShops: number;
    avgRiskScore?: number;
    highRiskCount?: number;
    mediumRiskCount?: number;
    lowRiskCount?: number;
  } | null>(null);

  const handleStartBatchAudit = useCallback(() => {
    if (!selectedGroupId) {
      showError("请选择店铺组");
      return;
    }

    const formData = new FormData();
    formData.append("_action", "batch_audit");
    formData.append("groupId", selectedGroupId);

    fetcher.submit(formData, { method: "post" });
    setIsRunning(true);
    setProgress(0);
    setResults([]);
    setSummary(null);
  }, [selectedGroupId, fetcher, showError]);

  useEffect(() => {
    const data = fetcher.data as { success?: boolean; jobId?: string; error?: string; actionType?: string } | undefined;
    if (data?.actionType === "batch_audit") {
      if (data.success && data.jobId) {
        setJobId(data.jobId);
        showSuccess("批量扫描已启动");
      } else if (data.error) {
        showError(data.error);
        setIsRunning(false);
      }
    }
  }, [fetcher.data, showSuccess, showError]);

  useEffect(() => {
    if (!jobId || !isRunning) return;

    const interval = setInterval(() => {
      const formData = new FormData();
      formData.append("_action", "check_batch_audit");
      formData.append("jobId", jobId);
      statusFetcher.submit(formData, { method: "post" });
    }, 2000);

    return () => clearInterval(interval);
  }, [jobId, isRunning, statusFetcher]);

  type BatchAuditResult = {
    results: Array<{
      shopId: string;
      shopDomain: string;
      status: "success" | "failed" | "skipped";
      riskScore?: number;
      error?: string;
    }>;
    summary: {
      avgRiskScore: number;
      highRiskCount: number;
      mediumRiskCount: number;
      lowRiskCount: number;
    };
    totalShops: number;
    completedShops: number;
    failedShops: number;
    skippedShops: number;
  };

  useEffect(() => {
    const data = statusFetcher.data as { success?: boolean; job?: { progress: number; status: string; result?: BatchAuditResult } } | undefined;
    if (data?.success && data.job) {
      setProgress(data.job.progress);

      if (data.job.status === "completed" && data.job.result) {
        setIsRunning(false);
        const result = data.job.result;
        setResults(result.results);
        setSummary({
          totalShops: result.totalShops,
          completedShops: result.completedShops,
          failedShops: result.failedShops,
          skippedShops: result.skippedShops,
          avgRiskScore: result.summary.avgRiskScore,
          highRiskCount: result.summary.highRiskCount,
          mediumRiskCount: result.summary.mediumRiskCount,
          lowRiskCount: result.summary.lowRiskCount,
        });
        showSuccess(`批量扫描完成！成功: ${result.completedShops}, 失败: ${result.failedShops}, 跳过: ${result.skippedShops}`);
      } else if (data.job.status === "failed") {
        setIsRunning(false);
        showError("批量扫描任务失败");
      }
    }
  }, [statusFetcher.data, showSuccess, showError]);

  const selectedGroup = shopGroups.find((g) => g.id === selectedGroupId);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              批量 Audit 扫描
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              对工作区内的多个店铺同时运行 Audit 扫描
            </Text>
          </BlockStack>
          <Badge tone="info">Agency 功能</Badge>
        </InlineStack>

        <Divider />

        {}
        <BlockStack gap="300">
          <Select
            label="选择店铺组"
            options={[
              { label: "请选择店铺组", value: "" },
              ...shopGroups.map((group) => ({
                label: `${group.name} (${group.shopCount} 个店铺)`,
                value: group.id,
              })),
            ]}
            value={selectedGroupId}
            onChange={setSelectedGroupId}
            disabled={isRunning}
          />

          {selectedGroup && (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                将对 <strong>{selectedGroup.name}</strong> 中的{" "}
                <strong>{selectedGroup.shopCount}</strong> 个店铺运行 Audit 扫描。
                预计耗时约 {Math.ceil(selectedGroup.shopCount * 0.5)} 分钟。
              </Text>
            </Banner>
          )}
        </BlockStack>

        {}
        {isRunning && (
          <BlockStack gap="300">
            <Divider />
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                扫描进度
              </Text>
              <Badge tone="info">{`${progress}%`}</Badge>
            </InlineStack>
            <ProgressBar progress={progress} tone="primary" />
            <Text as="p" variant="bodySm" tone="subdued">
              正在扫描店铺，请稍候...
            </Text>
          </BlockStack>
        )}

        {}
        {summary && (
          <BlockStack gap="300">
            <Divider />
            <Text as="h3" variant="headingSm">
              扫描结果汇总
            </Text>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">总店铺数</Text>
                  <Badge>{String(summary.totalShops)}</Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">成功</Text>
                  <Badge tone="success">{String(summary.completedShops)}</Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">失败</Text>
                  <Badge tone={summary.failedShops > 0 ? "critical" : "success"}>
                    {String(summary.failedShops)}
                  </Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">跳过</Text>
                  <Badge tone="info">{String(summary.skippedShops)}</Badge>
                </InlineStack>
                {summary.avgRiskScore !== undefined && (
                  <>
                    <Divider />
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">平均风险分数</Text>
                      <Badge tone={summary.avgRiskScore > 60 ? "critical" : summary.avgRiskScore > 30 ? "warning" : "success"}>
                        {summary.avgRiskScore.toFixed(1)}
                      </Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">高风险店铺</Text>
                      <Badge tone="critical">{String(summary.highRiskCount || 0)}</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">中风险店铺</Text>
                      <Badge>{String(summary.mediumRiskCount || 0)}</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">低风险店铺</Text>
                      <Badge tone="success">{String(summary.lowRiskCount || 0)}</Badge>
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Box>
          </BlockStack>
        )}

        {}
        {results.length > 0 && (
          <BlockStack gap="300">
            {summary && <Divider />}
            <Text as="h3" variant="headingSm">
              详细结果
            </Text>
            <DataTable
              columnContentTypes={["text", "text", "numeric", "text"]}
              headings={["店铺", "状态", "风险分数", "详情"]}
              rows={results.map((result) => [
                result.shopDomain,
                <Badge
                  key={result.shopId}
                  tone={
                    result.status === "success"
                      ? "success"
                      : result.status === "failed"
                        ? "critical"
                        : undefined
                  }
                >
                  {result.status === "success"
                    ? "成功"
                    : result.status === "failed"
                      ? "失败"
                      : "跳过"}
                </Badge>,
                result.riskScore !== undefined ? String(result.riskScore) : "-",
                result.error || "-",
              ])}
            />
          </BlockStack>
        )}

        <Divider />

        {}
        <InlineStack gap="200" align="end">
          {onRefresh && (
            <Button onClick={onRefresh} icon={RefreshIcon} disabled={isRunning}>
              刷新
            </Button>
          )}
          <Button
            variant="primary"
            onClick={handleStartBatchAudit}
            icon={PlayIcon}
            disabled={!selectedGroupId || isRunning}
            loading={isRunning}
          >
            {isRunning ? "扫描中..." : "开始批量扫描"}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

