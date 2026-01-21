import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Badge,
  Layout,
  Divider,
  List,
} from "@shopify/polaris";
import { CheckCircleIcon, LockIcon } from "~/components/icons";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
    },
  });

  if (!shop) {
    return json({
      shop: null,
      planId: "free" as PlanId,
      hasAgencyAccess: false,
    });
  }

  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const hasAgencyAccess = isPlanAtLeast(planId, "agency");

  return json({
    shop: { id: shop.id, domain: shopDomain },
    planId,
    hasAgencyAccess,
  });
};

export default function WorkspacePage() {
  const { shop, planId, hasAgencyAccess } = useLoaderData<typeof loader>();

  if (!shop) {
    return (
      <Page title="多店工作区">
        <Banner tone="critical" title="未找到店铺信息">
          <Text as="p" variant="bodySm">
            请确保应用已正确安装。
          </Text>
        </Banner>
      </Page>
    );
  }

  if (!hasAgencyAccess) {
    return (
      <Page title="多店工作区">
        <BlockStack gap="500">
          <PageIntroCard
            title="多店工作区"
            description="管理多个店铺、批量配置、团队协作"
            items={[
              "最多 50 个店铺管理",
              "批量 Audit 扫描",
              "批量应用像素模板",
              "团队协作（Owner/Admin/Viewer 权限）",
              "白标报告支持",
            ]}
            primaryAction={{ content: "升级到 Agency", url: "/app/billing" }}
          />

          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    需要 Agency 套餐
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    多店工作区功能需要 Agency ($199/月) 套餐才能使用。
                  </Text>
                </BlockStack>
                <Badge tone="warning">
                  {planId === "free" ? "免费版" : planId === "starter" ? "Starter" : planId === "growth" ? "Growth" : "当前套餐"}
                </Badge>
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Agency 套餐
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  多店铺、批量、白标、团队协作即将在 v1.1 推出；当前已包含：
                </Text>
                <List type="bullet">
                  <List.Item>无限像素、全部模块、验收报告导出</List.Item>
                  <List.Item>专属客户成功经理、SLA 保障</List.Item>
                  <List.Item>每月 100,000 笔订单追踪</List.Item>
                </List>
              </BlockStack>
              <Button url="/app/billing" variant="primary" icon={LockIcon}>
                升级到 Agency
              </Button>
            </BlockStack>
          </Card>
        </BlockStack>
      </Page>
    );
  }

  return (
    <Page title="多店工作区" subtitle="管理多个店铺、批量配置、团队协作">
      <BlockStack gap="500">
        <PageIntroCard
          title="多店工作区"
          description="管理多个店铺、批量配置、团队协作"
          items={[
            "最多 50 个店铺管理",
            "批量 Audit 扫描",
            "批量应用像素模板",
            "团队协作（Owner/Admin/Viewer 权限）",
            "白标报告支持",
          ]}
          primaryAction={{ content: "升级到 Agency", url: "/app/billing" }}
        />

        <Banner tone="warning" title="功能即将推出">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              多店工作区功能正在开发中，预计在 v1.1 版本中发布。
            </Text>
            <Text as="p" variant="bodySm">
              当前版本支持单店管理。如果您需要多店管理功能，请联系我们的客户成功团队。
            </Text>
          </BlockStack>
        </Banner>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              即将推出的功能
            </Text>
            <Divider />
            <Layout>
              <Layout.Section variant="oneHalf">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <CheckCircleIcon />
                    <Text as="h3" variant="headingSm">
                      Workspace 管理
                    </Text>
                  </InlineStack>
                  <List type="bullet">
                    <List.Item>创建和管理多个店铺分组</List.Item>
                    <List.Item>最多 50 个店铺</List.Item>
                    <List.Item>店铺分组和标签</List.Item>
                  </List>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneHalf">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <CheckCircleIcon />
                    <Text as="h3" variant="headingSm">
                      批量操作
                    </Text>
                  </InlineStack>
                  <List type="bullet">
                    <List.Item>批量 Audit 扫描</List.Item>
                    <List.Item>批量应用像素模板</List.Item>
                    <List.Item>批量导出报告</List.Item>
                  </List>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneHalf">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <CheckCircleIcon />
                    <Text as="h3" variant="headingSm">
                      团队协作
                    </Text>
                  </InlineStack>
                  <List type="bullet">
                    <List.Item>Owner/Admin/Viewer 权限</List.Item>
                    <List.Item>团队成员管理</List.Item>
                    <List.Item>协作评论和任务</List.Item>
                  </List>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneHalf">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <CheckCircleIcon />
                    <Text as="h3" variant="headingSm">
                      白标报告
                    </Text>
                  </InlineStack>
                  <List type="bullet">
                    <List.Item>自定义品牌（Agency 品牌）</List.Item>
                    <List.Item>多店铺迁移报告</List.Item>
                    <List.Item>PDF/CSV 导出</List.Item>
                  </List>
                </BlockStack>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
