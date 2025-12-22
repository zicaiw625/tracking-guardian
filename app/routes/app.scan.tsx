import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, useFetcher } from "@remix-run/react";
import { useState, useCallback } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Banner, Box, Divider, ProgressBar, Icon, DataTable, EmptyState, Spinner, Link, Tabs, TextField, Modal, } from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, SearchIcon, ArrowRightIcon, ClipboardIcon, DeleteIcon, RefreshIcon, } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scanShopTracking, getScanHistory, analyzeScriptContent, type ScriptAnalysisResult } from "../services/scanner.server";
import { refreshTypOspStatus } from "../services/checkout-profile.server";
import { getScriptTagDeprecationStatus, getAdditionalScriptsDeprecationStatus, getMigrationUrgencyStatus, getUpgradeStatusMessage, formatDeadlineForUI, type ShopTier, type ShopUpgradeStatus, } from "../utils/deprecation-dates";
import type { ScriptTag, RiskItem } from "../types";
import type { MigrationAction, EnhancedScanResult } from "../services/scanner/types";
import { logger } from "../utils/logger";
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
            };
            migrationActions = generateMigrationActions(enhancedResult);
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
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<{ type: "scriptTag" | "webPixel"; id: string; gid: string; title: string } | null>(null);
    const isScanning = navigation.state === "submitting";
    const isDeleting = deleteFetcher.state === "submitting";
    const isUpgrading = upgradeFetcher.state === "submitting";

    // Handle ScriptTag deletion
    const handleDeleteScriptTag = useCallback((scriptTagId: number, scriptTagGid: string, platform?: string) => {
        setPendingDelete({
            type: "scriptTag",
            id: String(scriptTagId),
            gid: scriptTagGid,
            title: `ScriptTag #${scriptTagId}${platform ? ` (${platform})` : ""}`,
        });
        setDeleteModalOpen(true);
    }, []);

    // Handle WebPixel deletion
    const handleDeleteWebPixel = useCallback((webPixelGid: string, platform?: string) => {
        setPendingDelete({
            type: "webPixel",
            id: webPixelGid,
            gid: webPixelGid,
            title: `WebPixel${platform ? ` (${platform})` : ""}`,
        });
        setDeleteModalOpen(true);
    }, []);

    // Confirm deletion
    const confirmDelete = useCallback(() => {
        if (!pendingDelete) return;

        const formData = new FormData();
        if (pendingDelete.type === "scriptTag") {
            formData.append("scriptTagGid", pendingDelete.gid);
            deleteFetcher.submit(formData, {
                method: "post",
                action: "/app/actions/delete-script-tag",
            });
        } else {
            formData.append("webPixelGid", pendingDelete.gid);
            deleteFetcher.submit(formData, {
                method: "post",
                action: "/app/actions/delete-web-pixel",
            });
        }
        setDeleteModalOpen(false);
        setPendingDelete(null);
    }, [pendingDelete, deleteFetcher]);

    // Close modal
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
        const names: Record<string, string> = {
            google: "Google Ads / GA4",
            meta: "Meta (Facebook) Pixel",
            tiktok: "TikTok Pixel",
            bing: "Microsoft Ads (Bing)",
            clarity: "Microsoft Clarity",
            pinterest: "Pinterest Tag",
            snapchat: "Snapchat Pixel",
            twitter: "Twitter/X Pixel",
        };
        return names[platform] || platform;
    };
    const riskItems = (latestScan?.riskItems as RiskItem[] | null) || [];
    const identifiedPlatforms = (latestScan?.identifiedPlatforms as string[] | null) || [];
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
                <InlineStack align="end">
                  <Button variant="primary" onClick={handleScan} loading={isScanning} icon={SearchIcon}>
                    {isScanning ? "扫描中..." : "开始扫描"}
                  </Button>
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
                        {action.type === "delete_script_tag" && action.scriptTagId && action.scriptTagGid && (
                          <Button 
                            tone="critical" 
                            size="slim" 
                            icon={DeleteIcon}
                            loading={isDeleting && pendingDelete?.gid === action.scriptTagGid}
                            onClick={() => handleDeleteScriptTag(
                              action.scriptTagId!,
                              action.scriptTagGid!,
                              action.platform
                            )}
                          >
                            删除 ScriptTag
                          </Button>
                        )}
                        {action.type === "remove_duplicate" && action.webPixelGid && (
                          <Button 
                            tone="critical" 
                            size="slim" 
                            icon={DeleteIcon}
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
                    <Text as="h2" variant="headingMd">
                      迁移建议
                    </Text>
                    <BlockStack gap="200">
                      {analysisResult.recommendations.map((rec, index) => (<InlineStack key={index} gap="200" align="start">
                          <Icon source={ArrowRightIcon} tone="success"/>
                          <Text as="p">{rec}</Text>
                        </InlineStack>))}
                    </BlockStack>
                    <Divider />
                    <Button url="/app/migrate" variant="primary">
                      前往迁移工具
                    </Button>
                  </BlockStack>
                </Card>)}
            </BlockStack>)}
        </Tabs>

        {/* Delete Confirmation Modal */}
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
                  请确保您已通过 Web Pixel 或其他方式配置了替代追踪方案。
                </Text>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>);
}
