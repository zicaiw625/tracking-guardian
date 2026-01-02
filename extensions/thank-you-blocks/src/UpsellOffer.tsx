

import {
    reactExtension,
    BlockStack,
    Text,
    Button,
    InlineLayout,
    View,
    useSettings,
    useApi,
    Link,
    Divider,
    Banner,
} from "@shopify/ui-extensions-react/checkout";
import { useState, useMemo, useCallback, memo } from "react";

export default reactExtension("purchase.thank-you.block.render", () => <UpsellOffer />);

const UpsellOffer = memo(function UpsellOffer() {
    const settings = useSettings();
    const api = useApi();
    const [dismissed, setDismissed] = useState(false);
    const [copied, setCopied] = useState(false);

    const storefrontUrl = useMemo(() => {
        
        return api.shop?.storefrontUrl || "";
    }, [api.shop?.storefrontUrl]);

    const discountCode = useMemo(() => (settings.upsell_discount_code as string) || "THANKYOU10", [settings.upsell_discount_code]);
    const discountPercent = useMemo(() => {
        const discountPercentStr = settings.upsell_discount_percent as string;
        return discountPercentStr ? parseInt(discountPercentStr, 10) : 10;
    }, [settings.upsell_discount_percent]);
    const expiryHours = useMemo(() => {
        const expiryHoursStr = settings.upsell_expiry_hours as string;
        return expiryHoursStr ? parseInt(expiryHoursStr, 10) : 24;
    }, [settings.upsell_expiry_hours]);
    
    
    const continueShoppingUrl = useMemo(() => {
        const url = (settings.continue_shopping_url as string) || "/";
        if (url.startsWith("http://") || url.startsWith("https://")) {
            return url;
        }
        return storefrontUrl ? `${storefrontUrl}${url.startsWith("/") ? url : `/${url}`}` : url;
    }, [settings.continue_shopping_url, storefrontUrl]);

    const handleCopyCode = useCallback(async () => {
        try {

            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(discountCode);
            }

            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {

            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }, [discountCode]);

    const handleDismiss = useCallback(() => {
        setDismissed(true);
    }, []);

    if (dismissed) {
        return null;
    }

    return (
        <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
            <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
                <Text size="medium" emphasis="bold">
                    🎁 专属感谢优惠
                </Text>
                <Button kind="plain" onPress={handleDismiss}>
                    ✕
                </Button>
            </InlineLayout>

            <Banner status="success">
                <BlockStack spacing="extraTight">
                    <Text size="medium" emphasis="bold">
                        下次购物立减 {discountPercent}%
                    </Text>
                    <Text size="small">
                        感谢您的订单！使用以下优惠码享受下次购物折扣
                    </Text>
                </BlockStack>
            </Banner>

            <View padding="base" background="subdued" cornerRadius="base">
                <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
                    <BlockStack spacing="none">
                        <Text size="small" appearance="subdued">
                            优惠码
                        </Text>
                        <Text size="large" emphasis="bold">
                            {discountCode}
                        </Text>
                    </BlockStack>
                    <Button kind="secondary" onPress={handleCopyCode}>
                        {copied ? "已复制 ✓" : "复制"}
                    </Button>
                </InlineLayout>
            </View>

            <BlockStack spacing="tight">
                <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
                    <Text size="small">⏰</Text>
                    <Text size="small" appearance="subdued">
                        优惠码有效期 {expiryHours} 小时
                    </Text>
                </InlineLayout>
                <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
                    <Text size="small">💳</Text>
                    <Text size="small" appearance="subdued">
                        可与其他优惠叠加使用
                    </Text>
                </InlineLayout>
                <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
                    <Text size="small">🔒</Text>
                    <Text size="small" appearance="subdued">
                        每个账户仅限使用一次
                    </Text>
                </InlineLayout>
            </BlockStack>

            <Divider />

            <Link to={continueShoppingUrl}>
                <Button kind="primary">
                    继续购物 →
                </Button>
            </Link>
        </BlockStack>
    );
});
