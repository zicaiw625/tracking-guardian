import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useFetcher } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  ProgressBar,
  Spinner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scanShopTracking } from "../services/scanner.server";
import { analyzeScriptContent } from "../services/scanner/content-analysis";
import { ManualPastePanel } from "../components/scan/ManualPastePanel";
import { PageIntroCard } from "../components/layout/PageIntroCard";

type Step = "scan" | "manual" | "checklist";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true },
  });

  if (!shop) {
    return json({ shop: null, scanResult: null, auditAssets: [] });
  }

  const latestScan = await prisma.scanReport.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  const auditAssets = await prisma.auditAsset.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return json({
    shop,
    scanResult: latestScan,
    auditAssets,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "scan") {
    try {
      const scanResult = await scanShopTracking(admin, shop.id, { force: true });
      
      const scanReport = await prisma.scanReport.create({
        data: {
          id: `scan_${Date.now()}`,
          shopId: shop.id,
          scriptTags: scanResult.scriptTags as any,
          riskItems: scanResult.riskItems as any,
          riskScore: scanResult.riskScore,
          identifiedPlatforms: scanResult.identifiedPlatforms as any,
          status: "completed",
          completedAt: new Date(),
        },
      });

      return json({ success: true, scanReport });
    } catch (error) {
      return json({ error: String(error) }, { status: 500 });
    }
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

export default function AuditPage() {
  const { shop, scanResult, auditAssets } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const scanFetcher = useFetcher();
  const [currentStep, setCurrentStep] = useState<Step>("scan");
  const [isScanning, setIsScanning] = useState(false);

  const handleStartScan = () => {
    setIsScanning(true);
    scanFetcher.submit(
      { intent: "scan" },
      { method: "post" }
    );
  };

  const handleManualPasteComplete = () => {
    setCurrentStep("checklist");
  };

  if (!shop) {
    return (
      <Page title="Audit">
        <Card>
          <Text>Shop not found</Text>
        </Card>
      </Page>
    );
  }

  const hasScanResult = scanResult?.status === "completed";
  const hasManualAssets = auditAssets.some(a => a.sourceType === "manual_paste");

  return (
    <Page
      title="Audit 扫描"
      subtitle="3步完成扫描：自动扫描 → 手动补充 → 迁移清单"
    >
      <BlockStack gap="500">
        <PageIntroCard
          title="Audit 扫描向导"
          description="在 3 分钟内完成扫描，生成可交付的迁移清单与风险分级。"
          items={[
            "Step 1: 自动扫描 ScriptTags + Web Pixels",
            "Step 2: 手动粘贴 Additional Scripts",
            "Step 3: 查看迁移清单与风险分级",
          ]}
        />

        {currentStep === "scan" && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                步骤 1: 自动扫描
              </Text>
              <Text as="p" tone="subdued">
                自动扫描 ScriptTags 和已安装的 Web Pixels，识别追踪平台和风险项。
              </Text>

              {scanFetcher.state === "submitting" || isScanning ? (
                <BlockStack gap="300">
                  <ProgressBar progress={50} />
                  <InlineStack align="center" gap="200">
                    <Spinner size="small" />
                    <Text>正在扫描...</Text>
                  </InlineStack>
                </BlockStack>
              ) : hasScanResult ? (
                <BlockStack gap="300">
                  <Banner tone="success">
                    <Text>扫描完成！发现 {auditAssets.length} 个追踪资产</Text>
                  </Banner>
                  <Button onClick={() => setCurrentStep("manual")}>
                    下一步：手动补充
                  </Button>
                </BlockStack>
              ) : (
                <Button variant="primary" onClick={handleStartScan}>
                  开始扫描
                </Button>
              )}
            </BlockStack>
          </Card>
        )}

        {currentStep === "manual" && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                步骤 2: 手动补充 Additional Scripts
              </Text>
              <Text as="p" tone="subdued">
                Shopify API 无法读取 checkout.liquid 中的 Additional Scripts，请手动粘贴。
              </Text>
              <ManualPastePanel
                shopId={shop.id}
                onAssetsCreated={() => {
                  handleManualPasteComplete();
                }}
              />
              <Button onClick={() => setCurrentStep("checklist")}>
                下一步：查看清单
              </Button>
            </BlockStack>
          </Card>
        )}

        {currentStep === "checklist" && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                步骤 3: 迁移清单
              </Text>
              <Text as="p" tone="subdued">
                根据扫描结果生成的迁移建议和风险分级。
              </Text>
              {auditAssets.length === 0 ? (
                <Banner tone="info">
                  <Text>暂无扫描结果，请先完成步骤 1 和 2</Text>
                </Banner>
              ) : (
                <BlockStack gap="300">
                  <Text as="p">
                    共发现 {auditAssets.length} 个追踪资产，需要迁移到 Web Pixel。
                  </Text>
                  <Button url="/app/pixels">前往安装像素</Button>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
