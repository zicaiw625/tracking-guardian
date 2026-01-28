import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, List, Link } from "@shopify/polaris";
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
    <Page title="Support" subtitle="帮助中心">
      <BlockStack gap="500">
        <PageIntroCard
          title="支持与工单"
          description="遇到迁移、像素、验收问题可通过工单与 FAQ 获取支持。"
          items={[
            "支持 PII/PCD 与隐私合规咨询",
            "迁移方案可预约专家协助",
          ]}
          primaryAction={{ content: "查看 FAQ", url: faqUrl }}
          secondaryAction={{ content: "导出报告", url: "/app/reports" }}
        />
        <Layout>
          <Layout.Section>
            <BlockStack gap="300">
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
