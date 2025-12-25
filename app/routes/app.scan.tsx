import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, useFetcher } from "@remix-run/react";
import { useState, useCallback, useMemo } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Banner, Box, Divider, ProgressBar, Icon, DataTable, EmptyState, Spinner, Link, Tabs, TextField, Modal, List, RangeSlider, } from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, SearchIcon, ArrowRightIcon, ClipboardIcon, RefreshIcon, InfoIcon, ExportIcon, ShareIcon, } from "~/components/icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scanShopTracking, getScanHistory, analyzeScriptContent, type ScriptAnalysisResult } from "../services/scanner.server";
import { refreshTypOspStatus } from "../services/checkout-profile.server";
import { getScriptTagDeprecationStatus, getAdditionalScriptsDeprecationStatus, getMigrationUrgencyStatus, getUpgradeStatusMessage, formatDeadlineForUI, type ShopTier, type ShopUpgradeStatus, } from "../utils/deprecation-dates";
import type { ScriptTag, RiskItem } from "../types";
import type { MigrationAction, EnhancedScanResult } from "../services/scanner/types";
import { logger } from "../utils/logger.server";
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            shopTier: true,
            typOspPagesEnabled: true,
            typOspUpdatedAt: true,
            typOspLastCheckedAt: true,
            typOspStatusReason: true,
        },
    });
    if (!shop) {
        return json({
            shop: null,
            latestScan: null,
            scanHistory: [],
            migrationActions: [] as MigrationAction[],
            deprecationStatus: null,
            upgradeStatus: null,
        });
    }
    const latestScanRaw = await prisma.scanReport.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
    });
    
    // Parse migrationActions from the scan report if available
    let migrationActions: MigrationAction[] = [];
    if (latestScanRaw) {
        try {
            // migrationActions might be stored in the scan result
            const scanData = latestScanRaw as unknown as { 
                scriptTags?: ScriptTag[];
                identifiedPlatforms?: string[];
                riskItems?: RiskItem[];
                riskScore?: number;
                additionalScriptsPatterns?: Array<{ platform: string; content: string }>;
            };
            // Re-generate migration actions from current scan data
            const { generateMigrationActions } = await import("../services/scanner/migration-actions");
            const { getExistingWebPixels } = await import("../services/migration.server");
            
            // Fetch current web pixels for accurate migration actions
            const webPixels = await getExistingWebPixels(admin);
            const enhancedResult: EnhancedScanResult = {
                scriptTags: (scanData.scriptTags as ScriptTag[]) || [],
                checkoutConfig: null,
                identifiedPlatforms: (scanData.identifiedPlatforms as string[]) || [],
                riskItems: (scanData.riskItems as RiskItem[]) || [],
                riskScore: scanData.riskScore || 0,
                webPixels: webPixels.map(p => ({ id: p.id, settings: p.settings })),
                duplicatePixels: [],
                migrationActions: [],
                additionalScriptsPatterns: (scanData.additionalScriptsPatterns as Array<{ platform: string; content: string }>) || [],
            };
            const shopTier = (shop.shopTier as string) || "unknown";
            migrationActions = generateMigrationActions(enhancedResult, shopTier);
        } catch (e) {
            // Fallback if generation fails
            migrationActions = [];
        }
    }
    
    const latestScan = latestScanRaw;
    const scanHistory = await getScanHistory(shop.id, 5);
    const shopTier: ShopTier = (shop.shopTier as ShopTier) || "unknown";
    const scriptTags = (latestScan?.scriptTags as ScriptTag[] | null) || [];
    const hasScriptTags = scriptTags.length > 0;
    const hasOrderStatusScriptTags = scriptTags.some(tag => tag.display_scope === "order_status");
    const scriptTagStatus = getScriptTagDeprecationStatus();
    const additionalScriptsStatus = getAdditionalScriptsDeprecationStatus(shopTier);
    const migrationUrgency = getMigrationUrgencyStatus(shopTier, hasScriptTags, hasOrderStatusScriptTags);
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const lastTypOspCheck = shop.typOspLastCheckedAt || shop.typOspUpdatedAt;
    const isTypOspStale = !lastTypOspCheck ||
        (Date.now() - lastTypOspCheck.getTime()) > sixHoursMs ||
        shop.typOspPagesEnabled === null;
    let typOspPagesEnabled = shop.typOspPagesEnabled;
    let typOspUpdatedAt = lastTypOspCheck;
    let typOspUnknownReason: string | undefined = shop.typOspStatusReason ?? undefined;
    let typOspUnknownError: string | undefined;
    if (admin && isTypOspStale) {
        try {
            const typOspResult = await refreshTypOspStatus(admin, shop.id);
            typOspPagesEnabled = typOspResult.typOspPagesEnabled;
            typOspUpdatedAt = typOspResult.checkedAt;
            if (typOspResult.status === "unknown") {
                typOspUnknownReason = typOspResult.unknownReason;
                typOspUnknownError = typOspResult.error;
            }
        }
        catch (error) {
            typOspUnknownReason = "API_ERROR";
            typOspUnknownError = error instanceof Error ? error.message : "Unknown error";
        }
    }
    const shopUpgradeStatus: ShopUpgradeStatus = {
        tier: shopTier,
        typOspPagesEnabled,
        typOspUpdatedAt,
        typOspUnknownReason,
        typOspUnknownError,
    };
    const upgradeStatusMessage = getUpgradeStatusMessage(shopUpgradeStatus, hasScriptTags);
    return json({
        shop: { id: shop.id, domain: shopDomain },
        latestScan,
        scanHistory,
        migrationActions,
        deprecationStatus: {
            shopTier,
            scriptTag: {
                ...formatDeadlineForUI(scriptTagStatus),
                isExpired: scriptTagStatus.isExpired,
            },
            additionalScripts: {
                ...formatDeadlineForUI(additionalScriptsStatus),
                isExpired: additionalScriptsStatus.isExpired,
            },
            migrationUrgency,
        },
        upgradeStatus: {
            ...upgradeStatusMessage,
            lastUpdated: typOspUpdatedAt?.toISOString() || null,
            hasOfficialSignal: typOspUpdatedAt !== null,
        },
    });
};
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
    });
    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }
    const formData = await request.formData();
    const actionType = formData.get("_action");
    if (actionType === "analyzeScript") {
        const scriptContent = formData.get("scriptContent") as string;
        if (!scriptContent || scriptContent.trim().length === 0) {
            return json({ error: "请粘贴要分析的脚本内容" }, { status: 400 });
        }
        try {
            const analysisResult = analyzeScriptContent(scriptContent);
            return json({
                success: true,
                actionType: "analyzeScript",
                analysisResult
            });
        }
        catch (error) {
            logger.error("Script analysis error occurred (content not logged for privacy)");
            return json({ error: error instanceof Error ? error.message : "分析失败" }, { status: 500 });
        }
    }
    try {
        const scanResult = await scanShopTracking(admin, shop.id);
        return json({ success: true, actionType: "scan", result: scanResult });
    }
    catch (error) {
        logger.error("Scan error", error);
        return json({ error: error instanceof Error ? error.message : "Scan failed" }, { status: 500 });
    }
};
export default function ScanPage() {
    const { shop, latestScan, scanHistory, deprecationStatus, upgradeStatus, migrationActions } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const deleteFetcher = useFetcher();
    const upgradeFetcher = useFetcher();
    const [selectedTab, setSelectedTab] = useState(0);
    const [scriptContent, setScriptContent] = useState("");
    const [guidanceModalOpen, setGuidanceModalOpen] = useState(false);
    const [guidanceContent, setGuidanceContent] = useState<{ title: string; platform?: string; scriptTagId?: number } | null>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<{ type: "webPixel"; id: string; gid: string; title: string } | null>(null);
    const [monthlyOrders, setMonthlyOrders] = useState(500);
    const isScanning = navigation.state === "submitting";

    const additionalScriptsWarning = (
      <Banner tone="warning" title="Additional Scripts 需手动粘贴">
        <BlockStack gap="200">
          <Text as="p">
            Shopify API 无法读取 checkout.liquid / Additional Scripts。请在下方「脚本内容分析」中粘贴原始脚本，确保迁移报告涵盖 Thank you / Order status 页的自定义逻辑。
          </Text>
          <Text as="p" tone="subdued">
            截止提醒：{deprecationStatus.additionalScripts.badge.text} — {deprecationStatus.additionalScripts.description}
          </Text>
        </BlockStack>
      </Banner>
    );
    
    // Declare identifiedPlatforms before useMemo uses it
    const identifiedPlatforms = (latestScan?.identifiedPlatforms as string[] | null) || [];
    
    // ROI 影响估算计算
    // 注意：此处仅为帮助商户理解潜在风险的示意，不构成任何效果预测或保证
    const roiEstimate = useMemo(() => {
        const platforms = identifiedPlatforms.length || 1;
        const scriptTagCount = ((latestScan?.scriptTags as ScriptTag[] | null) || []).length;
        
        // 不迁移的事件丢失估算（仅供参考）
        // 实际影响取决于客户群体、流量来源、广告策略等多种因素
        const eventsLostPerMonth = monthlyOrders * platforms;
        
        // 我们不提供具体金额估算，因为实际影响因店铺而异
        const hasRisk = scriptTagCount > 0;
        
        return {
            eventsLostPerMonth,
            hasRisk,
            platforms,
            scriptTagCount,
        };
    }, [monthlyOrders, identifiedPlatforms, latestScan]);
    const isDeleting = deleteFetcher.state === "submitting";
    const isUpgrading = upgradeFetcher.state === "submitting";

    // P0-1: Show ScriptTag cleanup guidance instead of direct deletion
    // (应用没有 write_script_tags 权限，无法直接删除 ScriptTag)
    const handleShowScriptTagGuidance = useCallback((scriptTagId: number, platform?: string) => {
        setGuidanceContent({
            title: `清理 ScriptTag #${scriptTagId}`,
            platform,
            scriptTagId,
        });
        setGuidanceModalOpen(true);
    }, []);

    // Close guidance modal
    const closeGuidanceModal = useCallback(() => {
        setGuidanceModalOpen(false);
        setGuidanceContent(null);
    }, []);

    // Handle WebPixel deletion (保留，因为有 write_pixels 权限)
    const handleDeleteWebPixel = useCallback((webPixelGid: string, platform?: string) => {
        setPendingDelete({
            type: "webPixel",
            id: webPixelGid,
            gid: webPixelGid,
            title: `WebPixel${platform ? ` (${platform})` : ""}`,
        });
        setDeleteModalOpen(true);
    }, []);

    // Confirm WebPixel deletion
    const confirmDelete = useCallback(() => {
        if (!pendingDelete) return;

        const formData = new FormData();
        formData.append("webPixelGid", pendingDelete.gid);
        deleteFetcher.submit(formData, {
            method: "post",
            action: "/app/actions/delete-web-pixel",
        });
        setDeleteModalOpen(false);
        setPendingDelete(null);
    }, [pendingDelete, deleteFetcher]);

    // Close delete modal
    const closeDeleteModal = useCallback(() => {
        setDeleteModalOpen(false);
        setPendingDelete(null);
    }, []);

    // Handle WebPixel settings upgrade (P1-02)
    const handleUpgradePixelSettings = useCallback(() => {
        const formData = new FormData();
        // Upgrade all pixels that need it (no specific GID)
        upgradeFetcher.submit(formData, {
            method: "post",
            action: "/app/actions/upgrade-web-pixel",
        });
    }, [upgradeFetcher]);

    const handleScan = () => {
        const formData = new FormData();
        formData.append("_action", "scan");
        submit(formData, { method: "post" });
    };
    const handleAnalyzeScript = () => {
        const formData = new FormData();
        formData.append("_action", "analyzeScript");
        formData.append("scriptContent", scriptContent);
        submit(formData, { method: "post" });
    };
    const analysisResult = actionData && "analysisResult" in actionData
        ? actionData.analysisResult as ScriptAnalysisResult
        : null;
    const tabs = [
        { id: "auto-scan", content: "自动扫描" },
        { id: "manual-analyze", content: "手动分析" },
    ];
    const getSeverityBadge = (severity: string) => {
        switch (severity) {
            case "high":
                return <Badge tone="critical">高风险</Badge>;
            case "medium":
                return <Badge tone="warning">中风险</Badge>;
            case "low":
                return <Badge tone="info">低风险</Badge>;
            default:
                return <Badge>未知</Badge>;
        }
    };
    const getPlatformName = (platform: string) => {
        // P0-4: bing/clarity removed from CAPI support, but keep display names for detection
        const names: Record<string, string> = {
            google: "GA4 (Measurement Protocol)",
            meta: "Meta (Facebook) Pixel",
            tiktok: "TikTok Pixel",
            bing: "Microsoft Ads (Bing) ⚠️",  // Warning: not supported
            clarity: "Microsoft Clarity ⚠️",   // Warning: not supported
            pinterest: "Pinterest Tag",
            snapchat: "Snapchat Pixel",
            twitter: "Twitter/X Pixel",
        };
        return names[platform] || platform;
    };
    const riskItems = (latestScan?.riskItems as RiskItem[] | null) || [];
    // identifiedPlatforms is now declared earlier, before useMemo
  const getUpgradeBannerTone = (urgency: string): "critical" | "warning" | "info" | "success" => {
        switch (urgency) {
            case "critical": return "critical";
            case "high": return "warning";
            case "medium": return "warning";
            case "resolved": return "success";
            default: return "info";
        }
    };
    return (<Page title="追踪脚本扫描" subtitle="扫描店铺中的追踪脚本，识别迁移风险">
      <BlockStack gap="500">
        {additionalScriptsWarning}
        {upgradeStatus && (<Banner title={upgradeStatus.title} tone={getUpgradeBannerTone(upgradeStatus.urgency)}>
            <BlockStack gap="200">
              <Text as="p">{upgradeStatus.message}</Text>
              {upgradeStatus.actions.length > 0 && (<BlockStack gap="100">
                  {upgradeStatus.actions.map((action, idx) => (<Text key={idx} as="p" variant="bodySm">
                      • {action}
                    </Text>))}
                </BlockStack>)}
              {!upgradeStatus.hasOfficialSignal && (<Text as="p" variant="bodySm" tone="subdued">
                  提示：我们尚未完成一次有效的升级状态检测。请稍后重试、重新授权应用，或等待后台定时任务自动刷新。
                </Text>)}
              {upgradeStatus.lastUpdated && (<Text as="p" variant="bodySm" tone="subdued">
                  状态更新时间: {new Date(upgradeStatus.lastUpdated).toLocaleString("zh-CN")}
                </Text>)}
            </BlockStack>
          </Banner>)}

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {selectedTab === 0 && (<BlockStack gap="500">
              <Box paddingBlockStart="400">
                <InlineStack align="space-between">
                  {/* P1-8: 导出和分享按钮 */}
                  {latestScan && (
                    <InlineStack gap="200">
                      <Button 
                        icon={ExportIcon} 
                        onClick={() => window.open("/api/exports?type=scan&format=json&include_meta=true", "_blank")}
                      >
                        导出报告
                      </Button>
                      <Button 
                        icon={ShareIcon}
                        onClick={() => {
                          const shareData = {
                            title: "追踪脚本扫描报告",
                            text: `店铺追踪扫描报告\n风险评分: ${latestScan.riskScore}/100\n检测平台: ${identifiedPlatforms.join(", ") || "无"}\n扫描时间: ${new Date(latestScan.createdAt).toLocaleString("zh-CN")}`,
                          };
                          if (navigator.share) {
                            navigator.share(shareData);
                          } else {
                            navigator.clipboard.writeText(shareData.text);
                            alert("报告摘要已复制到剪贴板");
                          }
                        }}
                      >
                        分享摘要
                      </Button>
                    </InlineStack>
                  )}
                  <InlineStack gap="200">
                    <Button variant="primary" onClick={handleScan} loading={isScanning} icon={SearchIcon}>
                      {isScanning ? "扫描中..." : "开始扫描"}
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Box>

              {isScanning && (<Card>
                  <BlockStack gap="400">
                    <InlineStack gap="200" align="center">
                      <Spinner size="small"/>
                      <Text as="p">正在扫描店铺追踪配置...</Text>
                    </InlineStack>
                    <ProgressBar progress={75} tone="primary"/>
                  </BlockStack>
                </Card>)}

              {!latestScan && !isScanning && (<Card>
                  <EmptyState heading="还没有扫描报告" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png" action={{
                    content: "开始扫描",
                    onAction: handleScan,
                    loading: isScanning,
                }}>
                    <BlockStack gap="300">
                      <Text as="p">
                        点击开始扫描，我们会自动检测 <strong>ScriptTags</strong> 和已安装的像素配置，并给出风险等级与迁移建议。
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        预计耗时约 10 秒，不会修改任何设置
                      </Text>
                      <Banner tone="info">
                        <BlockStack gap="200">
                          <Text as="p">
                            <strong>关于 Additional Scripts：</strong>Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts。
                            请切换到「手动分析」标签页，粘贴脚本内容进行分析。
                          </Text>
                        </BlockStack>
                      </Banner>
                      <Link url="https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/upgrade-thank-you-order-status" external>
                        了解为何需要迁移（Checkout Extensibility）
                      </Link>
                    </BlockStack>
                  </EmptyState>
                </Card>)}

        {latestScan && !isScanning && (<Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    风险评分
                  </Text>
                  <Box background={latestScan.riskScore > 60
                    ? "bg-fill-critical"
                    : latestScan.riskScore > 30
                        ? "bg-fill-warning"
                        : "bg-fill-success"} padding="600" borderRadius="200">
                    <BlockStack gap="200" align="center">
                      <Text as="p" variant="heading3xl" fontWeight="bold">
                        {latestScan.riskScore}
                      </Text>
                      <Text as="p" variant="bodySm">
                        / 100
                      </Text>
                    </BlockStack>
                  </Box>
                  <Text as="p" variant="bodySm" tone="subdued">
                    扫描时间:{" "}
                    {new Date(latestScan.createdAt).toLocaleString("zh-CN")}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    检测到的平台
                  </Text>
                  {identifiedPlatforms.length > 0 ? (<BlockStack gap="200">
                      {identifiedPlatforms.map((platform) => (<InlineStack key={platform} gap="200" align="start">
                          <Icon source={CheckCircleIcon} tone="success"/>
                          <Text as="span">{getPlatformName(platform)}</Text>
                        </InlineStack>))}
                    </BlockStack>) : (<Text as="p" tone="subdued">
                      未检测到追踪平台
                    </Text>)}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      ScriptTags
                    </Text>
                    {deprecationStatus?.scriptTag && (<Badge tone={deprecationStatus.scriptTag.isExpired ? "critical" : "warning"}>
                        {deprecationStatus.scriptTag.badge.text}
                      </Badge>)}
                  </InlineStack>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span">已安装数量</Text>
                      <Text as="span" fontWeight="semibold">
                        {((latestScan.scriptTags as ScriptTag[] | null) || []).length}
                      </Text>
                    </InlineStack>
                    {((latestScan.scriptTags as ScriptTag[] | null) || []).length > 0 && deprecationStatus?.scriptTag && (<Banner tone={deprecationStatus.scriptTag.isExpired ? "critical" : "warning"}>
                        <p>{deprecationStatus.scriptTag.description}</p>
                      </Banner>)}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>)}

        {/* ROI 影响估算卡片 - 增强版：带交互式计算器 */}
        {latestScan && !isScanning && latestScan.riskScore > 0 && (<Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  📊 迁移影响分析（仅供参考）
                </Text>
                <Badge tone="info">示例估算</Badge>
              </InlineStack>
              
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  <strong>⚠️ 免责声明：</strong>以下为简化示意，仅帮助理解迁移的必要性。
                  实际业务影响因店铺业务模式、流量来源、客户群体、广告账户设置等多种因素而异，
                  本工具无法预测具体数值影响，不构成任何效果保证或承诺。
                </Text>
              </Banner>

              {/* 交互式订单量输入 */}
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <Text as="p" fontWeight="semibold">
                    🧮 输入您的月订单量，查看具体影响
                  </Text>
                  <RangeSlider
                    label="月订单量"
                    value={monthlyOrders}
                    onChange={(value) => setMonthlyOrders(value as number)}
                    output
                    min={100}
                    max={10000}
                    step={100}
                    suffix={<Text as="span" variant="bodySm">{monthlyOrders} 单/月</Text>}
                  />
                </BlockStack>
              </Box>

              {/* 事件丢失估算 - 基于实际输入 */}
              <Box background="bg-fill-critical-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={AlertCircleIcon} tone="critical" />
                    <Text as="h3" variant="headingMd" tone="critical">
                      不迁移会丢失什么？（示意说明）
                    </Text>
                  </InlineStack>
                  
                  {/* 具体数字展示 */}
                  <InlineStack gap="400" align="space-between" wrap>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">可能受影响的事件</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                          {roiEstimate.eventsLostPerMonth.toLocaleString()}
                        </Text>
                        <Text as="p" variant="bodySm" tone="critical">
                          {roiEstimate.platforms} 平台 × {monthlyOrders} 订单
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">受影响 ScriptTag</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                          {roiEstimate.scriptTagCount}
                        </Text>
                        <Text as="p" variant="bodySm" tone="critical">
                          将在截止日停止执行
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">实际影响</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="caution">
                          因店铺而异
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          取决于流量来源和客户群体
                        </Text>
                      </BlockStack>
                    </Box>
                  </InlineStack>
                  
                  <BlockStack gap="200">
                    {identifiedPlatforms.length > 0 ? (
                      identifiedPlatforms.map((platform) => (
                        <Box key={platform} background="bg-surface" padding="300" borderRadius="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200">
                              <Badge tone="critical">将失效</Badge>
                              <Text as="span" fontWeight="semibold">{getPlatformName(platform)}</Text>
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="critical">
                              参考值（仅供估算）
                            </Text>
                          </InlineStack>
                        </Box>
                      ))
                    ) : (
                      <Text as="p" variant="bodySm">
                        当前 ScriptTag 中的追踪代码将在截止日期后全部失效
                      </Text>
                    )}
                  </BlockStack>

                  <Banner tone="warning">
                    <Text as="p" variant="bodySm">
                      <strong>⚠️ 重要提醒：</strong>
                      ScriptTag 在截止日期后将停止执行，导致其中的追踪代码失效。
                      实际对您业务的影响取决于流量来源、客户群体、广告策略等多种因素，
                      本工具无法预测具体金额影响。建议您结合自身业务情况评估迁移优先级。
                    </Text>
                  </Banner>
                </BlockStack>
              </Box>

              <Divider />

              {/* 迁移后恢复 - 显示具体收益 */}
              <Box background="bg-fill-success-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text as="h3" variant="headingMd" tone="success">
                      迁移后能恢复什么？（您的预期收益）
                    </Text>
                  </InlineStack>

                  {/* 具体收益数字展示 */}
                  <InlineStack gap="400" align="space-between" wrap>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">每月恢复事件</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                          {roiEstimate.eventsLostPerMonth.toLocaleString()}
                        </Text>
                        <Text as="p" variant="bodySm" tone="success">
                          转化追踪功能恢复
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">潜在收益（示例）</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                          确保追踪
                        </Text>
                        <Text as="p" variant="bodySm" tone="success">
                          避免数据中断
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">服务端追踪</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                          更可靠
                        </Text>
                        <Text as="p" variant="bodySm" tone="success">
                          CAPI 双重保障
                        </Text>
                      </BlockStack>
                    </Box>
                  </InlineStack>

                  <BlockStack gap="200">
                    {identifiedPlatforms.length > 0 ? (
                      identifiedPlatforms.map((platform) => (
                        <Box key={platform} background="bg-surface" padding="300" borderRadius="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200">
                              <Badge tone="success">✓ 恢复</Badge>
                              <Text as="span" fontWeight="semibold">{getPlatformName(platform)}</Text>
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="success">
                              每月 {monthlyOrders.toLocaleString()} 个转化事件 → 广告平台
                            </Text>
                          </InlineStack>
                        </Box>
                      ))
                    ) : (
                      <Text as="p" variant="bodySm">
                        所有追踪功能将通过 Web Pixel + 服务端 CAPI 恢复
                      </Text>
                    )}
                  </BlockStack>

                  <Banner tone="success">
                    <Text as="p" variant="bodySm">
                      <strong>✅ 迁移的核心价值：</strong>
                      迁移是一次性工作，完成后可确保转化追踪在 ScriptTag 废弃后继续正常工作。
                      服务端 CAPI 不受浏览器隐私设置和广告拦截器影响，是 Shopify 和各广告平台推荐的追踪方式。
                      实际追踪效果因店铺情况而异。
                    </Text>
                  </Banner>
                </BlockStack>
              </Box>

              <Divider />

              {/* 对比卡片 */}
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  迁移前后对比
                </Text>
                <InlineStack gap="400" align="space-between" wrap={false}>
                  <Box background="bg-surface-critical" padding="300" borderRadius="200" minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">当前（不迁移）</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                        {latestScan.riskScore > 60 ? "高风险" : latestScan.riskScore > 30 ? "中风险" : "低风险"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="critical">
                        {((latestScan.scriptTags as ScriptTag[] | null) || []).length} 个 ScriptTag 将失效
                      </Text>
                    </BlockStack>
                  </Box>

                  <Box padding="300">
                    <Icon source={ArrowRightIcon} tone="subdued" />
                  </Box>

                  <Box background="bg-surface-success" padding="300" borderRadius="200" minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">迁移后</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                        功能恢复
                      </Text>
                      <Text as="p" variant="bodySm" tone="success">
                        Web Pixel + CAPI 双保险
                      </Text>
                    </BlockStack>
                  </Box>

                  <Box padding="300">
                    <Icon source={ArrowRightIcon} tone="subdued" />
                  </Box>

                  <Box background="bg-surface-success" padding="300" borderRadius="200" minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">额外收益</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                        更稳定
                      </Text>
                      <Text as="p" variant="bodySm" tone="success">
                        不受隐私限制影响
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineStack>

                <Banner tone="info" title="服务端 CAPI 的技术优势">
                  <Text as="p" variant="bodySm">
                    ✅ 不受 iOS 14.5+ App Tracking Transparency 限制
                    <br />
                    ✅ 不受浏览器广告拦截器影响
                    <br />
                    ✅ 不受第三方 Cookie 弃用影响
                    <br />
                    ✅ Shopify Webhook 直接传递订单数据
                    <br />
                    <Text as="span" tone="subdued">
                      注：实际归因效果因广告账户设置、流量来源等因素而异
                    </Text>
                  </Text>
                </Banner>
              </BlockStack>

              <InlineStack align="end" gap="200">
                <Button url="/app/diagnostics">
                  查看追踪诊断
                </Button>
                <Button url="/app/migrate" variant="primary">
                  立即开始迁移
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>)}

        {latestScan && riskItems.length > 0 && !isScanning && (<Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                风险详情
              </Text>
              <BlockStack gap="300">
                {riskItems.map((item, index) => (<Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <InlineStack gap="200">
                          <Icon source={AlertCircleIcon} tone={item.severity === "high"
                        ? "critical"
                        : item.severity === "medium"
                            ? "warning"
                            : "info"}/>
                          <Text as="span" fontWeight="semibold">
                            {item.name}
                          </Text>
                        </InlineStack>
                        {getSeverityBadge(item.severity)}
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        {item.description}
                      </Text>
                      {item.details && (<Text as="p" variant="bodySm">
                          {item.details}
                        </Text>)}
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200">
                          {item.platform && (<Badge>{getPlatformName(item.platform)}</Badge>)}
                          {item.impact && (<Text as="span" variant="bodySm" tone="critical">
                              影响: {item.impact}
                            </Text>)}
                        </InlineStack>
                        <Button url={`/app/migrate${item.platform ? `?platform=${item.platform}` : ""}`} size="slim" icon={ArrowRightIcon}>
                          一键迁移
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Box>))}
              </BlockStack>
            </BlockStack>
          </Card>)}

        {/* Migration Actions with Delete Buttons */}
        {latestScan && migrationActions && migrationActions.length > 0 && !isScanning && (<Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  迁移操作
                </Text>
                <Badge tone="attention">{`${migrationActions.length} 项待处理`}</Badge>
              </InlineStack>
              
              {deleteFetcher.data ? (
                <Banner 
                  tone={(deleteFetcher.data as { success?: boolean }).success ? "success" : "critical"}
                  onDismiss={() => {}}
                >
                  <Text as="p">
                    {String((deleteFetcher.data as { message?: string }).message || 
                     (deleteFetcher.data as { error?: string }).error || "操作完成")}
                  </Text>
                </Banner>
              ) : null}

              {upgradeFetcher.data ? (
                <Banner 
                  tone={(upgradeFetcher.data as { success?: boolean }).success ? "success" : "critical"}
                  onDismiss={() => {}}
                >
                  <Text as="p">
                    {String((upgradeFetcher.data as { message?: string }).message || 
                     (upgradeFetcher.data as { error?: string }).error || "升级完成")}
                  </Text>
                </Banner>
              ) : null}

              <BlockStack gap="300">
                {migrationActions.map((action, index) => (
                  <Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" fontWeight="semibold">
                              {action.title}
                            </Text>
                            <Badge tone={
                              action.priority === "high" ? "critical" : 
                              action.priority === "medium" ? "warning" : "info"
                            }>
                              {action.priority === "high" ? "高优先级" : 
                               action.priority === "medium" ? "中优先级" : "低优先级"}
                            </Badge>
                          </InlineStack>
                          {action.platform && (
                            <Badge>{getPlatformName(action.platform)}</Badge>
                          )}
                        </BlockStack>
                        {action.deadline && (
                          <Badge tone="warning">{`截止: ${action.deadline}`}</Badge>
                        )}
                      </InlineStack>
                      
                      <Text as="p" variant="bodySm" tone="subdued">
                        {action.description}
                      </Text>
                      
                      <InlineStack gap="200" align="end">
                        {/* P0-1: ScriptTag 清理改为显示手动指南（应用无 write_script_tags 权限） */}
                        {action.type === "migrate_script_tag" && action.scriptTagId && (
                          <Button 
                            size="slim" 
                            icon={InfoIcon}
                            onClick={() => handleShowScriptTagGuidance(
                              action.scriptTagId!,
                              action.platform
                            )}
                          >
                            查看清理指南
                          </Button>
                        )}
                        {action.type === "remove_duplicate" && action.webPixelGid && (
                          <Button 
                            tone="critical" 
                            size="slim" 
                            loading={isDeleting && pendingDelete?.gid === action.webPixelGid}
                            onClick={() => handleDeleteWebPixel(action.webPixelGid!, action.platform)}
                          >
                            删除重复像素
                          </Button>
                        )}
                        {action.type === "configure_pixel" && action.description?.includes("升级") && (
                          <Button 
                            size="slim" 
                            icon={RefreshIcon}
                            loading={isUpgrading}
                            onClick={handleUpgradePixelSettings}
                          >
                            升级配置
                          </Button>
                        )}
                        {action.type === "configure_pixel" && !action.description?.includes("升级") && (
                          <Button 
                            size="slim" 
                            url="/app/migrate"
                            icon={ArrowRightIcon}
                          >
                            配置 Pixel
                          </Button>
                        )}
                        {action.type === "enable_capi" && (
                          <Button 
                            size="slim" 
                            url="/app/settings"
                            icon={ArrowRightIcon}
                          >
                            配置 CAPI
                          </Button>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>)}

        {/* P1-3: 迁移向导卡片 */}
        {latestScan && !isScanning && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  🧭 迁移向导
                </Text>
                <Badge tone="info">P1-3 迁移闭环</Badge>
              </InlineStack>
              
              <Text as="p" tone="subdued">
                根据扫描结果，以下是完成迁移所需的步骤。点击各项可直接跳转到对应位置。
              </Text>

              <Divider />

              {/* 分类一：Web Pixel 相关 */}
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  📦 Web Pixel 设置
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Web Pixel 是 Shopify 推荐的客户端追踪方式，替代传统 ScriptTag。
                </Text>
                <InlineStack gap="300" wrap>
                  <Button 
                    url="https://admin.shopify.com/store/settings/customer_events"
                    external
                    icon={ShareIcon}
                  >
                    管理 Pixels（Shopify 后台）
                  </Button>
                  <Button 
                    url="/app/migrate"
                    icon={ArrowRightIcon}
                  >
                    在应用内配置 Pixel
                  </Button>
                </InlineStack>
              </BlockStack>

              <Divider />

              {/* 分类二：Checkout Editor 相关 */}
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  🛒 Checkout Editor（Plus 专属）
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  如果您是 Shopify Plus 商家，可以使用 Checkout UI Extension 替代 Additional Scripts。
                </Text>
                <InlineStack gap="300" wrap>
                  <Button 
                    url="https://admin.shopify.com/store/settings/checkout/editor"
                    external
                    icon={ShareIcon}
                  >
                    打开 Checkout Editor
                  </Button>
                  <Button 
                    url="https://shopify.dev/docs/apps/checkout/thank-you-order-status"
                    external
                    icon={InfoIcon}
                  >
                    查看官方文档
                  </Button>
                </InlineStack>
              </BlockStack>

              <Divider />

              {/* 分类三：迁移清单 */}
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  📋 迁移清单
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  生成可导出的迁移步骤清单，方便团队协作或记录进度。
                </Text>
                
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">待迁移项目：</Text>
                    <List type="number">
                      {migrationActions && migrationActions.length > 0 ? (
                        migrationActions.slice(0, 5).map((action, i) => (
                          <List.Item key={i}>
                            {action.title}
                            {action.platform && ` (${getPlatformName(action.platform)})`}
                            {action.priority === "high" && " ⚠️"}
                          </List.Item>
                        ))
                      ) : (
                        <List.Item>暂无待处理项目 ✅</List.Item>
                      )}
                      {migrationActions && migrationActions.length > 5 && (
                        <List.Item>...还有 {migrationActions.length - 5} 项</List.Item>
                      )}
                    </List>
                    
                    <InlineStack gap="200" align="end">
                      <Button 
                        icon={ClipboardIcon}
                        onClick={() => {
                          const checklist = [
                            "# 迁移清单",
                            `店铺: ${shop?.domain || "未知"}`,
                            `生成时间: ${new Date().toLocaleString("zh-CN")}`,
                            "",
                            "## 待处理项目",
                            ...(migrationActions?.map((a, i) => 
                              `${i + 1}. [${a.priority === "high" ? "高" : a.priority === "medium" ? "中" : "低"}] ${a.title}${a.platform ? ` (${a.platform})` : ""}`
                            ) || ["无"]),
                            "",
                            "## 快速链接",
                            "- Pixels 管理: https://admin.shopify.com/store/settings/customer_events",
                            "- Checkout Editor: https://admin.shopify.com/store/settings/checkout/editor",
                            "- 应用迁移工具: /app/migrate",
                          ].join("\n");
                          navigator.clipboard.writeText(checklist);
                        }}
                      >
                        复制清单
                      </Button>
                      <Button 
                        icon={ExportIcon}
                        onClick={() => {
                          const checklist = [
                            "迁移清单",
                            `店铺: ${shop?.domain || "未知"}`,
                            `生成时间: ${new Date().toLocaleString("zh-CN")}`,
                            "",
                            "待处理项目:",
                            ...(migrationActions?.map((a, i) => 
                              `${i + 1}. [${a.priority === "high" ? "高优先级" : a.priority === "medium" ? "中优先级" : "低优先级"}] ${a.title}${a.platform ? ` (${a.platform})` : ""}`
                            ) || ["无"]),
                          ].join("\n");
                          const blob = new Blob([checklist], { type: "text/plain" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `migration-checklist-${new Date().toISOString().split("T")[0]}.txt`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        导出清单
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>

              <Divider />

              {/* 替代方案分类 */}
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  🔄 替代方案一览
                </Text>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="300">
                    <InlineStack gap="400" wrap>
                      <Box minWidth="200px">
                        <BlockStack gap="100">
                          <Badge tone="success">官方替代</Badge>
                          <Text as="p" variant="bodySm">
                            • Shopify Pixels（客户端）
                            <br />• Customer Events API
                          </Text>
                        </BlockStack>
                      </Box>
                      <Box minWidth="200px">
                        <BlockStack gap="100">
                          <Badge tone="info">Web Pixel 替代</Badge>
                          <Text as="p" variant="bodySm">
                            • ScriptTag → Web Pixel
                            <br />• checkout.liquid → Pixel + Extension
                          </Text>
                        </BlockStack>
                      </Box>
                      <Box minWidth="200px">
                        <BlockStack gap="100">
                          <Badge tone="warning">UI Extension 替代</Badge>
                          <Text as="p" variant="bodySm">
                            • Additional Scripts → Checkout UI
                            <br />• Order Status 脚本 → TYP Extension
                          </Text>
                        </BlockStack>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {scanHistory.length > 1 && (<Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                扫描历史
              </Text>
              <DataTable columnContentTypes={["text", "numeric", "text", "text"]} headings={["扫描时间", "风险分", "检测平台", "状态"]} rows={scanHistory.filter((scan): scan is NonNullable<typeof scan> => scan !== null).map((scan) => [
                    new Date(scan.createdAt).toLocaleString("zh-CN"),
                    String(scan.riskScore),
                    ((scan.identifiedPlatforms as string[]) || []).join(", ") || "-",
                    scan.status === "completed" ? "完成" : scan.status,
                ])}/>
            </BlockStack>
          </Card>)}

              {latestScan && latestScan.riskScore > 0 && (<Banner title="建议进行迁移" tone="warning" action={{ content: "前往迁移工具", url: "/app/migrate" }}>
                  <p>
                    检测到您的店铺存在需要迁移的追踪脚本。
                    建议使用我们的迁移工具将追踪代码更新为 Shopify Web Pixel 格式。
                  </p>
                </Banner>)}
            </BlockStack>)}

          {selectedTab === 1 && (<BlockStack gap="500">
              <Box paddingBlockStart="400">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      手动分析 Additional Scripts
                    </Text>
                    <Text as="p" tone="subdued">
                      Shopify API 无法自动读取 Additional Scripts 内容。
                      请从 Shopify 后台复制脚本代码，粘贴到下方进行分析。
                    </Text>

                    <Banner tone="critical" title="Plus：2025-08-28 / 非 Plus：2026-08-26 将失效">
                      <Text as="p" variant="bodySm">
                        这是 Thank you / Order status 页面迁移的硬性截止时间。提前粘贴 Additional Scripts 代码并完成迁移，可避免追踪中断。
                      </Text>
                    </Banner>

                    <Banner tone="info">
                      <BlockStack gap="200">
                        <Text as="p" fontWeight="semibold">如何获取 Additional Scripts：</Text>
                        <Text as="p" variant="bodySm">
                          1. 前往 Shopify 后台 → 设置 → 结账
                          <br />2. 找到「订单状态页面」或「Additional Scripts」区域
                          <br />3. 复制其中的所有代码
                          <br />4. 粘贴到下方文本框中
                        </Text>
                      </BlockStack>
                    </Banner>

                    <TextField label="粘贴脚本内容" value={scriptContent} onChange={setScriptContent} multiline={8} autoComplete="off" placeholder={`<!-- 示例 -->
<script>
  gtag('event', 'purchase', {...});
  fbq('track', 'Purchase', {...});
</script>`} helpText="支持检测 Google、Meta、TikTok、Bing 等平台的追踪代码"/>

                    <InlineStack align="end">
                      <Button variant="primary" onClick={handleAnalyzeScript} loading={isScanning} disabled={!scriptContent.trim()} icon={ClipboardIcon}>
                        分析脚本
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Box>

              {analysisResult && (<Layout>
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                          风险评分
                        </Text>
                        <Box background={analysisResult.riskScore > 60
                    ? "bg-fill-critical"
                    : analysisResult.riskScore > 30
                        ? "bg-fill-warning"
                        : "bg-fill-success"} padding="600" borderRadius="200">
                          <BlockStack gap="200" align="center">
                            <Text as="p" variant="heading3xl" fontWeight="bold">
                              {analysisResult.riskScore}
                            </Text>
                            <Text as="p" variant="bodySm">
                              / 100
                            </Text>
                          </BlockStack>
                        </Box>
                      </BlockStack>
                    </Card>
                  </Layout.Section>

                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                          检测到的平台
                        </Text>
                        {analysisResult.identifiedPlatforms.length > 0 ? (<BlockStack gap="200">
                            {analysisResult.identifiedPlatforms.map((platform) => (<InlineStack key={platform} gap="200" align="start">
                                <Icon source={CheckCircleIcon} tone="success"/>
                                <Text as="span">{getPlatformName(platform)}</Text>
                              </InlineStack>))}
                          </BlockStack>) : (<Text as="p" tone="subdued">
                            未检测到已知追踪平台
                          </Text>)}
                      </BlockStack>
                    </Card>
                  </Layout.Section>

                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                          检测详情
                        </Text>
                        {analysisResult.platformDetails.length > 0 ? (<BlockStack gap="200">
                            {analysisResult.platformDetails.slice(0, 5).map((detail, idx) => (<Box key={idx} background="bg-surface-secondary" padding="200" borderRadius="100">
                                <BlockStack gap="100">
                                  <InlineStack gap="200" align="space-between">
                                    <Text as="span" variant="bodySm" fontWeight="semibold">
                                      {detail.type}
                                    </Text>
                                    <Badge tone={detail.confidence === "high" ? "success" : "info"}>
                                      {detail.confidence === "high" ? "高可信度" : "中可信度"}
                                    </Badge>
                                  </InlineStack>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {detail.matchedPattern}
                                  </Text>
                                </BlockStack>
                              </Box>))}
                          </BlockStack>) : (<Text as="p" tone="subdued">
                            无检测详情
                          </Text>)}
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                </Layout>)}

              {analysisResult && analysisResult.risks.length > 0 && (<Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      风险详情
                    </Text>
                    <BlockStack gap="300">
                      {analysisResult.risks.map((risk, index) => (<Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                          <BlockStack gap="200">
                            <InlineStack align="space-between">
                              <InlineStack gap="200">
                                <Icon source={AlertCircleIcon} tone={risk.severity === "high"
                        ? "critical"
                        : risk.severity === "medium"
                            ? "warning"
                            : "info"}/>
                                <Text as="span" fontWeight="semibold">
                                  {risk.name}
                                </Text>
                              </InlineStack>
                              {getSeverityBadge(risk.severity)}
                            </InlineStack>
                            <Text as="p" tone="subdued">
                              {risk.description}
                            </Text>
                            {risk.details && (<Text as="p" variant="bodySm">
                                {risk.details}
                              </Text>)}
                          </BlockStack>
                        </Box>))}
                    </BlockStack>
                  </BlockStack>
                </Card>)}

              {analysisResult && analysisResult.recommendations.length > 0 && (<Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        迁移建议清单
                      </Text>
                      <Badge tone="info">人工分析结果</Badge>
                    </InlineStack>
                    <BlockStack gap="300">
                      {analysisResult.recommendations.map((rec, index) => {
                        // Simple parsing of the recommendation text
                        const lines = rec.split('\n');
                        const titleLine = lines[0] || "";
                        const titleMatch = titleLine.match(/\*\*(.*?)\*\*/);
                        const title = titleMatch ? titleMatch[1] : titleLine.replace(/^[^\w\u4e00-\u9fa5]+/, '');
                        const details = lines.slice(1).map(l => l.trim()).filter(l => l.length > 0);
                        
                        // Extract link if exists
                        const linkLine = details.find(l => l.includes("http"));
                        const urlMatch = linkLine?.match(/(https?:\/\/[^\s]+)/);
                        const url = urlMatch ? urlMatch[1] : null;
                        
                        // Determine action
                        const isInternal = title.includes("Google Analytics") || title.includes("Meta Pixel") || title.includes("TikTok");
                        const isExternal = !!url;

                        // Check if it's the summary checklist
                        if (rec.includes("迁移清单建议")) {
                           return (
                             <Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                               <BlockStack gap="200">
                                 <Text as="h3" variant="headingSm">📋 综合迁移建议</Text>
                                 <List type="number">
                                   {details.map((d, i) => {
                                      const cleanText = d.replace(/^\d+\.\s*/, '').trim();
                                      if (!cleanText) return null;
                                      return <List.Item key={i}>{cleanText}</List.Item>;
                                   })}
                                 </List>
                               </BlockStack>
                             </Box>
                           );
                        }

                        return (
                          <Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                            <BlockStack gap="300">
                              <InlineStack align="space-between" blockAlign="start">
                                <BlockStack gap="100">
                                  <Text as="h3" variant="headingSm">{title}</Text>
                                  {details.map((line, i) => (
                                    <Text key={i} as="p" variant="bodySm" tone="subdued">
                                      {line}
                                    </Text>
                                  ))}
                                </BlockStack>
                                {isInternal && (
                                  <Button url="/app/migrate" size="slim" icon={ArrowRightIcon}>
                                    去配置
                                  </Button>
                                )}
                                {isExternal && !isInternal && (
                                  <Button url={url!} external size="slim" icon={ShareIcon}>
                                    查看应用
                                  </Button>
                                )}
                              </InlineStack>
                            </BlockStack>
                          </Box>
                        );
                      })}
                    </BlockStack>
                    <Divider />
                    <Button url="/app/migrate" variant="primary">
                      前往迁移工具
                    </Button>
                  </BlockStack>
                </Card>)}
            </BlockStack>)}
        </Tabs>

        {/* P0-1: ScriptTag Cleanup Guidance Modal */}
        <Modal
          open={guidanceModalOpen}
          onClose={closeGuidanceModal}
          title={guidanceContent?.title || "ScriptTag 清理指南"}
          primaryAction={{
            content: "我知道了",
            onAction: closeGuidanceModal,
          }}
          secondaryActions={[
            {
              content: "前往迁移工具",
              url: `/app/migrate${guidanceContent?.platform ? `?platform=${guidanceContent.platform}` : ""}`,
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  由于 Shopify 权限限制，应用无法直接删除 ScriptTag。
                  请按照以下步骤手动清理，或等待原创建应用自动处理。
                </Text>
              </Banner>
              
              <BlockStack gap="200">
                <Text as="p" fontWeight="semibold">推荐清理步骤：</Text>
                <List type="number">
                  <List.Item>
                    <Text as="span">
                      <strong>确认 Web Pixel 已启用</strong>：在「迁移」页面确认 Tracking Guardian Pixel 已安装并正常运行
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span">
                      <strong>配置 CAPI 凭证</strong>：在「设置」页面配置相应平台的服务端追踪凭证
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span">
                      <strong>验证追踪正常</strong>：完成一次测试订单，在「监控」页面确认事件已收到
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span">
                      <strong>手动删除 ScriptTag</strong>：前往 Shopify 后台 → 设置 → 应用和销售渠道，找到创建该 ScriptTag 的应用并卸载
                    </Text>
                  </List.Item>
                </List>
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text as="p" fontWeight="semibold">找不到创建应用？</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  如果 ScriptTag 是由已卸载的应用创建的残留数据，您可以：
                </Text>
                <List type="bullet">
                  <List.Item>联系 Shopify 支持，提供 ScriptTag ID: {guidanceContent?.scriptTagId}</List.Item>
                  <List.Item>使用 Shopify GraphQL API 手动删除（需开发者权限）</List.Item>
                  <List.Item>等待 ScriptTag 自动过期（Plus 商家将于 2025-08-28 停止执行，非 Plus 商家将于 2026-08-26 停止执行）</List.Item>
                </List>
              </BlockStack>

              {guidanceContent?.platform && (
                <>
                  <Divider />
                  <Banner tone="success">
                    <Text as="p" variant="bodySm">
                      💡 安装 Tracking Guardian 的 Web Pixel 后，旧的 {guidanceContent.platform} ScriptTag 可以安全删除，
                      因为服务端 CAPI 将接管所有转化追踪功能。
                    </Text>
                  </Banner>
                </>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* WebPixel Delete Confirmation Modal */}
        <Modal
          open={deleteModalOpen}
          onClose={closeDeleteModal}
          title="确认删除"
          primaryAction={{
            content: "确认删除",
            destructive: true,
            onAction: confirmDelete,
            loading: isDeleting,
          }}
          secondaryActions={[
            {
              content: "取消",
              onAction: closeDeleteModal,
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">
                您确定要删除 <strong>{pendingDelete?.title}</strong> 吗？
              </Text>
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  此操作不可撤销。删除后，相关追踪功能将立即停止。
                  请确保您已通过其他方式配置了替代追踪方案。
                </Text>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>);
}
