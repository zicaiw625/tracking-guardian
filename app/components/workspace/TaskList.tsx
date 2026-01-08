import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  DataTable,
  Select,
  TextField,
  Modal,
  Box,
  Divider,
  Banner,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { PlusIcon, EditIcon, DeleteIcon } from "~/components/icons";
import type { TaskWithDetails } from "~/services/task-assignment.server";

interface TaskListProps {
  tasks: TaskWithDetails[];
  groupId?: string;
  shopId: string;
  onTaskCreate?: () => void;
  onTaskUpdate?: (taskId: string) => void;
  onTaskDelete?: (taskId: string) => void;
}

export function TaskList({
  tasks,
  groupId,
  shopId,
  onTaskCreate,
  onTaskUpdate,
  onTaskDelete,
}: TaskListProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");

  const filteredTasks = tasks.filter((task) => {
    if (filterStatus !== "all" && task.status !== filterStatus) return false;
    if (filterPriority !== "all") {
      const priorityNum = parseInt(filterPriority);
      if (priorityNum <= 3 && task.priority > 3) return false;
      if (priorityNum > 3 && priorityNum <= 7 && (task.priority <= 3 || task.priority > 7)) return false;
      if (priorityNum > 7 && task.priority <= 7) return false;
    }
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge>待处理</Badge>;
      case "in_progress":
        return <Badge tone="info">进行中</Badge>;
      case "completed":
        return <Badge tone="success">已完成</Badge>;
      case "blocked":
        return <Badge tone="warning">已阻塞</Badge>;
      case "cancelled":
        return <Badge tone="critical">已取消</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: number) => {
    if (priority <= 3) {
      return <Badge tone="critical">高</Badge>;
    } else if (priority <= 7) {
      return <Badge tone="warning">中</Badge>;
    } else {
      return <Badge>低</Badge>;
    }
  };

  const rows = filteredTasks.map((task) => [
    task.title,
    task.assetDisplayName || "-",
    getStatusBadge(task.status),
    getPriorityBadge(task.priority),
    task.assignedToShopDomain || "未分配",
    task.dueDate ? new Date(task.dueDate).toLocaleDateString("zh-CN") : "-",
    task.commentCount > 0 ? `${task.commentCount} 条评论` : "无评论",
    <InlineStack key={task.id} gap="200">
      <Button
        size="slim"
        variant="plain"
        onClick={() => onTaskUpdate?.(task.id)}
      >
        查看
      </Button>
      <Button
        size="slim"
        tone="critical"
        variant="plain"
        onClick={() => onTaskDelete?.(task.id)}
      >
        删除
      </Button>
    </InlineStack>,
  ]);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              迁移任务
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              共 {tasks.length} 个任务，{filteredTasks.length} 个显示
            </Text>
          </BlockStack>
          <Button
            icon={PlusIcon}
            variant="primary"
            onClick={() => setShowCreateModal(true)}
          >
            创建任务
          </Button>
        </InlineStack>

        <Divider />

        <InlineStack gap="300" wrap>
          <Box minWidth="200px">
            <Select
              label="状态筛选"
              options={[
                { label: "全部", value: "all" },
                { label: "待处理", value: "pending" },
                { label: "进行中", value: "in_progress" },
                { label: "已完成", value: "completed" },
                { label: "已阻塞", value: "blocked" },
                { label: "已取消", value: "cancelled" },
              ]}
              value={filterStatus}
              onChange={setFilterStatus}
            />
          </Box>
          <Box minWidth="200px">
            <Select
              label="优先级筛选"
              options={[
                { label: "全部", value: "all" },
                { label: "高 (1-3)", value: "3" },
                { label: "中 (4-7)", value: "7" },
                { label: "低 (8-10)", value: "10" },
              ]}
              value={filterPriority}
              onChange={setFilterPriority}
            />
          </Box>
        </InlineStack>

        {filteredTasks.length > 0 ? (
          <DataTable
            columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
            headings={["任务", "关联资产", "状态", "优先级", "分配给", "截止日期", "评论", "操作"]}
            rows={rows}
          />
        ) : (
          <Banner tone="info">
            <Text as="p">暂无任务。点击"创建任务"开始创建迁移任务。</Text>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}
