import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDynamicCorsHeaders } from "../utils/cors";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { getPublicAppDomain, getSupportConfig } from "../utils/config.server";
import { useTranslation, Trans } from "react-i18next";
import { PublicLayout } from "~/components/layout/PublicLayout";
import { Card, Text, BlockStack, Layout } from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = getDynamicCorsHeaders(request);
  const support = getSupportConfig();

  const response = json({
    appName: "Tracking Guardian",
    appDomain: getPublicAppDomain(),
    lastUpdated: "2026-02-02",
    contactEmail: support.contactEmail,
  });
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  addSecurityHeadersToHeaders(headers, PUBLIC_PAGE_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

function TermsContent() {
  const { t } = useTranslation();
  const { appName, appDomain, lastUpdated, contactEmail } = useLoaderData<typeof loader>();

  return (
    <PublicLayout>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h1" variant="headingLg">{t("PublicTerms.Title")}</Text>
              <BlockStack gap="200">
                <Text as="p" tone="subdued">
                  <strong>{t("PublicTerms.Meta.AppName")}：</strong>{appName}
                </Text>
                <Text as="p" tone="subdued">
                  <strong>{t("PublicTerms.Meta.LastUpdated")}：</strong>{lastUpdated}
                </Text>
                <Text as="p" tone="subdued">
                  <strong>{t("PublicTerms.Meta.AppDomain")}：</strong>{appDomain}
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicTerms.Section1.Title")}</Text>
              <Text as="p">
                <Trans i18nKey="PublicTerms.Section1.Content" values={{ appName }} />
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicTerms.Section2.Title")}</Text>
              <Text as="p">
                <Trans i18nKey="PublicTerms.Section2.Content" values={{ appName }} />
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicTerms.Section3.Title")}</Text>
              <Text as="p">
                {t("PublicTerms.Section3.Content")}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicTerms.Section4.Title")}</Text>
              <Text as="p">
                {t("PublicTerms.Section4.Content")}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicTerms.Section5.Title")}</Text>
              <Text as="p">
                {t("PublicTerms.Section5.Content")}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicTerms.Section6.Title")}</Text>
              <Text as="p">
                <Trans i18nKey="PublicTerms.Section6.Content" values={{ email: contactEmail }} />
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </PublicLayout>
  );
}

export default function TermsPage() {
  return <TermsContent />;
}
