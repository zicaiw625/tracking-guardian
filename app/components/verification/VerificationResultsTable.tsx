import { Box, Banner, BlockStack, Button, Card, DataTable, InlineStack, List, Text } from "@shopify/polaris";
import { ExportIcon } from "~/components/icons";
import { StatusBadge } from "./VerificationBadges";
import { useTranslation } from "react-i18next";

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
  latestRun: { results: VerificationEventResult[] } | null;
  pixelStrictOrigin: boolean;
}

const KNOWN_LIMITATIONS: Record<string, string[]> = {
  checkout_completed: ["buyer.email", "buyer.phone", "deliveryAddress", "shippingAddress", "billingAddress"],
  checkout_started: ["buyer.email", "buyer.phone", "deliveryAddress", "shippingAddress", "billingAddress"],
  checkout_contact_info_submitted: ["buyer.email", "buyer.phone"],
  checkout_shipping_info_submitted: ["deliveryAddress", "shippingAddress"],
  payment_info_submitted: ["billingAddress"],
};

const UNAVAILABLE_EVENTS = ["refund", "order_cancelled", "order_edited", "subscription_created", "subscription_updated", "subscription_cancelled"];

export function VerificationResultsTable({
  latestRun,
  pixelStrictOrigin,
}: VerificationResultsTableProps) {
  const { t } = useTranslation();

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

  const buildLimitations = (r: VerificationEventResult): string[] => {
    const limitations: string[] = [];
    if (r.status === "missing_params" && r.discrepancies) {
      const missingFields = r.discrepancies.filter((d) =>
        d.includes("missing") || d.includes("null") || d.includes("undefined")
      );
      if (missingFields.length > 0) {
        const knownFields = KNOWN_LIMITATIONS[r.eventType] || [];
        const fieldNames = missingFields
          .map((d) => {
            const match = d.match(/(?:missing|null|undefined)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/i);
            return match ? match[1] : d;
          })
          .filter((f) => f.length > 0);
        const matchedFields = fieldNames.filter((f) =>
          knownFields.some((kl) => f.includes(kl) || kl.includes(f))
        );
        if (matchedFields.length > 0) {
          limitations.push(t("verification.table.limitations.strictSandbox", { eventType: r.eventType, fields: matchedFields.join(", ") }));
        } else {
          const unknownFields = fieldNames.filter((f) => !matchedFields.includes(f));
          if (unknownFields.length > 0) {
            limitations.push(t("verification.table.limitations.sandboxUnknown", { fields: unknownFields.join(", ") }));
          }
        }
      }
    }
    if (UNAVAILABLE_EVENTS.includes(r.eventType)) {
      limitations.push(t("verification.table.limitations.unavailableEvent", { eventType: r.eventType }));
    }
    return limitations;
  };

  return (
    <Box padding="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {t("verification.table.title")}
            </Text>
            {latestRun && latestRun.results.length > 0 && (
              <Button icon={ExportIcon} onClick={handleExportJson} size="slim">
                {t("verification.actions.exportJson")}
              </Button>
            )}
          </InlineStack>
          {latestRun && latestRun.results.length > 0 ? (
            <>
              {!pixelStrictOrigin && (
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("verification.table.banners.origin.title")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("verification.table.banners.origin.description")}
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("verification.table.banners.sandbox.title")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("verification.table.banners.sandbox.description")}
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("verification.table.banners.sandbox.knownLimitations")}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>checkout_completed / checkout_started：</strong>{t("verification.table.banners.sandbox.limit1")}
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>checkout_contact_info_submitted：</strong>{t("verification.table.banners.sandbox.limit2")}
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>checkout_shipping_info_submitted：</strong>{t("verification.table.banners.sandbox.limit3")}
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>payment_info_submitted：</strong>{t("verification.table.banners.sandbox.limit4")}
                      </Text>
                    </List.Item>
                  </List>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("verification.table.banners.sandbox.unavailableEvents")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("verification.table.banners.sandbox.unavailableEventsList")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("verification.table.banners.sandbox.autoLabelNote")}
                  </Text>
                </BlockStack>
              </Banner>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "numeric", "text", "text", "text"]}
                headings={[
                    t("verification.table.headings.eventType"),
                    t("verification.table.headings.platform"),
                    t("verification.table.headings.orderId"),
                    t("verification.table.headings.status"),
                    t("verification.table.headings.amount"),
                    t("verification.table.headings.currency"),
                    t("verification.table.headings.issue"),
                    t("verification.table.headings.limit")
                ]}
                rows={latestRun.results.map((r) => {
                  const limitations = buildLimitations(r);
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
            <Banner tone="info">
              <Text as="p">{t("verification.table.noData")}</Text>
            </Banner>
          )}
        </BlockStack>
      </Card>
    </Box>
  );
}
