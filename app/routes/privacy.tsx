import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDynamicCorsHeaders } from "../utils/cors";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { getPublicAppDomain } from "../utils/config.server";
import { useTranslation, Trans } from "react-i18next";
import { PublicLayout } from "~/components/layout/PublicLayout";
import { Card, Text, BlockStack, List, Banner, Layout } from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = getDynamicCorsHeaders(request);
  const response = json({
    appName: "Tracking Guardian",
    appDomain: getPublicAppDomain(),
    lastUpdated: "2026-02-02",
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

function PrivacyContent() {
  const { t } = useTranslation();
  const { appName, appDomain, lastUpdated } = useLoaderData<typeof loader>();

  return (
    <PublicLayout>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h1" variant="headingLg">
                {t("PublicPrivacy.Title")}
              </Text>
              <BlockStack gap="200">
                <Text as="p" tone="subdued">
                  <strong>{t("PublicPrivacy.Meta.AppName")}：</strong>{appName}
                </Text>
                <Text as="p" tone="subdued">
                  <strong>{t("PublicPrivacy.Meta.LastUpdated")}：</strong>{lastUpdated}
                </Text>
                <Text as="p" tone="subdued">
                  <strong>{t("PublicPrivacy.Meta.AppDomain")}：</strong>{appDomain}
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicPrivacy.Overview.Title")}</Text>
              <Text as="p">
                <Trans i18nKey="PublicPrivacy.Overview.Content" values={{ appName }} />
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicPrivacy.CollectedData.Title")}</Text>
              
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacy.CollectedData.Orders")}</Text>
                <List>
                  <List.Item>{t("PublicPrivacyDetail.CollectedData.Orders.Id")}</List.Item>
                  <List.Item>{t("PublicPrivacyDetail.CollectedData.Orders.Amount")}</List.Item>
                  <List.Item>{t("PublicPrivacyDetail.CollectedData.Orders.Items")}</List.Item>
                  <List.Item>{t("PublicPrivacyDetail.CollectedData.Orders.Token")}</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacy.CollectedData.Consent")}</Text>
                <List>
                  <List.Item>{t("PublicPrivacyDetail.CollectedData.Consent.Marketing")}</List.Item>
                  <List.Item>{t("PublicPrivacyDetail.CollectedData.Consent.Analytics")}</List.Item>
                  <List.Item>{t("PublicPrivacyDetail.CollectedData.Consent.SaleOfData")}</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacy.CollectedData.NoPII")}</Text>
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="bold">{t("PublicPrivacyDetail.CollectedData.NoPII.Title")}</Text>
                    <List>
                      <List.Item>{t("PublicPrivacyDetail.CollectedData.NoPII.Name")}</List.Item>
                      <List.Item>{t("PublicPrivacyDetail.CollectedData.NoPII.Email")}</List.Item>
                      <List.Item>{t("PublicPrivacyDetail.CollectedData.NoPII.Phone")}</List.Item>
                      <List.Item>{t("PublicPrivacyDetail.CollectedData.NoPII.Address")}</List.Item>
                      <List.Item>{t("PublicPrivacyDetail.CollectedData.NoPII.Payment")}</List.Item>
                    </List>
                  </BlockStack>
                </Banner>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacy.CollectedData.TechData")}</Text>
                <Text as="p">{t("PublicPrivacyDetail.CollectedData.TechData")}</Text>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacy.CollectedData.Session")}</Text>
                <Text as="p">
                  <Trans i18nKey="PublicPrivacyDetail.CollectedData.Session" />
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicPrivacy.Usage.Title")}</Text>
              
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacy.Usage.Tracking")}</Text>
                <Text as="p">
                  <Trans i18nKey="PublicPrivacyDetail.Usage.Tracking.P1" values={{ appName }} />
                </Text>
                <Text as="p">
                  <Trans i18nKey="PublicPrivacyDetail.Usage.Tracking.P2" />
                </Text>
                <Text as="p">
                  <Trans i18nKey="PublicPrivacyDetail.Usage.Tracking.P3" />
                </Text>
                
                <Banner tone="critical">
                   <Text as="p" fontWeight="bold">{t("PublicPrivacyDetail.Usage.ServerSideWarning.Title")}</Text>
                   <Text as="p">{t("PublicPrivacyDetail.Usage.ServerSideWarning.Content")}</Text>
                </Banner>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacy.Usage.Reconciliation")}</Text>
                <Text as="p">
                  <Trans i18nKey="PublicPrivacyDetail.Usage.Reconciliation" />
                </Text>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacy.Usage.Compliance")}</Text>
                <Text as="p">
                  <Trans i18nKey="PublicPrivacyDetail.Usage.Compliance" />
                </Text>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacy.Usage.PCD")}</Text>
                <Text as="p">
                  <Trans i18nKey="PublicPrivacyDetail.Usage.PCD" />
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicPrivacy.Retention.Title")}</Text>
              <Text as="p">{t("PublicPrivacy.Retention.Content")}</Text>
              <List>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Retention.Receipt" /></List.Item>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Retention.Run" /></List.Item>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Retention.Report" /></List.Item>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Retention.Log" /></List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicPrivacy.Deletion.Title")}</Text>
              <Text as="p">{t("PublicPrivacy.Deletion.Content")}</Text>
              <List>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Deletion.Uninstall" /></List.Item>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Deletion.GDPR" /></List.Item>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Deletion.Shop" /></List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicPrivacy.Sharing.Title")}</Text>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacy.Sharing.Title")}</Text>
                <Text as="p">{t("PublicPrivacy.Sharing.Content")}</Text>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("PublicPrivacyDetail.Sharing.Alerts.Title")}</Text>
                <Text as="p">{t("PublicPrivacyDetail.Sharing.Alerts.Content")}</Text>
                <List>
                  <List.Item><Trans i18nKey="PublicPrivacyDetail.Sharing.Alerts.Slack" /></List.Item>
                  <List.Item><Trans i18nKey="PublicPrivacyDetail.Sharing.Alerts.Telegram" /></List.Item>
                </List>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicPrivacy.Security.Title")}</Text>
              <List>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Security.Transport" /></List.Item>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Security.Storage" /></List.Item>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Security.Access" /></List.Item>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Security.Masking" /></List.Item>
                <List.Item><Trans i18nKey="PublicPrivacyDetail.Security.Replay" /></List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicPrivacy.Rights.Title")}</Text>
              <BlockStack gap="200">
                <List>
                  <List.Item><Trans i18nKey="PublicPrivacyDetail.Rights.Access" /></List.Item>
                  <List.Item><Trans i18nKey="PublicPrivacyDetail.Rights.Deletion" /></List.Item>
                  <List.Item><Trans i18nKey="PublicPrivacyDetail.Rights.Correction" /></List.Item>
                  <List.Item><Trans i18nKey="PublicPrivacyDetail.Rights.Portability" /></List.Item>
                  <List.Item><Trans i18nKey="PublicPrivacyDetail.Rights.Objection" /></List.Item>
                </List>
                <Text as="p">{t("PublicPrivacyDetail.Rights.Webhook")}</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicPrivacy.Docs.Title")}</Text>
              <Text as="p">
                {t("PublicPrivacy.Docs.Content")} <a href="/terms" style={{ color: '#008060', textDecoration: 'none' }}>{t("PublicTerms.Title")}</a>.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("PublicPrivacy.Contact.Title")}</Text>
              <Text as="p">{t("PublicPrivacy.Contact.Content")}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </PublicLayout>
  );
}

export default function PrivacyPage() {
  return <PrivacyContent />;
}
