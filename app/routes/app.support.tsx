import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, List, Link } from "@shopify/polaris";
import { PageIntroCard } from "~/components/layout/PageIntroCard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return json({
    host: url.host,
    contactEmail: "support@tracking-guardian.app",
    faqUrl: "https://help.tracking-guardian.app",
  });
};

export default function SupportPage() {
  const { contactEmail, faqUrl } = useLoaderData<typeof loader>();
  return (
    <Page title="Support" subtitle="帮助中心与诊断包导出">
      <BlockStack gap="500">
        <PageIntroCard
          title="支持与工单"
          description="遇到迁移、像素、验收问题可通过工单与 FAQ 获取支持。诊断包包含配置快照、像素/事件日志摘要与错误指标，不包含订单或客户 PII。"
          items={[
            "紧急问题请优先提交诊断包",
            "支持 PII/PCD 与隐私合规咨询",
            "迁移方案可预约专家协助",
          ]}
          primaryAction={{ content: "查看 FAQ", url: faqUrl }}
          secondaryAction={{ content: "诊断包导出", url: "/api/diagnostics.export" }}
        />
        <Layout>
          <Layout.Section>
            <BlockStack gap="300">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    诊断包导出说明
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    诊断包包含基础配置状态、事件健康度摘要、像素安装状态等信息，便于定位追踪问题。
                    不包含订单明细、客户邮箱/电话等敏感数据。
                  </Text>
                  <InlineStack gap="200">
                    <Link url="/app/diagnostics">查看诊断页</Link>
                    <Link url="/api/diagnostics.export">下载诊断包</Link>
                    <Link url="/app/reports">导出报告</Link>
                  </InlineStack>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    联系我们
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      邮箱：<Link url={`mailto:${contactEmail}`}>{contactEmail}</Link>
                    </List.Item>
                    <List.Item>
                      帮助中心：<Link url={faqUrl} external>{faqUrl}</Link>
                    </List.Item>
                    <List.Item>
                      状态页：<Link url="https://status.tracking-guardian.app" external>status.tracking-guardian.app</Link>
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
