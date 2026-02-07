import { json, type LoaderFunctionArgs } from "@remix-run/node";
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
} from "@shopify/polaris";
import { getDynamicCorsHeaders } from "../utils/cors";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { getSupportConfig } from "../utils/config.server";
import { useTranslation } from "react-i18next";
import { PublicLayout } from "~/components/layout/PublicLayout";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = getDynamicCorsHeaders(request);
  const config = getSupportConfig();
  const response = json({
    supportEmail: config.contactEmail,
    statusPage: config.statusPageUrl,
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

function SupportContent() {
  const { t } = useTranslation();
  const { supportEmail, statusPage } = useLoaderData<typeof loader>();

  return (
    <PublicLayout>
      <Page
        title={t("PublicSupport.Title")}
        subtitle={t("PublicSupport.Subtitle")}
        fullWidth
      >
        <Layout>
          <Layout.Section>
            <Banner tone="info">
              <p>
                {t("PublicSupport.Contact.Content")}
              </p>
            </Banner>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  {t("PublicSupport.Contact.Title")}
                </Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    {t("PublicSupport.Contact.Email")} <Link url={`mailto:${supportEmail}`}>{supportEmail}</Link>
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("PublicSupport.Contact.DataRights")}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    {t("PublicSupport.Contact.StatusPage")} <Link url={statusPage} external>{statusPage}</Link>
                  </Text>
                </BlockStack>
                <InlineStack gap="200">
                  <Badge tone="success">{t("PublicSupport.Badges.Public")}</Badge>
                  <Badge tone="info">{t("PublicSupport.Badges.NoLogin")}</Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("PublicSupport.FAQ.Title")}
                  </Text>
                  
                  <BlockStack gap="300">
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{t("PublicSupport.FAQ.PII.Q")}</Text>
                        <Text as="p" variant="bodyMd">{t("PublicSupport.FAQ.PII.A")}</Text>
                      </BlockStack>
                    </Box>

                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{t("PublicSupport.FAQ.Events.Q")}</Text>
                        <Text as="p" variant="bodyMd">{t("PublicSupport.FAQ.Events.A")}</Text>
                      </BlockStack>
                    </Box>

                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{t("PublicSupport.FAQ.Consent.Q")}</Text>
                        <Text as="p" variant="bodyMd">{t("PublicSupport.FAQ.Consent.A")}</Text>
                      </BlockStack>
                    </Box>

                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{t("PublicSupport.FAQ.Retention.Q")}</Text>
                        <Text as="p" variant="bodyMd">{t("PublicSupport.FAQ.Retention.A")}</Text>
                      </BlockStack>
                    </Box>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("PublicSupport.Migration.Title")}
                  </Text>
                  <List type="number">
                    <List.Item>{t("PublicSupport.Migration.Tip1")}</List.Item>
                    <List.Item>{t("PublicSupport.Migration.Tip2")}</List.Item>
                    <List.Item>{t("PublicSupport.Migration.Tip3")}</List.Item>
                  </List>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>
    </PublicLayout>
  );
}

export default function PublicSupportPage() {
  return <SupportContent />;
}
