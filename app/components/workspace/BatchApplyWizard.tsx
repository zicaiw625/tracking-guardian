

import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Box,
  Divider,
  Banner,
  List,
  Badge,
  ProgressBar,
  Checkbox,
  DataTable,
  Spinner,
} from "@shopify/polaris";
import { useState, useCallback, useEffect, useRef } from "react";
import { CheckCircleIcon, AlertCircleIcon } from "~/components/icons";

export interface PixelTemplate {
  id: string;
  name: string;
  description?: string;
  platforms: Array<{
    platform: string;
    eventMappings?: Record<string, string>;
    clientSideEnabled?: boolean;
    serverSideEnabled?: boolean;
  }>;
  usageCount?: number;
}

export interface ShopInfo {
  shopId: string;
  shopDomain: string;
  hasExistingConfig?: boolean;
}

interface BatchApplyWizardProps {
  template: PixelTemplate;
  targetShops: ShopInfo[];
  onConfirm: (options: {
    overwriteExisting: boolean;
    skipIfExists: boolean;
  }) => Promise<{ jobId?: string; result?: unknown }>;
  onCancel: () => void;
  jobId?: string | null;
}

type WizardStep = "preview" | "confirm" | "applying" | "complete";

export function BatchApplyWizard({
  template,
  targetShops,
  onConfirm,
  onCancel,
  jobId: initialJobId,
}: BatchApplyWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>(initialJobId ? "applying" : "preview");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [skipIfExists, setSkipIfExists] = useState(true);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(initialJobId || null);
  const [jobStatus, setJobStatus] = useState<{
    status: "pending" | "running" | "completed" | "failed";
    progress: number;
    totalItems?: number;
    completedItems?: number;
    failedItems?: number;
    skippedItems?: number;
    result?: unknown;
    error?: string;
  } | null>(null);
  const [results, setResults] = useState<{
    success: number;
    failed: number;
    skipped: number;
    details?: Array<{
      shopId: string;
      shopDomain: string;
      status: "success" | "failed" | "skipped";
      message: string;
      platformsApplied?: string[];
      errorType?: string;
      comparisons?: Array<{
        platform: string;
        action: "created" | "updated" | "skipped" | "no_change";
        differences?: Array<{
          field: string;
          before: unknown;
          after: unknown;
        }>;
      }>;
    }>;
    summary?: {
      totalPlatformsApplied?: number;
      platformsBreakdown?: Record<string, number>;
      changesBreakdown?: {
        created: number;
        updated: number;
        skipped: number;
        noChange: number;
      };
    };
  } | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const pollJobStatus = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/batch-jobs/${id}`);
      if (!response.ok) throw new Error("Failed to fetch job status");
      const status = await response.json();
      setJobStatus(status);
      setProgress(status.progress || 0);

      if (status.status === "completed" || status.status === "failed") {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        if (status.status === "completed" && status.result) {
          const result = status.result;
          setResults({
            success: result.successCount || 0,
            failed: result.failedCount || 0,
            skipped: result.skippedCount || 0,
            details: result.results || [],
          });
          setCurrentStep("complete");
        } else if (status.status === "failed") {
          setResults({
            success: status.completedItems || 0,
            failed: status.failedItems || 0,
            skipped: status.skippedItems || 0,
          });
          setCurrentStep("complete");
        }
      }
    } catch (error) {

      if (process.env.NODE_ENV === "development") {
        // 客户端调试输出：轮询任务状态失败
        // eslint-disable-next-line no-console
        console.error("Failed to poll job status:", error);
      }
    }
  }, []);

  useEffect(() => {
    if (jobId && currentStep === "applying") {
      pollJobStatus(jobId);
      pollIntervalRef.current = setInterval(() => {
        pollJobStatus(jobId);
      }, 2000);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }
  }, [jobId, currentStep, pollJobStatus]);

  const handleApply = useCallback(async () => {
    setCurrentStep("applying");
    setProgress(0);

    try {
      const response = await onConfirm({
        overwriteExisting,
        skipIfExists,
      });

      if (response.jobId) {
        setJobId(response.jobId);
        setProgress(0);
      } else if (response.result && typeof response.result === 'object' && response.result !== null) {
        const result = response.result as { successCount?: number; failedCount?: number; skippedCount?: number; results?: unknown[] };
        setProgress(100);
        setResults({
          success: result.successCount || 0,
          failed: result.failedCount || 0,
          skipped: result.skippedCount || 0,
          details: (result.results || []).map((r: unknown) => {
            const item = r as { shopId?: string; shopDomain?: string; status?: string; message?: string; platformsApplied?: string[] };
            return {
              shopId: item.shopId || "",
              shopDomain: item.shopDomain || "",
              status: (item.status === "success" || item.status === "failed" || item.status === "skipped" ? item.status : "skipped") as "success" | "failed" | "skipped",
              message: item.message || "",
              platformsApplied: item.platformsApplied,
            };
          }),
        });
        setCurrentStep("complete");
      }
    } catch (error) {
      setCurrentStep("confirm");
      throw error;
    }
  }, [onConfirm, overwriteExisting, skipIfExists]);

  if (currentStep === "preview") {

    const shopsWithConfig = targetShops.filter((s) => s.hasExistingConfig).length;
    const shopsWithoutConfig = targetShops.length - shopsWithConfig;
    const platformsInTemplate = template.platforms.map((p) => p.platform);

    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            预览批量应用
          </Text>

          <BlockStack gap="300">
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  模板信息
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" fontWeight="semibold">
                    {template.name}
                  </Text>
                  {template.usageCount !== undefined && (
                    <Badge tone="info">{`已使用 ${template.usageCount} 次`}</Badge>
                  )}
                </InlineStack>
                {template.description && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {template.description}
                  </Text>
                )}
                <Divider />
                <Text as="h4" variant="headingSm">
                  包含平台 ({platformsInTemplate.length} 个)
                </Text>
                <List type="bullet">
                  {template.platforms.map((p, idx) => (
                    <List.Item key={idx}>
                      <Text as="span" variant="bodySm">
                        {p.platform.charAt(0).toUpperCase() + p.platform.slice(1)}
                        {p.clientSideEnabled && " (客户端)"}
                        {p.serverSideEnabled && " (服务端)"}
                      </Text>
                    </List.Item>
                  ))}
                </List>
              </BlockStack>
            </Box>

            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  目标店铺统计
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">总店铺数</Text>
                  <Badge>{String(targetShops.length)}</Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">已有配置</Text>
                  <Badge>{String(shopsWithConfig)}</Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">无配置（将新建）</Text>
                  <Badge tone="success">{String(shopsWithoutConfig)}</Badge>
                </InlineStack>
              </BlockStack>
            </Box>

            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  目标店铺列表 ({targetShops.length} 个)
                </Text>
                <List type="bullet">
                  {targetShops.slice(0, 5).map((shop) => (
                    <List.Item key={shop.shopId}>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodySm">
                          {shop.shopDomain}
                        </Text>
                        {shop.hasExistingConfig && (
                          <Badge tone="warning">已有配置</Badge>
                        )}
                        {!shop.hasExistingConfig && (
                          <Badge tone="success">将新建</Badge>
                        )}
                      </InlineStack>
                    </List.Item>
                  ))}
                  {targetShops.length > 5 && (
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        还有 {targetShops.length - 5} 个店铺...
                      </Text>
                    </List.Item>
                  )}
                </List>
              </BlockStack>
            </Box>

            {}
            {shopsWithConfig > 0 && (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    差异对比提示
                  </Text>
                  <Text as="p" variant="bodySm">
                    检测到 {shopsWithConfig} 个店铺已有像素配置。应用模板时：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        如果选择"覆盖"，将替换现有配置为模板配置
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        如果选择"跳过"，将保留现有配置，只应用到新店铺
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        建议：在下一步查看详细差异对比
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
            )}

            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  <strong>重要提示：</strong>
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      模板只包含配置结构，不包含 API 凭证
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      各店铺需要在应用后单独配置 API Key 和 Access Token
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      如果店铺已有配置，可以选择覆盖或跳过
                    </Text>
                  </List.Item>
                </List>
              </BlockStack>
            </Banner>
          </BlockStack>

          <InlineStack align="end" gap="200">
            <Button onClick={onCancel}>取消</Button>
            <Button variant="primary" onClick={() => setCurrentStep("confirm")}>
              下一步
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  if (currentStep === "confirm") {
    const shopsWithConfig = targetShops.filter((s) => s.hasExistingConfig).length;

    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            确认批量应用
          </Text>

          <BlockStack gap="300">
            {shopsWithConfig > 0 && (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    检测到 {shopsWithConfig} 个店铺已有像素配置
                  </Text>
                  <Checkbox
                    label="覆盖已存在的配置"
                    checked={overwriteExisting}
                    onChange={setOverwriteExisting}
                    helpText="如果启用，将替换现有配置；如果禁用，将跳过已有配置的店铺"
                  />
                  <Checkbox
                    label="跳过已有配置的店铺"
                    checked={skipIfExists}
                    onChange={setSkipIfExists}
                    disabled={overwriteExisting}
                    helpText="如果启用，将跳过已有配置的店铺，只应用到新店铺"
                  />
                </BlockStack>
              </Banner>
            )}

            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  应用摘要
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">模板</Text>
                  <Text as="span" fontWeight="semibold">{template.name}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">目标店铺</Text>
                  <Text as="span" fontWeight="semibold">{targetShops.length} 个</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">包含平台</Text>
                  <Text as="span" fontWeight="semibold">
                    {template.platforms.length} 个
                  </Text>
                </InlineStack>
                {shopsWithConfig > 0 && (
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">处理方式</Text>
                    <Text as="span" fontWeight="semibold">
                      {overwriteExisting ? "覆盖已有配置" : skipIfExists ? "跳过已有配置" : "保留已有配置"}
                    </Text>
                  </InlineStack>
                )}
              </BlockStack>
            </Box>
          </BlockStack>

          <InlineStack align="end" gap="200">
            <Button onClick={() => setCurrentStep("preview")}>上一步</Button>
            <Button variant="primary" onClick={handleApply}>
              确认应用
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  if (currentStep === "applying") {
    const completed = jobStatus?.completedItems || 0;
    const failed = jobStatus?.failedItems || 0;
    const skipped = jobStatus?.skippedItems || 0;
    const total = jobStatus?.totalItems || targetShops.length;
    const processing = completed + failed + skipped;

    return (
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              正在批量应用...
            </Text>
            <Badge tone={jobStatus?.status === "failed" ? "critical" : "info"}>
              {jobStatus?.status === "running" ? "处理中" : jobStatus?.status === "failed" ? "失败" : "完成"}
            </Badge>
          </InlineStack>

          <ProgressBar progress={progress} />

          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">总店铺数</Text>
                <Text as="span" variant="bodySm" fontWeight="semibold">{total}</Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">已完成</Text>
                <Badge tone="success">{String(completed)}</Badge>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">失败</Text>
                <Badge tone={failed > 0 ? "critical" : "success"}>{String(failed)}</Badge>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">跳过</Text>
                <Badge tone="info">{String(skipped)}</Badge>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">处理进度</Text>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {processing} / {total} ({progress}%)
                </Text>
              </InlineStack>
            </BlockStack>
          </Box>

          {jobStatus?.status === "running" && (
            <Banner tone="info">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="p" variant="bodySm">
                    正在将模板应用到 {total} 个店铺，已处理 {processing} 个...
                  </Text>
                </InlineStack>
              </BlockStack>
            </Banner>
          )}

          {jobStatus?.error && (
            <Banner tone="critical">
              <Text as="p" variant="bodySm">
                错误: {jobStatus.error}
              </Text>
            </Banner>
          )}
        </BlockStack>
      </Card>
    );
  }

  if (currentStep === "complete") {
    return (
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              批量应用完成
            </Text>
            <Badge tone={results && results.failed === 0 ? "success" : "warning"}>
              {results && results.failed === 0 ? "全部成功" : "部分完成"}
            </Badge>
          </InlineStack>

          {results && (
            <>
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    应用结果汇总
                  </Text>
                  <InlineStack gap="400" wrap>
                    <Box>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">成功</Text>
                        <Badge tone="success" size="large">
                          {String(results.success)}
                        </Badge>
                      </BlockStack>
                    </Box>
                    <Box>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">失败</Text>
                        <Badge tone={results.failed > 0 ? "critical" : "success"} size="large">
                          {String(results.failed)}
                        </Badge>
                      </BlockStack>
                    </Box>
                    <Box>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">跳过</Text>
                        <Badge tone="info" size="large">
                          {String(results.skipped)}
                        </Badge>
                      </BlockStack>
                    </Box>
                    <Box>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">总计</Text>
                        <Text as="span" variant="headingLg" fontWeight="semibold">
                          {results.success + results.failed + results.skipped}
                        </Text>
                      </BlockStack>
                    </Box>
                  </InlineStack>
                </BlockStack>
              </Box>

              {}
              {results.summary?.changesBreakdown && (
                <>
                  <Divider />
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        配置变更统计
                      </Text>
                      <InlineStack gap="400" wrap>
                        <Box>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" tone="subdued">新建配置</Text>
                            <Badge tone="success" size="large">
                              {String(results.summary.changesBreakdown.created)}
                            </Badge>
                          </BlockStack>
                        </Box>
                        <Box>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" tone="subdued">更新配置</Text>
                            <Badge tone="info" size="large">
                              {String(results.summary.changesBreakdown.updated)}
                            </Badge>
                          </BlockStack>
                        </Box>
                        <Box>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" tone="subdued">跳过配置</Text>
                            <Badge tone="warning" size="large">
                              {String(results.summary.changesBreakdown.skipped)}
                            </Badge>
                          </BlockStack>
                        </Box>
                        <Box>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" tone="subdued">无变更</Text>
                            <Badge size="large">
                              {String(results.summary.changesBreakdown.noChange)}
                            </Badge>
                          </BlockStack>
                        </Box>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </>
              )}

              {}
              {results.summary?.platformsBreakdown && Object.keys(results.summary.platformsBreakdown).length > 0 && (
                <>
                  <Divider />
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        平台应用统计
                      </Text>
                      <List type="bullet">
                        {Object.entries(results.summary.platformsBreakdown).map(([platform, count]) => (
                          <List.Item key={platform}>
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="bodySm" fontWeight="semibold">
                                {platform.charAt(0).toUpperCase() + platform.slice(1)}
                              </Text>
                              <Badge>{`${count} 个店铺`}</Badge>
                            </InlineStack>
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  </Box>
                </>
              )}

              {results.details && results.details.length > 0 && (
                <>
                  <Divider />
                  <Text as="h3" variant="headingSm">
                    详细结果
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={["店铺域名", "状态", "应用平台", "消息"]}
                    rows={results.details.map((detail) => [
                      detail.shopDomain || detail.shopId,
                      <Badge
                        key={detail.shopId}
                        tone={
                          detail.status === "success"
                            ? "success"
                            : detail.status === "failed"
                              ? "critical"
                              : "info"
                        }
                      >
                        {detail.status === "success"
                          ? "成功"
                          : detail.status === "failed"
                            ? "失败"
                            : "跳过"}
                      </Badge>,
                      detail.platformsApplied?.join(", ") || "-",
                      detail.message || "-",
                    ])}
                  />

                  {}
                  {results.details.some((d) => d.comparisons && d.comparisons.length > 0) && (
                    <>
                      <Divider />
                      <Text as="h3" variant="headingSm">
                        配置对比详情
                      </Text>
                      {results.details
                        .filter((d) => d.comparisons && d.comparisons.length > 0)
                        .map((detail) => (
                          <Box key={detail.shopId} background="bg-surface-secondary" padding="400" borderRadius="200">
                            <BlockStack gap="300">
                              <Text as="h4" variant="headingSm">
                                {detail.shopDomain || detail.shopId}
                              </Text>
                              {detail.comparisons?.map((comparison) => (
                                <Box key={comparison.platform} paddingBlockStart="200">
                                  <BlockStack gap="200">
                                    <InlineStack gap="200" blockAlign="center">
                                      <Text as="span" variant="bodySm" fontWeight="semibold">
                                        {comparison.platform.charAt(0).toUpperCase() + comparison.platform.slice(1)}
                                      </Text>
                                      <Badge
                                        tone={
                                          comparison.action === "created"
                                            ? "success"
                                            : comparison.action === "updated"
                                              ? "info"
                                              : comparison.action === "skipped"
                                                ? "warning"
                                                : undefined
                                        }
                                      >
                                        {comparison.action === "created"
                                          ? "新建"
                                          : comparison.action === "updated"
                                            ? "更新"
                                            : comparison.action === "skipped"
                                              ? "跳过"
                                              : "无变更"}
                                      </Badge>
                                    </InlineStack>
                                    {comparison.differences && comparison.differences.length > 0 && (
                                      <List type="bullet">
                                        {comparison.differences.map((diff, idx) => (
                                          <List.Item key={idx}>
                                            <Text as="span" variant="bodySm">
                                              <strong>{diff.field}:</strong> {String(diff.before)} → {String(diff.after)}
                                            </Text>
                                          </List.Item>
                                        ))}
                                      </List>
                                    )}
                                  </BlockStack>
                                </Box>
                              ))}
                            </BlockStack>
                          </Box>
                        ))}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {results && results.failed === 0 ? (
            <Banner tone="success">
              <Text as="p" variant="bodySm">
                批量应用已成功完成！所有 {results.success} 个店铺已应用模板配置。请在各店铺中单独配置 API 凭证以启用追踪功能。
              </Text>
            </Banner>
          ) : results && results.failed > 0 ? (
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                批量应用已完成，但有 {results.failed} 个店铺应用失败。请查看上方详细结果，检查失败原因后重试。
              </Text>
            </Banner>
          ) : (
            <Banner tone="success">
              <Text as="p" variant="bodySm">
                批量应用已完成。请在各店铺中单独配置 API 凭证以启用追踪功能。
              </Text>
            </Banner>
          )}

          <InlineStack align="end">
            <Button variant="primary" onClick={onCancel}>
              完成
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  return null;
}

