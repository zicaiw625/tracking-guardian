import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, useRevalidator } from "@remix-run/react";
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useToastContext, EnhancedEmptyState, CardSkeleton } from "~/components/ui";

const PixelMigrationWizard = lazy(() => import("~/components/migrate/PixelMigrationWizard").then(module => ({ default: module.PixelMigrationWizard })));
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Banner, Box, Divider, Icon, ProgressBar, Link, List, } from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, SettingsIcon, LockIcon, } from "~/components/icons";
import { ConfigManagementCard } from "~/components/migrate/ConfigManagementCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createWebPixel, getExistingWebPixels, isOurWebPixel, needsSettingsUpgrade, upgradeWebPixelSettings, updateWebPixel } from "../services/migration.server";
import { decryptIngestionSecret, isTokenEncrypted, encryptIngestionSecret } from "../utils/token-encryption";
import { encryptJson } from "../utils/crypto.server";
import { randomBytes } from "crypto";
import { refreshTypOspStatus } from "../services/checkout-profile.server";
import { logger } from "../utils/logger.server";
import { formatDeadlineForUI, getAdditionalScriptsDeprecationStatus, getMigrationUrgencyStatus, getScriptTagDeprecationStatus, getUpgradeStatusMessage, DEPRECATION_DATES, getDateDisplayLabel, type ShopTier, } from "../utils/deprecation-dates";
import { getPlanDefinition, normalizePlan, isPlanAtLeast } from "../utils/plans";
import { getWizardTemplates } from "../services/pixel-template.server";

function generateIngestionSecret(): string {
    return randomBytes(32).toString("hex");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const url = new URL(request.url);
    const platformParam = url.searchParams.get("platform");
    const assetIdParam = url.searchParams.get("assetId");

    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            ingestionSecret: true,
            webPixelId: true,
            plan: true,
            typOspPagesEnabled: true,
            typOspUpdatedAt: true,
            typOspLastCheckedAt: true,
            typOspStatusReason: true,
            shopTier: true,
        },
    });

    let prefillAsset = null;
    let prefillPlatform = platformParam;
    if (assetIdParam && shop) {
        try {
            prefillAsset = await prisma.auditAsset.findUnique({
                where: { id: assetIdParam },
                select: {
                    id: true,
                    platform: true,
                    category: true,
                    displayName: true,
                    suggestedMigration: true,
                    details: true,
                },
            });

            if (prefillAsset && prefillAsset.platform) {
                prefillPlatform = prefillAsset.platform;
            }
        } catch (error) {
            logger.warn("Failed to load AuditAsset for prefill", { assetId: assetIdParam, error });
        }
    }

    if (!shop) {
        return json({
            shop: null,
            pixelStatus: "not_installed" as const,
            hasCapiConfig: false,
            latestScan: null,
            needsSettingsUpgrade: false,
            currentPixelSettings: null,
            shopTier: "unknown" as const,
            typOspStatus: {
                enabled: false,
                lastChecked: null,
            },
            hasRequiredScopes: false,
            planId: "free" as const,
            planLabel: getPlanDefinition("free").name,
            planTagline: getPlanDefinition("free").tagline,
            deadlines: null,
            upgradeStatus: null,
            migrationUrgency: null,
        });
    }

    let typOspPagesEnabled = shop.typOspPagesEnabled;
    let typOspLastChecked = shop.typOspLastCheckedAt || shop.typOspUpdatedAt;
    const isStale = !typOspLastChecked || (Date.now() - typOspLastChecked.getTime()) > 6 * 60 * 60 * 1000;

    if (isStale) {
        try {
            const result = await refreshTypOspStatus(admin, shop.id);
            typOspPagesEnabled = result.typOspPagesEnabled;
            typOspLastChecked = result.checkedAt;
        } catch (error) {
            logger.error("Failed to refresh TYP/OSP status in migrate loader", error);
        }
    }

    const existingPixels = await getExistingWebPixels(admin);
    const ourPixel = existingPixels.find((p) => {
        if (!p.settings)
            return false;
        try {
            const settings = JSON.parse(p.settings);
            return isOurWebPixel(settings, shopDomain);
        }
        catch {
            return false;
        }
    });
    let needsUpgrade = false;
    if (ourPixel?.settings) {
        try {
            const settings = JSON.parse(ourPixel.settings);
            needsUpgrade = needsSettingsUpgrade(settings);
        }
        catch {
            needsUpgrade = false;
        }
    }
    const hasCapiConfig = await prisma.pixelConfig.count({
        where: {
            shopId: shop.id,
            isActive: true,
            serverSideEnabled: true,
            credentialsEncrypted: { not: null },
        },
    }) > 0;
    const latestScan = await prisma.scanReport.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
    });
    const shopTier = (shop.shopTier as ShopTier) || "unknown";
    const planId = normalizePlan(shop.plan);
    const planDef = getPlanDefinition(planId);
    const scriptTagDeadline = formatDeadlineForUI(getScriptTagDeprecationStatus());
    const additionalScriptsDeadline = formatDeadlineForUI(getAdditionalScriptsDeprecationStatus(shopTier));
    const scriptTags = (latestScan?.scriptTags as { display_scope?: string }[] | null) || [];
    const hasScriptTags = scriptTags.length > 0;
    const hasOrderStatusScriptTags = scriptTags.some((tag) => tag.display_scope === "order_status");
    const migrationUrgency = getMigrationUrgencyStatus(shopTier, hasScriptTags, hasOrderStatusScriptTags);
    const upgradeStatus = getUpgradeStatusMessage({
        tier: shopTier,
        typOspPagesEnabled,
        typOspUpdatedAt: typOspLastChecked || null,
        typOspUnknownReason: shop.typOspStatusReason ?? undefined,
        typOspUnknownError: undefined,
    }, hasScriptTags);

    const hasRequiredScopes = session.scope?.split(",").includes("read_customer_events") || false;

    const templates = await getWizardTemplates(shop.id);

    const { loadWizardDraft } = await import("../services/migration-wizard.server");
    const wizardDraft = await loadWizardDraft(shop.id);

    const pixelConfigs = await prisma.pixelConfig.findMany({
        where: {
            shopId: shop.id,
            isActive: true,
        },
        select: {
            id: true,
            platform: true,
            environment: true,
            configVersion: true,
            previousConfig: true,
            rollbackAllowed: true,
        },
    });

    return json({
        shop: { id: shop.id, domain: shopDomain },
        shopTier,
        pixelStatus: ourPixel ? "installed" as const : "not_installed" as const,
        pixelId: ourPixel?.id,
        hasCapiConfig,
        latestScan,
        needsSettingsUpgrade: needsUpgrade,
        currentPixelSettings: ourPixel?.settings ? JSON.parse(ourPixel.settings) : null,
        typOspStatus: {
            enabled: typOspPagesEnabled ?? false,
            lastChecked: typOspLastChecked ? typOspLastChecked.toISOString() : null,
        },
        hasRequiredScopes,
        planId,
        planLabel: planDef.name,
        planTagline: planDef.tagline,
        deadlines: {
            scriptTag: scriptTagDeadline,
            additionalScripts: additionalScriptsDeadline,
        },
        upgradeStatus,
        migrationUrgency,
        templates,
        wizardDraft,
        pixelConfigs,

        prefillPlatform: prefillPlatform || null,
        prefillAsset: prefillAsset ? {
            id: prefillAsset.id,
            platform: prefillAsset.platform || null,
            category: prefillAsset.category,
            displayName: prefillAsset.displayName || null,
            suggestedMigration: prefillAsset.suggestedMigration,
        } : null,
    });
};
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            ingestionSecret: true,
            webPixelId: true,
            plan: true,
        },
    });
    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }
    const formData = await request.formData();
    const actionType = formData.get("_action");
    if (actionType === "enablePixel" || actionType === "upgradePixelSettings") {
        if (!isPlanAtLeast(shop.plan, "growth")) {
            return json({
                _action: actionType,
                success: false,
                error: "App Pixel 相关操作需 Growth 及以上套餐，请升级后重试。",
            }, { status: 403 });
        }
        let ingestionSecret: string | undefined = undefined;
        if (shop.ingestionSecret) {
            try {
                if (isTokenEncrypted(shop.ingestionSecret)) {
                    ingestionSecret = decryptIngestionSecret(shop.ingestionSecret);
                }
                else {
                    ingestionSecret = shop.ingestionSecret;
                    const encryptedSecret = encryptIngestionSecret(ingestionSecret as string);
                    await prisma.shop.update({
                        where: { id: shop.id },
                        data: { ingestionSecret: encryptedSecret },
                    });
                    logger.info(`[Migration] Migrated unencrypted ingestionSecret for ${shopDomain}`);
                }
            }
            catch (error) {
                logger.error(`[Migration] Failed to decrypt ingestionSecret for ${shopDomain}`, error);
            }
        }
        if (!ingestionSecret) {
            ingestionSecret = generateIngestionSecret();
            const encryptedSecret = encryptIngestionSecret(ingestionSecret);
            await prisma.shop.update({
                where: { id: shop.id },
                data: { ingestionSecret: encryptedSecret },
            });
            logger.info(`[Migration] Generated new ingestionSecret for ${shopDomain}`);
        }

        const finalIngestionSecret: string = ingestionSecret;

        let ourPixelId = shop.webPixelId;

        if (!ourPixelId) {
            const existingPixels = await getExistingWebPixels(admin);
            const ourPixel = existingPixels.find((p) => {
                if (!p.settings)
                    return false;
                try {
                    const settings = JSON.parse(p.settings);
                    return isOurWebPixel(settings, shopDomain);
                }
                catch {
                    return false;
                }
            });
            ourPixelId = ourPixel?.id ?? null;
        }

        if (actionType === "upgradePixelSettings") {
            if (!ourPixelId) {
                return json({
                    _action: "upgradePixelSettings",
                    success: false,
                    error: "未找到 Web Pixel，请先安装 Pixel",
                }, { status: 404 });
            }

            const existingPixels = await getExistingWebPixels(admin);
            const ourPixel = existingPixels.find((p) => p.id === ourPixelId);
            if (!ourPixel) {
                return json({
                    _action: "upgradePixelSettings",
                    success: false,
                    error: "Web Pixel 已不存在",
                }, { status: 404 });
            }

            const currentSettings = ourPixel.settings ? JSON.parse(ourPixel.settings) : {};
            const result = await upgradeWebPixelSettings(
                admin,
                ourPixelId,
                currentSettings,
                shopDomain,
                finalIngestionSecret
            );

            if (result.success) {
                logger.info(`[Migration] Upgraded WebPixel settings for ${shopDomain}`);
                return json({
                    _action: "upgradePixelSettings",
                    success: true,
                    message: "Pixel 设置已升级到最新版本",
                    webPixelId: ourPixelId,
                });
            } else {
                return json({
                    _action: "upgradePixelSettings",
                    success: false,
                    error: result.error,
                    userErrors: result.userErrors,
                });
            }
        }

        let result;
        if (ourPixelId) {
            result = await updateWebPixel(admin, ourPixelId, finalIngestionSecret, shopDomain);
        }
        else {
            result = await createWebPixel(admin, finalIngestionSecret, shopDomain);
        }
        if (result.success) {
            const newPixelId = result.webPixelId || ourPixelId;
            if (newPixelId && newPixelId !== shop.webPixelId) {
                await prisma.shop.update({
                    where: { id: shop.id },
                    data: { webPixelId: newPixelId },
                });
                logger.info(`[Migration] Stored webPixelId ${newPixelId} for ${shopDomain}`);
            }
            return json({
                _action: "enablePixel",
                success: true,
                message: ourPixelId ? "App Pixel 已更新" : "App Pixel 已启用",
                webPixelId: newPixelId,
            });
        }
        else {
            return json({
                _action: "enablePixel",
                success: false,
                error: result.error,
                userErrors: result.userErrors,
            });
        }
    }
    if (actionType === "saveWizardConfigs") {
        const configsJson = formData.get("configs") as string;

        if (!configsJson) {
            return json({ error: "缺少配置数据" }, { status: 400 });
        }

        try {
            const configs = JSON.parse(configsJson) as Array<{
                platform: string;
                platformId: string;
                credentials: Record<string, string>;
                eventMappings: Record<string, string>;
                environment: "test" | "live";
            }>;

            for (const config of configs) {
                const platform = config.platform as "google" | "meta" | "tiktok" | "pinterest";

                let credentials: Record<string, string> = {};
                if (platform === "google") {
                    credentials = {
                        measurementId: config.credentials.measurementId || "",
                        apiSecret: config.credentials.apiSecret || "",
                    };
                } else {
                    credentials = {
                        pixelId: config.credentials.pixelId || "",
                        accessToken: config.credentials.accessToken || "",
                        ...(config.credentials.testEventCode && { testEventCode: config.credentials.testEventCode }),
                    };
                }

                const encryptedCredentials = encryptJson(credentials);

                await prisma.pixelConfig.upsert({
                    where: {
                        shopId_platform: {
                            shopId: shop.id,
                            platform,
                        },
                    },
                    update: {
                        platformId: config.platformId,
                        credentialsEncrypted: encryptedCredentials,
                        serverSideEnabled: true,
                        eventMappings: config.eventMappings as object,
                        environment: config.environment,
                        migrationStatus: "in_progress",
                    },
                    create: {
                        shopId: shop.id,
                        platform,
                        platformId: config.platformId,
                        credentialsEncrypted: encryptedCredentials,
                        serverSideEnabled: true,
                        eventMappings: config.eventMappings as object,
                        environment: config.environment,
                        migrationStatus: "in_progress",
                    },
                });
            }

            return json({
                success: true,
                _action: "saveWizardConfigs",
                message: `已成功配置 ${configs.length} 个平台`,
            });
        } catch (error) {
            logger.error("Failed to save wizard configs", error);
            return json({
                error: error instanceof Error ? error.message : "保存配置失败",
            }, { status: 500 });
        }
    }

    if (actionType === "validateTestEnvironment") {
        const platform = formData.get("platform") as string;
        const shopIdParam = formData.get("shopId") as string;

        if (!platform || !shopIdParam) {
            return json({
                valid: false,
                message: "缺少必要参数",
            }, { status: 400 });
        }

        try {
            const { validateTestEnvironment } = await import("../services/migration-wizard.server");
            const result = await validateTestEnvironment(shopIdParam, platform as "google" | "meta" | "tiktok" | "pinterest");
            return json(result);
        } catch (error) {
            logger.error("Failed to validate test environment", error);
            return json({
                valid: false,
                message: error instanceof Error ? error.message : "验证失败",
            }, { status: 500 });
        }
    }

    if (actionType === "saveWizardDraft") {
        const draftJson = formData.get("draft") as string;
        if (!draftJson) {
            return json({ success: false, error: "缺少草稿数据" }, { status: 400 });
        }

        try {
            const draft = JSON.parse(draftJson);
            const { saveWizardDraft } = await import("../services/migration-wizard.server");
            const result = await saveWizardDraft(shop.id, draft);
            return json(result);
        } catch (error) {
            logger.error("Failed to save wizard draft", error);
            return json({
                success: false,
                error: error instanceof Error ? error.message : "保存草稿失败",
            }, { status: 500 });
        }
    }

    if (actionType === "clearWizardDraft") {
        try {
            const { clearWizardDraft } = await import("../services/migration-wizard.server");
            const result = await clearWizardDraft(shop.id);
            return json(result);
        } catch (error) {
            logger.error("Failed to clear wizard draft", error);
            return json({ success: false }, { status: 500 });
        }
    }

    if (actionType === "getConfigVersionHistory") {
        try {
            const platform = formData.get("platform") as string;
            if (!platform) {
                return json({ success: false, error: "缺少平台参数" }, { status: 400 });
            }

            const { getConfigVersionHistory } = await import("../services/pixel-config-version.server");
            const history = await getConfigVersionHistory(shop.id, platform as any);

            if (!history) {
                return json({ success: false, error: "配置不存在" }, { status: 404 });
            }

            return json({ success: true, history });
        } catch (error) {
            logger.error("Failed to get config version history", error);
            return json({
                success: false,
                error: error instanceof Error ? error.message : "获取版本历史失败",
            }, { status: 500 });
        }
    }

    if (actionType === "rollbackConfig") {
        try {
            const platform = formData.get("platform") as string;
            if (!platform) {
                return json({ success: false, error: "缺少平台参数" }, { status: 400 });
            }

            const { rollbackConfig } = await import("../services/pixel-config-version.server");
            const result = await rollbackConfig(shop.id, platform as any);

            return json(result);
        } catch (error) {
            logger.error("Failed to rollback config", error);
            return json({
                success: false,
                error: error instanceof Error ? error.message : "回滚失败",
            }, { status: 500 });
        }
    }

    if (actionType === "switchEnvironment") {
        const platform = formData.get("platform") as string;
        const environment = formData.get("environment") as "test" | "live";

        if (!platform || !environment) {
            return json({ success: false, error: "缺少必要参数" }, { status: 400 });
        }

        try {
            const { switchEnvironment } = await import("../services/pixel-rollback.server");
            const result = await switchEnvironment(shop.id, platform, environment);

            if (result.success) {
                logger.info(`[Migration] Switched environment for ${platform} to ${environment}`, {
                    shopId: shop.id,
                    platform,
                    environment,
                });
            }

            return json({
                success: result.success,
                message: result.message,
                previousEnvironment: result.previousEnvironment,
                newEnvironment: result.newEnvironment,
            });
        } catch (error) {
            logger.error("Failed to switch environment", error);
            return json({
                success: false,
                error: error instanceof Error ? error.message : "环境切换失败",
            }, { status: 500 });
        }
    }

    if (actionType === "rollbackConfig") {
        const platform = formData.get("platform") as string;

        if (!platform) {
            return json({ success: false, error: "缺少平台参数" }, { status: 400 });
        }

        try {
            const { rollbackConfig } = await import("../services/pixel-rollback.server");
            const result = await rollbackConfig(shop.id, platform);

            if (result.success) {
                logger.info(`[Migration] Rolled back config for ${platform}`, {
                    shopId: shop.id,
                    platform,
                    previousVersion: result.previousVersion,
                    currentVersion: result.currentVersion,
                });
            }

            return json({
                success: result.success,
                message: result.message,
                previousVersion: result.previousVersion,
                currentVersion: result.currentVersion,
            });
        } catch (error) {
            logger.error("Failed to rollback config", error);
            return json({
                success: false,
                error: error instanceof Error ? error.message : "回滚失败",
            }, { status: 500 });
        }
    }

    return json({ error: "Unknown action" }, { status: 400 });
};

type SetupStep = "typOsp" | "pixel" | "capi" | "complete";

interface TimelineItem {
    id: string;
    title: string;
    badge: {
        tone: "critical" | "warning" | "attention" | "success";
        text: string;
    };
    description: string;
}
export default function MigratePage() {
    const { shop, pixelStatus, hasCapiConfig, latestScan, needsSettingsUpgrade, typOspStatus, hasRequiredScopes, deadlines, upgradeStatus, migrationUrgency, shopTier, planId, planLabel, planTagline, templates, wizardDraft, pixelConfigs, prefillPlatform, prefillAsset, } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const { showSuccess, showError } = useToastContext();
    const isGrowthOrAbove = isPlanAtLeast(planId, "growth");
    const isProOrAbove = isPlanAtLeast(planId, "pro");
    const isAgency = isPlanAtLeast(planId, "agency");
    const [currentStep, setCurrentStep] = useState<SetupStep>(() => {
        if (!typOspStatus.enabled) return "typOsp";
        if (pixelStatus === "installed") {
            return hasCapiConfig ? "complete" : "capi";
        }
        return "pixel";
    });
    const [showWizard, setShowWizard] = useState(false);
    const revalidator = useRevalidator();
    const isSubmitting = navigation.state === "submitting";

    const handleUpgradeSettings = () => {
        const formData = new FormData();
        formData.append("_action", "upgradePixelSettings");
        submit(formData, { method: "post" });
    };

    useEffect(() => {
        const data = actionData as {
            _action?: string;
            success?: boolean;
            message?: string;
            error?: string;
        } | undefined;

        if (data?._action === "enablePixel") {
            if (data?.success) {
                showSuccess(data?.message || "App Pixel 已启用");
                setCurrentStep("capi");
                return;
            } else if (data?.error) {
                showError(data.error);
                return;
            }
        } else if (data?._action === "upgradePixelSettings") {
            if (data?.success) {
                showSuccess(data?.message || "Pixel 设置已升级");
            } else if (data?.error) {
                showError(data.error);
            }

            return;
        } else if (data?._action === "saveWizardConfigs") {
            if (data?.success) {
                showSuccess(data?.message || "配置已保存");
                setShowWizard(false);
                revalidator.revalidate();
                setCurrentStep("complete");

                setTimeout(() => {
                    window.location.href = "/app/verification";
                }, 2000);
                return;
            } else if (data?.error) {
                showError(data.error);
                return;
            }
        }

        if (pixelStatus === "installed" && hasCapiConfig && typOspStatus.enabled) {
            setCurrentStep("complete");
        } else if (pixelStatus === "installed") {
            setCurrentStep("capi");
        } else if (!typOspStatus.enabled) {
            setCurrentStep("typOsp");
        } else {
            setCurrentStep("pixel");
        }
    }, [actionData, pixelStatus, hasCapiConfig, typOspStatus.enabled, showSuccess, showError, revalidator]);

    const handleEnablePixel = () => {
        if (!isGrowthOrAbove) {
            return;
        }
        const formData = new FormData();
        formData.append("_action", "enablePixel");
        submit(formData, { method: "post" });
    };

    const handleWizardComplete = () => {
        revalidator.revalidate();
        setShowWizard(false);
        setCurrentStep("complete");

        setTimeout(() => {
            window.location.href = "/app/verification";
        }, 1000);
    };
    const steps = [
        { id: "typOsp", label: "升级 Checkout", number: 1 },
        { id: "pixel", label: "启用 App Pixel", number: 2 },
        { id: "capi", label: "配置服务端追踪", number: 3 },
        { id: "complete", label: "完成设置", number: 4 },
    ];

    const stepIndex = steps.findIndex((s) => s.id === currentStep);
    if (stepIndex === -1) {
        console.error(`[MigratePage] Invalid currentStep: ${currentStep}. Available steps:`, steps.map(s => s.id));
    }
    const currentStepIndex = Math.max(0, stepIndex);
    const identifiedPlatforms = (latestScan?.identifiedPlatforms as string[]) || [];

    const timelineItems: TimelineItem[] = deadlines && deadlines.scriptTag && deadlines.additionalScripts ? [
        {
            id: "scriptTag",
            title: "ScriptTag 创建限制",
            badge: deadlines.scriptTag.badge,
            description: deadlines.scriptTag.description,
        },
        {
            id: "additionalScripts",
            title: "Additional Scripts 只读",
            badge: deadlines.additionalScripts.badge,
            description: deadlines.additionalScripts.description,
        },
    ] : [];
    const migrationUrgencyActions = migrationUrgency?.actions ?? [];

    const migrationSuggestionText = useMemo(() => {
        if (shopTier === "plus") {
            const deadlineDate = getDateDisplayLabel(DEPRECATION_DATES.plusAdditionalScriptsReadOnly, "exact");
            const autoUpgradeDate = getDateDisplayLabel(DEPRECATION_DATES.plusAutoUpgradeStart, "month");
            return `Plus 商家建议在 ${deadlineDate} 前完成迁移；${autoUpgradeDate}起 Shopify 将逐步自动升级。`;
        } else {
            const deadlineDate = getDateDisplayLabel(DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly, "exact");
            return `非 Plus 商家建议在 ${deadlineDate} 前完成迁移，以确保 Thank you / Order status 页追踪不受影响。`;
        }
    }, [shopTier]);

    if (!shop) {
      return (
        <Page title="设置追踪" subtitle="配置服务端转化追踪（Server-side CAPI）">
          <EnhancedEmptyState
            icon="⚠️"
            title="店铺信息未找到"
            description="未找到店铺信息，请重新安装应用。"
            primaryAction={{
              content: "返回首页",
              url: "/app",
            }}
          />
        </Page>
      );
    }

    return (<Page title="设置追踪" subtitle="配置服务端转化追踪（Server-side CAPI）">
      <BlockStack gap="500">
        {upgradeStatus && (<Banner title={upgradeStatus.title} tone={upgradeStatus.urgency === "critical"
            ? "critical"
            : upgradeStatus.urgency === "high"
                ? "warning"
                : upgradeStatus.urgency === "resolved"
                    ? "success"
                    : "info"}>
            <BlockStack gap="200">
              <Text as="p">{upgradeStatus.message}</Text>
              {upgradeStatus.actions.length > 0 && (<List type="bullet">
                  {upgradeStatus.actions.map((item, idx) => (<List.Item key={idx}>{item}</List.Item>))}
                </List>)}
              {upgradeStatus.autoUpgradeInfo?.isInAutoUpgradeWindow && (<Text as="p" tone="caution" variant="bodySm">
                  {upgradeStatus.autoUpgradeInfo.autoUpgradeMessage}
                </Text>)}
            </BlockStack>
          </Banner>)}

        <Banner title="服务端转化追踪 (Server-side CAPI)" tone="info" action={{
            content: "了解更多",
            url: "https://help.shopify.com",
            external: true,
        }}>
          <BlockStack gap="200">
            <Text as="p">
              Tracking Guardian 使用 <strong>服务端 Conversions API</strong> 来发送转化数据。
              这种方式比客户端像素更准确、更隐私友好，并且不受广告拦截器影响。
            </Text>
            <List type="bullet">
              <List.Item>降低广告拦截器影响，提高追踪一致性</List.Item>
              <List.Item>不受 iOS 14+ 隐私限制影响</List.Item>
              <List.Item>符合 GDPR/CCPA 要求</List.Item>
            </List>
          </BlockStack>
        </Banner>

        <Banner
          title={`当前套餐：${planLabel || planId}`}
          tone={isGrowthOrAbove ? "success" : "warning"}
          action={{
            content: "查看套餐/升级",
            url: "/app/settings?tab=subscription",
          }}
        >
          <BlockStack gap="200">
            {planTagline && (
              <Text as="p" variant="bodySm">{planTagline}</Text>
            )}
            {!isGrowthOrAbove && (
              <List type="bullet">
                <List.Item>像素迁移中心（App Pixel + CAPI 向导）在 Growth 及以上开放</List.Item>
                <List.Item>高级 TY/OS 组件、事件对账与多渠道像素需 Pro 及以上</List.Item>
                <List.Item>多店铺/白标报告在 Agency 套餐提供</List.Item>
              </List>
            )}
            {isGrowthOrAbove && !isProOrAbove && (
              <List type="bullet">
                <List.Item>当前可用：App Pixel + 单/双渠道 CAPI 迁移</List.Item>
                <List.Item>升级到 Pro 以解锁事件对账、告警与高级 TY/OS 模块</List.Item>
              </List>
            )}
            {isProOrAbove && !isAgency && (
              <List type="bullet">
                <List.Item>已解锁多渠道像素 + 事件对账 + TY/OS 高级组件</List.Item>
                <List.Item>如需多店铺协作/白标报告，可升级至 Agency</List.Item>
              </List>
            )}
            {isAgency && (
              <List type="bullet">
                <List.Item>已解锁多店铺、协作与白标报告</List.Item>
                <List.Item>如需迁移托管，可在支持渠道提交工单</List.Item>
              </List>
            )}
          </BlockStack>
        </Banner>

        {!hasRequiredScopes && (
          <Banner
            title="需更新授权"
            tone="critical"
            action={{
              content: "更新授权",
              url: "/auth/login",
              external: false,
            }}
          >
            <BlockStack gap="200">
              <Text as="p">
                应用权限已更新（新增 read_customer_events），请重新授权以确保 Pixel 正常工作。
              </Text>
            </BlockStack>
          </Banner>
        )}

        {}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">⏰ Shopify 追踪升级时间线</Text>
              {migrationUrgency && (<Badge tone={migrationUrgency.urgency === "critical"
                ? "critical"
                : migrationUrgency.urgency === "high"
                    ? "warning"
                    : "info"}>
                  {migrationUrgency.urgency === "critical"
                ? "紧急"
                : migrationUrgency.urgency === "high"
                    ? "高优先级"
                    : "提示"}
                </Badge>)}
            </InlineStack>
            <BlockStack gap="200">
              {timelineItems.length > 0 ? timelineItems.map((item) => (<Box key={item.id} background="bg-surface-secondary" padding="300" borderRadius="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" fontWeight="semibold">{item.title}</Text>
                    {item.badge && (<Badge tone={item.badge.tone}>{item.badge.text}</Badge>)}
                  </InlineStack>
                  {item.description && (<Text as="p" variant="bodySm" tone="subdued">
                      {item.description}
                    </Text>)}
                </Box>)) : (<Text as="p" tone="subdued" variant="bodySm">
                  当前无法加载截止日期，请稍后重试或刷新页面。
                </Text>)}
              {migrationUrgency?.primaryMessage && (<Text as="p" variant="bodySm">
                  {migrationUrgency.primaryMessage}
                </Text>)}
              {migrationUrgencyActions.length > 0 && (<List type="bullet">
                  {migrationUrgencyActions.map((action, idx) => (<List.Item key={idx}>{action}</List.Item>))}
                </List>)}
              <Text as="p" tone="subdued">
                {migrationSuggestionText}
              </Text>
            </BlockStack>
          </BlockStack>
        </Card>

        {}
        {needsSettingsUpgrade && pixelStatus === "installed" && (
          <Banner
            title="Pixel 设置需要升级"
            tone="warning"
            action={{
              content: "一键升级设置",
              onAction: handleUpgradeSettings,
              loading: isSubmitting,
            }}
          >
            <BlockStack gap="200">
              <Text as="p">
                检测到您的 App Pixel 使用旧版配置格式（缺少 shop_domain 或使用旧键名 ingestion_secret）。
                请点击「一键升级设置」来更新到最新版本，以确保追踪功能正常工作。
              </Text>
              {}
            </BlockStack>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              {steps.map((step, index) => (<InlineStack key={step.id} gap="400" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Box background={index < currentStepIndex
                ? "bg-fill-success"
                : index === currentStepIndex
                    ? "bg-fill-info"
                    : "bg-surface-secondary"} padding="200" borderRadius="full" minWidth="32px" minHeight="32px">
                      <Text as="span" variant="bodySm" fontWeight="bold" alignment="center">
                        {index < currentStepIndex ? "✓" : step.number}
                      </Text>
                    </Box>
                    <Text as="span" fontWeight={index === currentStepIndex ? "bold" : "regular"} tone={index <= currentStepIndex ? undefined : "subdued"}>
                      {step.label}
                    </Text>
                  </InlineStack>
                  {index < steps.length - 1 && (<Box background={index < currentStepIndex ? "bg-fill-success" : "bg-surface-secondary"} minWidth="60px" minHeight="2px"/>)}
                </InlineStack>))}
            </InlineStack>
            {

}
            <ProgressBar
                progress={
                    currentStep === "complete"
                        ? 100
                        : (currentStepIndex / steps.length) * 100
                }
                tone="primary"
                size="small"
            />
          </BlockStack>
        </Card>

        {identifiedPlatforms.length > 0 && currentStep === "pixel" && (<Banner tone="warning" title="检测到旧版追踪代码">
            <BlockStack gap="200">
              <Text as="p">
                扫描发现您的店铺可能有旧版追踪脚本。启用服务端追踪后，建议删除这些旧代码以避免重复追踪：
              </Text>
              <InlineStack gap="200">
                {identifiedPlatforms.map((platform) => (<Badge key={platform} tone="attention">
                    {platform}
                  </Badge>))}
              </InlineStack>
              <Link url="/app/scan">运行扫描查看详情</Link>
            </BlockStack>
          </Banner>)}

        <Layout>
          <Layout.Section>
            {currentStep === "typOsp" && (<Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    第 1 步：升级 Checkout Extensibility
                  </Text>

                  <Banner tone="warning" title="需要升级结账页面">
                    <BlockStack gap="200">
                      <Text as="p">
                        检测到您的店铺尚未完全启用 Checkout Extensibility（Thank You / Order Status 页面）。
                        Shopify 将于 2025 年 8 月 28 日起停止支持旧版脚本。
                      </Text>
                    </BlockStack>
                  </Banner>

                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">为什么需要升级？</Text>
                    <List type="bullet">
                      <List.Item>旧版 additional scripts 将变为只读或失效</List.Item>
                      <List.Item>Web Pixel 需要在新版结账页面才能获得最佳支持</List.Item>
                      <List.Item>确保数据追踪的连续性和准确性</List.Item>
                    </List>
                  </BlockStack>

                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">如何升级：</Text>
                      <List type="number">
                        <List.Item>点击下方按钮前往 <strong>Shopify 后台 → 设置 → 结账</strong></List.Item>
                        <List.Item>查找 <strong>&ldquo;Upgrade to Checkout Extensibility&rdquo;</strong> 或类似横幅</List.Item>
                        <List.Item>按照提示创建并发布新的 Checkout Profile</List.Item>
                      </List>
                    </BlockStack>
                  </Box>

                  <InlineStack gap="200">
                    <Button variant="primary" url={`https:
                      前往 Shopify 后台升级
                    </Button>
                    <Button onClick={() => window.location.reload()}>
                      已完成升级，刷新状态
                    </Button>
                    <Button onClick={() => setCurrentStep("pixel")} variant="tertiary">
                      跳过（仅供测试）
                    </Button>
                  </InlineStack>

                  <Text as="p" tone="subdued" variant="bodySm">
                    如果您确认已升级但此处仍显示未完成，可能是 Shopify API 数据延迟（通常需几分钟）。您可以点击刷新或先跳过此步骤。
                  </Text>
                </BlockStack>
              </Card>)}

            {currentStep === "pixel" && (<Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    第 2 步：启用 App Pixel
                  </Text>

                  <Text as="p" tone="subdued">
                    App Pixel 是一个轻量级的追踪组件，仅在顾客完成结账时触发。
                    它不会收集浏览历史或个人信息，完全符合隐私要求。
                  </Text>

                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center">
                        <Icon source={LockIcon} tone="success"/>
                        <Text as="span" fontWeight="semibold">隐私保护</Text>
                      </InlineStack>
                      <List type="bullet">
                        <List.Item>仅追踪 checkout_completed 事件</List.Item>
                        <List.Item>不收集浏览历史或个人行为</List.Item>
                        <List.Item>遵守 Shopify Customer Privacy API</List.Item>
                        <List.Item>不传输可识别个人身份信息（PII）</List.Item>
                      </List>
                    </BlockStack>
                  </Box>

                  {}

                  {!isGrowthOrAbove && (
                    <Banner
                      tone="warning"
                      action={{ content: "升级至 Growth", url: "/app/settings?tab=subscription" }}
                    >
                      <Text as="p">
                        App Pixel 启用与 CAPI 迁移在 Growth 及以上套餐开放。请升级后继续。
                      </Text>
                    </Banner>
                  )}

                  <Button
                    variant="primary"
                    onClick={handleEnablePixel}
                    loading={isSubmitting}
                    size="large"
                    disabled={!isGrowthOrAbove}
                  >
                    一键启用 App Pixel
                  </Button>
                </BlockStack>
              </Card>)}

            {currentStep === "capi" && (
              <>
                {!showWizard ? (
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack gap="200" blockAlign="center">
                        <Icon source={CheckCircleIcon} tone="success"/>
                        <Text as="h2" variant="headingMd">
                          App Pixel 已启用
                        </Text>
                      </InlineStack>

                      <Divider />

                      <Text as="h2" variant="headingMd">
                        第 3 步：配置服务端追踪 (CAPI)
                      </Text>

                      <Text as="p" tone="subdued">
                        配置广告平台的 Conversions API 凭证，让 Tracking Guardian 自动发送转化数据。
                      </Text>

                      <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                        <BlockStack gap="300">
                          <Text as="span" fontWeight="semibold">支持的平台：</Text>
                          <List type="bullet">
                            <List.Item>Google Analytics 4 (Measurement Protocol)</List.Item>
                            <List.Item>Meta Conversions API (Facebook CAPI)</List.Item>
                            <List.Item>TikTok Events API</List.Item>
                            <List.Item>Pinterest Conversions API</List.Item>
                          </List>
                        </BlockStack>
                      </Box>

                      <Banner tone="info">
                        <BlockStack gap="200">
                          <Text as="p">
                            使用向导可以快速配置多个平台，或前往设置页面手动配置。
                          </Text>
                        </BlockStack>
                      </Banner>

                      {!isProOrAbove && (
                        <Banner
                          tone="warning"
                          action={{ content: "升级至 Pro", url: "/app/settings?tab=subscription" }}
                        >
                          <Text as="p">
                            事件对账与多渠道 CAPI 配置在 Pro 及以上开放。请升级以继续配置凭证。
                          </Text>
                        </Banner>
                      )}

                      <InlineStack gap="200">
                        <Button
                          variant="primary"
                          size="large"
                          disabled={!isProOrAbove}
                          onClick={() => setShowWizard(true)}
                        >
                          使用向导配置
                        </Button>
                        <Button url="/app/settings" size="large" disabled={!isProOrAbove}>
                          前往设置页面
                        </Button>
                        <Button onClick={() => setCurrentStep("complete")} disabled={!isProOrAbove}>
                          稍后配置
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                ) : (
                  <Suspense fallback={<CardSkeleton lines={5} />}>
                    <PixelMigrationWizard
                      pixelConfigs={pixelConfigs}
                      onComplete={handleWizardComplete}
                      onCancel={() => setShowWizard(false)}
                      shopId={shop?.id}
                      initialPlatforms={
                        prefillPlatform
                          ? [prefillPlatform as "google" | "meta" | "tiktok" | "pinterest"].filter((p): p is "google" | "meta" | "tiktok" | "pinterest" =>
                              ["google", "meta", "tiktok", "pinterest"].includes(p)
                            )
                          : identifiedPlatforms.filter((p): p is "google" | "meta" | "tiktok" | "pinterest" =>
                              ["google", "meta", "tiktok", "pinterest"].includes(p)
                            )
                      }
                      canManageMultiple={isAgency}
                      templates={templates}
                      wizardDraft={wizardDraft}
                      prefillAsset={prefillAsset}
                    />
                  </Suspense>
                )}
              </>
            )}

            {currentStep === "complete" && (<Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CheckCircleIcon} tone="success"/>
                    <Text as="h2" variant="headingMd">
                      设置完成！
                    </Text>
                  </InlineStack>

                  <Banner tone="success">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">
                        Tracking Guardian 已开始追踪您的转化数据
                      </Text>
                      <Text as="p">
                        当顾客完成订单后，转化事件将自动发送到您配置的广告平台。
                      </Text>
                    </BlockStack>
                  </Banner>

                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="300">
                      <Text as="span" fontWeight="semibold">当前状态：</Text>
                      <InlineStack gap="400">
                        <InlineStack gap="100" blockAlign="center">
                          <Icon source={CheckCircleIcon} tone="success"/>
                          <Text as="span">App Pixel 已启用</Text>
                        </InlineStack>
                        {hasCapiConfig ? (<InlineStack gap="100" blockAlign="center">
                            <Icon source={CheckCircleIcon} tone="success"/>
                            <Text as="span">CAPI 已配置</Text>
                          </InlineStack>) : (<InlineStack gap="100" blockAlign="center">
                            <Icon source={AlertCircleIcon} tone="caution"/>
                            <Text as="span">CAPI 未配置</Text>
                          </InlineStack>)}
                      </InlineStack>
                    </BlockStack>
                  </Box>

                  <Divider />

                  <Text as="h3" variant="headingSm">
                    下一步建议：
                  </Text>
                  <List type="bullet">
                    <List.Item>在监控面板查看实时转化数据</List.Item>
                    <List.Item>创建测试订单验证追踪是否正常</List.Item>
                    <List.Item>如有旧版追踪代码，建议在 Shopify 后台手动删除以避免重复计数</List.Item>
                  </List>

                  <InlineStack gap="200">
                    <Button variant="primary" url="/app/monitor">
                      前往监控面板
                    </Button>
                    <Button url="/app/settings">
                      管理 CAPI 设置
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>)}
          </Layout.Section>

          <Layout.Section variant="oneThird">
            {pixelConfigs && pixelConfigs.length > 0 && (
              <ConfigManagementCard
                pixelConfigs={pixelConfigs}
                shopId={shop?.id || ""}
              />
            )}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={SettingsIcon} tone="base"/>
                  <Text as="h2" variant="headingMd">
                    工作原理
                  </Text>
                </InlineStack>

                <BlockStack gap="300">
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="span" fontWeight="semibold">1. 顾客完成结账</Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        App Pixel 检测到 checkout_completed 事件
                      </Text>
                    </BlockStack>
                  </Box>

                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="span" fontWeight="semibold">2. 服务端接收 Webhook</Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        Shopify 发送 orders/paid webhook 到我们的服务器
                      </Text>
                    </BlockStack>
                  </Box>

                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="span" fontWeight="semibold">3. 发送 CAPI 转化</Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        服务器发送订单金额和商品信息到广告平台
                      </Text>
                    </BlockStack>
                  </Box>
                </BlockStack>

                <Divider />

                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">为什么使用服务端追踪？</Text>
                  <List type="bullet">
                    <List.Item>绕过广告拦截器和浏览器限制</List.Item>
                    <List.Item>更可靠的转化归因</List.Item>
                    <List.Item>更好的隐私合规性（数据最小化）</List.Item>
                    <List.Item>更稳定的追踪准确性</List.Item>
                  </List>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>);
}
