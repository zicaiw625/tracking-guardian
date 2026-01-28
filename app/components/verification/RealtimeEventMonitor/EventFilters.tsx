import { BlockStack, Divider, Filters, InlineStack, Box, Select, ChoiceList, Button } from "@shopify/polaris";
import type { UseEventFiltersReturn } from "./useEventFilters";

interface EventFiltersProps {
  filters: UseEventFiltersReturn;
}

export function EventFilters({ filters }: EventFiltersProps) {
  const {
    searchQuery,
    setSearchQuery,
    filterPlatform,
    setFilterPlatform,
    filterStatus,
    setFilterStatus,
    filterEventType,
    setFilterEventType,
    uniquePlatforms,
    uniqueEventTypes,
    clearFilters,
  } = filters;
  return (
    <>
      <Divider />
      <BlockStack gap="300">
        <Filters
          queryValue={searchQuery}
          filters={[]}
          onQueryChange={setSearchQuery}
          onQueryClear={() => setSearchQuery("")}
          onClearAll={clearFilters}
          queryPlaceholder="搜索事件类型、平台、订单ID..."
        />
        <InlineStack gap="300" wrap>
          <Box minWidth="200px">
            <Select
              label="平台"
              labelHidden
              options={[
                { label: "所有平台", value: "all" },
                ...uniquePlatforms.map(p => ({ label: p, value: p })),
              ]}
              value={filterPlatform}
              onChange={setFilterPlatform}
            />
          </Box>
          <Box minWidth="200px">
            <Select
              label="事件类型"
              labelHidden
              options={[
                { label: "所有事件类型", value: "" },
                ...uniqueEventTypes.map(t => ({ label: t, value: t })),
              ]}
              value={filterEventType}
              onChange={setFilterEventType}
            />
          </Box>
          <Box minWidth="200px">
            <ChoiceList
              title="状态"
              titleHidden
              choices={[
                { label: "成功", value: "success" },
                { label: "失败", value: "failed" },
                { label: "待处理", value: "pending" },
              ]}
              selected={filterStatus}
              onChange={setFilterStatus}
              allowMultiple
            />
          </Box>
          {(filterPlatform !== "all" || filterStatus.length > 0 || filterEventType || searchQuery) && (
            <Button
              variant="plain"
              onClick={clearFilters}
            >
              清除过滤
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </>
  );
}
