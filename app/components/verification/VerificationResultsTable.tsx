import React, { useState } from "react";
import { Box, Banner, BlockStack, Button, Card, DataTable, InlineStack, List, Text, Collapsible } from "@shopify/polaris";
import { ExportIcon } from "~/components/icons";
import { StatusBadge } from "./VerificationBadges";
import { getEventSandboxLimitations } from "~/utils/verification-limits";
import { useTranslation, Trans } from "react-i18next";

export interface VerificationEventResult {
  eventType: string;
  platform: string;
  orderId?: string;
  status: string;
  params?: { value?: number; currency?: string };
  discrepancies?: string[];
  errors?: string[];
}

export interface VerificationResultsTableProps {
  latestRun: {
    results: VerificationEventResult[];
    status?: string;
    totalTests?: number;
    limitReached?: boolean;
  } | null;
  pixelStrictOrigin: boolean;
}

export function VerificationResultsTable({
  latestRun,
  pixelStrictOrigin,
}: VerificationResultsTableProps) {
  const { t } = useTranslation();
  const [showStrictLimits, setShowStrictLimits] = useState(false);

  const handleExportJson = () => {
    if (!latestRun?.results?.length) return;
    const data = JSON.stringify(latestRun.results, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `verification-results-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
  };

  return (
    <Box padding="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {t("verification.title")}
            </Text>
            {latestRun && latestRun.results.length > 0 && (
              <Button icon={ExportIcon} onClick={handleExportJson} size="slim">
                {t("verification.exportJson")}
              </Button>
            )}
          </InlineStack>
          {latestRun && latestRun.results.length > 0 ? (
            <>
              {latestRun.limitReached && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    {t("verification.limitWarning")}
                  </Text>
                </Banner>
              )}
              {!pixelStrictOrigin && (
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("verification.originWarningTitle")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("verification.originWarningBody")}
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              <Banner tone="warning">
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("verification.strictLimitTitle")}
                    </Text>
                    <Button variant="plain" onClick={() => setShowStrictLimits(!showStrictLimits)}>
                      {showStrictLimits ? t("verification.toggleDetailsHide") : t("verification.toggleDetailsShow")}
                    </Button>
                  </InlineStack>
                  
                  <Collapsible open={showStrictLimits} id="strict-limits-collapsible">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm">
                        {t("verification.sandboxDescription")}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("verification.limitFieldsTitle")}
                      </Text>
                      <List type="bullet">
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            <strong>checkout_completed / checkout_started: </strong>{t("verification.limitFields.checkout_completed")}
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            <strong>checkout_contact_info_submitted: </strong>{t("verification.limitFields.checkout_contact_info_submitted")}
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            <strong>checkout_shipping_info_submitted: </strong>{t("verification.limitFields.checkout_shipping_info_submitted")}
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            <strong>payment_info_submitted: </strong>{t("verification.limitFields.payment_info_submitted")}
                          </Text>
                        </List.Item>
                      </List>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("verification.unavailableEventsTitle")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {t("verification.unavailableEvents.description")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="verification.autoTagNote" components={{ strong: <strong /> }} />
                      </Text>
                    </BlockStack>
                  </Collapsible>
                </BlockStack>
              </Banner>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "numeric", "text", "text", "text"]}
                headings={[
                  t("verification.tableHeadings.eventType"),
                  t("verification.tableHeadings.platform"),
                  t("verification.tableHeadings.orderId"),
                  t("verification.tableHeadings.status"),
                  t("verification.tableHeadings.value"),
                  t("verification.tableHeadings.currency"),
                  t("verification.tableHeadings.issues"),
                  t("verification.tableHeadings.sandboxLimitations"),
                ]}
                rows={latestRun.results.map((r) => {
                  const limitations = getEventSandboxLimitations(r, t);
                  return [
                    r.eventType,
                    r.platform,
                    r.orderId || "-",
                    <StatusBadge key={r.orderId ?? r.eventType} status={r.status} />,
                    r.params?.value?.toFixed(2) ?? "-",
                    r.params?.currency ?? "-",
                    r.discrepancies?.join("; ") || r.errors?.join("; ") || "-",
                    limitations.join("; ") || "-",
                  ];
                })}
              />
            </>
          ) : (
            <Banner tone={latestRun?.status === 'completed' ? 'warning' : 'info'}>
              <Text as="p">
                {latestRun?.status === 'completed'
                  ? t("verification.emptyStateCompleted")
                  : t("verification.emptyStateInit")}
              </Text>
            </Banner>
          )}
        </BlockStack>
      </Card>
    </Box>
  );
}
