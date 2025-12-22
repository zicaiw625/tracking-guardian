// Server-side tracking settings tab component
import { 
    Layout, 
    Card, 
    Text, 
    BlockStack, 
    InlineStack, 
    Button, 
    TextField, 
    Select, 
    Checkbox, 
    Divider, 
    Banner, 
    Badge, 
    Box 
} from "@shopify/polaris";
import type { PixelConfigDisplay, TokenIssues } from "./types";

interface ServerSideTabProps {
    pixelConfigs: PixelConfigDisplay[] | undefined;
    tokenIssues: TokenIssues;
    serverPlatform: string;
    setServerPlatform: (value: string) => void;
    serverEnabled: boolean;
    setServerEnabled: (value: boolean) => void;
    metaPixelId: string;
    setMetaPixelId: (value: string) => void;
    metaAccessToken: string;
    setMetaAccessToken: (value: string) => void;
    metaTestCode: string;
    setMetaTestCode: (value: string) => void;
    googleMeasurementId: string;
    setGoogleMeasurementId: (value: string) => void;
    googleApiSecret: string;
    setGoogleApiSecret: (value: string) => void;
    tiktokPixelId: string;
    setTiktokPixelId: (value: string) => void;
    tiktokAccessToken: string;
    setTiktokAccessToken: (value: string) => void;
    serverFormDirty: boolean;
    isSubmitting: boolean;
    onSave: () => void;
    onTestConnection: () => void;
}

export function ServerSideTab({
    pixelConfigs,
    tokenIssues,
    serverPlatform,
    setServerPlatform,
    serverEnabled,
    setServerEnabled,
    metaPixelId,
    setMetaPixelId,
    metaAccessToken,
    setMetaAccessToken,
    metaTestCode,
    setMetaTestCode,
    googleMeasurementId,
    setGoogleMeasurementId,
    googleApiSecret,
    setGoogleApiSecret,
    tiktokPixelId,
    setTiktokPixelId,
    tiktokAccessToken,
    setTiktokAccessToken,
    serverFormDirty,
    isSubmitting,
    onSave,
    onTestConnection,
}: ServerSideTabProps) {
    return (
        <Layout>
            <Layout.Section>
                <Card>
                    <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                            服务端转化追踪（Conversions API）
                        </Text>

                        {tokenIssues.hasIssues && (
                            <Banner
                                title="需要重新授权"
                                tone="critical"
                                action={{
                                    content: "查看详情",
                                    onAction: () => {
                                        const platform = tokenIssues.affectedPlatforms[0];
                                        if (platform) setServerPlatform(platform);
                                    },
                                }}
                            >
                                <p>
                                    以下平台的访问令牌已过期或无效，请重新配置：
                                    <strong> {tokenIssues.affectedPlatforms.join(", ")}</strong>
                                </p>
                            </Banner>
                        )}

                        <Banner tone="info">
                            <p>
                                服务端追踪通过 Shopify Webhooks 直接将转化数据发送到广告平台，
                                不受浏览器隐私设置和广告拦截器的影响，可显著提高追踪准确性。
                            </p>
                        </Banner>

                        <Divider />

                        <Select
                            label="选择平台"
                            options={[
                                { label: "Meta Conversions API（CAPI）", value: "meta" },
                                { label: "Google GA4 Measurement Protocol", value: "google" },
                                { label: "TikTok Events API", value: "tiktok" },
                            ]}
                            value={serverPlatform}
                            onChange={setServerPlatform}
                        />

                        {serverPlatform === "meta" && (
                            <>
                                <TextField
                                    label="Pixel ID"
                                    value={metaPixelId}
                                    onChange={setMetaPixelId}
                                    autoComplete="off"
                                    placeholder="1234567890123456"
                                />
                                <TextField
                                    label="Access Token"
                                    type="password"
                                    value={metaAccessToken}
                                    onChange={setMetaAccessToken}
                                    autoComplete="off"
                                    helpText="在 Meta Events Manager 中生成系统用户访问令牌"
                                />
                                <TextField
                                    label="Test Event Code (可选)"
                                    value={metaTestCode}
                                    onChange={setMetaTestCode}
                                    autoComplete="off"
                                    helpText="用于测试模式，生产环境请留空"
                                />
                            </>
                        )}

                        {serverPlatform === "google" && (
                            <>
                                <Banner tone="info">
                                    <p>
                                        <strong>GA4 Measurement Protocol</strong> 是推荐的服务端追踪方式。
                                        Google Ads 可以从 GA4 导入转化数据进行归因优化。
                                    </p>
                                </Banner>
                                <TextField
                                    label="Measurement ID"
                                    value={googleMeasurementId}
                                    onChange={setGoogleMeasurementId}
                                    autoComplete="off"
                                    placeholder="G-XXXXXXXXXX"
                                    helpText="GA4 媒体资源的 Measurement ID（格式：G-XXXXXXXXXX）。在 GA4 管理后台 > 数据流中找到"
                                    error={googleMeasurementId && !googleMeasurementId.match(/^G-[A-Z0-9]+$/i)
                                        ? "格式应为 G-XXXXXXXXXX"
                                        : undefined}
                                />
                                <TextField
                                    label="API Secret"
                                    type="password"
                                    value={googleApiSecret}
                                    onChange={setGoogleApiSecret}
                                    autoComplete="off"
                                    helpText="在 GA4 > 数据流 > 选择您的数据流 > Measurement Protocol API 密钥中创建新密钥"
                                />
                                <Text as="p" variant="bodySm" tone="subdued">
                                    💡 提示：如需在 Google Ads 中使用转化数据，请在 Google Ads 中设置「从 GA4 导入转化」。
                                </Text>
                            </>
                        )}

                        {serverPlatform === "tiktok" && (
                            <>
                                <TextField
                                    label="Pixel ID"
                                    value={tiktokPixelId}
                                    onChange={setTiktokPixelId}
                                    autoComplete="off"
                                    placeholder="例: C1234567890123456789"
                                />
                                <TextField
                                    label="Access Token"
                                    type="password"
                                    value={tiktokAccessToken}
                                    onChange={setTiktokAccessToken}
                                    autoComplete="off"
                                    helpText="在 TikTok Events Manager 中生成"
                                />
                            </>
                        )}

                        <Checkbox
                            label="启用服务端追踪"
                            checked={serverEnabled}
                            onChange={setServerEnabled}
                        />

                        <InlineStack gap="200">
                            <Button
                                variant="primary"
                                onClick={onSave}
                                loading={isSubmitting}
                                disabled={!serverFormDirty}
                            >
                                保存配置
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={onTestConnection}
                                loading={isSubmitting}
                                disabled={serverFormDirty ||
                                    (serverPlatform === "meta" && (!metaPixelId || !metaAccessToken))}
                            >
                                测试连接
                            </Button>
                        </InlineStack>
                        {serverFormDirty && (
                            <Text as="p" variant="bodySm" tone="caution">
                                请先保存配置后再测试连接
                            </Text>
                        )}
                    </BlockStack>
                </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
                <Card>
                    <BlockStack gap="300">
                        <Text as="h3" variant="headingMd">
                            服务端追踪状态
                        </Text>
                        {pixelConfigs &&
                            pixelConfigs.filter((c) => c.serverSideEnabled).length > 0 ? (
                            pixelConfigs
                                .filter((c) => c.serverSideEnabled)
                                .map((config) => (
                                    <Box
                                        key={config.id}
                                        background="bg-surface-secondary"
                                        padding="300"
                                        borderRadius="200"
                                    >
                                        <BlockStack gap="100">
                                            <InlineStack align="space-between">
                                                <Text as="span" fontWeight="semibold">
                                                    {config.platform === "meta"
                                                        ? "Meta CAPI"
                                                        : config.platform === "google"
                                                            ? "Google Ads"
                                                            : "TikTok"}
                                                </Text>
                                                <Badge tone="success">已启用</Badge>
                                            </InlineStack>
                                            {config.lastTestedAt && (
                                                <Text as="span" variant="bodySm" tone="subdued">
                                                    上次测试: {new Date(config.lastTestedAt).toLocaleDateString("zh-CN")}
                                                </Text>
                                            )}
                                        </BlockStack>
                                    </Box>
                                ))
                        ) : (
                            <Text as="p" tone="subdued">
                                尚未启用服务端追踪
                            </Text>
                        )}
                    </BlockStack>
                </Card>
            </Layout.Section>
        </Layout>
    );
}

