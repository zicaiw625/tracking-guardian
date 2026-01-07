import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useRevalidator, useActionData } from "@remix-run/react";
import { useState, useCallback, useEffect, Suspense, lazy } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  DataTable,
  Modal,
  TextField,
  Select,
  ProgressBar,
  Icon,
  Tabs,
  List,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  PlusIcon,
  DeleteIcon,
  EditIcon,
  ExportIcon,
  SearchIcon,
  RefreshIcon,
} from "~/components/icons";
import { EnhancedEmptyState, EmptyStateNoPermission, useToastContext, CardSkeleton } from "~/components/ui";
import { authenticate } from "../shopify.server";
import {
  startBatchAudit,
  getBatchAuditStatus,
  type BatchAuditResult,
  type BatchAuditJob,
} from "../services/batch-audit.server";
import {
  batchApplyPixelTemplate,
  getPixelTemplates,
  getBatchApplyJobStatus,
  type BatchApplyResult,
} from "../services/batch-pixel-apply.server";
import { TaskList } from "../components/workspace/TaskList";
import { CommentSection } from "../components/workspace/CommentSection";
import { BatchOperationsPanel } from "../components/workspace/BatchOperationsPanel";
import { BatchTaskBoard } from "../components/workspace/BatchTaskBoard";
import { TaskAssignmentPanel } from "../components/workspace/TaskAssignmentPanel";
import prisma from "../db.server";
import {
  canManageMultipleShops,
  getMaxShopsForShop,
  getShopGroups,
  getShopGroupDetails,
  createShopGroup,
  addShopToGroup,
  removeShopFromGroup,
  updateMemberPermissions,
  deleteShopGroup,
  getGroupAggregatedStats,
  getGroupShopBreakdown,
  type ShopGroupInfo,
  type ShopGroupDetails,
  type AggregatedStats,
} from "../services/multi-shop.server";
import { getAuditAssets, type AuditAssetRecord } from "../services/audit-asset.server";
import { startBatchVerification } from "../services/batch-verification.server";
import { createInvitation } from "../services/workspace-invitation.server";
import { BILLING_PLANS, type PlanId } from "../services/billing/plans";
import {
  getMigrationTasks,
  createMigrationTask,
  updateMigrationTask,
  deleteMigrationTask,
  type CreateTaskInput,
} from "../services/task-assignment.server";
import {
  getTaskComments,
  createTaskComment,
} from "../services/task-comments.server";

const BatchApplyWizard = lazy(() => import("../components/workspace/BatchApplyWizard").then(module => ({ default: module.BatchApplyWizard })));
import type { PixelTemplate, ShopInfo } from "../components/workspace/BatchApplyWizard";

interface LoaderData {
  shop: {
    id: string;
    shopDomain: string;
    plan: PlanId;
  } | null;
  canManage: boolean;
  maxShops: number;
  groups: ShopGroupInfo[];
  selectedGroup: ShopGroupDetails | null;
  groupStats: AggregatedStats | null;
  shopBreakdown: Array<{
    shopId: string;
    shopDomain: string;
    orders: number;
    revenue: number;
    matchRate: number;
  }> | null;
  planInfo: typeof BILLING_PLANS[PlanId];
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: number;
    assignedToShopDomain: string | null;
    commentCount: number;
  }>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true, plan: true },
  });

  if (!shop) {
    return json<LoaderData>({
      shop: null,
      canManage: false,
      maxShops: 1,
      groups: [],
      selectedGroup: null,
      groupStats: null,
      shopBreakdown: null,
      planInfo: BILLING_PLANS.free,
      tasks: [],
    });
  }

  const planId = shop.plan as PlanId;
  const canManage = await canManageMultipleShops(shop.id);
  const maxShops = await getMaxShopsForShop(shop.id);
  const groups = await getShopGroups(shop.id);

  let selectedGroup: ShopGroupDetails | null = null;
  let groupStats: AggregatedStats | null = null;
  let shopBreakdown: Array<{
    shopId: string;
    shopDomain: string;
    orders: number;
    revenue: number;
    matchRate: number;
  }> | null = null;

  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId") || (groups.length > 0 ? groups[0].id : null);

  let tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: number;
    assignedToShopDomain: string | null;
    commentCount: number;
  }> = [];

  const auditAssets = await getAuditAssets(shop.id, {
    migrationStatus: "pending",
    limit: 100,
  });

  if (groupId) {
    selectedGroup = await getShopGroupDetails(groupId, shop.id);
    groupStats = await getGroupAggregatedStats(groupId, shop.id, 7);
    shopBreakdown = await getGroupShopBreakdown(groupId, shop.id, 7);

    const migrationTasks = await getMigrationTasks(shop.id, { groupId });
    tasks = migrationTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assignedToShopDomain: t.assignedToShopDomain,
      commentCount: t.commentCount,
    }));
  }

  return json<LoaderData & { auditAssets: typeof auditAssets; availableMembers: Array<{ shopId: string; shopDomain: string; role: string }> }>({
    shop: { id: shop.id, shopDomain: shop.shopDomain, plan: planId },
    canManage,
    maxShops,
    groups,
    selectedGroup,
    groupStats,
    shopBreakdown,
    planInfo: BILLING_PLANS[planId],
    tasks,
    auditAssets,
    availableMembers: selectedGroup?.members.map((m) => ({
      shopId: m.shopId,
      shopDomain: m.shopDomain || "",
      role: m.role,
    })) || [],
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "店铺未找到" }, { status: 404 });
  }

  switch (actionType) {
    case "create_group": {
      const name = formData.get("name") as string;
      if (!name || name.trim().length === 0) {
        return json({ error: "请输入分组名称" }, { status: 400 });
      }
      const group = await createShopGroup(shop.id, name.trim());
      if (!group) {
        return json({ error: "创建失败，请检查套餐限制" }, { status: 400 });
      }
      return json({ success: true, groupId: group.id });
    }

    case "delete_group": {
      const groupId = formData.get("groupId") as string;
      const success = await deleteShopGroup(groupId, shop.id);
      if (!success) {
        return json({ error: "删除失败" }, { status: 400 });
      }
      return json({ success: true });
    }

    case "add_shop": {
      const groupId = formData.get("groupId") as string;
      const shopId = formData.get("shopId") as string;
      const role = (formData.get("role") as "admin" | "member") || "member";

      const success = await addShopToGroup(groupId, shopId, shop.id, {
        role,
        canEditSettings: role === "admin",
        canViewReports: true,
        canManageBilling: false,
      });

      if (!success) {
        return json({ error: "添加失败" }, { status: 400 });
      }
      return json({ success: true });
    }

    case "remove_shop": {
      const groupId = formData.get("groupId") as string;
      const shopId = formData.get("shopId") as string;

      const success = await removeShopFromGroup(groupId, shopId, shop.id);
      if (!success) {
        return json({ error: "移除失败" }, { status: 400 });
      }
      return json({ success: true });
    }

    case "update_permissions": {
      const groupId = formData.get("groupId") as string;
      const memberId = formData.get("memberId") as string;
      const role = formData.get("role") as "admin" | "member";
      const canEditSettings = formData.get("canEditSettings") === "true";
      const canViewReports = formData.get("canViewReports") === "true";
      const canManageBilling = formData.get("canManageBilling") === "true";

      const success = await updateMemberPermissions(groupId, memberId, shop.id, {
        role,
        canEditSettings,
        canViewReports,
        canManageBilling,
      });

      if (!success) {
        return json({ error: "更新失败" }, { status: 400 });
      }
      return json({ success: true });
    }

    case "batch_verification": {
      const groupId = formData.get("groupId") as string;
      const runType = (formData.get("runType") as "quick" | "full") || "quick";
      const platformsParam = formData.get("platforms") as string;
      const platforms = platformsParam ? platformsParam.split(",") : [];

      if (!groupId) {
        return json({ error: "请选择分组" }, { status: 400 });
      }

      const result = await startBatchVerification({
        groupId,
        requesterId: shop.id,
        runType,
        platforms,
        concurrency: 3,
      });

      if ("error" in result) {
        return json({ error: result.error }, { status: 400 });
      }

      return json({ success: true, jobId: result.jobId });
    }

    case "batch_audit": {
      const groupId = formData.get("groupId") as string;
      if (!groupId) {
        return json({ error: "请选择分组" }, { status: 400 });
      }

      const result = await startBatchAudit({
        groupId,
        requesterId: shop.id,
        concurrency: 3,
        skipRecentHours: 6,
      });

      if ("error" in result) {
        return json({ error: result.error }, { status: 400 });
      }

      return json({
        success: true,
        actionType: "batch_audit",
        jobId: result.jobId,
        message: "批量扫描已启动",
      });
    }

    case "startBatchAudit": {

      const groupId = formData.get("groupId") as string;
      if (!groupId) {
        return json({ error: "请选择分组" }, { status: 400 });
      }

      const result = await startBatchAudit({
        groupId,
        requesterId: shop.id,
        concurrency: 3,
        skipRecentHours: 6,
      });

      if ("error" in result) {
        return json({ error: result.error }, { status: 400 });
      }

      return json({
        success: true,
        actionType: "batch_audit",
        jobId: result.jobId,
        message: "批量扫描已启动",
      });
    }

    case "check_batch_audit": {
      const jobId = formData.get("jobId") as string;
      if (!jobId) {
        return json({ error: "缺少任务 ID" }, { status: 400 });
      }

      const job = getBatchAuditStatus(jobId);
      if (!job) {
        return json({ error: "任务不存在或已过期" }, { status: 404 });
      }

      return json({
        success: true,
        actionType: "check_batch_audit",
        job,
      });
    }

    case "batch_apply_template": {
      const templateId = formData.get("templateId") as string;
      const groupId = formData.get("groupId") as string;
      const overwriteExisting = formData.get("overwriteExisting") === "true";
      const skipIfExists = formData.get("skipIfExists") === "true";

      if (!templateId || !groupId) {
        return json({ error: "缺少必要参数" }, { status: 400 });
      }

      const group = await getShopGroupDetails(groupId, shop.id);
      if (!group) {
        return json({ error: "分组不存在" }, { status: 404 });
      }

      const shopIds = group.members.map((m) => m.shopId);

      const result = await batchApplyPixelTemplate({
        templateId,
        targetShopIds: shopIds,
        overwriteExisting,
        skipIfExists,
      });

      if ("error" in result) {
        return json({ error: result.error }, { status: 400 });
      }

      return json({
        success: true,
        actionType: "batch_apply_template",
        jobId: result.jobId,
        message: `批量应用已启动，正在处理 ${shopIds.length} 个店铺`,
        result,
      });
    }

    case "check_batch_apply": {
      const jobId = formData.get("jobId") as string;
      if (!jobId) {
        return json({ error: "缺少任务 ID" }, { status: 400 });
      }

      const job = getBatchApplyJobStatus(jobId);
      if (!job) {
        return json({ error: "任务不存在或已过期" }, { status: 404 });
      }

      return json({
        success: true,
        actionType: "check_batch_apply",
        job,
      });
    }

    case "send_invitation": {
      const groupId = formData.get("groupId") as string;
      const inviteeEmail = formData.get("inviteeEmail") as string;
      const role = (formData.get("role") as "admin" | "member") || "member";

      if (!groupId) {
        return json({ error: "请选择分组" }, { status: 400 });
      }

      if (!inviteeEmail) {
        return json({ error: "请输入受邀者邮箱" }, { status: 400 });
      }

      const result = await createInvitation({
        groupId,
        inviterId: shop.id,
        inviteeEmail,
        role,
        permissions: {
          canEditSettings: role === "admin",
          canViewReports: true,
          canManageBilling: false,
        },
      });

      if (!result) {
        return json({ error: "创建邀请失败" }, { status: 400 });
      }

      return json({
        success: true,
        actionType: "send_invitation",
        inviteUrl: result.inviteUrl,
        message: "邀请链接已生成",
      });
    }

    case "create_task": {
      const groupId = formData.get("groupId") as string;
      const shopId = formData.get("shopId") as string;
      const title = formData.get("title") as string;

      if (!title || !shopId) {
        return json({ error: "缺少必要参数" }, { status: 400 });
      }

      const taskInput: CreateTaskInput = {
        shopId,
        title,
        description: formData.get("description") as string || undefined,
        assignedToShopId: formData.get("assignedToShopId") as string || undefined,
        priority: formData.get("priority") ? parseInt(formData.get("priority") as string) : undefined,
        dueDate: formData.get("dueDate") ? new Date(formData.get("dueDate") as string) : undefined,
        groupId: groupId || undefined,
        assetId: formData.get("assetId") as string || undefined,
      };

      const result = await createMigrationTask(taskInput, shop.id);
      if ("error" in result) {
        return json({ error: result.error }, { status: 400 });
      }

      return json({ success: true, taskId: result.id, actionType: "create_task" });
    }

    case "createMigrationTasks": {
      const assetIdsStr = formData.get("assetIds") as string;
      const title = formData.get("title") as string;
      const description = formData.get("description") as string;
      const assignedToShopId = formData.get("assignedToShopId") as string;
      const priority = formData.get("priority") ? parseInt(formData.get("priority") as string) : 5;
      const dueDate = formData.get("dueDate") ? new Date(formData.get("dueDate") as string) : undefined;
      const groupId = formData.get("groupId") as string;

      if (!assetIdsStr) {
        return json({ error: "缺少资产 ID" }, { status: 400 });
      }

      const assetIds = JSON.parse(assetIdsStr) as string[];
      const taskIds: string[] = [];

      for (const assetId of assetIds) {

        const asset = await prisma.auditAsset.findUnique({
          where: { id: assetId },
          select: { shopId: true, displayName: true },
        });

        if (!asset) {
          continue;
        }

        const taskInput: CreateTaskInput = {
          shopId: asset.shopId,
          title: title || asset.displayName || "迁移任务",
          description: description || undefined,
          assignedToShopId: assignedToShopId || undefined,
          priority,
          dueDate,
          groupId: groupId || undefined,
          assetId,
        };

        const result = await createMigrationTask(taskInput, shop.id);
        if (!("error" in result)) {
          taskIds.push(result.id);
        }
      }

      return json({
        success: true,
        taskIds,
        actionType: "createMigrationTasks",
        message: `成功创建 ${taskIds.length} 个任务`,
      });
    }

    default:
      return json({ error: "未知操作" }, { status: 400 });
  }
};

function RoleBadge({ role }: { role: string }) {
  switch (role) {
    case "owner":
      return <Badge tone="success">所有者</Badge>;
    case "admin":
      return <Badge tone="info">管理员</Badge>;
    case "member":
      return <Badge>成员</Badge>;
    default:
      return <Badge>{role}</Badge>;
  }
}

function StatsCard({
  title,
  value,
  suffix,
  tone,
}: {
  title: string;
  value: string | number;
  suffix?: string;
  tone?: "success" | "warning" | "critical";
}) {
  const bgColor = tone
    ? tone === "success"
      ? "bg-fill-success-secondary"
      : tone === "warning"
        ? "bg-fill-warning-secondary"
        : "bg-fill-critical-secondary"
    : "bg-surface-secondary";

  return (
    <Box background={bgColor} padding="400" borderRadius="200">
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {title}
        </Text>
        <InlineStack gap="100" blockAlign="baseline">
          <Text as="p" variant="headingXl" fontWeight="bold">
            {value}
          </Text>
          {suffix && (
            <Text as="span" variant="bodySm" tone="subdued">
              {suffix}
            </Text>
          )}
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

export default function WorkspacePage() {
  const loaderData = useLoaderData<typeof loader>();
  const {
    shop,
    canManage,
    maxShops,
    groups,
    selectedGroup,
    groupStats,
    shopBreakdown,
    planInfo,
    tasks,
  } = loaderData;
  const auditAssets = "auditAssets" in loaderData ? (loaderData as typeof loaderData & { auditAssets: AuditAssetRecord[] }).auditAssets : [];
  const availableMembers = "availableMembers" in loaderData ? (loaderData as typeof loaderData & { availableMembers: Array<{ shopId: string; shopDomain: string; role: string }> }).availableMembers : [];
  const actionData = useActionData<typeof action>();

  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const { showSuccess, showError } = useToastContext();

  const [selectedTab, setSelectedTab] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null);
  const [showAddShopModal, setShowAddShopModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newShopDomain, setNewShopDomain] = useState("");
  const [newShopRole, setNewShopRole] = useState<"admin" | "member">("member");

  const [batchAuditJobId, setBatchAuditJobId] = useState<string | null>(null);
  const [batchAuditStatus, setBatchAuditStatus] = useState<BatchAuditJob | null>(null);
  const [batchAuditResult, setBatchAuditResult] = useState<BatchAuditResult | null>(null);
  const [showBatchAuditResult, setShowBatchAuditResult] = useState(false);

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportReportType, setExportReportType] = useState<"verification" | "scan" | "migration">("verification");
  const [exportFormat, setExportFormat] = useState<"csv" | "json" | "pdf">("pdf");
  const [exportResult, setExportResult] = useState<{
    success: boolean;
    totalShops?: number;
    successCount?: number;
    failedCount?: number;
    reports?: Array<{
      shopId: string;
      shopDomain: string;
      status: "success" | "failed";
      error?: string;
    }>;
    downloadUrl?: string;
    error?: string;
  } | null>(null);

  const [showBatchApplyModal, setShowBatchApplyModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PixelTemplate | null>(null);
  const [batchApplyJobId, setBatchApplyJobId] = useState<string | null>(null);
  const [batchApplyStatus, setBatchApplyStatus] = useState<{
    status: "pending" | "running" | "completed" | "failed";
    progress: number;
    totalItems?: number;
    completedItems?: number;
    failedItems?: number;
    skippedItems?: number;
    result?: unknown;
    error?: string;
  } | null>(null);
  const [batchApplyTargetShops, setBatchApplyTargetShops] = useState<ShopInfo[]>([]);

  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskComments, setTaskComments] = useState<Array<{
    id: string;
    taskId: string;
    authorShopId: string;
    authorShopDomain: string;
    content: string;
    isSystemMessage: boolean;
    parentCommentId: string | null;
    replies: Array<{
      id: string;
      authorShopId: string;
      content: string;
      isSystemMessage: boolean;
      parentCommentId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    createdAt: Date;
    updatedAt: Date;
  }>>([]);

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData) {
      if ("success" in actionData && actionData.success) {
        const actionType = (actionData as { actionType?: string }).actionType;
        if (actionType === "create_group") {
          showSuccess("工作区创建成功！");
        } else if (actionType === "delete_group") {
          showSuccess("工作区已删除");
        } else if (actionType === "add_shop") {
          showSuccess("店铺已添加到工作区");
        } else if (actionType === "remove_shop") {
          showSuccess("店铺已从工作区移除");
        } else if (actionType === "export_batch") {
          setExportResult(actionData as typeof exportResult);
          showSuccess("批量导出完成");
        } else if (actionType === "batch_apply_template") {
          const data = actionData as { jobId?: string; result?: BatchApplyResult };
          if (data.jobId) {
            setBatchApplyJobId(data.jobId);
            showSuccess("批量应用已启动，正在处理中...");

          } else if (data.result) {
            const progress = data.result.totalShops > 0
              ? Math.round((data.result.successCount + data.result.failedCount) / data.result.totalShops * 100)
              : 100;
            setBatchApplyStatus({
              status: data.result.success ? "completed" : "failed",
              progress,
              totalItems: data.result.totalShops,
              completedItems: data.result.successCount,
              failedItems: data.result.failedCount,
              result: data.result,
            });
            showSuccess(`批量应用完成：成功 ${data.result.successCount}，失败 ${data.result.failedCount}`);
          }
        } else {
          showSuccess("操作成功");
        }
        revalidator.revalidate();
      } else if ("error" in actionData && actionData.error) {
        showError("操作失败：" + String(actionData.error));
      }
    }
  }, [actionData, showSuccess, showError, revalidator]);

  const handleBatchExport = useCallback(() => {
    if (!selectedGroup) return;

    const formData = new FormData();
    formData.append("_action", "export_batch");
    formData.append("reportType", exportReportType);
    formData.append("format", exportFormat);
    formData.append("groupId", selectedGroup.id);

    showSuccess("正在生成批量报告，请稍候...");

    fetch("/api/batch-reports", {
      method: "POST",
      body: formData,
    })
      .then(async (res) => {
        const contentType = res.headers.get("content-type");

        if (contentType?.includes("application/json")) {
          return res.json();
        } else if (contentType?.includes("application/pdf") || contentType?.includes("text/csv") || contentType?.includes("application/json")) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const disposition = res.headers.get("content-disposition");
          const filename = disposition?.match(/filename="?(.+)"?/)?.[1] ||
            `batch-${exportReportType}-report-${Date.now()}.${exportFormat === "pdf" ? "pdf" : exportFormat === "csv" ? "csv" : "json"}`;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setShowExportModal(false);
          showSuccess(`批量报告已下载: ${filename}`);
          return { success: true, downloaded: true };
        } else {
          const blob = await res.blob();
          return blob.text().then((text) => {
            try {
              return JSON.parse(text);
            } catch {
              throw new Error("无法解析服务器响应");
            }
          });
        }
      })
      .then((data) => {
        if (data.success) {
          if (!data.downloaded) {
            setExportResult(data);
            setShowExportModal(false);
            showSuccess(`批量导出完成：成功 ${data.result?.successCount || 0} 个，失败 ${data.result?.failedCount || 0} 个`);
          }
        } else {
          showError(data.error || "导出失败");
        }
      })
      .catch((error) => {
        showError("导出失败：" + (error.message || "未知错误"));
      });
  }, [selectedGroup, exportReportType, exportFormat, showSuccess, showError]);

  const handleBatchApply = useCallback(async (options: {
    overwriteExisting: boolean;
    skipIfExists: boolean;
  }): Promise<{ jobId?: string; result?: { success: boolean; totalShops: number; successCount: number; failedCount: number } }> => {
    if (!selectedTemplate || !selectedGroup) {
      return {};
    }

    const formData = new FormData();
    formData.append("_action", "batch_apply_template");
    formData.append("templateId", selectedTemplate.id);
    formData.append("groupId", selectedGroup.id);
    formData.append("overwriteExisting", String(options.overwriteExisting));
    formData.append("skipIfExists", String(options.skipIfExists));

    try {
      const response = await fetch("/app/workspace", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        if (data.jobId) {
          setBatchApplyJobId(data.jobId);
          showSuccess("批量应用已启动，正在处理中...");
          return { jobId: data.jobId };
        } else if (data.result) {
          showSuccess(`批量应用完成：成功 ${data.result.successCount}，失败 ${data.result.failedCount}`);
          return { result: data.result };
        }
        return {};
      } else {
        showError(data.error || "批量应用失败");
        throw new Error(data.error || "批量应用失败");
      }
    } catch (error) {
      showError("批量应用失败：" + (error instanceof Error ? error.message : "未知错误"));
      throw error;
    }
  }, [selectedTemplate, selectedGroup, showSuccess, showError]);

  const handleCreateGroup = useCallback(() => {
    if (!newGroupName.trim()) return;
    const formData = new FormData();
    formData.append("_action", "create_group");
    formData.append("name", newGroupName.trim());
    submit(formData, { method: "post" });
    setShowCreateModal(false);
    setNewGroupName("");
  }, [newGroupName, submit]);

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      if (!confirm("确定要删除此分组吗？所有成员关联将被移除。")) return;
      const formData = new FormData();
      formData.append("_action", "delete_group");
      formData.append("groupId", groupId);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const handleRemoveShop = useCallback(
    (groupId: string, shopId: string) => {
      if (!confirm("确定要从分组中移除此店铺吗？")) return;
      const formData = new FormData();
      formData.append("_action", "remove_shop");
      formData.append("groupId", groupId);
      formData.append("shopId", shopId);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const handleBatchAudit = useCallback(() => {
    if (!selectedGroup) return;
    if (!confirm(`确定要对「${selectedGroup.name}」中的所有店铺运行扫描吗？\n\n这将扫描 ${selectedGroup.memberCount} 个店铺，可能需要几分钟时间。`)) return;

    const formData = new FormData();
    formData.append("_action", "batch_audit");
    formData.append("groupId", selectedGroup.id);
    submit(formData, { method: "post" });
  }, [selectedGroup, submit]);

  const handleSendInvitation = useCallback(() => {
    if (!selectedGroup || !inviteeEmail.trim()) return;
    const formData = new FormData();
    formData.append("_action", "send_invitation");
    formData.append("groupId", selectedGroup.id);
    formData.append("inviteeEmail", inviteeEmail.trim());
    formData.append("role", inviteRole);
    submit(formData, { method: "post" });
  }, [selectedGroup, inviteeEmail, inviteRole, submit]);

  const tabs = [
    { id: "overview", content: "概览" },
    { id: "batch", content: "批量操作" },
    { id: "shops", content: "店铺管理" },
    { id: "templates", content: "像素模板" },
    { id: "tasks", content: "任务管理" },
    { id: "reports", content: "汇总报告" },
  ];

  if (!canManage) {
    return (
      <Page title="多店管理">
        <EmptyStateNoPermission
          requiredFeature="Agency"
          onUpgrade={() => window.location.href = "/app/billing"}
        />
      </Page>
    );
  }

  if (!shop) {
    return (
      <Page title="多店管理">
        <Banner tone="critical">
          <Text as="p">未找到店铺信息，请重新安装应用。</Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="多店管理"
      subtitle={`最多可管理 ${maxShops} 个店铺`}
      primaryAction={{
        content: "创建分组",
        icon: PlusIcon,
        onAction: () => setShowCreateModal(true),
        disabled: groups.length >= maxShops,
      }}
      secondaryActions={[
        {
          content: "刷新",
          onAction: () => revalidator.revalidate(),
        },
        {
          content: "像素模板",
          url: "/app/workspace/templates",
        },
      ]}
    >
      <BlockStack gap="500">
        {}
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <InlineStack gap="200">
                <Text as="h2" variant="headingMd">
                  当前套餐
                </Text>
                <Badge tone="success">{planInfo.name}</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {planInfo.tagline}
              </Text>
            </BlockStack>
            <BlockStack gap="100" align="end">
              <Text as="p" variant="bodySm" tone="subdued">
                已创建分组
              </Text>
              <Text as="p" variant="headingMd" fontWeight="bold">
                {groups.length} / {maxShops}
              </Text>
            </BlockStack>
          </InlineStack>
        </Card>

        {}
        {groups.length === 0 ? (
          <EnhancedEmptyState
            icon="📁"
            title="尚未创建分组"
            description="创建分组后，您可以将多个店铺添加到同一分组中进行统一管理。"
            primaryAction={{
              content: "创建第一个分组",
              onAction: () => setShowCreateModal(true),
            }}
          />
        ) : (
          <>
            {}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  我的分组
                </Text>
                <InlineStack gap="200" wrap>
                  {groups.map((group) => (
                    <Button
                      key={group.id}
                      url={`/app/workspace?groupId=${group.id}`}
                      variant={selectedGroup?.id === group.id ? "primary" : "secondary"}
                      size="slim"
                    >
                      {`${group.name} (${group.memberCount})`}
                    </Button>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>

            {}
            {selectedGroup && (
              <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                {}
                {selectedTab === 0 && (
                  <Box paddingBlockStart="400">
                    <BlockStack gap="500">
                      {}
                      <Card>
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text as="h2" variant="headingLg">
                                {selectedGroup.name}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                创建于 {new Date(selectedGroup.createdAt).toLocaleDateString("zh-CN")}
                              </Text>
                            </BlockStack>
                            <InlineStack gap="200">
                              <Button
                                icon={SearchIcon}
                                variant="primary"
                                onClick={handleBatchAudit}
                                loading={isSubmitting}
                              >
                                批量扫描
                              </Button>
                              <Button
                                icon={DeleteIcon}
                                tone="critical"
                                variant="plain"
                                onClick={() => handleDeleteGroup(selectedGroup.id)}
                              >
                                删除分组
                              </Button>
                            </InlineStack>
                          </InlineStack>

                          <Divider />

                          {}
                          <Banner tone="info">
                            <Text as="p" variant="bodySm">
                              💡 <strong>批量扫描</strong>：一键对分组内所有店铺运行 Audit 扫描，
                              识别追踪脚本风险并生成迁移建议。最近 6 小时内已扫描的店铺将被跳过。
                            </Text>
                          </Banner>

                          {}
                          {groupStats && (
                            <Layout>
                              <Layout.Section variant="oneThird">
                                <StatsCard
                                  title="过去 7 天订单"
                                  value={groupStats.totalOrders.toLocaleString()}
                                  suffix="笔"
                                />
                              </Layout.Section>
                              <Layout.Section variant="oneThird">
                                <StatsCard
                                  title="过去 7 天收入"
                                  value={`$${groupStats.totalRevenue.toFixed(2)}`}
                                />
                              </Layout.Section>
                              <Layout.Section variant="oneThird">
                                <StatsCard
                                  title="平均匹配率"
                                  value={groupStats.averageMatchRate.toFixed(1)}
                                  suffix="%"
                                  tone={
                                    groupStats.averageMatchRate >= 95
                                      ? "success"
                                      : groupStats.averageMatchRate >= 80
                                        ? "warning"
                                        : "critical"
                                  }
                                />
                              </Layout.Section>
                            </Layout>
                          )}
                        </BlockStack>
                      </Card>

                      {}
                      {groupStats && Object.keys(groupStats.platformBreakdown).length > 0 && (
                        <Card>
                          <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">
                              平台分布
                            </Text>
                            <DataTable
                              columnContentTypes={["text", "numeric", "numeric"]}
                              headings={["平台", "订单数", "收入"]}
                              rows={Object.entries(groupStats.platformBreakdown).map(
                                ([platform, data]) => [
                                  platform.charAt(0).toUpperCase() + platform.slice(1),
                                  data.orders.toLocaleString(),
                                  `$${data.revenue.toFixed(2)}`,
                                ]
                              )}
                            />
                          </BlockStack>
                        </Card>
                      )}
                    </BlockStack>
                  </Box>
                )}

                {}
                {selectedTab === 1 && (
                  <Box paddingBlockStart="400">
                    <BlockStack gap="500">
                      {selectedGroup && shop && (
                        <>
                          <BatchOperationsPanel
                            groupId={selectedGroup.id}
                            groupName={selectedGroup.name}
                            requesterId={shop.id}
                            memberCount={selectedGroup.memberCount}
                            onBatchAuditStart={handleBatchAudit}
                            onBatchTemplateApply={() => {

                              setShowBatchApplyModal(true);
                            }}
                            onReportGenerate={async (options) => {

                              const formData = new FormData();
                              formData.append("_action", "generate_batch_report");
                              formData.append("groupId", selectedGroup.id);
                              formData.append("reportTypes", JSON.stringify(options.reportTypes || []));
                              formData.append("includeDetails", String(options.includeDetails ?? true));
                              if (options.whiteLabel) {
                                formData.append("whiteLabel", JSON.stringify(options.whiteLabel));
                              }

                              const response = await fetch("/app/workspace", {
                                method: "POST",
                                body: formData,
                              });

                              if (response.ok) {
                                const blob = await response.blob();
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `batch-report-${selectedGroup.name}-${new Date().toISOString().split("T")[0]}.pdf`;
                                document.body.appendChild(a);
                                a.click();
                                window.URL.revokeObjectURL(url);
                                document.body.removeChild(a);
                                showSuccess("报告已生成并下载");
                              } else {
                                const error = await response.json();
                                showError(error.error || "报告生成失败");
                              }
                            }}
                          />
                          <BatchTaskBoard
                            groupId={selectedGroup.id}
                            requesterId={shop.id}
                            onRefresh={() => revalidator.revalidate()}
                          />
                        </>
                      )}
                    </BlockStack>
                  </Box>
                )}

                {selectedTab === 3 && (
                  <Box paddingBlockStart="400">
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text as="h2" variant="headingMd">
                              分组成员
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {selectedGroup.memberCount} 个店铺
                            </Text>
                          </BlockStack>
                          <Button
                            icon={PlusIcon}
                            onClick={() => setShowInviteModal(true)}
                            variant="primary"
                            size="slim"
                          >
                            邀请店铺
                          </Button>
                        </InlineStack>

                        <Divider />

                        {selectedGroup.members.length > 0 ? (
                          <DataTable
                            columnContentTypes={["text", "text", "text", "text", "text"]}
                            headings={["店铺", "角色", "编辑设置", "查看报告", "操作"]}
                            rows={selectedGroup.members.map((member) => [
                              member.shopDomain,
                              <RoleBadge key={member.id} role={member.role} />,
                              member.canEditSettings ? (
                                <Icon key={`edit-${member.id}`} source={CheckCircleIcon} tone="success" />
                              ) : (
                                "-"
                              ),
                              member.canViewReports ? (
                                <Icon key={`view-${member.id}`} source={CheckCircleIcon} tone="success" />
                              ) : (
                                "-"
                              ),
                              member.role !== "owner" ? (
                                <Button
                                  key={`remove-${member.id}`}
                                  size="slim"
                                  tone="critical"
                                  variant="plain"
                                  onClick={() =>
                                    handleRemoveShop(selectedGroup.id, member.shopId)
                                  }
                                >
                                  移除
                                </Button>
                              ) : (
                                <Text key={`owner-${member.id}`} as="span" variant="bodySm" tone="subdued">
                                  -
                                </Text>
                              ),
                            ])}
                          />
                        ) : (
                          <Banner tone="info">
                            <Text as="p">此分组暂无成员。</Text>
                          </Banner>
                        )}

                        <Divider />

                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm" tone="subdued">
                            💡 提示：要添加新店铺到分组，需要先在该店铺上安装此应用，
                            然后使用店铺 ID 进行关联。
                          </Text>
                        </BlockStack>
                      </BlockStack>
                    </Card>
                  </Box>
                )}

                {}
                {selectedTab === 2 && (
                  <Box paddingBlockStart="400">
                    <BlockStack gap="500">
                      <Card>
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                              🎨 像素配置模板
                            </Text>
                            <Button variant="primary" size="slim">
                              创建模板
                            </Button>
                          </InlineStack>

                          <Text as="p" variant="bodySm" tone="subdued">
                            创建可重复使用的像素配置模板，批量应用到分组内的所有店铺。
                          </Text>

                          <Divider />

                          {}
                          <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">
                              系统预设模板
                            </Text>

                            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                              <InlineStack align="space-between" blockAlign="center">
                                <BlockStack gap="100">
                                  <Text as="span" fontWeight="semibold">
                                    基础追踪套件
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    GA4 + Meta Pixel 的基础配置
                                  </Text>
                                </BlockStack>
                                <Button
                              size="slim"
                              onClick={() => {
                                setSelectedTemplate({
                                  id: "basic-tracking",
                                  name: "基础追踪套件",
                                  description: "GA4 + Meta Pixel 的基础配置，适合刚开始追踪的店铺",
                                  platforms: [
                                    { platform: "google", clientSideEnabled: true, serverSideEnabled: true },
                                    { platform: "meta", clientSideEnabled: true, serverSideEnabled: true },
                                  ],
                                });
                                setShowBatchApplyModal(true);
                              }}
                            >
                              应用到分组
                            </Button>
                              </InlineStack>
                            </Box>

                            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                              <InlineStack align="space-between" blockAlign="center">
                                <BlockStack gap="100">
                                  <Text as="span" fontWeight="semibold">
                                    全渠道追踪套件
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    GA4 + Meta + TikTok + Pinterest
                                  </Text>
                                </BlockStack>
                                <Button
                                  size="slim"
                                  onClick={() => {
                                    setSelectedTemplate({
                                      id: "full-channel",
                                      name: "全渠道追踪套件",
                                      description: "GA4 + Meta + TikTok + Pinterest，覆盖主流广告平台",
                                      platforms: [
                                        { platform: "google", clientSideEnabled: true, serverSideEnabled: true },
                                        { platform: "meta", clientSideEnabled: true, serverSideEnabled: true },
                                        { platform: "tiktok", clientSideEnabled: true, serverSideEnabled: true },
                                        { platform: "pinterest", clientSideEnabled: true, serverSideEnabled: false },
                                      ],
                                    });
                                    setShowBatchApplyModal(true);
                                  }}
                                >
                                  应用到分组
                                </Button>
                              </InlineStack>
                            </Box>

                            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                              <InlineStack align="space-between" blockAlign="center">
                                <BlockStack gap="100">
                                  <Text as="span" fontWeight="semibold">
                                    仅服务端追踪
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    仅 CAPI，注重隐私
                                  </Text>
                                </BlockStack>
                                <Button
                                  size="slim"
                                  onClick={() => {
                                    setSelectedTemplate({
                                      id: "capi-only",
                                      name: "仅服务端追踪",
                                      description: "仅 CAPI，最大化隐私保护，适合对隐私要求高的店铺",
                                      platforms: [
                                        { platform: "google", clientSideEnabled: false, serverSideEnabled: true },
                                        { platform: "meta", clientSideEnabled: false, serverSideEnabled: true },
                                      ],
                                    });
                                    setShowBatchApplyModal(true);
                                  }}
                                >
                                  应用到分组
                                </Button>
                              </InlineStack>
                            </Box>
                          </BlockStack>

                          <Divider />

                          <Banner tone="info">
                            <Text as="p" variant="bodySm">
                              💡 <strong>提示：</strong>模板只包含配置结构（启用哪些平台、事件映射等），
                              不包含凭证（API Key、Access Token）。凭证需要在各店铺单独配置。
                            </Text>
                          </Banner>
                        </BlockStack>
                      </Card>
                    </BlockStack>
                  </Box>
                )}

                {}
                {selectedTab === 4 && (
                  <Box paddingBlockStart="400">
                    <BlockStack gap="500">
                      {selectedGroup && shop && (
                        <>
                          <Suspense fallback={<CardSkeleton lines={3} />}>
                            <TaskAssignmentPanel
                              shopId={shop.id}
                              workspaceId={selectedGroup.id}
                              groupId={selectedGroup.id}
                              availableAssets={auditAssets}
                              availableMembers={availableMembers}
                              onTaskCreated={(taskId) => {
                                showSuccess(`任务 ${taskId} 创建成功`);
                                revalidator.revalidate();
                              }}
                            />
                          </Suspense>
                          <Divider />
                          <TaskList
                            tasks={tasks.map((t) => ({
                              id: t.id,
                              shopId: shop.id,
                              shopDomain: shop.shopDomain,
                              assetId: null,
                              assetDisplayName: null,
                              title: t.title,
                              description: null,
                              assignedToShopId: null,
                              assignedToShopDomain: t.assignedToShopDomain,
                              assignedByShopId: shop.id,
                              assignedByShopDomain: shop.shopDomain,
                              status: t.status,
                              priority: t.priority,
                              dueDate: null,
                              startedAt: null,
                              completedAt: null,
                              groupId: selectedGroup.id,
                              groupName: selectedGroup.name,
                              commentCount: t.commentCount,
                              createdAt: new Date(),
                              updatedAt: new Date(),
                            }))}
                            groupId={selectedGroup.id}
                            shopId={shop.id}
                            onTaskCreate={() => {
                              setShowCreateTaskModal(true);
                            }}
                            onTaskUpdate={(taskId) => {
                              setSelectedTaskId(taskId);
                            }}
                            onTaskDelete={async (taskId) => {
                              if (!confirm("确定要删除此任务吗？")) return;
                              const formData = new FormData();
                              formData.append("_action", "delete_task");
                              formData.append("taskId", taskId);
                              submit(formData, { method: "post" });
                            }}
                          />
                        </>
                      )}
                    </BlockStack>
                  </Box>
                )}

                {}

                {selectedTab === 5 && (
                  <Box paddingBlockStart="400">
                    <BlockStack gap="500">
                      <Card>
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                              店铺详细数据
                            </Text>
                            <Button
                              icon={ExportIcon}
                              size="slim"
                              onClick={() => {
                                if (selectedGroup) {
                                  window.open(`/api/exports?type=group_breakdown&groupId=${selectedGroup.id}&format=csv`, "_blank");
                                }
                              }}
                            >
                              导出 CSV
                            </Button>
                          </InlineStack>

                          <Divider />

                          {shopBreakdown && shopBreakdown.length > 0 ? (
                            <DataTable
                              columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                              headings={["店铺", "订单数", "收入", "匹配率"]}
                              rows={shopBreakdown.map((shop) => [
                                shop.shopDomain,
                                shop.orders.toLocaleString(),
                                `$${shop.revenue.toFixed(2)}`,
                                <Badge
                                  key={shop.shopId}
                                  tone={
                                    shop.matchRate >= 95
                                      ? "success"
                                      : shop.matchRate >= 80
                                        ? undefined
                                        : "critical"
                                  }
                                >
                                  {`${shop.matchRate.toFixed(1)}%`}
                                </Badge>,
                              ])}
                            />
                          ) : (
                            <Banner tone="info">
                              <Text as="p">暂无数据，请确保分组中有店铺并产生订单。</Text>
                            </Banner>
                          )}
                        </BlockStack>
                      </Card>

                      <Card>
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text as="h2" variant="headingMd">
                                📄 批量报告导出
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                批量导出分组内所有店铺的验收报告或扫描报告
                              </Text>
                            </BlockStack>
                            <Button
                              icon={ExportIcon}
                              onClick={() => setShowExportModal(true)}
                              variant="primary"
                            >
                              批量导出
                            </Button>
                          </InlineStack>

                          <Divider />

                          <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">
                              支持的导出类型
                            </Text>
                            <List type="bullet">
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  <strong>验收报告</strong> - 包含所有店铺的验收测试结果和评分
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  <strong>扫描报告</strong> - 包含所有店铺的风险扫描结果和迁移建议
                                </Text>
                              </List.Item>
                            </List>
                            <Text as="p" variant="bodySm" tone="subdued">
                              导出格式支持 CSV 和 JSON，可一次性下载所有店铺的报告数据。
                            </Text>
                          </BlockStack>
                        </BlockStack>
                      </Card>

                      {}
                      {exportResult && (
                        <Card>
                          <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">
                              导出结果
                            </Text>
                            <Banner
                              tone={exportResult.success ? "success" : "warning"}
                            >
                              <Text as="p" variant="bodySm">
                                {exportResult.success
                                  ? `✅ 成功导出 ${exportResult.successCount || 0} 个店铺的报告`
                                  : `⚠️ 部分导出失败，成功 ${exportResult.successCount || 0} 个，失败 ${exportResult.failedCount || 0} 个`}
                              </Text>
                            </Banner>
                            {(() => {
                              if (!("result" in exportResult) || !exportResult.result || typeof exportResult.result !== "object" || exportResult.result === null) return null;
                              if (!("combinedReport" in exportResult.result) || !exportResult.result.combinedReport || typeof exportResult.result.combinedReport !== "object" || exportResult.result.combinedReport === null) return null;
                              if (!("filename" in exportResult.result.combinedReport) || !("content" in exportResult.result.combinedReport) || !("mimeType" in exportResult.result.combinedReport)) return null;
                              const result = exportResult.result as { combinedReport: { filename: string; content: string; mimeType: string } };
                              return (
                              <Button
                                variant="primary"
                                onClick={() => {
                                  const combinedReport = result.combinedReport;
                                  const blob = new Blob(
                                    [combinedReport.content],
                                    { type: combinedReport.mimeType }
                                  );
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = combinedReport.filename;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                }}
                              >
                                下载合并报告 ({typeof exportResult.result === "object" && exportResult.result !== null && "combinedReport" in exportResult.result && exportResult.result.combinedReport && typeof exportResult.result.combinedReport === "object" && exportResult.result.combinedReport !== null && "filename" in exportResult.result.combinedReport ? String(exportResult.result.combinedReport.filename) : ""})
                              </Button>
                              );
                            })()}
                          </BlockStack>
                        </Card>
                      )}
                    </BlockStack>
                  </Box>
                )}
              </Tabs>
            )}
          </>
        )}
      </BlockStack>

      {}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="创建新分组"
        primaryAction={{
          content: "创建",
          onAction: handleCreateGroup,
          loading: isSubmitting,
          disabled: !newGroupName.trim(),
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
            <TextField
              label="分组名称"
              value={newGroupName}
              onChange={setNewGroupName}
              placeholder="例如：北美市场店铺"
              autoComplete="off"
            />
            <Text as="p" variant="bodySm" tone="subdued">
              分组可以帮助您管理多个店铺，例如按区域、品牌或客户分类。
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {}
      <Modal
        open={showExportModal}
        onClose={() => {
          setShowExportModal(false);
          setExportReportType("verification");
          setExportFormat("csv");
        }}
        title="批量导出报告"
        primaryAction={{
          content: "导出",
          onAction: handleBatchExport,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => {
              setShowExportModal(false);
              setExportReportType("verification");
              setExportFormat("csv");
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
              <Select
                label="报告类型"
                options={[
                  { label: "验收报告", value: "verification" },
                  { label: "扫描报告", value: "scan" },
                  { label: "迁移报告", value: "migration" },
                ]}
                value={exportReportType}
                onChange={(val) => setExportReportType(val as "verification" | "scan" | "migration")}
              />
            <Select
              label="导出格式"
              options={[
                { label: "PDF (推荐，美观格式)", value: "pdf" },
                { label: "CSV (Excel 兼容)", value: "csv" },
                { label: "JSON (结构化数据)", value: "json" },
              ]}
              value={exportFormat}
              onChange={(val) => setExportFormat(val as "csv" | "json" | "pdf")}
            />
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  将导出「{selectedGroup?.name}」分组内所有 {selectedGroup?.memberCount || 0} 个店铺的报告。
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {exportFormat === "pdf" && "PDF 格式包含完整的报告内容和图表，适合打印和分享。"}
                  {exportFormat === "csv" && "CSV 格式适合在 Excel 中打开和分析数据。"}
                  {exportFormat === "json" && "JSON 格式包含结构化数据，适合程序处理。"}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  导出完成后可下载合并报告文件。
                </Text>
              </BlockStack>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {}
      <Modal
        open={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          setInviteeEmail("");
          setGeneratedInviteUrl(null);
        }}
        title="邀请店铺加入分组"
        primaryAction={
          generatedInviteUrl
            ? {
                content: "复制链接",
                onAction: () => {
                  navigator.clipboard.writeText(generatedInviteUrl);

                },
              }
            : {
                content: "生成邀请链接",
                onAction: handleSendInvitation,
                loading: isSubmitting,
                disabled: !inviteeEmail.trim(),
              }
        }
        secondaryActions={[
          {
            content: generatedInviteUrl ? "关闭" : "取消",
            onAction: () => {
              setShowInviteModal(false);
              setInviteeEmail("");
              setGeneratedInviteUrl(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {generatedInviteUrl ? (
              <>
                <Banner tone="success">
                  <Text as="p">邀请链接已生成！请将链接发送给被邀请的店铺。</Text>
                </Banner>
                <TextField
                  label="邀请链接"
                  value={generatedInviteUrl}
                  readOnly
                  autoComplete="off"
                  helpText="链接有效期 7 天"
                />
              </>
            ) : (
              <>
                <TextField
                  label="受邀店铺邮箱（可选）"
                  type="email"
                  value={inviteeEmail}
                  onChange={setInviteeEmail}
                  placeholder="shop@example.com"
                  autoComplete="off"
                  helpText="用于发送邀请邮件，也可以手动分享链接"
                />
                <Select
                  label="角色"
                  options={[
                    { label: "成员 - 仅查看报告", value: "member" },
                    { label: "管理员 - 可编辑设置", value: "admin" },
                  ]}
                  value={inviteRole}
                  onChange={(val) => setInviteRole(val as "admin" | "member")}
                />
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    被邀请的店铺需要先安装 Tracking Guardian 应用，
                    然后点击邀请链接接受邀请。
                  </Text>
                </Banner>
              </>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {}
      {showBatchApplyModal && selectedTemplate && selectedGroup && (
        <Modal
          open={showBatchApplyModal}
          onClose={() => {
            setShowBatchApplyModal(false);
            setSelectedTemplate(null);
          }}
          title="批量应用像素模板"
          size="large"
        >
          <Modal.Section>
            <Suspense fallback={<CardSkeleton lines={5} />}>
              <BatchApplyWizard
                template={selectedTemplate}
                targetShops={selectedGroup.members.map((m) => ({
                  shopId: m.shopId,
                  shopDomain: m.shopDomain,
                  hasExistingConfig: false,
                }))}
                onConfirm={handleBatchApply}
                onCancel={() => {
                  setShowBatchApplyModal(false);
                  setSelectedTemplate(null);
                  setBatchApplyJobId(null);
                }}
                jobId={batchApplyJobId}
              />
            </Suspense>
          </Modal.Section>
        </Modal>
      )}

      {}

      <Modal
        open={showCreateTaskModal}
        onClose={() => setShowCreateTaskModal(false)}
        title="创建迁移任务"
        primaryAction={{
          content: "创建",
          onAction: () => {
            if (!selectedGroup || !shop) return;
            const formData = new FormData();
            formData.append("_action", "create_task");
            formData.append("groupId", selectedGroup.id);
            formData.append("shopId", shop.id);
            formData.append("title", "新迁移任务");
            submit(formData, { method: "post" });
            setShowCreateTaskModal(false);
          },
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setShowCreateTaskModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                创建任务后，您可以将任务分配给团队成员，并通过评论进行协作。
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
