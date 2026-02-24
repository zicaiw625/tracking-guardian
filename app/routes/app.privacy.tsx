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
import { useTranslation, Trans } from "react-i18next";

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
  const { t } = useTranslation();
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {title}
          </Text>
          <Badge tone={tone}>{t("common.countItems", { count: items.length })}</Badge>
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
  const { t } = useTranslation();
  const { showError } = useToastContext();
  const { shop, appDomain, tab, gdprJobs } = useLoaderData<typeof loader>();
  const isGdprTab = tab === "gdpr";
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  return (
    <Page
      title={t("PrivacyPage.Title")}
      subtitle={t("PrivacyPage.Subtitle")}
    >
      <BlockStack gap="500">
        {isGdprTab ? (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {t("PrivacyPage.GDPRHistory")}
                </Text>
                <Button url="/app/privacy" variant="secondary">
                  {t("PrivacyPage.Back")}
                </Button>
              </InlineStack>
              {gdprJobs.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("PrivacyPage.NoRecords")}
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
                            {t("PrivacyPage.Created", { date: createdAt })}
                          </Text>
                          {completedAt ? (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("PrivacyPage.Completed", { date: completedAt })}
                            </Text>
                          ) : null}
                          {job.errorMessage ? (
                            <Text as="p" variant="bodySm" tone="critical">
                              {job.errorMessage}
                            </Text>
                          ) : null}
                          <InlineStack gap="200">
                            <Button url={`/app/gdpr/export/${job.id}`} variant="primary">
                              {t("PrivacyPage.DownloadJSON")}
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
        <Banner title={t("PrivacyPage.Overview.Title")} tone="info">
          <BlockStack gap="200">
            <p>
              <Trans i18nKey="PrivacyPage.Overview.Content" />
            </p>
            <p>
              {t("PrivacyPage.Overview.Note")}
            </p>
          </BlockStack>
        </Banner>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {t("PrivacyPage.Config.Title")}
            </Text>
            <InlineStack gap="400" wrap>
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("PrivacyPage.Config.Strategy")}
                  </Text>
                  <Badge tone={shop.consentStrategy === "strict" ? "success" : "info"}>
                    {shop.consentStrategy === "strict" 
                      ? t("PrivacyPage.Config.Strict") 
                      : t("PrivacyPage.Config.Balanced")}
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
                  {t("PrivacyPage.DataTypes.Title")}
                </InlineStack>
              </Text>
              <DataTypeCard
                title={t("PrivacyPage.DataTypes.PixelEvents.Title")}
                description={t("PrivacyPage.DataTypes.PixelEvents.Description")}
                items={t("PrivacyPage.DataTypes.PixelEvents.Items", { returnObjects: true }) as string[]}
                tone="info"
              />
              <DataTypeCard
                title={t("PrivacyPage.DataTypes.Consent.Title")}
                description={t("PrivacyPage.DataTypes.Consent.Description")}
                items={t("PrivacyPage.DataTypes.Consent.Items", { returnObjects: true }) as string[]}
                tone="success"
              />
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    {t("PrivacyPage.DataTypes.TechData.Title")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("PrivacyPage.DataTypes.TechData.Content")}
                  </Text>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
          <Layout.Section variant="oneHalf">
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={CheckCircleIcon} tone="success" />
                  {t("PrivacyPage.Usage.Title")}
                </InlineStack>
              </Text>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("PrivacyPage.Usage.Tracking.Title")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("PrivacyPage.Usage.Tracking.Content")}
                  </Text>
                  <Banner tone="warning">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("PrivacyPage.Usage.Warning.Title")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {t("PrivacyPage.Usage.Warning.Content")}
                      </Text>
                    </BlockStack>
                  </Banner>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("PrivacyPage.Usage.Reconciliation.Title")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("PrivacyPage.Usage.Reconciliation.Content")}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("PrivacyPage.Usage.Compliance.Title")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("PrivacyPage.Usage.Compliance.Content")}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("PrivacyPage.Usage.PixelSending.Title")}
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("PrivacyPage.Usage.PixelSending.When")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("PrivacyPage.Usage.PixelSending.WhenContent")}
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("PrivacyPage.Usage.PixelSending.Fields")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("PrivacyPage.Usage.PixelSending.FieldsContent")}
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("PrivacyPage.Usage.PixelSending.Consent")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("PrivacyPage.Usage.PixelSending.ConsentContent")}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("PrivacyPage.Usage.Notifications.Title")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("PrivacyPage.Usage.Notifications.Content")}
                  </Text>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
        <CollapsibleSection title={t("PrivacyPage.Retention.Title")} defaultOpen>
          <BlockStack gap="300">
            <Banner tone="info">
              <p>{t("PrivacyPage.Retention.Note")}</p>
            </Banner>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    {t("PrivacyPage.Retention.Receipts")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("PrivacyPage.Retention.ReceiptsDesc")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    {t("PrivacyPage.Retention.Runs")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("PrivacyPage.Retention.RunsDesc")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    {t("PrivacyPage.Retention.Reports")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("PrivacyPage.Retention.ReportsDesc")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    {t("PrivacyPage.Retention.Logs")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("PrivacyPage.Retention.LogsDesc")}
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title={t("PrivacyPage.Deletion.Title")}>
          <BlockStack gap="300">
            <Text as="p">
              {t("PrivacyPage.Deletion.Desc")}
            </Text>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={DeleteIcon} tone="critical" />
                  <Text as="span" fontWeight="semibold">
                    {t("PrivacyPage.Deletion.Uninstall.Title")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="PrivacyPage.Deletion.Uninstall.Desc" />
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={DeleteIcon} tone="critical" />
                  <Text as="span" fontWeight="semibold">
                    {t("PrivacyPage.Deletion.GDPR.Title")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="PrivacyPage.Deletion.GDPR.Desc" />
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={DeleteIcon} tone="critical" />
                  <Text as="span" fontWeight="semibold">
                    {t("PrivacyPage.Deletion.Shop.Title")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="PrivacyPage.Deletion.Shop.Desc" />
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title={t("PrivacyPage.Security.Title")}>
          <BlockStack gap="300">
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={LockFilledIcon} tone="success" />
                  <Text as="span" fontWeight="semibold">
                    {t("PrivacyPage.Security.Transport.Title")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("PrivacyPage.Security.Transport.Desc")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={LockFilledIcon} tone="success" />
                  <Text as="span" fontWeight="semibold">
                    {t("PrivacyPage.Security.Storage.Title")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("PrivacyPage.Security.Storage.Desc")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={LockFilledIcon} tone="success" />
                  <Text as="span" fontWeight="semibold">
                    {t("PrivacyPage.Security.Access.Title")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("PrivacyPage.Security.Access.Desc")}
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title={t("PrivacyPage.GDPRTest.Title")}>
          <BlockStack gap="300">
            <Text as="p">
              {t("PrivacyPage.GDPRTest.Desc")}
            </Text>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="span" fontWeight="semibold">
                  {t("PrivacyPage.GDPRTest.Step1")}
                </Text>
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="PrivacyPage.GDPRTest.Step1" />
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="span" fontWeight="semibold">
                  {t("PrivacyPage.GDPRTest.Step2")}
                </Text>
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="PrivacyPage.GDPRTest.Step2" />
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
                  {t("PrivacyPage.GDPRTest.Step3")}
                </Text>
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="PrivacyPage.GDPRTest.Step3" />
                </Text>
                <Box background="bg-surface" padding="200" borderRadius="100">
                  <code>shopify app trigger-webhook --topic customers/data_request</code>
                </Box>
              </BlockStack>
            </Box>
            <Banner tone="success">
              <p>
                <Trans i18nKey="PrivacyPage.GDPRTest.Success" />
              </p>
            </Banner>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title={t("PrivacyPage.ExportDelete.Title")}>
          <BlockStack gap="400">
            <Banner tone="info">
              <Text variant="bodySm" as="span">
                {t("PrivacyPage.ExportDelete.Note")}
              </Text>
            </Banner>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">
                  {t("PrivacyPage.ExportDelete.Export.Title")}
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  {t("PrivacyPage.ExportDelete.Export.Desc")}
                </Text>
                <InlineStack gap="200">
                  <Button
                    url="/api/exports?type=conversions&format=json"
                    external
                    variant="primary"
                  >
                    {t("PrivacyPage.ExportDelete.Export.JSON")}
                  </Button>
                  <Button
                    url="/api/exports?type=conversions&format=csv"
                    external
                  >
                    {t("PrivacyPage.ExportDelete.Export.CSV")}
                  </Button>
                  <Button
                    url="/api/exports?type=events&format=json"
                    external
                  >
                    {t("PrivacyPage.ExportDelete.Export.Events")}
                  </Button>
                </InlineStack>
                <Text variant="bodySm" as="p" tone="subdued">
                  {t("PrivacyPage.ExportDelete.Export.Note")}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">
                  {t("PrivacyPage.ExportDelete.Delete.Title")}
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  {t("PrivacyPage.ExportDelete.Delete.Desc")}
                </Text>
                <Banner tone="critical">
                  <Text variant="bodySm" as="span" fontWeight="semibold">
                    {t("PrivacyPage.ExportDelete.Delete.Warning")}
                  </Text>
                  <List type="bullet">
                    <List.Item>{t("privacy.deleteItems.conversions")}</List.Item>
                    <List.Item>{t("privacy.deleteItems.eventLogs")}</List.Item>
                    <List.Item>{t("privacy.deleteItems.surveyResponses")}</List.Item>
                    <List.Item>{t("privacy.deleteItems.configSettings")}</List.Item>
                  </List>
                </Banner>
                <Button
                  tone="critical"
                  onClick={() => {
                    setShowDeleteModal(true);
                  }}
                >
                  {t("PrivacyPage.ExportDelete.Delete.Button")}
                </Button>
                <Modal
                  open={showDeleteModal}
                  onClose={() => setShowDeleteModal(false)}
                  title={t("PrivacyPage.ExportDelete.Delete.ModalTitle")}
                  primaryAction={{
                    content: t("PrivacyPage.ExportDelete.Delete.Confirm"),
                    destructive: true,
                    onAction: () => {
                      setShowDeleteModal(false);
                      showError(t("PrivacyPage.ExportDelete.Delete.Error"));
                    },
                  }}
                  secondaryActions={[
                    {
                      content: t("privacy.cancel"),
                      onAction: () => setShowDeleteModal(false),
                    },
                  ]}
                >
                  <Modal.Section>
                    <Text variant="bodyMd" as="p">
                      {t("PrivacyPage.ExportDelete.Delete.ModalContent")}
                    </Text>
                    <List type="bullet">
                      <List.Item>{t("privacy.deleteItems.conversions")}</List.Item>
                      <List.Item>{t("privacy.deleteItems.eventLogs")}</List.Item>
                      <List.Item>{t("privacy.deleteItems.surveyResponses")}</List.Item>
                      <List.Item>{t("privacy.deleteItems.configSettings")}</List.Item>
                    </List>
                    <Text variant="bodyMd" as="p" tone="critical" fontWeight="semibold">
                      {t("PrivacyPage.ExportDelete.Delete.Irreversible")}
                    </Text>
                  </Modal.Section>
                </Modal>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">
                  {t("PrivacyPage.ExportDelete.Status.Title")}
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  {t("PrivacyPage.ExportDelete.Status.Desc")}
                </Text>
                <Button url="/app/privacy?tab=gdpr" variant="secondary">
                  {t("PrivacyPage.ExportDelete.Status.Button")}
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </CollapsibleSection>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {t("PrivacyPage.Docs.Title")}
            </Text>
            <List type="bullet">
              <List.Item>
                <Link url="/privacy" external>
                  {t("PrivacyPage.Docs.Privacy")}
                </Link>
              </List.Item>
              <List.Item>
                <Link url="/terms" external>
                  {t("PrivacyPage.Docs.Terms")}
                </Link>
              </List.Item>
              <List.Item>
                <Link url="https://help.shopify.com/en/manual/your-account/privacy" external>
                  {t("PrivacyPage.Docs.ShopifyPrivacy")}
                </Link>
              </List.Item>
              <List.Item>
                <Link url="https://help.shopify.com/en/manual/your-account/gdpr" external>
                  {t("PrivacyPage.Docs.ShopifyGDPR")}
                </Link>
              </List.Item>
            </List>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
