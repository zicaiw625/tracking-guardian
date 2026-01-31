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
import { useLocale } from "~/context/LocaleContext";

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
  itemsLabel,
  tone = "info",
}: {
  title: string;
  description: string;
  items: string[];
  itemsLabel: string;
  tone?: "info" | "success" | "warning";
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {title}
          </Text>
          <Badge tone={tone}>{`${items.length} ${itemsLabel}`}</Badge>
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
  const { locale, t, tArray } = useLocale();
  const { shop, appDomain, tab, gdprJobs } = useLoaderData<typeof loader>();
  const isGdprTab = tab === "gdpr";
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const itemsLabel = t("common.items");
  return (
    <Page
      title={t("privacy.title")}
      subtitle={t("privacy.subtitle")}
    >
      <BlockStack gap="500">
        {isGdprTab ? (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {t("privacy.gdprHistory")}
                </Text>
                <Button url="/app/privacy" variant="secondary">
                  {t("privacy.back")}
                </Button>
              </InlineStack>
              {gdprJobs.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("privacy.noRecords")}
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
                    const createdAt = new Date(job.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
                    const completedAt = job.completedAt ? new Date(job.completedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") : null;
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
                            {t("privacy.createdAt")}: {createdAt}
                          </Text>
                          {completedAt ? (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("privacy.completedAt")}: {completedAt}
                            </Text>
                          ) : null}
                          {job.errorMessage ? (
                            <Text as="p" variant="bodySm" tone="critical">
                              {job.errorMessage}
                            </Text>
                          ) : null}
                          <InlineStack gap="200">
                            <Button url={`/app/gdpr/export/${job.id}`} variant="primary">
                              {t("privacy.downloadJson")}
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
        <Banner title={t("privacy.dataOverview")} tone="info">
          <BlockStack gap="200">
            <p>{t("privacy.dataOverviewP1")}</p>
            <p>{t("privacy.dataOverviewP2")}</p>
          </BlockStack>
        </Banner>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              📋 {t("privacy.yourConfig")}
            </Text>
            <InlineStack gap="400" wrap>
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("privacy.consentStrategy")}
                  </Text>
                  <Badge tone={shop.consentStrategy === "strict" ? "success" : "info"}>
                    {shop.consentStrategy === "strict" ? t("common.strictMode") : t("common.balancedMode")}
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
                  {t("privacy.dataTypesCollected")}
                </InlineStack>
              </Text>
              <DataTypeCard
                title={t("privacy.pixelEventData")}
                description={t("privacy.pixelEventDataDesc")}
                items={tArray("privacy.pixelEventDataItems")}
                itemsLabel={itemsLabel}
                tone="info"
              />
              <DataTypeCard
                title={t("privacy.customerConsent")}
                description={t("privacy.customerConsentDesc")}
                items={tArray("privacy.customerConsentItems")}
                itemsLabel={itemsLabel}
                tone="success"
              />
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    {t("privacy.requestTechData")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("privacy.requestTechDataDesc")}
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
                  {t("privacy.dataUsage")}
                </InlineStack>
              </Text>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("privacy.conversionTracking")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("privacy.conversionTrackingDesc")}
                  </Text>
                  <Banner tone="warning">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("privacy.importantNoServerDelivery")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {t("privacy.noServerDeliveryDesc")}
                      </Text>
                    </BlockStack>
                  </Banner>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("privacy.reconciliationDiagnostics")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("privacy.reconciliationDesc")}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("privacy.complianceExecution")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("privacy.complianceDesc")}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("privacy.webPixelSendTitle")}
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("privacy.whenSent")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("privacy.whenSentDesc")}
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("privacy.fieldsSent")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("privacy.fieldsSentDesc")}
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("privacy.consentChanges")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("privacy.consentChangesDesc")}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("privacy.notificationsThirdParty")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("privacy.notificationsDesc")}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        {t("privacy.slackDesc")}
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        {t("privacy.telegramDesc")}
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
        <CollapsibleSection title={t("privacy.dataRetention")} defaultOpen>
          <BlockStack gap="300">
            <Banner tone="info">
              <p>{t("privacy.dataRetentionIntro")}</p>
            </Banner>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    {t("privacy.pixelReceipt")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("privacy.pixelReceiptRetention")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    {t("privacy.verificationRun")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("privacy.verificationRunRetention")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    {t("privacy.scanReport")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("privacy.scanReportRetention")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="span" fontWeight="semibold">
                    {t("privacy.eventAuditLog")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("privacy.eventAuditLogRetention")}
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title={t("privacy.dataDeletion")}>
          <BlockStack gap="300">
            <Text as="p">
              {t("privacy.dataDeletionIntro")}
            </Text>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={DeleteIcon} tone="critical" />
                  <Text as="span" fontWeight="semibold">
                    {t("privacy.uninstallApp")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("privacy.uninstallDesc")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={DeleteIcon} tone="critical" />
                  <Text as="span" fontWeight="semibold">
                    {t("privacy.gdprCustomerDeletion")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("privacy.gdprCustomerDesc")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={DeleteIcon} tone="critical" />
                  <Text as="span" fontWeight="semibold">
                    {t("privacy.shopDeletion")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("privacy.shopDeletionDesc")}
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title={t("privacy.securityMeasures")}>
          <BlockStack gap="300">
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={LockFilledIcon} tone="success" />
                  <Text as="span" fontWeight="semibold">
                    {t("privacy.transportEncryption")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("privacy.transportEncryptionDesc")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={LockFilledIcon} tone="success" />
                  <Text as="span" fontWeight="semibold">
                    {t("privacy.credentialEncryption")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("privacy.credentialEncryptionDesc")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={LockFilledIcon} tone="success" />
                  <Text as="span" fontWeight="semibold">
                    {t("privacy.accessControl")}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {t("privacy.accessControlDesc")}
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title={t("privacy.gdprWebhooksGuide")}>
          <BlockStack gap="300">
            <Text as="p">
              {t("privacy.gdprWebhooksIntro")}
            </Text>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="span" fontWeight="semibold">
                  {t("privacy.gdprStep1")}
                </Text>
                <Text as="p" variant="bodySm">
                  {t("privacy.gdprStep1Desc")}
                </Text>
              </BlockStack>
            </Box>
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="span" fontWeight="semibold">
                  {t("privacy.gdprStep2")}
                </Text>
                <Text as="p" variant="bodySm">
                  {t("privacy.gdprStep2Desc")}
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
                  {t("privacy.gdprStep3")}
                </Text>
                <Text as="p" variant="bodySm">
                  {t("privacy.gdprStep3Desc")}
                </Text>
                <Box background="bg-surface" padding="200" borderRadius="100">
                  <code>shopify app trigger-webhook --topic customers/data_request</code>
                </Box>
              </BlockStack>
            </Box>
            <Banner tone="success">
              <p>{t("privacy.gdprImplemented")}</p>
            </Banner>
          </BlockStack>
        </CollapsibleSection>
        <CollapsibleSection title={t("privacy.exportAndDelete")}>
          <BlockStack gap="400">
            <Banner tone="info">
              <Text variant="bodySm" as="span">
                {t("privacy.exportDeleteIntro")}
              </Text>
            </Banner>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">
                  {t("privacy.dataExport")}
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  {t("privacy.dataExportDesc")}
                </Text>
                <InlineStack gap="200">
                  <Button
                    url="/api/exports?type=conversions&format=json"
                    external
                    variant="primary"
                  >
                    {t("privacy.exportConversionsJson")}
                  </Button>
                  <Button
                    url="/api/exports?type=conversions&format=csv"
                    external
                  >
                    {t("privacy.exportConversionsCsv")}
                  </Button>
                  <Button
                    url="/api/exports?type=events&format=json"
                    external
                  >
                    {t("privacy.exportEventsJson")}
                  </Button>
                </InlineStack>
                <Text variant="bodySm" as="p" tone="subdued">
                  {t("privacy.exportNote")}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">
                  {t("privacy.dataDeletionTitle")}
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  {t("privacy.dataDeletionDesc")}
                </Text>
                <Banner tone="critical">
                  <Text variant="bodySm" as="span" fontWeight="semibold">
                    {t("privacy.deleteWarning")}
                  </Text>
                  <List type="bullet">
                    <List.Item>{t("privacy.allConversions")}</List.Item>
                    <List.Item>{t("privacy.allEventLogs")}</List.Item>
                    <List.Item>{t("privacy.allSurveyResponses")}</List.Item>
                    <List.Item>{t("privacy.allConfigAndSettings")}</List.Item>
                  </List>
                </Banner>
                <Button
                  tone="critical"
                  onClick={() => {
                    setShowDeleteModal(true);
                  }}
                >
                  {t("privacy.deleteAllData")}
                </Button>
                <Modal
                  open={showDeleteModal}
                  onClose={() => setShowDeleteModal(false)}
                  title={t("privacy.confirmDeleteAllTitle")}
                  primaryAction={{
                    content: t("common.confirmDelete"),
                    destructive: true,
                    onAction: () => {
                      setShowDeleteModal(false);
                      showError(t("privacy.deleteFeatureUnavailable"));
                    },
                  }}
                  secondaryActions={[
                    {
                      content: t("common.cancelLabel"),
                      onAction: () => setShowDeleteModal(false),
                    },
                  ]}
                >
                  <Modal.Section>
                    <Text variant="bodyMd" as="p">
                      {t("privacy.confirmDeleteQuestion")}
                    </Text>
                    <List type="bullet">
                      <List.Item>{t("privacy.allConversions")}</List.Item>
                      <List.Item>{t("privacy.allEventLogs")}</List.Item>
                      <List.Item>{t("privacy.allSurveyResponses")}</List.Item>
                      <List.Item>{t("privacy.allConfigAndSettings")}</List.Item>
                    </List>
                    <Text variant="bodyMd" as="p" tone="critical" fontWeight="semibold">
                      {t("privacy.cannotUndo")}
                    </Text>
                  </Modal.Section>
                </Modal>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">
                  {t("privacy.gdprRequestStatus")}
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  {t("privacy.gdprRequestStatusDesc")}
                </Text>
                <Button url="/app/privacy?tab=gdpr" variant="secondary">
                  {t("common.viewGdprHistory")}
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </CollapsibleSection>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              📚 {t("privacy.relatedDocs")}
            </Text>
            <List type="bullet">
              <List.Item>
                <Link url="/privacy" external>
                  {t("common.fullPrivacyPolicy")}
                </Link>
              </List.Item>
              <List.Item>
                <Link url="/terms" external>
                  {t("common.termsOfService")}
                </Link>
              </List.Item>
              <List.Item>
                <Link url="https://help.shopify.com/en/manual/your-account/privacy" external>
                  {t("privacy.shopifyDataProtection")}
                </Link>
              </List.Item>
              <List.Item>
                <Link url="https://help.shopify.com/en/manual/your-account/gdpr" external>
                  {t("privacy.shopifyGdpr")}
                </Link>
              </List.Item>
            </List>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
