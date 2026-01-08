import { useState, useCallback, useMemo } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Select,
  TextField,
  Badge,
  Box,
  Divider,
  List,
  Modal,
  Banner,
  DatePicker,
  RangeSlider,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, PlusIcon } from "~/components/icons";
import { useFetcher } from "@remix-run/react";
import type { AuditAssetRecord } from "~/services/audit-asset.server";

export interface TaskAssignmentPanelProps {
  shopId: string;
  workspaceId?: string;
  groupId?: string;
  availableAssets: AuditAssetRecord[];
  availableMembers?: Array<{
    shopId: string;
    shopDomain: string;
    role: string;
  }>;
  onTaskCreated?: (taskId: string) => void;
}

export function TaskAssignmentPanel({
  shopId,
  workspaceId,
  groupId,
  availableAssets,
  availableMembers = [],
  onTaskCreated,
}: TaskAssignmentPanelProps) {
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [assignedToShopId, setAssignedToShopId] = useState<string>("");
  const [priority, setPriority] = useState(5);
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const fetcher = useFetcher();

  const handleAssetToggle = useCallback((assetId: string) => {
    setSelectedAssets((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  }, []);

  const handleCreateTask = useCallback(() => {
    if (selectedAssets.length === 0) {
      return;
    }

    const formData = new FormData();
    formData.append("_action", "createMigrationTasks");
    formData.append("assetIds", JSON.stringify(selectedAssets));
    formData.append("title", taskTitle || "迁移任务");
    formData.append("description", taskDescription);
    formData.append("assignedToShopId", assignedToShopId);
    formData.append("priority", String(priority));
    formData.append("groupId", groupId || "");
    if (dueDate) {
      formData.append("dueDate", dueDate.toISOString());
    }

    fetcher.submit(formData, { method: "post" });
  }, [
    selectedAssets,
    taskTitle,
    taskDescription,
    assignedToShopId,
    priority,
    groupId,
    dueDate,
    fetcher,
  ]);

  useMemo(() => {
    if (fetcher.data && (fetcher.data as { success?: boolean }).success) {
      const result = fetcher.data as { taskIds?: string[] };
      if (result.taskIds && result.taskIds.length > 0) {
        setShowCreateModal(false);
        setSelectedAssets([]);
        setTaskTitle("");
        setTaskDescription("");
        setAssignedToShopId("");
        setPriority(5);
        setDueDate(undefined);
        if (onTaskCreated) {
          result.taskIds.forEach((id) => onTaskCreated(id));
        }
      }
    }
  }, [fetcher.data, onTaskCreated]);

  const selectedAssetsData = useMemo(() => {
    return availableAssets.filter((asset) => selectedAssets.includes(asset.id));
  }, [availableAssets, selectedAssets]);

  const priorityLabel = useMemo(() => {
    if (priority <= 2) return "高";
    if (priority <= 5) return "中";
    return "低";
  }, [priority]);

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              任务分配
            </Text>
            <Button
              onClick={() => setShowCreateModal(true)}
              disabled={selectedAssets.length === 0}
              icon={PlusIcon}
              variant="primary"
            >
              {`创建任务 (${selectedAssets.length})`}
            </Button>
          </InlineStack>

          <Text as="p" variant="bodySm" tone="subdued">
            选择需要分配的审计资产，创建迁移任务并分配给团队成员
          </Text>

          <Divider />

          {availableAssets.length === 0 ? (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                暂无可分配的审计资产。请先运行扫描或手动添加资产。
              </Text>
            </Banner>
          ) : (
            <BlockStack gap="300">
              {availableAssets.map((asset) => {
                const isSelected = selectedAssets.includes(asset.id);
                const riskBadge = {
                  high: { tone: "critical" as const, label: "高" },
                  medium: { tone: "warning" as const, label: "中" },
                  low: { tone: "success" as const, label: "低" },
                }[asset.riskLevel];

                return (
                  <Box
                    key={asset.id}
                    background={
                      isSelected ? "bg-surface-info" : "bg-surface-secondary"
                    }
                    padding="300"
                    borderRadius="200"
                  >
                    <div onClick={() => handleAssetToggle(asset.id)} style={{ cursor: "pointer", width: "100%", height: "100%" }}>
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="200">
                        <InlineStack gap="200" wrap>
                          <Text as="span" fontWeight="semibold">
                            {asset.displayName || asset.platform || "未命名资产"}
                          </Text>
                          {asset.platform && <Badge>{asset.platform}</Badge>}
                          <Badge tone={riskBadge.tone}>{`${riskBadge.label}风险`}</Badge>
                          <Badge tone="info">{asset.category}</Badge>
                          {asset.migrationStatus === "completed" && (
                            <Badge tone="success">已完成</Badge>
                          )}
                        </InlineStack>
                        {asset.details && typeof asset.details === "object" && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            {JSON.stringify(asset.details).substring(0, 100)}...
                          </Text>
                        )}
                      </BlockStack>
                      {isSelected && (
                        <CheckCircleIcon />
                      )}
                    </InlineStack>
                    </div>
                  </Box>
                );
              })}
            </BlockStack>
          )}

          {selectedAssets.length > 0 && (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                已选择 {selectedAssets.length} 个资产。点击「创建任务」按钮继续。
              </Text>
            </Banner>
          )}
        </BlockStack>
      </Card>

      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="创建迁移任务"
        primaryAction={{
          content: "创建任务",
          onAction: handleCreateTask,
          loading: fetcher.state === "submitting",
          disabled: selectedAssets.length === 0,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setShowCreateModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodySm" tone="subdued">
              将为选中的 {selectedAssets.length} 个资产创建迁移任务
            </Text>

            <TextField
              label="任务标题"
              value={taskTitle}
              onChange={setTaskTitle}
              placeholder="例如：迁移 Meta Pixel 到 Web Pixel"
              helpText="如果不填写，将使用资产名称作为标题"
              autoComplete="off"
            />

            <TextField
              label="任务描述（可选）"
              value={taskDescription}
              onChange={setTaskDescription}
              autoComplete="off"
              multiline={3}
              placeholder="添加任务描述、注意事项等"
            />

            {availableMembers.length > 0 && (
              <Select
                label="分配给"
                options={[
                  { label: "未分配", value: "" },
                  ...availableMembers.map((member) => ({
                    label: member.shopDomain,
                    value: member.shopId,
                  })),
                ]}
                value={assignedToShopId}
                onChange={setAssignedToShopId}
                helpText="选择要分配给的团队成员"
              />
            )}

            <BlockStack gap="300">
              <Text as="span" variant="bodySm" fontWeight="semibold">
                优先级: {priorityLabel} ({priority}/10)
              </Text>
              <RangeSlider
                label=""
                value={priority}
                onChange={(value) => setPriority(value as number)}
                min={1}
                max={10}
                step={1}
                output
              />
            </BlockStack>

            <DatePicker
              month={dueDate ? dueDate.getMonth() : new Date().getMonth()}
              year={dueDate ? dueDate.getFullYear() : new Date().getFullYear()}
              selected={dueDate}
              onMonthChange={(month, year) => {

              }}
              onChange={(range) => {
                if (range && 'start' in range) {
                  setDueDate(range.start);
                } else {
                  setDueDate(range as Date | undefined);
                }
              }}
            />

            <Divider />

            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                选中的资产 ({selectedAssets.length})
              </Text>
              <List>
                {selectedAssetsData.map((asset) => (
                  <List.Item key={asset.id}>
                    {asset.displayName || asset.platform || "未命名资产"}
                  </List.Item>
                ))}
              </List>
            </BlockStack>

            {fetcher.data && (fetcher.data as { error?: string }).error ? (
              <Banner tone="critical">
                <Text as="p" variant="bodySm">
                  {(fetcher.data as { error: string }).error}
                </Text>
              </Banner>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
