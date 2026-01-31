import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, List, Link } from "@shopify/polaris";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { getSupportConfig } from "../utils/config.server";
import { useLocale } from "~/context/LocaleContext";

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
  const { t, tArray } = useLocale();
  const { contactEmail, faqUrl, statusPageUrl } = useLoaderData<typeof loader>();
  return (
    <Page title={t("support.title")} subtitle={t("support.subtitle")}>
      <BlockStack gap="500">
        <PageIntroCard
          title={t("support.supportAndTickets")}
          description={t("support.supportDesc")}
          items={tArray("support.supportItems")}
          primaryAction={{ content: t("support.viewFaq"), url: faqUrl }}
          secondaryAction={{ content: t("support.exportReport"), url: "/app/reports" }}
        />
        <Layout>
          <Layout.Section>
            <BlockStack gap="300">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("support.contactUs")}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      {t("support.email")}: <Link url={`mailto:${contactEmail}`}>{contactEmail}</Link>
                    </List.Item>
                    <List.Item>
                      {t("support.helpCenter")}: <Link url={faqUrl} external>{faqUrl}</Link>
                    </List.Item>
                    <List.Item>
                      {t("support.statusPage")}: <Link url={statusPageUrl} external>{statusPageUrl.replace(/^https?:\/\//, "")}</Link>
                    </List.Item>
                    <List.Item>
                      <Link url="/privacy" external>{t("support.privacyPolicy")}</Link>
                      {" · "}
                      <Link url="/terms" external>{t("support.termsOfService")}</Link>
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
