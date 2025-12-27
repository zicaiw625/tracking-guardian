

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
  Divider,
  Banner,
  Link,
  List,
  Icon,
  Collapsible,
  Button,
} from "@shopify/polaris";
import {
  LockFilledIcon,
  ClockIcon,
  DeleteIcon,
  InfoIcon,
  CheckCircleIcon,
} from "~/components/icons";
import { useState } from "react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      piiEnabled: true,
      pcdAcknowledged: true,
      consentStrategy: true,
    },
  });

  return json({
    shop: shop || { piiEnabled: false, pcdAcknowledged: false, consentStrategy: "strict" },
    appDomain: process.env.APP_URL || "https://your-app-domain.com",
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
  const { shop, appDomain } = useLoaderData<typeof loader>();

  return (
    <Page
      title="隐私与数据"
      subtitle="了解本应用如何收集、使用和保护您店铺的数据"
    >
      <BlockStack gap="500">
        {}
        <Banner title="数据处理概览" tone="info">
          <BlockStack gap="200">
            <p>
              Tracking Guardian 作为<strong>数据处理者</strong>（Data Processor），
              代表商家（数据控制者）处理转化追踪数据。我们遵循 GDPR、CCPA 等隐私法规，
              确保数据安全和合规。
            </p>
          </BlockStack>
        </Banner>

        {}
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
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    PII 高级开关
                  </Text>
                  <Badge tone={shop.piiEnabled ? "warning" : "success"}>
                    {shop.piiEnabled ? "已启用" : "已禁用"}
                  </Badge>
                </BlockStack>
              </Box>
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    PCD 确认
                  </Text>
                  <Badge tone={shop.pcdAcknowledged ? "success" : "attention"}>
                    {shop.pcdAcknowledged ? "已确认" : "未确认"}
                  </Badge>
                </BlockStack>
              </Box>
            </InlineStack>
          </BlockStack>
        </Card>

        <Layout>
          <Layout.Section variant="oneHalf">
            {}
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={InfoIcon} tone="info" />
                  收集的数据类型
                </InlineStack>
              </Text>

              <DataTypeCard
                title="订单数据"
                description="用于转化追踪和归因"
                items={[
                  "订单 ID 和订单号",
                  "订单金额和货币",
                  "商品信息（名称、数量、价格）",
                  "结账令牌（用于匹配像素事件）",
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

              <DataTypeCard
                title="PII 数据（可选）"
                description="仅在启用 PII 开关时收集，用于提高广告平台匹配率"
                items={[
                  "邮箱地址（SHA256 哈希后存储）",
                  "电话号码（SHA256 哈希后存储）",
                  "姓名（SHA256 哈希后存储）",
                  "收货地址（SHA256 哈希后存储）",
                ]}
                tone="warning"
              />
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            {}
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
                    将购买事件发送到您配置的广告平台（Meta、TikTok、GA4），
                    帮助您准确衡量广告投资回报。
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    对账与诊断
                  </Text>
                  <Text as="p" variant="bodySm">
                    比对 Webhook 订单与像素事件，帮助您发现追踪缺口并优化配置。
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
            </BlockStack>
          </Layout.Section>
        </Layout>

        {}
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

        {}
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
                  <code>CUSTOMERS_REDACT</code> webhook，并删除相关的 PII 哈希。
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

            <Banner tone="warning">
              <p>
                <strong>注意</strong>：PII 数据仅以 SHA256 哈希形式存储，
                我们无法从哈希还原原始数据。删除操作会移除哈希值记录。
              </p>
            </Banner>
          </BlockStack>
        </CollapsibleSection>

        {}
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
                    PII 哈希
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  客户 PII（邮箱、电话等）在进入系统时即被 SHA256 哈希，原始数据不存储。
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

        {}
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

        {}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              📚 相关文档
            </Text>
            <List type="bullet">
              <List.Item>
                <Link url="/docs/PRIVACY_POLICY.md" external>
                  完整隐私政策
                </Link>
              </List.Item>
              <List.Item>
                <Link url="/docs/DATA_RETENTION.md" external>
                  数据保留政策
                </Link>
              </List.Item>
              <List.Item>
                <Link url="/docs/COMPLIANCE.md" external>
                  合规说明文档
                </Link>
              </List.Item>
              <List.Item>
                <Link url="https://shopify.dev/docs/apps/store/data-protection/protected-customer-data" external>
                  Shopify 客户数据保护指南
                </Link>
              </List.Item>
              <List.Item>
                <Link url="https://shopify.dev/docs/apps/store/data-protection/gdpr" external>
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
