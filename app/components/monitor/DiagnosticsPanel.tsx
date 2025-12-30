
import { Card, Text, BlockStack, InlineStack, Badge, Box, Button, List, Divider, Banner, Collapsible } from "@shopify/polaris";
import { useState } from "react";
import { ArrowRightIcon, CheckCircleIcon, AlertCircleIcon, WarningIcon } from "~/components/icons";
import { isValidPlatform, PLATFORM_NAMES } from "~/types";
import type { DiagnosticReport, DiagnosticIssue, DiagnosticRecommendation } from "~/services/monitoring-diagnostics.server";

interface DiagnosticsPanelProps {
  report: DiagnosticReport;
  onRunDiagnostics?: () => void;
}

export function DiagnosticsPanel({ report, onRunDiagnostics }: DiagnosticsPanelProps) {
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

  const toggleIssue = (issueId: string) => {
    const newExpanded = new Set(expandedIssues);
    if (newExpanded.has(issueId)) {
      newExpanded.delete(issueId);
    } else {
      newExpanded.add(issueId);
    }
    setExpandedIssues(newExpanded);
  };

  const getSeverityTone = (severity: DiagnosticIssue["severity"]) => {
    switch (severity) {
      case "critical":
        return "critical";
      case "high":
        return "critical";
      case "medium":
        return "warning";
      case "low":
        return "info";
      default:
        return "info";
    }
  };

  const getHealthTone = (health: DiagnosticReport["overallHealth"]) => {
    switch (health) {
      case "healthy":
        return "success";
      case "warning":
        return "warning";
      case "critical":
        return "critical";
      default:
        return "info";
    }
  };

  const getHealthLabel = (health: DiagnosticReport["overallHealth"]) => {
    switch (health) {
      case "healthy":
        return "健康";
      case "warning":
        return "需要关注";
      case "critical":
        return "严重问题";
      default:
        return "未知";
    }
  };

  return (
    <BlockStack gap="400">
      {/* 总体健康状态 */}
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              🔍 系统诊断
            </Text>
            {onRunDiagnostics && (
              <Button onClick={onRunDiagnostics} variant="secondary">
                重新诊断
              </Button>
            )}
          </InlineStack>

          <Box
            background={
              report.overallHealth === "healthy"
                ? "bg-fill-success"
                : report.overallHealth === "warning"
                  ? "bg-fill-warning"
                  : "bg-fill-critical"
            }
            padding="600"
            borderRadius="200"
          >
            <BlockStack gap="200" align="center">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone={getHealthTone(report.overallHealth)}>
                  {getHealthLabel(report.overallHealth)}
                </Badge>
                <Text as="p" variant="heading3xl" fontWeight="bold">
                  {report.healthScore}
                </Text>
                <Text as="p" variant="bodySm">
                  / 100
                </Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                诊断时间: {new Date(report.timestamp).toLocaleString("zh-CN")}
              </Text>
            </BlockStack>
          </Box>

          {/* 问题统计 */}
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              问题统计
            </Text>
            <InlineStack gap="400" wrap>
              <Box>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">总问题数</Text>
                  <Text as="span" variant="headingLg">{report.summary.totalIssues}</Text>
                </BlockStack>
              </Box>
              {report.summary.criticalIssues > 0 && (
                <Box>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">严重</Text>
                    <Text as="span" variant="headingLg" tone="critical">
                      {report.summary.criticalIssues}
                    </Text>
                  </BlockStack>
                </Box>
              )}
              {report.summary.highIssues > 0 && (
                <Box>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">高优先级</Text>
                    <Text as="span" variant="headingLg" tone="warning">
                      {report.summary.highIssues}
                    </Text>
                  </BlockStack>
                </Box>
              )}
              {report.summary.mediumIssues > 0 && (
                <Box>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">中等</Text>
                    <Text as="span" variant="headingLg">{report.summary.mediumIssues}</Text>
                  </BlockStack>
                </Box>
              )}
              {report.summary.lowIssues > 0 && (
                <Box>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">低优先级</Text>
                    <Text as="span" variant="headingLg">{report.summary.lowIssues}</Text>
                  </BlockStack>
                </Box>
              )}
            </InlineStack>
          </BlockStack>
        </BlockStack>
      </Card>

      {/* 问题列表 */}
      {report.issues.length === 0 ? (
        <Card>
          <Banner tone="success">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ✅ 未检测到任何问题
              </Text>
              <Text as="p" variant="bodySm">
                系统运行正常，所有监控指标都在正常范围内。
              </Text>
            </BlockStack>
          </Banner>
        </Card>
      ) : (
        <BlockStack gap="400">
          {report.issues
            .sort((a, b) => {
              const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
              return severityOrder[b.severity] - severityOrder[a.severity];
            })
            .map((issue) => {
              const isExpanded = expandedIssues.has(issue.id);
              return (
                <Card key={issue.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone={getSeverityTone(issue.severity)}>
                            {issue.severity === "critical"
                              ? "严重"
                              : issue.severity === "high"
                                ? "高"
                                : issue.severity === "medium"
                                  ? "中等"
                                  : "低"}
                          </Badge>
                          <Text as="h3" variant="headingSm">
                            {issue.title}
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {issue.description}
                        </Text>
                        {issue.metrics.current !== undefined && (
                          <InlineStack gap="200">
                            <Text as="span" variant="bodySm" tone="subdued">
                              当前值: {issue.metrics.current.toFixed(2)}
                              {issue.metrics.current < 100 ? "%" : ""}
                            </Text>
                            {issue.metrics.threshold !== undefined && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                阈值: {issue.metrics.threshold.toFixed(2)}
                                {issue.metrics.threshold < 100 ? "%" : ""}
                              </Text>
                            )}
                          </InlineStack>
                        )}
                        {issue.affectedPlatforms && issue.affectedPlatforms.length > 0 && (
                          <InlineStack gap="100" wrap>
                            <Text as="span" variant="bodySm" tone="subdued">受影响平台:</Text>
                            {issue.affectedPlatforms.map((platform) => (
                              <Badge key={platform} tone="info">
                                {isValidPlatform(platform) ? PLATFORM_NAMES[platform] : platform}
                              </Badge>
                            ))}
                          </InlineStack>
                        )}
                        {issue.affectedEventTypes && issue.affectedEventTypes.length > 0 && (
                          <InlineStack gap="100" wrap>
                            <Text as="span" variant="bodySm" tone="subdued">受影响事件类型:</Text>
                            {issue.affectedEventTypes.map((eventType) => (
                              <Badge key={eventType} tone="info">
                                {eventType}
                              </Badge>
                            ))}
                          </InlineStack>
                        )}
                      </BlockStack>
                      <Button
                        plain
                        onClick={() => toggleIssue(issue.id)}
                        ariaExpanded={isExpanded}
                        ariaControls={`issue-${issue.id}`}
                      >
                        {isExpanded ? "收起" : "查看建议"}
                      </Button>
                    </InlineStack>

                    <Collapsible open={isExpanded} id={`issue-${issue.id}`}>
                      <Divider />
                      <BlockStack gap="300">
                        <Text as="h4" variant="headingSm">
                          修复建议
                        </Text>
                        {issue.recommendations
                          .sort((a, b) => {
                            const priorityOrder = { high: 3, medium: 2, low: 1 };
                            return priorityOrder[b.priority] - priorityOrder[a.priority];
                          })
                          .map((recommendation, idx) => (
                            <Box
                              key={idx}
                              background="bg-surface-secondary"
                              padding="400"
                              borderRadius="200"
                            >
                              <BlockStack gap="200">
                                <InlineStack align="space-between" blockAlign="center">
                                  <InlineStack gap="200" blockAlign="center">
                                    <Badge
                                      tone={
                                        recommendation.priority === "high"
                                          ? "critical"
                                          : recommendation.priority === "medium"
                                            ? "warning"
                                            : "info"
                                      }
                                    >
                                      {recommendation.priority === "high"
                                        ? "高优先级"
                                        : recommendation.priority === "medium"
                                          ? "中优先级"
                                          : "低优先级"}
                                    </Badge>
                                    <Text as="span" fontWeight="semibold">
                                      {recommendation.action}
                                    </Text>
                                  </InlineStack>
                                  {recommendation.estimatedTime && (
                                    <Text as="span" variant="bodySm" tone="subdued">
                                      预计时间: {recommendation.estimatedTime}
                                    </Text>
                                  )}
                                </InlineStack>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {recommendation.description}
                                </Text>
                                <List type="number">
                                  {recommendation.steps.map((step, stepIdx) => (
                                    <List.Item key={stepIdx}>{step}</List.Item>
                                  ))}
                                </List>
                                {recommendation.relatedUrl && (
                                  <Button
                                    url={recommendation.relatedUrl}
                                    variant="secondary"
                                    size="slim"
                                    icon={ArrowRightIcon}
                                  >
                                    前往修复
                                  </Button>
                                )}
                              </BlockStack>
                            </Box>
                          ))}
                        {issue.estimatedFixTime && (
                          <Banner tone="info">
                            <Text as="p" variant="bodySm">
                              预计修复时间: {issue.estimatedFixTime}
                            </Text>
                          </Banner>
                        )}
                      </BlockStack>
                    </Collapsible>
                  </BlockStack>
                </Card>
              );
            })}
        </BlockStack>
      )}

      {/* 优先建议 */}
      {report.recommendations.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingSm">
              📋 优先修复建议
            </Text>
            <BlockStack gap="300">
              {report.recommendations
                .filter((r) => r.priority === "high")
                .slice(0, 3)
                .map((recommendation, idx) => (
                  <Box
                    key={idx}
                    background="bg-surface-secondary"
                    padding="300"
                    borderRadius="200"
                  >
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {recommendation.action}
                        </Text>
                        {recommendation.relatedUrl && (
                          <Button
                            url={recommendation.relatedUrl}
                            variant="plain"
                            size="slim"
                            icon={ArrowRightIcon}
                          >
                            前往
                          </Button>
                        )}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {recommendation.description}
                      </Text>
                    </BlockStack>
                  </Box>
                ))}
            </BlockStack>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

