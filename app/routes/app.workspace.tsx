/**
 * Agency Workspace 管理页面
 * 对应设计方案 4.7 Agency：多店与交付
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useRevalidator } from "@remix-run/react";
import { useState, useCallback } from "react";
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
  EmptyState,
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
} from "~/components/icons";

import { authenticate } from "../shopify.server";
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
import { BILLING_PLANS, type PlanId } from "../services/billing/plans";

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
    });
  }

  const planId = shop.plan as PlanId;
  const canManage = await canManageMultipleShops(shop.id);
  const maxShops = await getMaxShopsForShop(shop.id);
  const groups = await getShopGroups(shop.id);

  // 如果有分组，加载第一个分组的详情
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

  if (groupId) {
    selectedGroup = await getShopGroupDetails(groupId, shop.id);
    groupStats = await getGroupAggregatedStats(groupId, shop.id, 7);
    shopBreakdown = await getGroupShopBreakdown(groupId, shop.id, 7);
  }

  return json<LoaderData>({
    shop: { id: shop.id, shopDomain: shop.shopDomain, plan: planId },
    canManage,
    maxShops,
    groups,
    selectedGroup,
    groupStats,
    shopBreakdown,
    planInfo: BILLING_PLANS[planId],
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
  const {
    shop,
    canManage,
    maxShops,
    groups,
    selectedGroup,
    groupStats,
    shopBreakdown,
    planInfo,
  } = useLoaderData<typeof loader>();

  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const [selectedTab, setSelectedTab] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddShopModal, setShowAddShopModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newShopDomain, setNewShopDomain] = useState("");
  const [newShopRole, setNewShopRole] = useState<"admin" | "member">("member");

  const isSubmitting = navigation.state === "submitting";

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

  const tabs = [
    { id: "overview", content: "概览" },
    { id: "shops", content: "店铺管理" },
    { id: "reports", content: "汇总报告" },
  ];

  // 未启用 Agency 功能
  if (!canManage) {
    return (
      <Page title="多店管理">
        <Card>
          <EmptyState
            heading="升级到 Agency 版解锁多店管理"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            action={{
              content: "查看套餐",
              url: "/app/billing",
            }}
          >
            <BlockStack gap="200">
              <Text as="p">
                Agency 版 (${BILLING_PLANS.agency.price}/月) 提供多店管理功能：
              </Text>
              <List type="bullet">
                <List.Item>最多管理 50 个店铺</List.Item>
                <List.Item>批量 Audit 与配置</List.Item>
                <List.Item>团队协作 (Owner/Admin/Viewer)</List.Item>
                <List.Item>迁移验收报告导出 (PDF/CSV)</List.Item>
                <List.Item>汇总统计与对账</List.Item>
              </List>
            </BlockStack>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  // 没有店铺信息
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
      ]}
    >
      <BlockStack gap="500">
        {/* 套餐信息 */}
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

        {/* 分组列表 */}
        {groups.length === 0 ? (
          <Card>
            <EmptyState
              heading="尚未创建分组"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "创建第一个分组",
                onAction: () => setShowCreateModal(true),
              }}
            >
              <Text as="p">创建分组后，您可以将多个店铺添加到同一分组中进行统一管理。</Text>
            </EmptyState>
          </Card>
        ) : (
          <>
            {/* 分组选择器 */}
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
                      {group.name} ({group.memberCount})
                    </Button>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>

            {/* 选中的分组详情 */}
            {selectedGroup && (
              <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                {/* 概览 */}
                {selectedTab === 0 && (
                  <Box paddingBlockStart="400">
                    <BlockStack gap="500">
                      {/* 分组信息 */}
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

                          {/* 统计卡片 */}
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

                      {/* 平台分布 */}
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

                {/* 店铺管理 */}
                {selectedTab === 1 && (
                  <Box paddingBlockStart="400">
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h2" variant="headingMd">
                            分组成员
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {selectedGroup.memberCount} 个店铺
                          </Text>
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

                {/* 汇总报告 */}
                {selectedTab === 2 && (
                  <Box paddingBlockStart="400">
                    <BlockStack gap="500">
                      <Card>
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                              店铺详细数据
                            </Text>
                            <Button icon={ExportIcon} size="slim">
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
                                        ? "warning"
                                        : "critical"
                                  }
                                >
                                  {shop.matchRate.toFixed(1)}%
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
                          <Text as="h2" variant="headingMd">
                            📄 验收报告导出
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            生成包含所有店铺迁移状态和验收结果的汇总报告。
                          </Text>
                          <InlineStack gap="200">
                            <Button>导出 PDF 报告</Button>
                            <Button variant="secondary">导出 CSV 数据</Button>
                          </InlineStack>
                        </BlockStack>
                      </Card>
                    </BlockStack>
                  </Box>
                )}
              </Tabs>
            )}
          </>
        )}
      </BlockStack>

      {/* 创建分组模态框 */}
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
    </Page>
  );
}

