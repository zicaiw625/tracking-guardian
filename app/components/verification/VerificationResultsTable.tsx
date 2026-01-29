import React from "react";
import { Box, Banner, BlockStack, Button, Card, DataTable, InlineStack, List, Text } from "@shopify/polaris";
import { ExportIcon } from "~/components/icons";
import { StatusBadge } from "./VerificationBadges";

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

function buildLimitations(r: VerificationEventResult): string[] {
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
        limitations.push(`Strict sandbox 已知限制：${r.eventType} 事件在 Web Worker 环境中无法获取以下字段：${matchedFields.join(", ")}。这是平台限制，不是故障。`);
      } else {
        const unknownFields = fieldNames.filter((f) => !matchedFields.includes(f));
        if (unknownFields.length > 0) {
          limitations.push(`Strict sandbox 限制：以下字段在 Web Worker 环境中不可用：${unknownFields.join(", ")}`);
        }
      }
    }
  }
  if (UNAVAILABLE_EVENTS.includes(r.eventType)) {
    limitations.push(`Strict sandbox 限制：${r.eventType} 事件在 Web Pixel strict sandbox 环境中不可用，需要通过订单 webhooks 获取`);
  }
  return limitations;
}

export function VerificationResultsTable({
  latestRun,
  pixelStrictOrigin,
}: VerificationResultsTableProps) {
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
              事件详细结果
            </Text>
            {latestRun && latestRun.results.length > 0 && (
              <Button icon={ExportIcon} onClick={handleExportJson} size="slim">
                导出 JSON
              </Button>
            )}
          </InlineStack>
          {latestRun && latestRun.results.length > 0 ? (
            <>
              {!pixelStrictOrigin && (
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      事件接收校验：当前为宽松的 Origin 校验
                    </Text>
                    <Text as="p" variant="bodySm">
                      来自非白名单来源或 HMAC 验证失败但未被拒绝的请求仍可能被接收并标为低信任，验收报告中的事件可能包含此类数据。若需更高准确性，建议在部署环境设置 PIXEL_STRICT_ORIGIN=true 并配置好 Origin 白名单。
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ⚠️ Strict Sandbox 限制说明（已自动标注）
                  </Text>
                  <Text as="p" variant="bodySm">
                    Web Pixel 运行在 strict sandbox (Web Worker) 环境中，无法访问 DOM、localStorage、第三方 cookie 等，部分字段可能不可用。如果某些字段为 null 或缺失，可能是由于 strict sandbox 限制，这是平台限制，不是故障。报告中已自动标注所有因 strict sandbox 限制而无法获取的字段和事件。
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    已知限制字段（可能为 null，已自动标注）：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>checkout_completed / checkout_started：</strong>buyer.email, buyer.phone, deliveryAddress, shippingAddress, billingAddress（这些字段在 Web Worker 环境中不可用，这是平台限制）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>checkout_contact_info_submitted：</strong>buyer.email, buyer.phone（这些字段在 Web Worker 环境中不可用，这是平台限制）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>checkout_shipping_info_submitted：</strong>deliveryAddress, shippingAddress（这些字段在 Web Worker 环境中不可用，这是平台限制）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>payment_info_submitted：</strong>billingAddress（这些字段在 Web Worker 环境中不可用，这是平台限制）
                      </Text>
                    </List.Item>
                  </List>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    不可用的事件类型（已自动标注，需要通过订单 webhooks 获取）：
                  </Text>
                  <Text as="p" variant="bodySm">
                    refund, order_cancelled, order_edited, subscription_created, subscription_updated, subscription_cancelled（这些事件在 strict sandbox 中不可用，需要通过订单 webhooks 获取）
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    💡 <strong>自动标注说明：</strong>报告中已自动标注所有因 strict sandbox 限制而无法获取的字段和事件。这些限制是 Shopify 平台的设计限制，不是故障。如需获取这些字段或事件，请使用订单 webhooks 或其他 Shopify API。
                  </Text>
                </BlockStack>
              </Banner>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "numeric", "text", "text", "text"]}
                headings={["事件类型", "平台", "订单ID", "状态", "金额", "币种", "问题", "Sandbox限制（已自动标注）"]}
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
              <Text as="p">暂无验收结果数据。请先运行验收测试。</Text>
            </Banner>
          )}
        </BlockStack>
      </Card>
    </Box>
  );
}
