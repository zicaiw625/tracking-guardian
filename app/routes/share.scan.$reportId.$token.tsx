import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { createHash } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Divider,
  Banner,
  Layout,
} from "@shopify/polaris";
import type { RiskItem } from "../types";
import { validateRiskItemsArray, validateStringArray } from "../utils/scan-data-validation";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { checkRateLimitAsync, ipKeyExtractor } from "../middleware/rate-limit.server";
import { timingSafeEqualHex } from "../utils/timing-safe.server";
import { isMissingColumnError } from "../utils/prisma-errors.server";

const publicJson = (data: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  addSecurityHeadersToHeaders(headers, PUBLIC_PAGE_HEADERS);
  return json(data, { ...init, headers });
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const ipKey = ipKeyExtractor(request);
    const rateLimitResult = await checkRateLimitAsync(ipKey, 60, 60 * 1000);
    if (!rateLimitResult.allowed) {
      return publicJson(
        {
          error: "Too many requests",
          report: null,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfter || 60),
            "X-RateLimit-Limit": "60",
            "X-RateLimit-Remaining": String(rateLimitResult.remaining || 0),
            "X-RateLimit-Reset": String(Math.ceil((rateLimitResult.resetAt || Date.now()) / 1000)),
          },
        }
      );
    }
    const reportId = params.reportId;
    if (!reportId) {
      return publicJson({ error: "Missing reportId", report: null }, { status: 400 });
    }

    const token = params.token;
    if (!token) {
      return publicJson({ error: "Missing share token", report: null }, { status: 403 });
    }

    const scanReport = await prisma.scanReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        shopId: true,
        shareTokenHash: true,
        shareTokenExpiresAt: true,
        riskScore: true,
        riskItems: true,
        identifiedPlatforms: true,
        scriptTags: true,
        checkoutConfig: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
    });

    if (!scanReport) {
      return publicJson({ error: "Report not found", report: null }, { status: 404 });
    }

    if (!scanReport.shareTokenHash) {
      return publicJson({ error: "Share link not available", report: null }, { status: 403 });
    }

    const shop = await prisma.shop.findUnique({
      where: { id: scanReport.shopId },
      select: { shopDomain: true },
    });

    if (!shop) {
      return publicJson({ error: "Shop not found", report: null }, { status: 404 });
    }

    const expectedTokenHash = createHash("sha256")
      .update(`${scanReport.id}-${scanReport.shopId}-${token}`)
      .digest("hex");

    if (!timingSafeEqualHex(expectedTokenHash, scanReport.shareTokenHash)) {
      return publicJson({ error: "Invalid share token", report: null }, { status: 403 });
    }

    if (scanReport.shareTokenExpiresAt && new Date() > scanReport.shareTokenExpiresAt) {
      return publicJson({ error: "Share link has expired", report: null }, { status: 403 });
    }

    const riskItems = validateRiskItemsArray(scanReport.riskItems);
    const identifiedPlatforms = validateStringArray(scanReport.identifiedPlatforms);

    return publicJson({
      report: {
        id: scanReport.id,
        shopDomain: shop.shopDomain,
        riskScore: scanReport.riskScore || 0,
        riskItems,
        identifiedPlatforms,
        status: scanReport.status,
        createdAt: scanReport.createdAt.toISOString(),
        completedAt: scanReport.completedAt?.toISOString() || null,
        expiresAt: scanReport.shareTokenExpiresAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (isMissingColumnError(error, "ScanReport", "shareTokenHash")) {
      return publicJson({ error: "Share link not available", report: null }, { status: 404 });
    }
    logger.error("Failed to load shared scan report", {
      error,
      reportId: params.reportId,
    });
    return publicJson(
      { error: error instanceof Error ? error.message : "Failed to load report", report: null },
      { status: 500 }
    );
  }
};

type ShareScanRiskItem = RiskItem & { platform?: string; recommendation?: string };

type ShareScanReport = {
  id: string;
  shopDomain: string;
  riskScore: number;
  riskItems: ShareScanRiskItem[];
  identifiedPlatforms: string[];
  status: string;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
};
type ShareScanLoaderData = { report: ShareScanReport } | { report: null; error: string };

export default function SharedScanReport() {
  const loaderData = useLoaderData<ShareScanLoaderData>();
  const report = loaderData.report ?? null;
  const error = "error" in loaderData ? loaderData.error : null;

  if (error || !report) {
    return (
      <Page title="报告不可用">
        <Card>
          <Banner tone="critical" title="无法访问报告">
            <Text as="p" variant="bodySm">
              {error || "报告不存在或链接已过期"}
            </Text>
          </Banner>
        </Card>
      </Page>
    );
  }

  const riskLevel = report.riskScore >= 70 ? "critical" : report.riskScore >= 40 ? "warning" : "info";
  const riskLabel = report.riskScore >= 70 ? "高风险" : report.riskScore >= 40 ? "中等风险" : "低风险";

  return (
    <Page title={`扫描报告 - ${report.shopDomain}`}>
      <BlockStack gap="500">
        <Banner tone="info" title="这是一个只读的分享报告">
          <Text as="p" variant="bodySm">
            此报告由 {report.shopDomain} 分享
            {report.expiresAt
              ? `，链接将于 ${new Date(report.expiresAt).toLocaleDateString("zh-CN")} 过期`
              : "，链接永不过期"}
          </Text>
        </Banner>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              报告信息
            </Text>
            <Divider />
            <Layout>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    店铺
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {report.shopDomain}
                  </Text>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    风险评分
                  </Text>
                  <Badge tone={riskLevel}>
                    {`${report.riskScore} / 100 (${riskLabel})`}
                  </Badge>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    状态
                  </Text>
                  <Badge
                    tone={
                      report.status === "completed"
                        ? "success"
                        : report.status === "running"
                          ? "info"
                          : report.status === "failed"
                            ? "critical"
                            : undefined
                    }
                  >
                    {report.status === "completed"
                      ? "已完成"
                      : report.status === "running"
                        ? "进行中"
                        : report.status === "failed"
                          ? "失败"
                          : "待处理"}
                  </Badge>
                </BlockStack>
              </Layout.Section>
            </Layout>
            {report.completedAt && (
              <BlockStack gap="200">
                <Text as="span" variant="bodySm" tone="subdued">
                  完成时间
                </Text>
                <Text as="span" variant="bodyMd">
                  {new Date(report.completedAt).toLocaleString("zh-CN")}
                </Text>
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {report.identifiedPlatforms.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                识别的平台
              </Text>
              <Divider />
              <InlineStack gap="200" wrap>
                {report.identifiedPlatforms.map((platform) => (
                  <Badge key={platform} tone="info">
                    {platform}
                  </Badge>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {report.riskItems.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                风险项目 ({report.riskItems.length})
              </Text>
              <Divider />
              <BlockStack gap="300">
                {report.riskItems.map((item) => {
                  const severityTone = item.severity === "high" ? "critical" : item.severity === "medium" ? "warning" : "info";
                  return (
                    <Box key={item.id} background="bg-surface-secondary" padding="400" borderRadius="200">
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="start">
                          <BlockStack gap="100">
                            <Text as="span" fontWeight="semibold">
                              {item.name}
                            </Text>
                            <Badge tone={severityTone}>
                              {item.severity === "high" ? "高风险" : item.severity === "medium" ? "中风险" : "低风险"}
                            </Badge>
                            {item.platform && (
                              <Badge>{item.platform}</Badge>
                            )}
                          </BlockStack>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {item.description}
                        </Text>
                        {item.recommendation && (
                          <Box paddingBlockStart="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              建议：
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {item.recommendation}
                            </Text>
                          </Box>
                        )}
                      </BlockStack>
                    </Box>
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {report.riskItems.length === 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                风险项目
              </Text>
              <Divider />
              <Banner tone="success">
                <Text as="p" variant="bodySm">
                  未发现风险项目。扫描完成且未发现需要迁移的追踪资产。
                </Text>
              </Banner>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}

