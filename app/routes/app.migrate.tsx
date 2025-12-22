import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState, useEffect } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Banner, Box, Divider, Icon, ProgressBar, Link, List, } from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, SettingsIcon, LockIcon, } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createWebPixel, getExistingWebPixels, isOurWebPixel, needsSettingsUpgrade, } from "../services/migration.server";
import { decryptIngestionSecret, isTokenEncrypted, encryptIngestionSecret } from "../utils/token-encryption";
import { randomBytes } from "crypto";
function generateIngestionSecret(): string {
    return randomBytes(32).toString("hex");
}
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            shopDomain: true,
            ingestionSecret: true,
            webPixelId: true,
        },
    });
    if (!shop) {
        return json({
            shop: null,
            pixelStatus: "not_installed" as const,
            hasCapiConfig: false,
            latestScan: null,
        });
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
    return json({
        shop: { id: shop.id, domain: shopDomain },
        pixelStatus: ourPixel ? "installed" as const : "not_installed" as const,
        pixelId: ourPixel?.id,
        hasCapiConfig,
        latestScan,
        needsSettingsUpgrade: needsUpgrade,
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
        },
    });
    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }
    const formData = await request.formData();
    const actionType = formData.get("_action");
    if (actionType === "enablePixel") {
        let ingestionSecret: string | undefined = undefined;
        if (shop.ingestionSecret) {
            try {
                if (isTokenEncrypted(shop.ingestionSecret)) {
                    ingestionSecret = decryptIngestionSecret(shop.ingestionSecret);
                }
                else {
                    ingestionSecret = shop.ingestionSecret;
                    const encryptedSecret = encryptIngestionSecret(ingestionSecret);
                    await prisma.shop.update({
                        where: { id: shop.id },
                        data: { ingestionSecret: encryptedSecret },
                    });
                    console.log(`[Migration] Migrated unencrypted ingestionSecret for ${shopDomain}`);
                }
            }
            catch (error) {
                console.error(`[Migration] Failed to decrypt ingestionSecret for ${shopDomain}:`, error);
            }
        }
        if (!ingestionSecret) {
            ingestionSecret = generateIngestionSecret();
            const encryptedSecret = encryptIngestionSecret(ingestionSecret);
            await prisma.shop.update({
                where: { id: shop.id },
                data: { ingestionSecret: encryptedSecret },
            });
            console.log(`[Migration] Generated new ingestionSecret for ${shopDomain}`);
        }
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
        let result;
        if (ourPixelId) {
            const { updateWebPixel } = await import("../services/migration.server");
            result = await updateWebPixel(admin, ourPixelId, ingestionSecret, shopDomain);
        }
        else {
            result = await createWebPixel(admin, ingestionSecret, shopDomain);
        }
        if (result.success) {
            const newPixelId = result.webPixelId || ourPixelId;
            if (newPixelId && newPixelId !== shop.webPixelId) {
                await prisma.shop.update({
                    where: { id: shop.id },
                    data: { webPixelId: newPixelId },
                });
                console.log(`[Migration] Stored webPixelId ${newPixelId} for ${shopDomain}`);
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
    return json({ error: "Unknown action" }, { status: 400 });
};
type SetupStep = "pixel" | "capi" | "complete";
export default function MigratePage() {
    const { shop, pixelStatus, hasCapiConfig, latestScan } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const [currentStep, setCurrentStep] = useState<SetupStep>(pixelStatus === "installed"
        ? (hasCapiConfig ? "complete" : "capi")
        : "pixel");
    const isSubmitting = navigation.state === "submitting";
    useEffect(() => {
        const data = actionData as {
            _action?: string;
            success?: boolean;
        } | undefined;
        if (data?._action === "enablePixel" && data?.success) {
            setCurrentStep("capi");
        }
    }, [actionData]);
    useEffect(() => {
        if (pixelStatus === "installed" && hasCapiConfig) {
            setCurrentStep("complete");
        }
        else if (pixelStatus === "installed") {
            setCurrentStep("capi");
        }
    }, [pixelStatus, hasCapiConfig]);
    const handleEnablePixel = () => {
        const formData = new FormData();
        formData.append("_action", "enablePixel");
        submit(formData, { method: "post" });
    };
    const steps = [
        { id: "pixel", label: "启用 App Pixel", number: 1 },
        { id: "capi", label: "配置服务端追踪", number: 2 },
        { id: "complete", label: "完成设置", number: 3 },
    ];
    const currentStepIndex = steps.findIndex((s) => s.id === currentStep);
    const identifiedPlatforms = (latestScan?.identifiedPlatforms as string[]) || [];
    return (<Page title="设置追踪" subtitle="配置服务端转化追踪（Server-side CAPI）">
      <BlockStack gap="500">
        <Banner title="服务端转化追踪 (Server-side CAPI)" tone="info" action={{
            content: "了解更多",
            url: "https://shopify.dev/docs/api/web-pixels-api",
            external: true,
        }}>
          <BlockStack gap="200">
            <Text as="p">
              Tracking Guardian 使用 <strong>服务端 Conversions API</strong> 来发送转化数据。
              这种方式比客户端像素更准确、更隐私友好，并且不受广告拦截器影响。
            </Text>
            <List type="bullet">
              <List.Item>准确率提高 15-30%</List.Item>
              <List.Item>不受 iOS 14+ 隐私限制影响</List.Item>
              <List.Item>符合 GDPR/CCPA 要求</List.Item>
            </List>
          </BlockStack>
        </Banner>

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
            <ProgressBar progress={((currentStepIndex + 1) / steps.length) * 100} tone="primary" size="small"/>
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
            {currentStep === "pixel" && (<Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    第 1 步：启用 App Pixel
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

                  {(() => {
                const data = actionData as {
                    _action?: string;
                    success?: boolean;
                    error?: string;
                    message?: string;
                } | undefined;
                if (data?._action === "enablePixel") {
                    if (data.success) {
                        return (<Banner tone="success">
                            <Text as="p">{data.message}</Text>
                          </Banner>);
                    }
                    else {
                        return (<Banner tone="critical">
                            <Text as="p">启用失败: {data.error}</Text>
                          </Banner>);
                    }
                }
                return null;
            })()}

                  <Button variant="primary" onClick={handleEnablePixel} loading={isSubmitting} size="large">
                    一键启用 App Pixel
                  </Button>
                </BlockStack>
              </Card>)}

            {currentStep === "capi" && (<Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CheckCircleIcon} tone="success"/>
                    <Text as="h2" variant="headingMd">
                      App Pixel 已启用
                    </Text>
                  </InlineStack>

                  <Divider />

                  <Text as="h2" variant="headingMd">
                    第 2 步：配置服务端追踪 (CAPI)
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
                      </List>
                    </BlockStack>
                  </Box>

                  <Banner tone="info">
                    <BlockStack gap="200">
                      <Text as="p">
                        在设置页面配置您需要的平台凭证。您可以同时启用多个平台。
                      </Text>
                    </BlockStack>
                  </Banner>

                  <InlineStack gap="200">
                    <Button variant="primary" url="/app/settings" size="large">
                      前往配置 CAPI 凭证
                    </Button>
                    <Button onClick={() => setCurrentStep("complete")}>
                      稍后配置
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>)}

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
