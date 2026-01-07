
import { useState, useEffect, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  ProgressBar,
  Button,
  DataTable,
  Banner,
  Box,
  Divider,
  Icon,
  EmptyState,
} from "@shopify/polaris";
import {
  RefreshIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
} from "~/components/icons";

interface BatchTask {
  id: string;
  type: "audit" | "template_apply" | "report_export";
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  result?: {
    total: number;
    completed: number;
    failed: number;
    skipped?: number;
  };
  error?: string;
}

interface BatchTaskBoardProps {
  groupId: string;
  requesterId: string;
  onRefresh?: () => void;
}

export function BatchTaskBoard({
  groupId,
  requesterId,
  onRefresh,
}: BatchTaskBoardProps) {
  const [tasks, setTasks] = useState<BatchTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    try {

      const formData = new FormData();
      formData.append("_action", "get_batch_tasks");
      formData.append("groupId", groupId);

      const response = await fetch("/app/workspace", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.success && data.tasks) {
        setTasks(data.tasks);
      }
    } catch (error) {

      if (process.env.NODE_ENV === "development") {

        console.error("Failed to fetch batch tasks:", error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchTasks();

    if (autoRefresh) {
      const interval = setInterval(() => {
        fetchTasks();
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [fetchTasks, autoRefresh]);

  const getTaskTypeLabel = (type: BatchTask["type"]) => {
    switch (type) {
      case "audit":
        return "批量扫描";
      case "template_apply":
        return "批量应用模板";
      case "report_export":
        return "报告导出";
      default:
        return type;
    }
  };

  const getStatusBadge = (status: BatchTask["status"]) => {
    switch (status) {
      case "pending":
        return <Badge tone="info">等待中</Badge>;
      case "running":
        return <Badge tone="attention">运行中</Badge>;
      case "completed":
        return <Badge tone="success">已完成</Badge>;
      case "failed":
        return <Badge tone="critical">失败</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getStatusIcon = (status: BatchTask["status"]) => {
    switch (status) {
      case "completed":
        return CheckCircleIcon;
      case "failed":
        return AlertCircleIcon;
      case "running":
        return ClockIcon;
      default:
        return ClockIcon;
    }
  };

  const runningTasks = tasks.filter((t) => t.status === "running");
  const hasRunningTasks = runningTasks.length > 0;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              任务看板
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              实时查看批量操作的执行状态和进度
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button
              icon={RefreshIcon}
              onClick={fetchTasks}
              loading={isLoading}
              size="slim"
            >
              刷新
            </Button>
            <Button
              variant={autoRefresh ? "primary" : "secondary"}
              onClick={() => setAutoRefresh(!autoRefresh)}
              size="slim"
            >
              {autoRefresh ? "停止自动刷新" : "开启自动刷新"}
            </Button>
          </InlineStack>
        </InlineStack>

        <Divider />

        {tasks.length === 0 ? (
          <EmptyState
            heading="暂无批量任务"
            image=""
          >
            <Text as="p" tone="subdued">
              当您启动批量操作时，任务将显示在这里
            </Text>
          </EmptyState>
        ) : (
          <BlockStack gap="400">
            {hasRunningTasks && (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  当前有 {runningTasks.length} 个任务正在运行，页面将每 5 秒自动刷新
                </Text>
              </Banner>
            )}

            <DataTable
              columnContentTypes={["text", "text", "text", "numeric", "text"]}
              headings={["任务类型", "状态", "进度", "结果", "时间"]}
              rows={tasks.map((task) => [
                getTaskTypeLabel(task.type),
                getStatusBadge(task.status),
                task.status === "running" ? (
                  <Box key={`progress-${task.id}`} minWidth="200px">
                    <ProgressBar progress={task.progress} size="small" />
                    <Text as="p" variant="bodySm" tone="subdued">
                      {task.progress}%
                    </Text>
                  </Box>
                ) : (
                  <Text key={`status-${task.id}`} as="span" variant="bodySm">
                    {task.progress}%
                  </Text>
                ),
                task.result ? (
                  <Text key={`result-${task.id}`} as="span" variant="bodySm">
                    成功: {task.result.completed} / 总数: {task.result.total}
                    {task.result.failed > 0 && ` / 失败: ${task.result.failed}`}
                    {task.result.skipped !== undefined &&
                      task.result.skipped > 0 &&
                      ` / 跳过: ${task.result.skipped}`}
                  </Text>
                ) : (
                  "-"
                ),
                <Text key={`time-${task.id}`} as="span" variant="bodySm">
                  {task.startedAt
                    ? new Date(task.startedAt).toLocaleString("zh-CN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "-"}
                </Text>,
              ])}
            />

            {}
            {tasks.map((task) => (
              <Box key={task.id}>
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Icon source={getStatusIcon(task.status)} />
                        <BlockStack gap="050">
                          <Text as="span" variant="headingSm" fontWeight="semibold">
                            {task.title}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {getTaskTypeLabel(task.type)}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                      {getStatusBadge(task.status)}
                    </InlineStack>

                    {task.status === "running" && (
                      <Box>
                        <ProgressBar progress={task.progress} />
                        <Text as="p" variant="bodySm" tone="subdued">
                          进度: {task.progress}%
                        </Text>
                      </Box>
                    )}

                    {task.result && (
                      <Box>
                        <InlineStack gap="400">
                          <Badge tone="success">
                            {`成功: ${task.result.completed}`}
                          </Badge>
                          {task.result.failed > 0 && (
                            <Badge tone="critical">{`失败: ${task.result.failed}`}</Badge>
                          )}
                          {task.result.skipped !== undefined &&
                            task.result.skipped > 0 && (
                              <Badge>{`跳过: ${task.result.skipped}`}</Badge>
                            )}
                        </InlineStack>
                      </Box>
                    )}

                    {task.error && (
                      <Banner tone="critical">
                        <Text as="p" variant="bodySm">
                          {task.error}
                        </Text>
                      </Banner>
                    )}

                    <InlineStack gap="400">
                      {task.startedAt && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          开始: {new Date(task.startedAt).toLocaleString("zh-CN")}
                        </Text>
                      )}
                      {task.completedAt && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          完成: {new Date(task.completedAt).toLocaleString("zh-CN")}
                        </Text>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Box>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

