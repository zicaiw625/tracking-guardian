import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, List, Link } from "@shopify/polaris";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { getSupportConfig } from "../utils/config.server";
import { useTranslation } from "react-i18next";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const support = getSupportConfig();
  return json({
    host: url.host,
    contactEmail: support.contactEmail,
    faqUrl: support.faqUrl,
    statusPageUrl: support.statusPageUrl,
  });
};

export default function SupportPage() {
  const { t } = useTranslation();
  const { contactEmail, faqUrl, statusPageUrl } = useLoaderData<typeof loader>();
  return (
    <Page title="Support" subtitle={t("support.subtitle")}>
      <BlockStack gap="500">
        <PageIntroCard
          title={t("support.intro.title")}
          description={t("support.intro.description")}
          items={[
            t("support.intro.items.0"),
            t("support.intro.items.1"),
          ]}
          primaryAction={{ content: t("support.intro.action.faq"), url: faqUrl }}
          secondaryAction={{ content: t("support.intro.action.reports"), url: "/app/reports" }}
        />
        <Layout>
          <Layout.Section>
            <BlockStack gap="300">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("support.contact.title")}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      {t("support.contact.email")}<Link url={`mailto:${contactEmail}`}>{contactEmail}</Link>
                    </List.Item>
                    <List.Item>
                      {t("support.contact.helpCenter")}<Link url={faqUrl} external>{faqUrl}</Link>
                    </List.Item>
                    <List.Item>
                      {t("support.contact.statusPage")}<Link url={statusPageUrl} external>{statusPageUrl.replace(/^https?:\/\//, "")}</Link>
                    </List.Item>
                    <List.Item>
                      <Link url="/privacy" external>{t("support.links.privacy")}</Link>
                      {" · "}
                      <Link url="/terms" external>{t("support.links.terms")}</Link>
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
