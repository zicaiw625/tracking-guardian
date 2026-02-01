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
import { CheckCircleIcon, ClockIcon, SearchIcon, AlertCircleIcon, ExportIcon } from "~/components/icons";
import { useSubmit } from "@remix-run/react";
import type { MigrationChecklistItem } from "~/services/migration-checklist.server";
import type { DependencyGraph } from "~/services/dependency-analysis.server";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
      return `${minutes} ${t("common.minutes")}`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} ${t("common.hours")} ${mins} ${t("common.minutes")}` : `${hours} ${t("common.hours")}`;
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
        return <Badge tone="success">{t("checklist.statusLabel.completed")}</Badge>;
      case "in_progress":
        return <Badge tone="info">{t("checklist.statusLabel.inProgress")}</Badge>;
      case "pending":
        return <Badge tone="info">{t("checklist.statusLabel.pending")}</Badge>;
      case "skipped":
        return <Badge>{t("checklist.statusLabel.skipped")}</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };
  const getMigrationBadge = (migration: string) => {
    switch (migration) {
      case "web_pixel":
        return <Badge tone="info">{t("checklist.migrationPath.webPixel")}</Badge>;
      case "ui_extension":
        return <Badge tone="warning">{t("checklist.migrationPath.manual")}</Badge>;
      case "server_side":
        return <Badge tone="warning">{t("checklist.migrationPath.notProvided")}</Badge>;
      case "none":
        return <Badge>{t("checklist.migrationPath.none")}</Badge>;
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
            {t("checklist.title")}
          </Text>
          <InlineStack gap="200">
            <Button
              size="slim"
              icon={ExportIcon}
              onClick={handleExportCSV}
            >
              {t("checklist.exportCSV")}
            </Button>
            <Badge tone="info">{`${filteredAndSortedItems.length} / ${stats.total} ${t("checklist.countSuffix")}`}</Badge>
          </InlineStack>
        </InlineStack>
        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <InlineStack gap="400" wrap>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("checklist.highRisk")}
                </Text>
                <Text as="span" variant="headingLg" fontWeight="bold" tone="critical">
                  {stats.high}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("checklist.mediumRisk")}
                </Text>
                <Text as="span" variant="headingLg" fontWeight="bold">
                  {stats.medium}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("checklist.totalTime")}
                </Text>
                <Text as="span" variant="headingLg" fontWeight="bold">
                  {formatTime(stats.totalTime)}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("checklist.progress")}
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
                label={t("checklist.search")}
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={t("checklist.searchPlaceholder")}
                prefix={<Icon source={SearchIcon} />}
                clearButton
                onClearButtonClick={() => setSearchQuery("")}
                autoComplete="off"
              />
            </Box>
            <Box minWidth="150px">
              <Select
                label={t("checklist.riskLevel")}
                options={[
                  { label: t("checklist.filters.all"), value: "all" },
                  { label: t("checklist.filters.high"), value: "high" },
                  { label: t("checklist.filters.medium"), value: "medium" },
                  { label: t("checklist.filters.low"), value: "low" },
                ]}
                value={filterRisk}
                onChange={(value) => setFilterRisk(value as FilterType)}
              />
            </Box>
            <Box minWidth="150px">
              <Select
                label={t("checklist.category")}
                options={[
                  { label: t("checklist.filters.all"), value: "all" },
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
                label={t("checklist.status")}
                options={[
                  { label: t("checklist.filters.all"), value: "all" },
                  { label: t("checklist.filters.pending"), value: "pending" },
                  { label: t("checklist.filters.inProgress"), value: "in_progress" },
                  { label: t("checklist.filters.completed"), value: "completed" },
                  { label: t("checklist.filters.skipped"), value: "skipped" },
                ]}
                value={filterStatus}
                onChange={setFilterStatus}
              />
            </Box>
            <Box minWidth="150px">
              <Select
                label={t("checklist.sort")}
                options={[
                  { label: t("checklist.sortOptions.priority"), value: "priority" },
                  { label: t("checklist.sortOptions.time"), value: "time" },
                  { label: t("checklist.sortOptions.risk"), value: "risk" },
                  { label: t("checklist.sortOptions.category"), value: "category" },
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
              {t("checklist.prdNote")}
            </Text>
            <List type="bullet">
              {(t("checklist.prdItems", { returnObjects: true }) as string[]).map((item, index) => (
                <List.Item key={index}>{item}</List.Item>
              ))}
            </List>
          </BlockStack>
        </Banner>
        {filteredAndSortedItems.length === 0 ? (
          <Banner tone="info">
            <Text as="p" variant="bodySm">
              {searchQuery || filterRisk !== "all" || filterCategory !== "all" || filterStatus !== "all"
                ? t("checklist.noMatch")
                : t("checklist.empty")}
            </Text>
          </Banner>
        ) : (
          <>
            {}
            <DataTable
              columnContentTypes={["text", "text", "text", "text"]}
              headings={t("checklist.tableHeadings", { returnObjects: true }) as string[]}
              rows={filteredAndSortedItems.map((item) => {
                const migrationPathLabel = item.suggestedMigration === "web_pixel"
                  ? t("checklist.migrationPath.webPixel")
                  : item.suggestedMigration === "ui_extension"
                    ? t("checklist.migrationPath.manual")
                    : item.suggestedMigration === "server_side"
                      ? t("checklist.migrationPath.notProvided")
                      : t("checklist.migrationPath.notSupported");
                
                let needsInfoText = "";
                if (item.requiredInfoKeys && item.requiredInfoKeys.length > 0) {
                    needsInfoText = item.requiredInfoKeys.map(k => t(k.key, k.params)).join(", ");
                } else {
                    const needsInfo: string[] = [];
                    if (item.platform) needsInfo.push(t("checklist.needsInfo.platform", { platform: item.platform }));
                    if (item.category === "pixel") needsInfo.push(t("checklist.needsInfo.pixelId"));
                    if (item.category === "survey") needsInfo.push(t("checklist.needsInfo.surveyQuestions"));
                    needsInfoText = needsInfo.length > 0 ? needsInfo.join(", ") : t("checklist.needsInfo.none");
                }

                const assetNameWithFingerprint = item.fingerprint
                  ? `${item.title || item.assetId || t("checklist.unnamedAsset")} (${item.fingerprint.slice(0, 8)}...)`
                  : item.title || item.assetId || t("checklist.unnamedAsset");
                const riskLevelText = item.riskLevel === "high" 
                  ? t("checklist.riskLevelText.high") 
                  : item.riskLevel === "medium" 
                    ? t("checklist.riskLevelText.medium") 
                    : t("checklist.riskLevelText.low");
                const riskReason = item.riskReasonKey 
                    ? t(item.riskReasonKey, item.riskReasonParams) 
                    : (item.riskReason || item.description || t("checklist.noReason", "No description"));
                return [
                  assetNameWithFingerprint,
                  t("checklist.riskReason", { level: riskLevelText, reason: riskReason }),
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
                          {item.riskLevel === "high" ? t("checklist.riskLevelText.high") : item.riskLevel === "medium" ? t("checklist.riskLevelText.medium") : t("checklist.riskLevelText.low")}
                        </Badge>
                        <Badge tone={item.priority >= 8 ? "critical" : item.priority >= 5 ? undefined : "info"}>
                          {`${t("checklist.sortOptions.priority")} ${item.priority}/10`}
                        </Badge>
                        {getStatusBadge(item.status)}
                        {getMigrationBadge(item.suggestedMigration)}
                        {item.platform && <Badge>{item.platform}</Badge>}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.descriptionKey ? t(item.descriptionKey, {
                            ...item.descriptionParams,
                            category: item.descriptionParams?.category ? t(`checklist.category.${item.descriptionParams.category}`, { defaultValue: item.descriptionParams.category }) : "",
                            migration: item.descriptionParams?.migration ? t(`checklist.migrationPath.${item.descriptionParams.migration}`, { defaultValue: item.descriptionParams.migration }) : "",
                            platform: item.descriptionParams?.platform ? t(`checklist.platform.${item.descriptionParams.platform}`, { defaultValue: item.descriptionParams.platform }) : ""
                        }) : item.description}
                      </Text>
                      <InlineStack gap="300" blockAlign="center">
                        <InlineStack gap="100" blockAlign="center">
                          <Icon source={ClockIcon} tone="subdued" />
                          <Text as="span" variant="bodySm" tone="subdued">
                            {t("common.loading") === "Loading..." ? "Est. " : "预计 "}{formatTime(item.estimatedTime)}
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
                            {`${expandedItems.has(item.id) ? t("checklist.dependencies.hide") : t("checklist.dependencies.show")}${dependencies.length > 0 ? t("checklist.dependencies.depsCount", { count: dependencies.length }) : ""}${dependents.length > 0 ? t("checklist.dependencies.dependentsCount", { count: dependents.length }) : ""}`}
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
                                        {t("checklist.dependencies.title")} ({dependencies.length})
                                      </Text>
                                    </InlineStack>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      {t("checklist.dependencies.desc")}
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
                                        {t("checklist.dependencies.dependentsTitle")} ({dependents.length})
                                      </Text>
                                    </InlineStack>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      {t("checklist.dependencies.dependentsDesc")}
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
                          {t("checklist.startMigration")}
                        </Button>
                      )}
                      {item.status !== "completed" && onItemComplete && (
                        <Button
                          size="slim"
                          variant="plain"
                          onClick={() => onItemComplete(item.assetId)}
                          icon={CheckCircleIcon}
                        >
                          {t("checklist.markComplete")}
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
