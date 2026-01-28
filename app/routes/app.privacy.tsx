import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Banner,
  Link,
  List,
  Icon,
  Collapsible,
  Button,
  Modal,
} from "@shopify/polaris";
import {
  LockFilledIcon,
  ClockIcon,
  DeleteIcon,
  InfoIcon,
  CheckCircleIcon,
} from "~/components/icons";
import { useState } from "react";
import { useToastContext } from "~/components/ui";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") || "";
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      consentStrategy: true,
    },
  });
  const gdprJobs = tab === "gdpr"
    ? await prisma.gDPRJob.findMany({
        where: { shopDomain },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          jobType: true,
          status: true,
          createdAt: true,
          completedAt: true,
          errorMessage: true,
        },
      })
    : [];
  return json({
    shop: shop || { consentStrategy: "strict" },
    appDomain: process.env.APP_URL || "https://app.tracking-guardian.com",
    tab,
    gdprJobs,
  });
};

function DataTypeCard({
  title,
  description,
  items,
  tone = "info",
}: {
  title: string;
  description: string;
  items: string[];
  tone?: "info" | "success" | "warning";
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {title}
          </Text>
          <Badge tone={tone}>{`${items.length} 项`}</Badge>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {description}
        </Text>
        <List type="bullet">
          {items.map((item, index) => (
            <List.Item key={index}>{item}</List.Item>
          ))}
        </List>
      </BlockStack>
    </Card>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <BlockStack gap="300">
        <div
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          style={{ cursor: "pointer", width: "100%" }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              setOpen(!open);
            }
          }}
        >
          <InlineStack align="space-between" blockAlign="center" gap="200">
            <Text as="span" variant="headingMd">
              {title}
            </Text>
            <Text as="span" tone="subdued">
              {open ? "▲" : "▼"}
            </Text>
          </InlineStack>
        </div>
        <Collapsible open={open} id={`section-${title}`}>
          <Box paddingBlockStart="200">{children}</Box>
        </Collapsible>
      </BlockStack>
    </Card>
  );
}

export default function PrivacyPage() {
  const { showError } = useToastContext();
  const { shop, appDomain, tab, gdprJobs } = useLoaderData<typeof loader>();
  const isGdprTab = tab === "gdpr";
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  return (
    <Page
      title="隐私与数据"
      subtitle="了解本应用如何收集、使用和保护您店铺的数据"
    >
      <BlockStack gap="500">
        {isGdprTab ? (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  GDPR 请求历史
                </Text>
                <Button url="/app/privacy" variant="secondary">
                  返回
                </Button>
              </InlineStack>
              {gdprJobs.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  暂无记录
                </Text>
              ) : (
                <BlockStack gap="300">
                  {gdprJobs.map((job) => {
                    const tone =
                      job.status === "completed"
                        ? "success"
                        : job.status === "failed"
                        ? "critical"
                        : "info";
                    const createdAt = new Date(job.createdAt).toLocaleString();
                    const completedAt = job.completedAt ? new Date(job.completedAt).toLocaleString() : null;
                    return (
                      <Card key={job.id}>
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="headingSm">
                              {job.jobType}
                            </Text>
                            <Badge tone={tone as any}>{job.status}</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            创建时间：{createdAt}
                          </Text>
                          {completedAt ? (
                            <Text as="p" variant="bodySm" tone="subdued">
                              完成时间：{completedAt}
                            </Text>
                          ) : null}
                          {job.errorMessage ? (
                            <Text as="p" variant="bodySm" tone="critical">
                              {job.errorMessage}
                            </Text>
                          ) : null}
                          <InlineStack gap="200">
                            <Button url={`/app/gdpr/export/${job.id}`} variant="primary">
                              下载 JSON
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </Card>
                    );
                  })}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        ) : null}
        <Banner title="数据处理概览" tone="info">
          <BlockStack gap="200">
            <p>
              Tracking Guardian 作为<strong>数据处理者</strong>（Data Processor），
              代表商家（数据控制者）处理转化追踪数据。我们遵循 GDPR、CCPA 等隐私法规，
              确保数据安全和合规。
            </p>
          </BlockStack>
        </Banner>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              📋 您的当前配置
            </Text>
            <InlineStack gap="400" wrap>
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    同意策略
                  </Text>
                  <Badge tone={shop.consentStrategy === "strict" ? "success" : "info"}>
                    {shop.consentStrategy === "strict" ? "严格模式" : "平衡模式"}
                  </Badge>
                </BlockStack>
              </Box>
            </InlineStack>
          </BlockStack>
        </Card>
        <Layout>
          <Layout.Section variant="oneHalf">
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={InfoIcon} tone="info" />
                  收集的数据类型
                </InlineStack>
              </Text>
              <DataTypeCard
                title="像素事件数据"
                description="来自 Web Pixel 事件收据，用于诊断和统计"
                items={[
                  "事件 ID 和事件类型",
                  "事件时间戳",
                  "事件参数（如订单金额、货币、商品信息等）",
                  "结账令牌（用于匹配像素事件，已哈希）",
                ]}
                tone="info"
              />
              <DataTypeCard
                title="客户同意状态"
                description="尊重客户隐私选择"
                items={[
                  "marketing: 是否同意营销追踪",
                  "analytics: 是否同意分析追踪",
                  "saleOfData: 是否允许数据销售（CCPA）",
                ]}
                tone="success"
              />
            </BlockStack>
          </Layout.Section>
          <Layout.Section variant="oneHalf">
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={CheckCircleIcon} tone="success" />
                  数据用途
                </InlineStack>
              </Text>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    转化追踪
                  </Text>
                  <Text as="p" variant="bodySm">
                    v1 默认仅基于 Web Pixel 客户事件和像素收据（PixelEventReceipt），不通过 Admin API 读取订单，也不向第三方平台发送服务端事件。
                  </Text>
                  <Banner tone="warning">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        重要：当前版本不提供服务端投递
                      </Text>
                      <Text as="p" variant="bodySm">
                        当前版本仅接收与校验 Web Pixel 事件，用于应用内诊断与验收。
                      </Text>
                    </BlockStack>
                  </Banner>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    对账与诊断
                  </Text>
                  <Text as="p" variant="bodySm">
                    v1 默认仅基于 Web Pixel 客户事件和像素收据（PixelEventReceipt），不通过 Admin API 读取订单。我们通过比对像素事件收据与内部日志，帮助您发现追踪缺口并优化配置。
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    合规执行
                  </Text>
                  <Text as="p" variant="bodySm">
                    根据客户的同意状态，自动决定是否向特定平台发送数据，确保符合 GDPR/CCPA。
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    通知与第三方服务
                  </Text>
                  <Text as="p" variant="bodySm">
                    当前版本中，告警通知功能已禁用。以下服务仅在将来版本或商家显式启用告警功能时使用：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>Slack Webhook</strong>：发送 JSON 格式的告警数据（店铺域名、告警类型、聚合指标、报告链接）。仅商家级运营数据，不包含订单明细或终端客户信息。
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>Telegram Bot API</strong>：发送店铺维度告警摘要与指标。不包含订单明细与终端客户信息。
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
        <CollapsibleSection title="数据保存时长" defaultOpen>
          <BlockStack gap="300">
            <Banner tone="info">
              <p>我们遵循数据最小化原则，仅保存必要的数据，并定期清理过期数据。</p>
            </Banner>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    ConversionJob（转化任务）
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  保存 <strong>30 天</strong>，用于重试失败的发送和对账分析。
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    PixelEventReceipt（像素收据）
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  保存 <strong>7 天</strong>，用于订单-像素匹配验证。
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    ConversionLog（发送日志）
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  保存 <strong>90 天</strong>，用于审计和问题排查。
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    ReconciliationReport（对账报告）
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  保存 <strong>365 天</strong>，用于长期趋势分析。
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title="数据删除方式">
          <BlockStack gap="300">
            <Text as="p">
              我们支持多种数据删除方式，确保您可以随时控制数据：
            </Text>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={DeleteIcon} tone="critical" />
                  <Text as="span" fontWeight="semibold">
                    卸载应用
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  当您卸载应用时，我们会收到 Shopify 的{" "}
                  <code>APP_UNINSTALLED</code> webhook，并在 <strong>48 小时内</strong>{" "}
                  删除与您店铺相关的所有数据。
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={DeleteIcon} tone="critical" />
                  <Text as="span" fontWeight="semibold">
                    GDPR 客户数据删除请求
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  当客户通过 Shopify 请求删除其数据时，我们会收到{" "}
                  <code>CUSTOMERS_DATA_REQUEST</code> 或{" "}
                  <code>CUSTOMERS_REDACT</code> webhook，并删除相关的数据。
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={DeleteIcon} tone="critical" />
                  <Text as="span" fontWeight="semibold">
                    店铺数据删除请求
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  响应 <code>SHOP_REDACT</code> webhook，删除店铺的所有数据。
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title="安全措施">
          <BlockStack gap="300">
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={LockFilledIcon} tone="success" />
                  <Text as="span" fontWeight="semibold">
                    传输加密
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  所有 API 通信均使用 TLS 1.2+ 加密。
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={LockFilledIcon} tone="success" />
                  <Text as="span" fontWeight="semibold">
                    凭证加密
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  平台 API 密钥（Meta Access Token、TikTok Pixel Code 等）使用 AES-256-GCM 加密存储。
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={LockFilledIcon} tone="success" />
                  <Text as="span" fontWeight="semibold">
                    访问控制
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  通过 Shopify OAuth 验证，确保只有授权的店铺管理员可以访问数据。
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title="GDPR Webhooks 测试指引">
          <BlockStack gap="300">
            <Text as="p">
              Shopify 要求应用正确响应 GDPR 相关的强制 webhooks。以下是测试方法：
            </Text>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="span" fontWeight="semibold">
                  1. 在 Shopify Partners Dashboard 中找到您的应用
                </Text>
                <Text as="p" variant="bodySm">
                  进入 <strong>App setup → GDPR Mandatory webhooks</strong>
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="span" fontWeight="semibold">
                  2. 配置 webhook 端点
                </Text>
                <Text as="p" variant="bodySm">
                  确保以下端点已正确配置：
                </Text>
                <List type="bullet">
                  <List.Item>
                    Customer data request: <code>{appDomain}/webhooks</code>
                  </List.Item>
                  <List.Item>
                    Customer data erasure: <code>{appDomain}/webhooks</code>
                  </List.Item>
                  <List.Item>
                    Shop data erasure: <code>{appDomain}/webhooks</code>
                  </List.Item>
                </List>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="span" fontWeight="semibold">
                  3. 使用 Shopify CLI 测试
                </Text>
                <Text as="p" variant="bodySm">
                  运行以下命令触发测试 webhook：
                </Text>
                <Box background="bg-surface" padding="200" borderRadius="100">
                  <code>shopify app trigger-webhook --topic customers/data_request</code>
                </Box>
              </BlockStack>
            </Box>
            <Banner tone="success">
              <p>
                本应用已实现所有 GDPR 强制 webhooks 处理程序。
                详见 <code>app/webhooks/handlers/</code> 目录。
              </p>
            </Banner>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title="数据导出与删除">
          <BlockStack gap="400">
            <Banner tone="info">
              <Text variant="bodySm" as="span">
                根据 GDPR 和 CCPA 法规，您有权导出或删除您的数据。我们提供以下工具：
              </Text>
            </Banner>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">
                  数据导出
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  导出您店铺的所有数据，包括转化记录、事件日志、问卷响应等。
                </Text>
                <InlineStack gap="200">
                  <Button
                    url="/api/exports?type=conversions&format=json"
                    external
                    variant="primary"
                  >
                    导出转化数据 (JSON)
                  </Button>
                  <Button
                    url="/api/exports?type=conversions&format=csv"
                    external
                  >
                    导出转化数据 (CSV)
                  </Button>
                  <Button
                    url="/api/exports?type=events&format=json"
                    external
                  >
                    导出事件日志 (JSON)
                  </Button>
                </InlineStack>
                <Text variant="bodySm" as="p" tone="subdued">
                  导出文件将在浏览器中下载。大型数据集可能需要几分钟时间。
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">
                  数据删除
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  删除您店铺的所有数据。此操作不可撤销，请谨慎操作。
                </Text>
                <Banner tone="critical">
                  <Text variant="bodySm" as="span" fontWeight="semibold">
                    警告：删除操作将永久删除所有数据，包括：
                  </Text>
                  <List type="bullet">
                    <List.Item>所有转化记录</List.Item>
                    <List.Item>所有事件日志</List.Item>
                    <List.Item>所有问卷响应</List.Item>
                    <List.Item>所有配置和设置</List.Item>
                  </List>
                </Banner>
                <Button
                  tone="critical"
                  onClick={() => {
                    setShowDeleteModal(true);
                  }}
                >
                  删除所有数据
                </Button>
                <Modal
                  open={showDeleteModal}
                  onClose={() => setShowDeleteModal(false)}
                  title="确认删除所有数据"
                  primaryAction={{
                    content: "确认删除",
                    destructive: true,
                    onAction: () => {
                      setShowDeleteModal(false);
                      showError("删除功能需要后端支持，请联系管理员或通过 GDPR webhook 处理");
                    },
                  }}
                  secondaryActions={[
                    {
                      content: "取消",
                      onAction: () => setShowDeleteModal(false),
                    },
                  ]}
                >
                  <Modal.Section>
                    <Text variant="bodyMd" as="p">
                      您确定要删除所有数据吗？此操作将永久删除：
                    </Text>
                    <List type="bullet">
                      <List.Item>所有转化记录</List.Item>
                      <List.Item>所有事件日志</List.Item>
                      <List.Item>所有问卷响应</List.Item>
                      <List.Item>所有配置和设置</List.Item>
                    </List>
                    <Text variant="bodyMd" as="p" tone="critical" fontWeight="semibold">
                      此操作不可撤销！
                    </Text>
                  </Modal.Section>
                </Modal>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">
                  GDPR 请求状态
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  查看最近的 GDPR 数据请求和删除请求状态。
                </Text>
                <Button url="/app/privacy?tab=gdpr" variant="secondary">
                  查看 GDPR 请求历史
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </CollapsibleSection>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              📚 相关文档
            </Text>
            <List type="bullet">
              <List.Item>
                <Link url="/privacy" external>
                  完整隐私政策
                </Link>
              </List.Item>
              <List.Item>
                <Link url="https://help.shopify.com/en/manual/your-account/privacy" external>
                  Shopify 客户数据保护指南
                </Link>
              </List.Item>
              <List.Item>
                <Link url="https://help.shopify.com/en/manual/your-account/gdpr" external>
                  Shopify GDPR 要求
                </Link>
              </List.Item>
            </List>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
