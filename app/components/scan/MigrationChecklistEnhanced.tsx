import { useState, useMemo } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  DataTable,
  Select,
  TextField,
  Icon,
  Box,
  Divider,
  Banner,
  Collapsible,
  Link,
  List,
} from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon, SearchIcon, FilterIcon, AlertCircleIcon, ExportIcon } from "~/components/icons";
import { useSubmit } from "@remix-run/react";
import type { MigrationChecklistItem } from "~/services/migration-checklist.server";
import type { DependencyGraph } from "~/services/dependency-analysis.server";

export interface MigrationChecklistEnhancedProps {
  items: MigrationChecklistItem[];
  dependencyGraph?: DependencyGraph | null;
  onItemClick?: (assetId: string) => void;
  onItemComplete?: (assetId: string) => void;
}

type FilterType = "all" | "high" | "medium" | "low";
type SortType = "priority" | "time" | "risk" | "category";

export function MigrationChecklistEnhanced({
  items,
  dependencyGraph,
  onItemClick,
  onItemComplete,
}: MigrationChecklistEnhancedProps) {
  const [filterRisk, setFilterRisk] = useState<FilterType>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortType>("priority");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const submit = useSubmit();

  const handleExportCSV = () => {
    const formData = new FormData();
    formData.append("_action", "export_checklist_csv");
    submit(formData, { method: "post" });
  };

  const categories = useMemo(() => {
    const cats = new Set(items.map((item) => item.category));
    return Array.from(cats);
  }, [items]);

  const filteredAndSortedItems = useMemo(() => {
    let filtered = items;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          item.platform?.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query)
      );
    }

    if (filterRisk !== "all") {
      filtered = filtered.filter((item) => item.riskLevel === filterRisk);
    }

    if (filterCategory !== "all") {
      filtered = filtered.filter((item) => item.category === filterCategory);
    }

    if (filterStatus !== "all") {
      filtered = filtered.filter((item) => item.status === filterStatus);
    }

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "priority":
          return b.priority - a.priority;
        case "time":
          return a.estimatedTime - b.estimatedTime;
        case "risk": {
          const riskOrder = { high: 3, medium: 2, low: 1 };
          return riskOrder[b.riskLevel] - riskOrder[a.riskLevel];
        }
        case "category":
          return a.category.localeCompare(b.category);
        default:
          return 0;
      }
    });

    return sorted;
  }, [items, searchQuery, filterRisk, filterCategory, filterStatus, sortBy]);

  const stats = useMemo(() => {
    const total = items.length;
    const high = items.filter((i) => i.riskLevel === "high").length;
    const medium = items.filter((i) => i.riskLevel === "medium").length;
    const low = items.filter((i) => i.riskLevel === "low").length;
    const pending = items.filter((i) => i.status === "pending").length;
    const inProgress = items.filter((i) => i.status === "in_progress").length;
    const completed = items.filter((i) => i.status === "completed").length;
    const totalTime = items.reduce((sum, item) => sum + item.estimatedTime, 0);

    return {
      total,
      high,
      medium,
      low,
      pending,
      inProgress,
      completed,
      totalTime,
    };
  }, [items]);

  const formatTime = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} 分钟`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  };

  const getRiskBadgeTone = (risk: string): "critical" | "info" | undefined => {
    switch (risk) {
      case "high":
        return "critical";
      case "medium":
        return undefined;
      case "low":
        return "info";
      default:
        return undefined;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge tone="success">已完成</Badge>;
      case "in_progress":
        return <Badge tone="info">进行中</Badge>;
      case "pending":
        return <Badge tone="info">待处理</Badge>;
      case "skipped":
        return <Badge>已跳过</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getMigrationBadge = (migration: string) => {
    switch (migration) {
      case "web_pixel":
        return <Badge tone="info">Web Pixel</Badge>;
      case "ui_extension":
        return <Badge tone="success">UI Extension</Badge>;
      case "server_side":
        return <Badge>Server-side</Badge>;
      case "none":
        return <Badge>无需迁移</Badge>;
      default:
        return <Badge>{migration}</Badge>;
    }
  };

  const getItemDependencies = (assetId: string) => {
    if (!dependencyGraph) return { dependencies: [], dependents: [] };

    const nodeId = `asset-${assetId}`;
    const dependencies = dependencyGraph.edges
      .filter(e => e.to === nodeId && e.type === "depends_on")
      .map(e => {
        const depNode = dependencyGraph.nodes.find(n => n.id === e.from);
        return depNode ? { assetId: depNode.assetId, name: depNode.assetId.substring(0, 8) + "..." } : null;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    const dependents = dependencyGraph.edges
      .filter(e => e.from === nodeId && e.type === "depends_on")
      .map(e => {
        const depNode = dependencyGraph.nodes.find(n => n.id === e.to);
        return depNode ? { assetId: depNode.assetId, name: depNode.assetId.substring(0, 8) + "..." } : null;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    return { dependencies, dependents };
  };

  const toggleExpanded = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            迁移清单
          </Text>
          <InlineStack gap="200">
            <Button
              size="slim"
              icon={ExportIcon}
              onClick={handleExportCSV}
            >
              导出 CSV
            </Button>
            <Badge tone="info">{`${filteredAndSortedItems.length} / ${stats.total} 项`}</Badge>
          </InlineStack>
        </InlineStack>

        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <InlineStack gap="400" wrap>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  高风险项
                </Text>
                <Text as="span" variant="headingLg" fontWeight="bold" tone="critical">
                  {stats.high}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  中风险项
                </Text>
                <Text as="span" variant="headingLg" fontWeight="bold">
                  {stats.medium}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  预计总时间
                </Text>
                <Text as="span" variant="headingLg" fontWeight="bold">
                  {formatTime(stats.totalTime)}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  完成进度
                </Text>
                <Text as="span" variant="headingLg" fontWeight="bold" tone="success">
                  {stats.completed} / {stats.total}
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Box>

        <BlockStack gap="300">
          <InlineStack gap="200" wrap>
            <Box minWidth="200px">
              <TextField
                label="搜索"
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="搜索资产名称、平台、类别..."
                prefix={<Icon source={SearchIcon} />}
                clearButton
                onClearButtonClick={() => setSearchQuery("")}
                autoComplete="off"
              />
            </Box>
            <Box minWidth="150px">
              <Select
                label="风险等级"
                options={[
                  { label: "全部", value: "all" },
                  { label: "高风险", value: "high" },
                  { label: "中风险", value: "medium" },
                  { label: "低风险", value: "low" },
                ]}
                value={filterRisk}
                onChange={(value) => setFilterRisk(value as FilterType)}
              />
            </Box>
            <Box minWidth="150px">
              <Select
                label="类别"
                options={[
                  { label: "全部", value: "all" },
                  ...categories.map((cat) => ({
                    label: cat.charAt(0).toUpperCase() + cat.slice(1),
                    value: cat,
                  })),
                ]}
                value={filterCategory}
                onChange={setFilterCategory}
              />
            </Box>
            <Box minWidth="150px">
              <Select
                label="状态"
                options={[
                  { label: "全部", value: "all" },
                  { label: "待处理", value: "pending" },
                  { label: "进行中", value: "in_progress" },
                  { label: "已完成", value: "completed" },
                  { label: "已跳过", value: "skipped" },
                ]}
                value={filterStatus}
                onChange={setFilterStatus}
              />
            </Box>
            <Box minWidth="150px">
              <Select
                label="排序"
                options={[
                  { label: "优先级", value: "priority" },
                  { label: "预计时间", value: "time" },
                  { label: "风险等级", value: "risk" },
                  { label: "类别", value: "category" },
                ]}
                value={sortBy}
                onChange={(value) => setSortBy(value as SortType)}
              />
            </Box>
          </InlineStack>
        </BlockStack>

        <Divider />

        {}
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              PRD 2.2: 迁移清单交付结构（4列）
            </Text>
            <List type="bullet">
              <List.Item>资产名称/指纹（hash）</List.Item>
              <List.Item>风险等级（High/Med/Low）+ 原因</List.Item>
              <List.Item>推荐迁移路径（Web Pixel / UI Extension / Server-side / None）</List.Item>
              <List.Item>预估工时 + 需要的信息（Pixel ID、Token、问卷题目等）</List.Item>
            </List>
          </BlockStack>
        </Banner>

        {filteredAndSortedItems.length === 0 ? (
          <Banner tone="info">
            <Text as="p" variant="bodySm">
              {searchQuery || filterRisk !== "all" || filterCategory !== "all" || filterStatus !== "all"
                ? "没有匹配的项，请调整筛选条件"
                : "暂无迁移清单项"}
            </Text>
          </Banner>
        ) : (
          <>
            {}
            <DataTable
              columnContentTypes={["text", "text", "text", "text"]}
              headings={[
                "资产名称/指纹",
                "风险等级 + 原因",
                "推荐迁移路径",
                "预估工时 + 需要的信息"
              ]}
              rows={filteredAndSortedItems.map((item) => {
                const migrationPathLabel = item.suggestedMigration === "web_pixel"
                  ? "Web Pixel"
                  : item.suggestedMigration === "ui_extension"
                    ? "UI Extension"
                    : item.suggestedMigration === "server_side"
                      ? "Server-side"
                      : "None";

                const needsInfo: string[] = [];
                if (item.platform) needsInfo.push(`平台: ${item.platform}`);
                if (item.category === "pixel") needsInfo.push("需要 Pixel ID");
                if (item.category === "survey") needsInfo.push("需要问卷题目");
                const needsInfoText = needsInfo.length > 0 ? needsInfo.join(", ") : "无特殊要求";

                                const assetNameWithFingerprint = item.fingerprint
                  ? `${item.title || item.assetId || "未命名资产"} (${item.fingerprint.slice(0, 8)}...)`
                  : item.title || item.assetId || "未命名资产";

                const riskLevelText = item.riskLevel === "high" ? "高" : item.riskLevel === "medium" ? "中" : "低";
                const riskReason = item.description || "无描述";

                return [
                  assetNameWithFingerprint,
                  `${riskLevelText}风险 - ${riskReason}`,
                  migrationPathLabel,
                  `${formatTime(item.estimatedTime)} | ${needsInfoText}`
                ];
              })}
            />
            <Divider />
            {}
            <BlockStack gap="300">
              {filteredAndSortedItems.map((item) => (
              <Box
                key={item.id}
                background={
                  item.status === "completed"
                    ? "bg-surface-success"
                    : item.status === "in_progress"
                      ? "bg-surface-info"
                      : "bg-surface-secondary"
                }
                padding="400"
                borderRadius="200"
              >
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center" wrap>
                        <Text as="span" fontWeight="semibold">
                          {item.title}
                        </Text>
                        <Badge tone={getRiskBadgeTone(item.riskLevel)}>
                          {item.riskLevel === "high" ? "高" : item.riskLevel === "medium" ? "中" : "低"}
                        </Badge>
                        <Badge tone={item.priority >= 8 ? "critical" : item.priority >= 5 ? undefined : "info"}>
                          {`优先级 ${item.priority}/10`}
                        </Badge>
                        {getStatusBadge(item.status)}
                        {getMigrationBadge(item.suggestedMigration)}
                        {item.platform && <Badge>{item.platform}</Badge>}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.description}
                      </Text>
                      <InlineStack gap="300" blockAlign="center">
                        <InlineStack gap="100" blockAlign="center">
                          <Icon source={ClockIcon} tone="subdued" />
                          <Text as="span" variant="bodySm" tone="subdued">
                            预计 {formatTime(item.estimatedTime)}
                          </Text>
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">
                          • {item.category}
                        </Text>
                      </InlineStack>

                      {dependencyGraph && (() => {
                        const { dependencies, dependents } = getItemDependencies(item.assetId);
                        if (dependencies.length === 0 && dependents.length === 0) return null;

                        return (
                          <Button
                            size="micro"
                            variant="plain"
                            onClick={() => toggleExpanded(item.id)}
                          >
                            {`${expandedItems.has(item.id) ? "隐藏" : "显示"}依赖关系${dependencies.length > 0 ? ` (${dependencies.length} 个依赖)` : ""}${dependents.length > 0 ? ` (${dependents.length} 个被依赖)` : ""}`}
                          </Button>
                        );
                      })()}
                    </BlockStack>

                    {expandedItems.has(item.id) && dependencyGraph && (() => {
                      const { dependencies, dependents } = getItemDependencies(item.assetId);
                      if (dependencies.length === 0 && dependents.length === 0) return null;

                      return (
                        <Box paddingBlockStart="300">
                          <Collapsible
                            open={expandedItems.has(item.id)}
                            id={`deps-${item.id}`}
                            transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
                          >
                            <BlockStack gap="200">
                              {dependencies.length > 0 && (
                                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                  <BlockStack gap="200">
                                    <InlineStack gap="200" blockAlign="center">
                                      <Icon source={AlertCircleIcon} tone="warning" />
                                      <Text as="span" variant="bodySm" fontWeight="semibold">
                                        依赖项 ({dependencies.length})
                                      </Text>
                                    </InlineStack>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      需要先完成以下资产的迁移：
                                    </Text>
                                    <List type="bullet">
                                      {dependencies.map((dep) => (
                                        <List.Item key={dep.assetId}>
                                          <Link
                                            url={`/app/migrate?assetId=${dep.assetId}`}
                                            removeUnderline
                                          >
                                            {dep.name}
                                          </Link>
                                        </List.Item>
                                      ))}
                                    </List>
                                  </BlockStack>
                                </Box>
                              )}
                              {dependents.length > 0 && (
                                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                  <BlockStack gap="200">
                                    <InlineStack gap="200" blockAlign="center">
                                      <Icon source={CheckCircleIcon} tone="info" />
                                      <Text as="span" variant="bodySm" fontWeight="semibold">
                                        被依赖项 ({dependents.length})
                                      </Text>
                                    </InlineStack>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      以下资产的迁移依赖此资产：
                                    </Text>
                                    <List type="bullet">
                                      {dependents.map((dep) => (
                                        <List.Item key={dep.assetId}>
                                          <Link
                                            url={`/app/migrate?assetId=${dep.assetId}`}
                                            removeUnderline
                                          >
                                            {dep.name}
                                          </Link>
                                        </List.Item>
                                      ))}
                                    </List>
                                  </BlockStack>
                                </Box>
                              )}
                            </BlockStack>
                          </Collapsible>
                        </Box>
                      );
                    })()}
                    <InlineStack gap="200">
                      {item.status === "pending" && onItemClick && (
                        <Button
                          size="slim"
                          onClick={() => onItemClick(item.assetId)}
                          url={`/app/migrate?assetId=${item.assetId}`}
                        >
                          开始迁移
                        </Button>
                      )}
                      {item.status !== "completed" && onItemComplete && (
                        <Button
                          size="slim"
                          variant="plain"
                          onClick={() => onItemComplete(item.assetId)}
                          icon={CheckCircleIcon}
                        >
                          标记完成
                        </Button>
                      )}
                    </InlineStack>
                  </InlineStack>
                </BlockStack>
              </Box>
            ))}
          </BlockStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
}

